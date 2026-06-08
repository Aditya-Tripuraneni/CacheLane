'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/cn';
import type { TokenBreakdown } from './scenario-data';
import { effectiveCost, costInUSD } from './scenario-data';
import { TokenBreakdown as BreakdownCard } from './token-breakdown';

type Props = {
  breakdown: TokenBreakdown;
  variant: 'standard' | 'cachelane';
  animate?: boolean;
  savedUsd?: number;
};

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function TokenBar({ breakdown, variant, animate = true, savedUsd }: Props) {
  const [showTooltip, setShowTooltip] = useState(false);
  const cost = effectiveCost(breakdown);
  const costUsd = costInUSD(cost);
  
  // Calculate total visible tokens to compute proportional widths
  // We don't include output tokens in the stacked bar as the focus is on input/cache
  const total = breakdown.cacheRead + breakdown.cacheWrite5m + breakdown.cacheWrite1h + breakdown.input;
  
  // Handle edge case of 0 tokens
  const safeTotal = total > 0 ? total : 1;
  
  const segments = [
    {
      key: 'read',
      tokens: breakdown.cacheRead,
      color: 'var(--color-success)',
      label: 'Cache Read (0.1×)',
      percent: (breakdown.cacheRead / safeTotal) * 100,
    },
    {
      key: 'write5m',
      tokens: breakdown.cacheWrite5m,
      color: 'var(--color-warn)',
      label: 'Cache Write 5m (1.25×)',
      percent: (breakdown.cacheWrite5m / safeTotal) * 100,
    },
    {
      key: 'write1h',
      tokens: breakdown.cacheWrite1h,
      color: 'var(--color-accent)',
      label: 'Cache Write 1h (2.0×)',
      percent: (breakdown.cacheWrite1h / safeTotal) * 100,
    },
    {
      key: 'input',
      tokens: breakdown.input,
      color: 'var(--color-danger)',
      label: 'Input (1.0×)',
      percent: (breakdown.input / safeTotal) * 100,
    },
  ].filter(s => s.tokens > 0);

  return (
    <div 
      className="relative flex flex-col gap-1.5"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* Tooltip */}
      <AnimatePresence>
        {showTooltip && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 5 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-0 z-10 mb-2"
          >
            <BreakdownCard breakdown={breakdown} variant={variant} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="mb-0.5 px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-faint)] flex items-center justify-between">
        <span>Token Flow (This Turn)</span>
        {savedUsd !== undefined && savedUsd > 0 && (
          <span className="text-[var(--color-success)] bg-[color-mix(in_oklch,var(--color-success),transparent_85%)] px-1.5 py-0.5 rounded text-[9px]">
            Saved: ${savedUsd.toFixed(3)}
          </span>
        )}
      </div>

      {/* Bar container */}
      <div className="flex h-6 w-full overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-inline)]">
        {segments.map((segment) => (
          <div
            key={segment.key}
            className="h-full transition-all duration-700 ease-[cubic-bezier(0.25,0.46,0.45,0.94)]"
            style={{ 
              width: `${segment.percent}%`,
              backgroundColor: segment.color,
            }}
          />
        ))}
        {segments.length === 0 && (
          <div className="h-full w-full bg-[var(--color-border)]" />
        )}
      </div>

      {/* Labels below bar */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          {segments.map((segment) => (
            <div key={segment.key} className="flex items-center gap-1">
              <div 
                className="h-2 w-2 rounded-sm" 
                style={{ backgroundColor: segment.color }}
              />
              <span className="text-[10px] text-[var(--color-fg-muted)]">
                {formatTokens(segment.tokens)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[var(--color-fg-faint)]">Effective:</span>
          <span className={cn(
            "font-mono text-[11px] font-bold flex items-center gap-1",
            variant === 'standard' ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'
          )}>
            {cost.toLocaleString()}
            <span className="text-[10px] opacity-75 font-normal">(~${costUsd.toFixed(3)})</span>
          </span>
        </div>
      </div>
    </div>
  );
}
