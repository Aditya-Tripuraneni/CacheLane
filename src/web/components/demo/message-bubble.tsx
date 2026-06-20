'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';
import { Lock } from 'lucide-react';

type MessageRole = 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'stub' | 'system_note';

type Props = {
  role: MessageRole;
  content: string;
  toolName?: string;
  isStubbed?: boolean;
  tokensSaved?: number;
  animate?: boolean;
};

export function MessageBubble({ role, content, toolName, isStubbed, tokensSaved, animate = false }: Props) {
  const initialAnimation = animate ? { opacity: 0, y: 10 } : false;
  const animateAnimation = { opacity: 1, y: 0 };
  const transition = { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number] };

  if (role === 'system_note') {
    return (
      <motion.div
        initial={initialAnimation}
        animate={animateAnimation}
        transition={transition}
        className="my-4 text-center text-xs italic text-[var(--color-fg-faint)]"
      >
        {content}
      </motion.div>
    );
  }

  if (role === 'stub') {
    return (
      <motion.div
        initial={initialAnimation}
        animate={animateAnimation}
        transition={transition}
        className="my-2 flex flex-col gap-2 rounded-lg border border-dashed border-[var(--color-border)] border-l-[3px] border-l-[var(--color-warn)] bg-[var(--color-bg)] p-3"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs text-[var(--color-fg-muted)]">
            {content}
          </span>
          {tokensSaved !== undefined && (
            <span className="flex items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--color-success),transparent_80%)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-success)]">
              <Lock size={10} />
              Stubbed — {tokensSaved.toLocaleString()} tokens saved
            </span>
          )}
        </div>
      </motion.div>
    );
  }

  if (role === 'tool_call') {
    return (
      <motion.div
        initial={initialAnimation}
        animate={animateAnimation}
        transition={transition}
        className="my-2 self-start rounded-md border border-[var(--color-border)] bg-[var(--color-bg-inline)] px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <span className="rounded bg-[var(--color-fg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-bg)]">
            {toolName}
          </span>
          <span className="font-mono text-xs text-[var(--color-fg-muted)] truncate max-w-[200px] sm:max-w-[300px]">
            {content}
          </span>
        </div>
      </motion.div>
    );
  }

  if (role === 'tool_result') {
    return (
      <motion.div
        initial={initialAnimation}
        animate={animateAnimation}
        transition={transition}
        className="my-2 self-start rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elev)] max-w-[90%] overflow-hidden"
      >
        <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-inline)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-fg-faint)]">
          File / Tool Output
        </div>
        <pre className="p-3 font-mono text-[11px] text-[var(--color-fg-muted)] overflow-x-auto">
          {content}
        </pre>
      </motion.div>
    );
  }

  // user or assistant
  const isUser = role === 'user';

  return (
    <motion.div
      initial={initialAnimation}
      animate={animateAnimation}
      transition={transition}
      className={cn(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start'
      )}
    >
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-sm bg-[var(--color-accent)] text-white'
            : 'rounded-bl-sm border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg)]'
        )}
      >
        {content}
      </div>
    </motion.div>
  );
}
