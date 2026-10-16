import type { ApiCall, Cause, Rebuild, Session } from "./types.js";

export const REBUILD_MIN_WRITE = 20_000;
const HOUR = 3_600_000;
const FIVE_MIN = 300_000;

export const written = (c: ApiCall): number => c.write5m + c.write1h;
export const contextOf = (c: ApiCall): number => c.input + c.read + written(c);

/** Share of input tokens served from cache. */
export function hitRatio(calls: ApiCall[]): number {
  let read = 0;
  let all = 0;
  for (const c of calls) {
    read += c.read;
    all += contextOf(c);
  }
  return all === 0 ? 0 : read / all;
}

export function classifyRebuilds(s: Session, baseUrlSet: boolean): Rebuild[] {
  const out: Rebuild[] = [];
  const proxySuspect = baseUrlSet && hitRatio(s.calls) < 0.5;
  let ttl = FIVE_MIN;
  for (let i = 1; i < s.calls.length; i++) {
    const prev = s.calls[i - 1]!;
    const call = s.calls[i]!;
    // The TTL in force is the tier of the most recent cache write.
    if (written(prev) > 0) ttl = prev.write1h > 0 ? HOUR : FIVE_MIN;
    if (written(call) <= REBUILD_MIN_WRITE || call.read >= 0.5 * (prev.read + written(prev))) continue;
    const gapMs = call.ts - prev.ts;
    const cause: Cause =
      gapMs > ttl ? "idle_expired"
      : call.model !== prev.model ? "model_switch"
      : s.compactAt.some((t) => t > prev.ts && t <= call.ts) ? "compaction"
      : proxySuspect ? "proxy_stripped"
      : "prefix_changed";
    out.push({ call, prev, gapMs, cause });
  }
  return out;
}
