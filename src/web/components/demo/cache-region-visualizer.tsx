'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Scissors } from 'lucide-react';
import { cn } from '@/lib/cn';

type RegionData = {
  stable: { tokens: number; cached: boolean; description: string };
  semi: {
    tokens: number;
    cached: boolean;
    description: string;
    stubbedBlocks?: string[];
  };
  volatile: { tokens: number; description: string };
};

type Props = {
  regions: RegionData;
  animate?: boolean;
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const standardEase: [number, number, number, number] = [0.25, 0.46, 0.45, 0.94];

export function CacheRegionVisualizer({ regions, animate = true }: Props) {
  const total = regions.stable.tokens + regions.semi.tokens + regions.volatile.tokens;
  const stablePercent = total > 0 ? (regions.stable.tokens / total) * 100 : 0;
  const semiPercent = total > 0 ? (regions.semi.tokens / total) * 100 : 0;
  const volatilePercent = total > 0 ? (regions.volatile.tokens / total) * 100 : 0;

  const regionEntries = [
    {
      key: 'stable',
      label: 'STABLE',
      color: 'var(--color-success)',
      bgClass: 'bg-[color-mix(in_oklch,var(--color-success),transparent_88%)]',
      borderClass: 'border-[var(--color-success)]',
      textClass: 'text-[var(--color-success)]',
      percent: stablePercent,
      tokens: regions.stable.tokens,
      cached: regions.stable.cached,
      description: regions.stable.description,
      icon: regions.stable.cached ? Lock : Unlock,
      breakpoint: 'Prefix Breakpoint',
      helpText: 'System instructions and tools. Cached upfront at 1.25x write cost, read at 0.1x.',
    },
    {
      key: 'semi',
      label: 'SEMI',
      color: 'var(--color-warn)',
      bgClass: 'bg-[color-mix(in_oklch,var(--color-warn),transparent_88%)]',
      borderClass: 'border-[var(--color-warn)]',
      textClass: 'text-[var(--color-warn)]',
      percent: semiPercent,
      tokens: regions.semi.tokens,
      cached: regions.semi.cached,
      description: regions.semi.description,
      icon: regions.semi.cached ? Lock : Unlock,
      breakpoint: 'Middle Breakpoint',
      stubbedBlocks: regions.semi.stubbedBlocks,
      helpText: 'Past conversation turns. Middle breakpoint caches this growing history.',
    },
    {
      key: 'volatile',
      label: 'VOLATILE',
      color: 'var(--color-danger)',
      bgClass: 'bg-[color-mix(in_oklch,var(--color-danger),transparent_88%)]',
      borderClass: 'border-[var(--color-danger)]',
      textClass: 'text-[var(--color-danger)]',
      percent: volatilePercent,
      tokens: regions.volatile.tokens,
      cached: false,
      description: regions.volatile.description,
      icon: Unlock,
      breakpoint: null,
      helpText: 'Latest user prompt & new tool results. Cannot be cached yet (1.0x cost).',
    },
  ];

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--color-fg-faint)]">
        Prompt Regions
      </h4>

      <div className="space-y-2">
        <AnimatePresence mode="wait">
          {regionEntries.map((region, i) => {
            const Icon = region.icon;
            return (
              <motion.div
                key={region.key}
                initial={animate ? { opacity: 0, x: -10 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, ease: standardEase, delay: i * 0.1 }}
                className={cn(
                  'rounded-lg border-l-[3px] p-3',
                  region.borderClass,
                  region.bgClass
                )}
              >
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] font-bold',
                        region.textClass
                      )}
                    >
                      {region.label}
                    </span>
                    {region.cached && (
                      <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-success),transparent_80%)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]">
                        <Lock size={9} />
                        cached
                      </span>
                    )}
                    {region.stubbedBlocks && region.stubbedBlocks.length > 0 && (
                      <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-warn),transparent_80%)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-warn)]">
                        <Scissors size={9} />
                        {region.stubbedBlocks.length} stubbed
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-xs font-bold text-[var(--color-fg-muted)]">
                    {formatTokens(region.tokens)}
                  </span>
                </div>

                {/* Description & Help */}
                <div className="mt-1 flex flex-col gap-1">
                  <p className="text-[11px] font-medium leading-relaxed text-[var(--color-fg)]">
                    {region.description}
                  </p>
                  <p className="text-[10px] leading-relaxed text-[var(--color-fg-faint)] italic">
                    {region.helpText}
                  </p>
                </div>

                {/* Cost multiplier */}
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[10px] text-[var(--color-fg-faint)]">
                    {region.cached ? '0.1× cost' : '1.0× cost'}
                  </span>
                  {/* Proportion bar */}
                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-border)]">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: region.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${region.percent}%` }}
                      transition={{ duration: 0.5, ease: standardEase }}
                    />
                  </div>
                </div>

                {/* Breakpoint indicator */}
                {region.breakpoint && (
                  <div className="mt-2 flex items-center gap-1 border-t border-dashed border-[var(--color-border)] pt-2">
                    <span className="text-[10px]">📌</span>
                    <span className="font-mono text-[10px] text-[var(--color-fg-faint)]">
                      {region.breakpoint}
                    </span>
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Total */}
      <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-2">
        <span className="text-[11px] font-medium text-[var(--color-fg-muted)]">
          Total prompt
        </span>
        <span className="font-mono text-xs font-bold text-[var(--color-fg)]">
          {formatTokens(total)} tokens
        </span>
      </div>
    </div>
  );
}
