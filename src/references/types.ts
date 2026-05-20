import type { BlockKind, ReferenceType } from "../types/index.js";

export interface ReferenceToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ReferenceBlock {
  id: string;
  id_token?: string;
  kind: BlockKind;
  file_path?: string;
  content: string;
}

export interface ReferenceTurn {
  turn_number: number;
  assistant_text: string;
  tool_calls: ReferenceToolCall[];
  blocks_in_prompt: ReferenceBlock[];
}

export interface DetectedReference {
  block_id: string;
  reference_type: ReferenceType;
  evidence: string;
}

export interface ReferenceResult {
  referenced_ids: Set<string>;
  references: DetectedReference[];
}
