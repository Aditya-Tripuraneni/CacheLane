export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <header className="mb-8 border-b border-[var(--color-border)] pb-6 sm:mb-10 sm:pb-8">
      {eyebrow && (
        <p className="text-xs font-mono text-[var(--color-fg-faint)] mb-2 uppercase tracking-wider font-bold">
          {eyebrow}
        </p>
      )}
      <h1 className="text-3xl font-bold text-[var(--color-fg)] tracking-tight leading-tight sm:text-4xl">
        {title}
      </h1>
      {description && (
        <p className="mt-3 max-w-prose text-base leading-relaxed text-[var(--color-fg-muted)] sm:text-lg">
          {description}
        </p>
      )}
    </header>
  );
}
