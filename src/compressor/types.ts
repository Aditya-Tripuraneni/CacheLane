import type {
  AnthropicImageContent,
  AnthropicMessage,
  AnthropicTextContent,
  AnthropicToolResultContent,
} from "../orchestrator/types.js";

export type { AnthropicMessage } from "../orchestrator/types.js";

export type ContentType = "json" | "log" | "shell" | "passthrough";
export type CompressionMode = "lossless" | "balanced" | "aggressive";
export type CompressionLossiness = "lossless" | "lossy" | "passthrough";
export type CompressionOutcome = "compressed" | "passthrough" | "skipped" | "error" | "retrieval_backed";

export interface BlockCompressEvent {
  tool_use_id: string;
  content_type: ContentType;
  original_tokens: number;
  compressed_tokens: number;
  tokens_saved: number;
  compressor_id?: string;
  profile_id?: string;
  mode?: CompressionMode;
  lossiness?: CompressionLossiness;
  outcome?: CompressionOutcome;
  latency_ms?: number;
  token_model?: string;
  retention_handle?: string;
}

export interface CompressResult {
  messages: AnthropicMessage[];
  events: BlockCompressEvent[];
}

export type ToolResultInnerBlock = AnthropicTextContent | AnthropicImageContent;

export type ToolResultContentBlock = AnthropicToolResultContent;

export interface CompressorConfig {
  enabled: boolean;
  exclude: string[];
  json_max_array_items: number;
  mode?: CompressionMode;
  compressors?: {
    json: boolean;
    log: boolean;
    shell: boolean;
  };
  shell_profiles?: Record<string, boolean>;
  retention?: {
    enabled: boolean;
    min_original_tokens: number;
    ttl_days: number;
  };
}

export interface CompressorInput {
  tool_use_id: string;
  content: string;
  mode: CompressionMode;
  json_max_array_items: number;
  command?: string;
  exit_code?: number;
}

export interface DetectionResult {
  matched: boolean;
  confidence: number;
  content_type: ContentType;
}

export interface CompressorOutput {
  content: string;
  content_type: ContentType;
  compressor_id: string;
  lossiness: CompressionLossiness;
}

export interface ToolOutputCompressor {
  id: string;
  supportedModes: CompressionMode[];
  detect(input: CompressorInput): DetectionResult;
  compress(input: CompressorInput): CompressorOutput;
}

export interface CompressOptions {
  model?: string;
  retainOriginal?: (record: CompressionOriginalRecord) => string | null;
  discardOriginal?: (handle: string) => void;
  now_ms?: number;
}

export interface CompressionOriginalRecord {
  tool_use_id: string;
  original_text: string;
  original_tokens: number;
  content_type: ContentType;
  compressor_id: string;
  mode: CompressionMode;
  lossiness: CompressionLossiness;
  created_at: number;
  expires_at: number | null;
}
