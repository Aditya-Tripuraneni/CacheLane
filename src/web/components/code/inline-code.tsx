export function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[0.88em] rounded px-1.5 py-0.5 bg-[var(--color-bg-inline)] border border-[var(--color-border)] text-[var(--color-fg)]">
      {children}
    </code>
  );
}
