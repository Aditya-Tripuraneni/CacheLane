import { globMatch } from "../classifier/glob.js";
import { countCompressionTokens } from "./token-accounting.js";
import { detectContentType, routeCompression } from "./registry.js";
import { matchProfile } from "./shell-profiles.js";
import type {
  AnthropicMessage,
  BlockCompressEvent,
  CompressOptions,
  CompressorConfig,
  CompressResult,
  ContentType,
  ToolResultContentBlock,
} from "./types.js";

export { detectContentType } from "./registry.js";
export type {
  ContentType,
  CompressResult,
  BlockCompressEvent,
  CompressorConfig,
  CompressionMode,
  ToolOutputCompressor,
} from "./types.js";

interface CommandInfo {
  command: string;
  exit_code?: number;
}

function buildCommandMap(messages: AnthropicMessage[]): Map<string, CommandInfo> {
  const map = new Map<string, CommandInfo>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "tool_use" &&
        (block as { name?: string }).name === "Bash"
      ) {
        const id = (block as { id?: string }).id;
        const input = (block as { input?: unknown }).input;
        const command =
          typeof input === "object" && input !== null && typeof (input as { command?: unknown }).command === "string"
            ? (input as { command: string }).command
            : undefined;
        const exitCodeRaw = typeof input === "object" && input !== null ? (input as { exit_code?: unknown }).exit_code : undefined;
        const exit_code = typeof exitCodeRaw === "number" ? exitCodeRaw : undefined;
        if (typeof id === "string" && command !== undefined) {
          map.set(id, { command, exit_code });
        }
      }
    }
  }
  return map;
}

function extractToolResultText(block: ToolResultContentBlock): string | null {
  if (typeof block.content === "string") return block.content;
  // Array-shaped tool_result content can mix text and images. Until we have a
  // structure-preserving transformer, leave it untouched rather than risking
  // corruption by flattening or duplicating content.
  if (Array.isArray(block.content)) return null;
  return null;
}

function replaceToolResultText(
  block: ToolResultContentBlock,
  newText: string
): ToolResultContentBlock {
  if (typeof block.content === "string") {
    return { ...block, content: newText };
  }
  if (Array.isArray(block.content)) {
    const newContent = block.content.map((b) =>
      b.type === "text" ? { ...b, text: newText } : b
    );
    return { ...block, content: newContent };
  }
  return block;
}

function maybeRetainOriginal(params: {
  block: ToolResultContentBlock;
  text: string;
  originalTokens: number;
  routed: {
    content_type: ContentType;
    compressor_id: string;
    lossiness: "lossless" | "lossy" | "passthrough";
  };
  mode: "lossless" | "balanced" | "aggressive";
  config: CompressorConfig;
  options: CompressOptions;
  is_failure: boolean;
}): string | undefined {
  const retention = params.config.retention;
  if (
    retention?.enabled !== true ||
    params.options.retainOriginal === undefined ||
    params.routed.lossiness !== "lossy" ||
    (params.originalTokens < retention.min_original_tokens && !params.is_failure)
  ) {
    return undefined;
  }

  const createdAt = params.options.now_ms ?? Date.now();
  const expiresAt = createdAt + retention.ttl_days * 24 * 60 * 60 * 1000;
  return params.options.retainOriginal({
    tool_use_id: params.block.tool_use_id,
    original_text: params.text,
    original_tokens: params.originalTokens,
    content_type: params.routed.content_type,
    compressor_id: params.routed.compressor_id,
    mode: params.mode,
    lossiness: params.routed.lossiness,
    created_at: createdAt,
    expires_at: expiresAt,
  }) ?? undefined;
}

function addRetrievalMarker(content: string, contentType: ContentType, handle: string): string {
  if (contentType === "json") {
    try {
      return JSON.stringify({
        __cachelane_compressed: true,
        retrieval_handle: handle,
        content: JSON.parse(content) as unknown,
      });
    } catch {
      // Fall through to text marker if the compressor produced unexpected JSON.
    }
  }

  return [
    `[CacheLane compressed: original available via cachelane_retrieve_tool_output handle=${handle}]`,
    content,
  ].join("\n");
}

