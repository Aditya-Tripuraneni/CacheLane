export type AgentTraceProviderName = "claude-code" | "glm" | "fake";

export type TraceBlockKind =
  | "system_prompt"
  | "tool_schema"
  | "claude_md"
  | "project_rules"
  | "prior_turn"
  | "tool_use_result_pair"
  | "file_read"
  | "retrieval_result"
  | "tool_output"
  | "user_message"
  | "stub";

export interface ScenarioWorkspaceFile {
  path: string;
  content: string;
}

export interface ScenarioSpec {
  id: string;
  title: string;
  description: string;
  prompt: string;
  turns: string[];
  workspace_files: ScenarioWorkspaceFile[];
  expected_references: string[];
  tags: string[];
}

export interface TraceToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface TraceCorpusBlock {
  id: string;
  id_token: string;
  kind: TraceBlockKind;
  file_path?: string;
  content: string;
}

export type RawTraceContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id?: string; name: string; input?: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id?: string; content: unknown };

export interface RawTraceToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

export interface RawTraceTurn {
  assistant_text?: string;
  content?: RawTraceContentBlock[];
  tool_calls?: RawTraceToolCall[];
  prompt_blocks?: TraceCorpusBlock[];
}

export interface RawTraceSession {
  session_id: string;
  provider: AgentTraceProviderName;
  scenario_id: string;
  started_at: string;
  ended_at: string;
  transcript_path?: string;
  request_summary?: Record<string, unknown>;
  command_summary?: Record<string, unknown>;
  turns: RawTraceTurn[];
}

export interface AgentTraceTurn {
  turn_number: number;
  assistant_text: string;
  tool_calls: TraceToolCall[];
  blocks_in_prompt: TraceCorpusBlock[];
}

export interface NormalizedTraceSession {
  session_id: string;
  provider: AgentTraceProviderName;
  scenario_id: string;
  source: {
    transcript_path?: string;
  };
  turns: AgentTraceTurn[];
}

export interface ProviderRunOptions {
  dry_run: boolean;
  run_id: string;
  run_dir: string;
  now: () => Date;
}

export interface ProviderAdapter {
  name: AgentTraceProviderName;
  runScenario(scenario: ScenarioSpec, options: ProviderRunOptions): Promise<RawTraceSession>;
}

export interface TraceRunReport {
  run_id: string;
  generated_at: string;
  provider: AgentTraceProviderName;
  dry_run: boolean;
  counts: {
    sessions: number;
    turns: number;
    blocks: number;
    tool_calls: number;
    referenced_candidates: number;
  };
  scenarios: Array<{
    scenario_id: string;
    session_id: string;
    turns: number;
    blocks: number;
    tool_calls: number;
    referenced_candidates: number;
  }>;
}
