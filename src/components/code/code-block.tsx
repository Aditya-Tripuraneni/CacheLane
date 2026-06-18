'use client';

import { useState, useRef } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

type CodeBlockProps = {
  children?: React.ReactNode;
  code?: string;
  className?: string;
  language?: string;
};

export function CodeBlock({ children, code, className, language = 'code' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLElement>(null);

  const copyToClipboard = () => {
    const codeElement = codeRef.current;
    if (codeElement) {
      const text = codeElement.textContent || '';
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  const content = code ?? children;

  return (
    <div className={cn('group relative', className)}>
      <button
        onClick={copyToClipboard}
        className={cn(
          'absolute right-3 top-3 flex items-center gap-1.5 rounded-md px-2 py-1',
          'text-xs font-medium transition-all duration-150',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          'bg-[var(--color-bg)] border border-[var(--color-border)]',
          'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-elev)]',
          'focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
          copied
            ? 'text-[var(--color-success)] border-[var(--color-success)]'
            : 'text-[var(--color-fg-faint)] hover:text-[var(--color-fg-muted)]'
        )}
        title="Copy to clipboard"
      >
        {copied ? (
          <>
            <Check size={14} />
            <span>Copied</span>
          </>
        ) : (
          <>
            <Copy size={14} />
            <span>Copy</span>
          </>
        )}
      </button>
      <code ref={codeRef} className="block">
        {content}
      </code>
    </div>
  );
}
