'use client';

import { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Monitor, Coffee, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { TokenBreakdown, CachelaneEvent, RegionSnapshot } from './scenario-data';
import { effectiveCost, costInUSD } from './scenario-data';
import { MessageBubble } from './message-bubble';
import { TokenBar } from './token-bar';
import { CacheRegionVisualizer } from './cache-region-visualizer';

export type DemoMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'stub' | 'system_note';
  content: string;
  toolName?: string;
  isStubbed?: boolean;
  tokensSaved?: number;
  turnIndex?: number;
};

type TurnStats = {
  turnIndex: number;
  breakdown: TokenBreakdown;
  events: CachelaneEvent[];
  regions?: RegionSnapshot;
  savedUsd?: number;
};

type Props = {
  variant: 'standard' | 'cachelane';
  messages: DemoMessage[];
  turnStats: TurnStats[];
  currentTurn: number;
  cumulativeCost: number;
};

function formatCost(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

const EVENT_LABELS: Record<CachelaneEvent, string> = {
  prefix_cached: '🔒 Prefix cache hit',
  middle_breakpoint_placed: '📌 Middle breakpoint placed',
  prefix_cache_write: '💾 Prefix cached (1.25× write)',
  middle_cached: '🔒 Middle cache hit',
  stub_created: '✂️ Block stubbed (K-pruning)',
  stub_expanded: '🔄 Stub expanded (lossless)',
  keepalive_sent: '💓 Keepalive ping sent',
  cache_expired: '⚠️ Cache expired (5-min TTL)',
};

const standardEase: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

export function ConversationPanel({
  variant,
  messages,
  turnStats,
  currentTurn,
  cumulativeCost: cumCost,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isStandard = variant === 'standard';

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Group messages by turn for rendering token bars
  const turnBoundaries = new Map<number, number>();
  messages.forEach((msg, idx) => {
    if (msg.turnIndex !== undefined) {
      turnBoundaries.set(msg.turnIndex, idx);
    }
  });

  const latestStats = turnStats.length > 0 ? turnStats[turnStats.length - 1] : null;

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Panel header */}
      <div
        className={cn(
          'flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3',
          isStandard
            ? 'bg-[color-mix(in_oklch,var(--color-danger),transparent_92%)]'
            : 'bg-[color-mix(in_oklch,var(--color-success),transparent_92%)]'
        )}
      >
        <div className="flex items-center gap-2">
          {isStandard ? (
            <Monitor size={16} className="text-[var(--color-danger)]" />
          ) : (
            <Coffee size={16} className="text-[var(--color-success)]" />
          )}
          <span className="text-sm font-bold text-[var(--color-fg)]">
            {isStandard ? 'Standard Claude Code' : 'With CacheLane'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {cumCost > 0 && (
            <motion.span
              key={cumCost}
              initial={{ scale: 1.2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={cn(
                'rounded-full px-2.5 py-0.5 font-mono text-xs font-bold',
                isStandard
                  ? 'bg-[color-mix(in_oklch,var(--color-danger),transparent_85%)] text-[var(--color-danger)]'
                  : 'bg-[color-mix(in_oklch,var(--color-success),transparent_85%)] text-[var(--color-success)]'
              )}
            >
              {formatCost(cumCost)} units
            </motion.span>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto p-4"
        style={{ minHeight: 300, maxHeight: 500 }}
      >
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[var(--color-fg-faint)]">
              Send a prompt to begin...
            </p>
          </div>
        )}

        {messages.map((msg, idx) => {
          // Filter messages for standard variant (no stubs, no system notes about CacheLane)
          if (isStandard && (msg.role === 'stub' || msg.role === 'system_note')) {
            return null;
          }

          const showTokenBar =
            msg.role === 'assistant' &&
            msg.turnIndex !== undefined &&
            turnStats.find((s) => s.turnIndex === msg.turnIndex);

          const stats = msg.turnIndex !== undefined
            ? turnStats.find((s) => s.turnIndex === msg.turnIndex)
            : undefined;

          return (
            <div key={msg.id}>
              <MessageBubble
                role={msg.role}
                content={msg.content}
                toolName={msg.toolName}
                isStubbed={msg.isStubbed}
                tokensSaved={msg.tokensSaved}
                animate
              />

              {/* Token bar after assistant responses */}
              {showTokenBar && stats && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.4, ease: standardEase, delay: 0.3 }}
                  className="mt-2 mb-1"
                >
                  <TokenBar
                    breakdown={stats.breakdown}
                    variant={variant}
                    animate
                  />

                  {/* CacheLane events & Impact Dashboard (only for the latest turn to reduce clutter) */}
                  {!isStandard && msg.turnIndex === currentTurn && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.8 }}
                      className="mt-4 flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 shadow-sm"
                    >
                      {/* Event Tags */}
                      {stats.events.length > 0 && (
                        <div className="mb-1 flex flex-wrap gap-1.5">
                          {stats.events.map((event, i) => (
                            <span
                              key={`${event}-${i}`}
                              className="rounded-full bg-[var(--color-bg-inline)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-fg-muted)] border border-[var(--color-border)]"
                            >
                              {EVENT_LABELS[event]}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Turn Impact Header */}
                      <div className="flex flex-col gap-2 border-b border-[var(--color-border)] pb-3">
                        <h4 className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-fg-faint)]">
                          Turn Cost Impact
                        </h4>
                        
                        {(() => {
                          if (stats.savedUsd === undefined) return null;
                          const clUnits = effectiveCost(stats.breakdown);
                          const clUsd = costInUSD(clUnits);
                          const stdUsd = clUsd + stats.savedUsd;
                          const isInvestment = stats.savedUsd < 0;
                          const absSaved = Math.abs(stats.savedUsd);

                          return (
                            <div className="flex items-end justify-between">
                              <div className="flex flex-col gap-1 text-sm">
                                <span className="text-[var(--color-fg-muted)]">Standard: <span className="font-mono text-[var(--color-danger)]">${stdUsd.toFixed(3)}</span></span>
                                <span className="font-bold text-[var(--color-fg)]">CacheLane: <span className="font-mono text-[var(--color-success)]">${clUsd.toFixed(3)}</span></span>
                              </div>
                              <div className="flex flex-col items-end">
                                <span className={cn(
                                  "text-lg font-bold font-mono",
                                  isInvestment ? "text-[var(--color-warn)]" : "text-[var(--color-success)]"
                                )}>
                                  {isInvestment ? '-' : '+'}${absSaved.toFixed(3)}
                                </span>
                                <span className="text-[10px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                                  {isInvestment ? 'Cache Investment' : 'Saved this turn'}
                                </span>
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      {/* Region Visualizer X-Ray */}
                      {stats.regions && (
                        <div className="pt-1">
                          <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-faint)]">
                            Cache Regions X-Ray
                          </h4>
                          <CacheRegionVisualizer regions={stats.regions} />
                        </div>
                      )}
                    </motion.div>
                  )}
                </motion.div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}
