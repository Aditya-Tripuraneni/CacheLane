export type Cause = "idle_expired" | "model_switch" | "compaction" | "proxy_stripped" | "prefix_changed";

/** One de-duplicated API call from a Claude Code transcript (usage metadata only). */
export interface ApiCall {
  id: string;
  model: string;
  ts: number;
  input: number;
  read: number;
  write5m: number;
  write1h: number;
}

export interface Session {
  sessionId: string;
  project: string;
  calls: ApiCall[];
  sidechainCalls: ApiCall[];
  compactAt: number[];
}

export interface Rebuild {
  call: ApiCall;
  prev: ApiCall;
  gapMs: number;
  cause: Cause;
}
