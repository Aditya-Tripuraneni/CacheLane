'use client';

import { useState, useRef, useEffect } from 'react';
import { Sparkles, ArrowUp, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { motion, AnimatePresence } from 'framer-motion';

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
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [value]);

  const handleSend = () => {
    if (value.trim() && !isAnimating && !isComplete) {
      onSend(value.trim());
      setValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const fillSuggested = () => {
    setValue(suggestedPrompt);
    textareaRef.current?.focus();
  };

  if (isComplete) {
    return (
      <div className="flex w-full flex-col items-center justify-center space-y-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-8 shadow-sm">
        <h3 className="text-xl font-bold text-[var(--color-fg)]">Demo Complete! 🎉</h3>
        <p className="text-center text-sm text-[var(--color-fg-muted)] max-w-md">
          You've seen how CacheLane's orchestration, K-pruning, and keepalive can drastically reduce token usage and costs compared to standard caching.
        </p>
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
    <div className="flex w-full flex-col gap-2">
      {/* Suggested prompt chip */}
      <div className="flex justify-start">
        <button
          onClick={fillSuggested}
          disabled={isAnimating}
          className="group flex max-w-full items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-inline)] px-3 py-1.5 text-left transition-colors hover:border-[var(--color-accent)] hover:bg-[color-mix(in_oklch,var(--color-accent),transparent_95%)] disabled:opacity-50"
        >
          <Sparkles size={12} className="shrink-0 text-[var(--color-accent)]" />
          <span className="truncate font-mono text-[11px] text-[var(--color-fg-muted)] group-hover:text-[var(--color-fg)]">
            Suggested: {suggestedPrompt}
          </span>
        </button>
      </div>

      {/* Input area */}
      <div className="relative flex w-full items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-2 shadow-sm transition-colors focus-within:border-[var(--color-accent)] focus-within:ring-1 focus-within:ring-[var(--color-accent)]">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isAnimating}
          placeholder="Type a message or use the suggested prompt..."
          className="max-h-[120px] min-h-[24px] w-full resize-none bg-transparent py-2 pl-3 text-sm text-[var(--color-fg)] placeholder:text-[var(--color-fg-faint)] focus:outline-none disabled:opacity-50"
          rows={1}
        />
        <div className="flex shrink-0 items-center gap-2 pb-1 pr-1">
          <AnimatePresence>
            {currentTurn > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={onReset}
                disabled={isAnimating}
                title="Reset conversation"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-fg-faint)] transition-colors hover:bg-[var(--color-bg-elev)] hover:text-[var(--color-fg)] disabled:opacity-50"
              >
                <RotateCcw size={16} />
              </motion.button>
            )}
          </AnimatePresence>
          <button
            onClick={handleSend}
            disabled={!value.trim() || isAnimating}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-fg-faint)]"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
      
      {/* Turn indicator */}
      <div className="flex justify-between px-2 text-[11px] text-[var(--color-fg-faint)]">
        <span>Turn {currentTurn + 1} of {totalTurns}</span>
        {isAnimating && <span className="animate-pulse">Thinking...</span>}
      </div>
    </div>
  );
}
