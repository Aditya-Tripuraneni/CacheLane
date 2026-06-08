'use client';

import { Sparkles, RotateCcw } from 'lucide-react';

import { SCENARIO, cumulativeCost, costInUSD, quotaPercent } from './scenario-data';

type Props = {
  suggestedPrompt: string;
  currentTurn: number;
  totalTurns: number;
  isAnimating: boolean;
  onSend: (prompt: string) => void;
  onReset: () => void;
  isComplete: boolean;
};

export function PromptInput({
  suggestedPrompt,
  currentTurn,
  totalTurns,
  isAnimating,
  onSend,
  onReset,
  isComplete,
}: Props) {
  if (isComplete) {
    const stdUnits = cumulativeCost(SCENARIO, totalTurns, 'standard');
    const clUnits = cumulativeCost(SCENARIO, totalTurns, 'cachelane');
    
    const stdUsd = costInUSD(stdUnits);
    const clUsd = costInUSD(clUnits);
    const savedUsd = stdUsd - clUsd;

    const stdQuota = quotaPercent(stdUnits);
    const clQuota = quotaPercent(clUnits);

    return (
      <div className="flex w-full flex-col items-center justify-center space-y-6 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6 md:p-8 shadow-sm">
        <h3 className="text-2xl font-serif text-[var(--color-fg)]">Demo Complete! 🎉</h3>
        <p className="max-w-xl text-center text-sm leading-relaxed text-[var(--color-fg-muted)]">
          You've seen how CacheLane's orchestration reduces token usage. 
          Here's how that translates to your wallet and your Claude API limits.
        </p>
        
        <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-2 mt-4">
          {/* Monetary Savings Card */}
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-sm">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg-faint)]">Session API Cost</h4>
              <div className="mt-4 flex items-baseline justify-between">
                <span className="text-sm text-[var(--color-fg-muted)]">Standard:</span>
                <span className="font-mono text-sm text-[var(--color-danger)]">${stdUsd.toFixed(3)}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-sm font-bold text-[var(--color-fg)]">CacheLane:</span>
                <span className="font-mono text-xl font-bold text-[var(--color-success)]">${clUsd.toFixed(3)}</span>
              </div>
            </div>
            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
                You saved <strong className="text-[var(--color-success)]">${savedUsd.toFixed(2)}</strong> in just 7 turns. At 50 sessions/month, that's <strong className="text-[var(--color-success)]">${(savedUsd * 50).toFixed(2)}/mo</strong> saved.
              </p>
            </div>
          </div>

          {/* Claude Pro Quota Card */}
          <div className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-5 shadow-sm">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--color-fg-faint)]">Claude Pro Limit Impact</h4>
              <div className="mt-4 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--color-fg-muted)]">Standard Limit Used</span>
                  <span className="font-mono text-[var(--color-danger)]">{stdQuota.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div className="h-full bg-[var(--color-danger)]" style={{ width: `${stdQuota}%` }} />
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[var(--color-fg)]">CacheLane Limit Used</span>
                  <span className="font-mono font-bold text-[var(--color-success)]">{clQuota.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div className="h-full bg-[var(--color-success)]" style={{ width: `${clQuota}%` }} />
                </div>
              </div>
            </div>
            <div className="border-t border-[var(--color-border)] pt-3">
              <p className="text-xs leading-relaxed text-[var(--color-fg-muted)]">
                CacheLane helps you stay comfortably within the $20/mo Pro plan limits instead of needing the $100/mo Max 5x plan for deep context workflows.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={onReset}
          className="mt-4 flex items-center gap-2 rounded-lg bg-[var(--color-fg)] px-6 py-2.5 text-sm font-bold text-[var(--color-bg)] transition-colors hover:opacity-90"
        >
          <RotateCcw size={16} />
          Restart Demo
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center justify-center gap-6 py-4">
      {/* Turn 0 Greeting */}
      {currentTurn === 0 && (
        <div className="flex flex-col items-center justify-center pt-8 pb-4">
          <div className="mb-4 flex h-12 w-12 items-center justify-center text-[var(--color-accent)]">
            <Sparkles size={32} strokeWidth={1.5} />
          </div>
          <h2 className="text-3xl font-serif text-[var(--color-fg)]">Welcome to CacheLane</h2>
          <p className="mt-3 text-[var(--color-fg-muted)]">
            Click the prompt below to start the interactive simulation.
          </p>
        </div>
      )}

      <div className="flex w-full max-w-2xl flex-col items-center gap-3">
        {/* Clickable Prompt Chip */}
        <button
          onClick={() => onSend(suggestedPrompt)}
          disabled={isAnimating}
          className="group relative flex w-full items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 text-left shadow-sm transition-all hover:border-[var(--color-accent)] hover:shadow-md disabled:cursor-wait disabled:opacity-50"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklch,var(--color-accent),transparent_90%)] text-[var(--color-accent)] transition-transform group-hover:scale-110">
            <Sparkles size={20} />
          </div>
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-bold text-[var(--color-fg)] transition-colors group-hover:text-[var(--color-accent)]">
              {currentTurn === 0 ? 'Start Demo' : 'Next Prompt'}
            </span>
            <span className="truncate text-[13px] text-[var(--color-fg-muted)]">
              "{suggestedPrompt}"
            </span>
          </div>
        </button>

        {/* Turn Status & Controls */}
        <div className="flex w-full items-center justify-between px-2 pt-1 text-xs text-[var(--color-fg-faint)]">
          <div className="flex items-center gap-2">
            <span>
              Turn {currentTurn + 1} of {totalTurns}
            </span>
            {isAnimating && (
              <span className="animate-pulse font-medium text-[var(--color-accent)]">
                Simulating...
              </span>
            )}
          </div>
          {currentTurn > 0 && !isAnimating && (
            <button
              onClick={onReset}
              className="flex items-center gap-1 transition-colors hover:text-[var(--color-fg)]"
            >
              <RotateCcw size={12} /> Restart
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
