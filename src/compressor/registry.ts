import { compressJson } from "./json-compress.js";
import { compressLog } from "./log-compress.js";
import { compressShell } from "./shell-compress.js";
import type {
  CompressorInput,
  CompressorOutput,
  DetectionResult,
  ToolOutputCompressor,
} from "./types.js";

const LOG_LINE_PATTERNS: RegExp[] = [
  /^\d{4}-\d{2}-\d{2}/,
  /\[INFO\]/i,
  /\[ERROR\]/i,
  /\[WARN\]/i,
  /\[DEBUG\]/i,
  /\bDEBUG\b/,
  /\bTRACE\b/,
];

export function detectContentType(text: string): "json" | "log" | "passthrough" {
  try {
    JSON.parse(text);
    return "json";
  } catch {
    // not JSON
  }

  const lines = text.split("\n").slice(0, 50);
  if (lines.length > 0) {
    const logCount = lines.filter((l) =>
      LOG_LINE_PATTERNS.some((p) => p.test(l))
    ).length;
    if (logCount / lines.length > 0.4) return "log";
  }

  return "passthrough";
}

function jsonDetection(input: CompressorInput): DetectionResult {
  return detectContentType(input.content) === "json"
    ? { matched: true, confidence: 100, content_type: "json" }
    : { matched: false, confidence: 0, content_type: "passthrough" };
}

function logDetection(input: CompressorInput): DetectionResult {
  return detectContentType(input.content) === "log"
    ? { matched: true, confidence: 80, content_type: "log" }
    : { matched: false, confidence: 0, content_type: "passthrough" };
}

export const shellCompressor: ToolOutputCompressor = {
  id: "shell",
  supportedModes: ["lossless", "balanced", "aggressive"],
  detect: (input) =>
    compressShell(input) !== null
      ? { matched: true, confidence: 100, content_type: "shell" }
      : { matched: false, confidence: 0, content_type: "passthrough" },
  compress: (input) => {
    const result = compressShell(input);
    if (result === null) {
      return { content: input.content, content_type: "passthrough", compressor_id: "passthrough", lossiness: "passthrough" };
    }
    return result.output;
  },
};

export const jsonCompressor: ToolOutputCompressor = {
  id: "json",
  supportedModes: ["lossless", "balanced", "aggressive"],
  detect: jsonDetection,
  compress: (input) => ({
    content: compressJson(input.content, input.json_max_array_items, input.mode),
    content_type: "json",
    compressor_id: "json",
    lossiness: input.mode === "lossless" ? "lossless" : "lossy",
  }),
};

export const logCompressor: ToolOutputCompressor = {
  id: "log",
  supportedModes: ["lossless", "balanced", "aggressive"],
  detect: logDetection,
  compress: (input) => {
    const content = input.mode === "lossless" ? input.content : compressLog(input.content);
    return {
      content,
      content_type: "log",
      compressor_id: "log",
      lossiness: content === input.content ? "lossless" : "lossy",
    };
  },
};

export const passthroughCompressor: ToolOutputCompressor = {
  id: "passthrough",
  supportedModes: ["lossless", "balanced", "aggressive"],
  detect: () => ({ matched: true, confidence: -1, content_type: "passthrough" }),
  compress: (input) => ({
    content: input.content,
    content_type: "passthrough",
    compressor_id: "passthrough",
    lossiness: "passthrough",
  }),
};

export function createDefaultRegistry(): ToolOutputCompressor[] {
  return [shellCompressor, jsonCompressor, logCompressor, passthroughCompressor];
}

export function routeCompression(
  input: CompressorInput,
  registry: ToolOutputCompressor[] = createDefaultRegistry(),
): CompressorOutput {
  const compressor = registry.find((candidate) => {
    if (!candidate.supportedModes.includes(input.mode)) return false;
    return candidate.detect(input).matched;
  });

  try {
    return (compressor ?? passthroughCompressor).compress(input);
  } catch {
    return passthroughCompressor.compress(input);
  }
}
