'use client';

import { cn } from '@/lib/cn';
import type { TokenBreakdown } from './scenario-data';
import { effectiveCost } from './scenario-data';

type Props = {
  breakdown: TokenBreakdown;
  variant: 'standard' | 'cachelane';
};

function padRight(str: string, len: number) {
  return str + ' '.repeat(Math.max(0, len - str.length));
}

function padLeft(str: string, len: number) {
  return ' '.repeat(Math.max(0, len - str.length)) + str;
}

export function TokenBreakdown({ breakdown, variant }: Props) {
  const cost = effectiveCost(breakdown);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between border-b border-[var(--color-border)] pb-2">
        <span className="text-xs font-bold text-[var(--color-fg)]">Cost Calculation</span>
        <span className="rounded bg-[var(--color-bg-inline)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)]">
          {variant}
        </span>
      </div>

      <div className="font-mono text-[11px] leading-relaxed text-[var(--color-fg-muted)]">
        {/* Table headers */}
        <div className="flex mb-1 border-b border-dashed border-[var(--color-border)] pb-1">
          <span className="w-24">Type</span>
          <span className="w-16 text-right">Tokens</span>
          <span className="w-12 text-right">Mult</span>
          <span className="w-16 text-right">Cost</span>
        </div>

        {/* Rows */}
        {breakdown.input > 0 && (
          <div className="flex py-0.5">
            <span className="w-24 text-[var(--color-danger)]">Input</span>
            <span className="w-16 text-right">{breakdown.input.toLocaleString()}</span>
            <span className="w-12 text-right text-[var(--color-fg-faint)]">×1.0</span>
            <span className="w-16 text-right text-[var(--color-fg)]">{(breakdown.input * 1.0).toLocaleString()}</span>
          </div>
        )}
        
        {breakdown.cacheRead > 0 && (
          <div className="flex py-0.5">
            <span className="w-24 text-[var(--color-success)]">Cache Read</span>
            <span className="w-16 text-right">{breakdown.cacheRead.toLocaleString()}</span>
            <span className="w-12 text-right text-[var(--color-fg-faint)]">×0.1</span>
            <span className="w-16 text-right text-[var(--color-fg)]">{(breakdown.cacheRead * 0.1).toLocaleString()}</span>
          </div>
        )}

        {breakdown.cacheWrite5m > 0 && (
          <div className="flex py-0.5">
            <span className="w-24 text-[var(--color-warn)]">Write (5m)</span>
            <span className="w-16 text-right">{breakdown.cacheWrite5m.toLocaleString()}</span>
            <span className="w-12 text-right text-[var(--color-fg-faint)]">×1.25</span>
            <span className="w-16 text-right text-[var(--color-fg)]">{(breakdown.cacheWrite5m * 1.25).toLocaleString()}</span>
          </div>
        )}

        {breakdown.cacheWrite1h > 0 && (
          <div className="flex py-0.5">
            <span className="w-24 text-[var(--color-accent)]">Write (1h)</span>
            <span className="w-16 text-right">{breakdown.cacheWrite1h.toLocaleString()}</span>
            <span className="w-12 text-right text-[var(--color-fg-faint)]">×2.0</span>
            <span className="w-16 text-right text-[var(--color-fg)]">{(breakdown.cacheWrite1h * 2.0).toLocaleString()}</span>
          </div>
        )}

        {/* Footer */}
        <div className="mt-1 flex border-t border-[var(--color-border)] pt-1 font-bold">
          <span className="w-24 text-[var(--color-fg)]">Effective</span>
          <span className="w-16 text-right text-[var(--color-fg-faint)]">
            {(breakdown.input + breakdown.cacheRead + breakdown.cacheWrite5m + breakdown.cacheWrite1h).toLocaleString()}
          </span>
          <span className="w-12 text-right"></span>
          <span className={cn(
            "w-16 text-right",
            variant === 'standard' ? 'text-[var(--color-danger)]' : 'text-[var(--color-success)]'
          )}>
            {cost.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}
