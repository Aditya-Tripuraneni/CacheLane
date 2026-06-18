'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

type CostDataPoint = {
  turn: number;
  standardCumulative: number;
  cachelaneCumulative: number;
};

type Props = {
  data: CostDataPoint[];
  currentTurn: number;
};

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(0);
}

export function CostChart({ data, currentTurn }: Props) {
  const visibleData = data.filter((d) => d.turn <= currentTurn);
  const maxCost = Math.max(
    ...data.map((d) => Math.max(d.standardCumulative, d.cachelaneCumulative)),
    1
  );

  const savings =
    currentTurn > 0 && visibleData.length > 0
      ? (() => {
          const last = visibleData[visibleData.length - 1];
          if (!last || last.standardCumulative === 0) return 0;
          return Math.round(
            ((last.standardCumulative - last.cachelaneCumulative) /
              last.standardCumulative) *
              100
          );
        })()
      : 0;

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--color-fg)]">
            Cumulative Cost
          </h3>
          <p className="text-xs text-[var(--color-fg-faint)]">
            Effective cost units per turn
          </p>
        </div>
        {savings > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-full bg-[color-mix(in_oklch,var(--color-success),transparent_85%)] px-3 py-1 text-xs font-bold text-[var(--color-success)]"
          >
            {savings}% saved
          </motion.div>
        )}
      </div>

      {/* Legend */}
      <div className="mb-3 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--color-danger)]" />
          <span className="text-[var(--color-fg-muted)]">Standard</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--color-success)]" />
          <span className="text-[var(--color-fg-muted)]">CacheLane</span>
        </span>
      </div>

      {/* Chart area */}
      <div className="flex items-end gap-2" style={{ height: 180 }}>
        {data.map((point) => {
          const isVisible = point.turn <= currentTurn;
          const stdHeight = isVisible
            ? (point.standardCumulative / maxCost) * 160
            : 0;
          const clHeight = isVisible
            ? (point.cachelaneCumulative / maxCost) * 160
            : 0;

          return (
            <div
              key={point.turn}
              className="flex flex-1 flex-col items-center gap-1"
            >
              {/* Bars container */}
              <div className="flex w-full items-end justify-center gap-1" style={{ height: 160 }}>
                {/* Standard bar */}
                <div className="relative flex w-5 flex-col items-center justify-end sm:w-7">
                  <motion.div
                    className={cn(
                      'w-full rounded-t-md',
                      isVisible
                        ? 'bg-[var(--color-danger)]'
                        : 'bg-[var(--color-border)]'
                    )}
                    initial={{ height: 0 }}
                    animate={{ height: stdHeight }}
                    transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.1 }}
                  />
                  {isVisible && stdHeight > 24 && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.5 }}
                      className="absolute top-1 text-[9px] font-bold text-white"
                    >
                      {formatNumber(point.standardCumulative)}
                    </motion.span>
                  )}
                </div>

                {/* CacheLane bar */}
                <div className="relative flex w-5 flex-col items-center justify-end sm:w-7">
                  <motion.div
                    className={cn(
                      'w-full rounded-t-md',
                      isVisible
                        ? 'bg-[var(--color-success)]'
                        : 'bg-[var(--color-border)]'
                    )}
                    initial={{ height: 0 }}
                    animate={{ height: clHeight }}
                    transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94], delay: 0.2 }}
                  />
                  {isVisible && clHeight > 24 && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.6 }}
                      className="absolute top-1 text-[9px] font-bold text-white"
                    >
                      {formatNumber(point.cachelaneCumulative)}
                    </motion.span>
                  )}
                </div>
              </div>

              {/* Turn label */}
              <span
                className={cn(
                  'text-[10px] font-medium',
                  point.turn === currentTurn
                    ? 'text-[var(--color-accent)]'
                    : 'text-[var(--color-fg-faint)]'
                )}
              >
                T{point.turn}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
