'use client';

import { useState, useEffect } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/cn';

type PreCodeBlockProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * Wraps a <pre><code> block with a copy button.
 * Usage: <PreCodeBlock><pre><code>...</code></pre></PreCodeBlock>
 */
export function PreCodeBlock({ children, className }: PreCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = (e: React.MouseEvent<HTMLButtonElement>) => {
    const button = e.currentTarget;
    const pre = button.previousElementSibling as HTMLPreElement;
    if (pre) {
      const code = pre.textContent || '';
      navigator.clipboard.writeText(code).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  return (
    <div className={cn('group relative not-prose', className)}>
      {children}
      <button
        onClick={copyToClipboard}
        className={cn(
          'absolute right-3 top-3 flex items-center gap-1.5 rounded-md px-2 py-1',
          'text-xs font-medium transition-all duration-150',
          'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          'bg-[var(--color-bg-elev)] border border-[var(--color-border)]',
          'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg)]',
          'focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
          'shadow-sm pointer-events-auto',
          copied
            ? 'text-[var(--color-success)] border-[var(--color-success)]'
            : 'text-[var(--color-fg-faint)] hover:text-[var(--color-fg)]'
        )}
        title="Copy to clipboard"
        aria-label={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? (
          <>
            <Check size={14} />
            <span className="hidden sm:inline">Copied</span>
          </>
        ) : (
          <>
            <Copy size={14} />
            <span className="hidden sm:inline">Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

/**
 * Universal wrapper for code blocks that adds copy functionality.
 * Wraps the content in proper pre/code tags.
 */
type CodeProps = {
  children: string;
  language?: string;
  className?: string;
};

export function Code({ children, language = '', className }: CodeProps) {
  return (
    <PreCodeBlock>
      <pre className={className}>
        <code className={language ? `language-${language}` : ''}>
          {children}
        </code>
      </pre>
    </PreCodeBlock>
  );
}