function compressBlock(
  block: ToolResultContentBlock,
  config: CompressorConfig,
  options: CompressOptions,
  commandInfo: CommandInfo | undefined,
): { compressed: ToolResultContentBlock; event: BlockCompressEvent } | null {
  if (config.exclude.some((pattern) => globMatch(pattern, block.tool_use_id))) return null;

  const text = extractToolResultText(block);
  if (text === null) return null;

  const mode = config.mode ?? "lossless";
  const originalTokens = countCompressionTokens(text, options.model);
  const start = performance.now();

  try {
    const detectedType = detectContentType(text);
    if (
      (detectedType === "json" && config.compressors?.json === false) ||
      (detectedType === "log" && config.compressors?.log === false)
    ) {
      return null;
    }

    const candidateProfile = commandInfo !== undefined ? matchProfile(commandInfo.command) : null;
    const shellEnabled = config.compressors?.shell !== false;
    const profileEnabled =
      candidateProfile === null || config.shell_profiles?.[candidateProfile.id] !== false;
    const shellAllowed = shellEnabled && profileEnabled;
    const effectiveCommand = shellAllowed ? commandInfo?.command : undefined;
    const effectiveExitCode = shellAllowed ? commandInfo?.exit_code : undefined;

    const routed = routeCompression({
      tool_use_id: block.tool_use_id,
      content: text,
      mode,
      json_max_array_items: config.json_max_array_items,
      command: effectiveCommand,
      exit_code: effectiveExitCode,
    });

    const profileId =
      routed.compressor_id === "shell" ? candidateProfile?.id : undefined;

    const initialCompressedTokens = countCompressionTokens(routed.content, options.model);
    const initiallySmaller = initialCompressedTokens < originalTokens;
    const retentionHandle = initiallySmaller
      ? maybeRetainOriginal({
        block,
        text,
        originalTokens,
        routed,
        mode,
        config,
        options,
        is_failure: commandInfo?.exit_code !== undefined && commandInfo.exit_code !== 0,
      })
      : undefined;
    const finalText = retentionHandle !== undefined
      ? addRetrievalMarker(routed.content, routed.content_type, retentionHandle)
      : routed.content;
    const finalCompressedTokens = countCompressionTokens(finalText, options.model);
    const useCompressed = finalCompressedTokens < originalTokens;
    if (!useCompressed && retentionHandle !== undefined) {
      options.discardOriginal?.(retentionHandle);
    }
    const finalBlock = useCompressed ? replaceToolResultText(block, finalText) : block;
    const latencyMs = performance.now() - start;
    const effectiveRetentionHandle = useCompressed ? retentionHandle : undefined;

    return {
      compressed: finalBlock,
      event: {
        tool_use_id: block.tool_use_id,
        content_type: routed.content_type,
        original_tokens: originalTokens,
        compressed_tokens: useCompressed ? finalCompressedTokens : originalTokens,
        tokens_saved: useCompressed ? originalTokens - finalCompressedTokens : 0,
        compressor_id: routed.compressor_id,
        profile_id: useCompressed ? profileId : undefined,
        mode,
        lossiness: useCompressed ? routed.lossiness : "passthrough",
        outcome: effectiveRetentionHandle !== undefined ? "retrieval_backed" : useCompressed ? "compressed" : "passthrough",
        latency_ms: latencyMs,
        token_model: options.model,
        retention_handle: effectiveRetentionHandle,
      },
    };
  } catch {
    const latencyMs = performance.now() - start;
    return {
      compressed: block,
      event: {
        tool_use_id: block.tool_use_id,
        content_type: "passthrough",
        original_tokens: originalTokens,
        compressed_tokens: originalTokens,
        tokens_saved: 0,
        compressor_id: "passthrough",
        mode,
        lossiness: "passthrough",
        outcome: "error",
        latency_ms: latencyMs,
        token_model: options.model,
      },
    };
  }
}

/**
 * Compress tool_result content blocks in the messages array.
 * Non-tool_result messages and disabled config pass through unchanged.
 * Never throws — any error returns the original message.
 */
export function compress(
  messages: AnthropicMessage[],
  config: CompressorConfig,
  options: CompressOptions = {},
): CompressResult {
  if (!config.enabled) {
    return { messages, events: [] };
  }

  const events: BlockCompressEvent[] = [];
  const commandMap = buildCommandMap(messages);
  const newMessages = messages.map((msg) => {
    try {
      let changed = false;
      const newContent = msg.content.map((block) => {
        if (
          typeof block !== "object" ||
          block === null ||
          (block as { type?: string }).type !== "tool_result"
        ) {
          return block;
        }

        const toolBlock = block as ToolResultContentBlock;
        const result = compressBlock(toolBlock, config, options, commandMap.get(toolBlock.tool_use_id));
        if (!result) return block;

        events.push(result.event);
        if (result.compressed !== toolBlock) changed = true;
        return result.compressed;
      });

      return changed ? { ...msg, content: newContent } : msg;
    } catch {
      return msg;
    }
  });

  return { messages: newMessages, events };
}
