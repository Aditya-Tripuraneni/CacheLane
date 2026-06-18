import { Info, AlertTriangle, Lightbulb, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/cn';

type Kind = 'tip' | 'note' | 'warn' | 'danger';

const meta: Record<
  Kind,
  { Icon: typeof Info; tone: string; iconColor: string; label: string }
> = {
  tip: {
    Icon: Lightbulb,
    tone: 'border-[var(--color-success)]/40 bg-[var(--color-success)]/[0.04] text-[var(--color-success)]',
    iconColor: 'text-[var(--color-success)]',
    label: 'Tip',
  },
  note: {
    Icon: Info,
    tone: 'border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-fg-muted)]',
    iconColor: 'text-[var(--color-fg-faint)]',
    label: 'Note',
  },
  warn: {
    Icon: AlertTriangle,
    tone: 'border-[var(--color-warn)]/40 bg-[var(--color-warn)]/[0.04] text-[var(--color-warn)]',
    iconColor: 'text-[var(--color-warn)]',
    label: 'Caution',
  },
  danger: {
    Icon: AlertCircle,
    tone: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/[0.04] text-[var(--color-danger)]',
    iconColor: 'text-[var(--color-danger)]',
    label: 'Important',
  },
};

export function Callout({
  kind = 'note',
  title,
  children,
}: {
  kind?: Kind;
  title?: string;
  children: React.ReactNode;
}) {
  const { Icon, tone, iconColor, label } = meta[kind];
  return (
    <aside className={cn('my-6 rounded-lg border p-4', tone)}>
      <div className={cn('flex items-center gap-2 mb-2 font-semibold text-sm')}>
        <Icon size={16} className={iconColor} />
        <span>{title ?? label}</span>
      </div>
      <div className="text-sm leading-relaxed [&_p:last-child]:mb-0 text-[var(--color-fg-muted)]">
        {children}
      </div>
    </aside>
  );
}
