import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { ReactNode, ComponentPropsWithoutRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const variants: Record<Variant, string> = {
  primary: [
    'bg-[var(--color-accent)] text-[var(--color-accent-fg)]',
    'hover:brightness-105 shadow-sm active:scale-[0.98]',
  ].join(' '),
  secondary: [
    'bg-[var(--color-bg-elev)] text-[var(--color-fg)]',
    'border border-[var(--color-border)]',
    'hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-inline)] active:scale-[0.98]',
  ].join(' '),
  ghost: 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev)]/50',
};

type Props = {
  variant?: Variant;
  href?: string;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<'button'>, 'className' | 'children'>;

export function Button({
  variant = 'primary',
  href,
  children,
  className,
  ...rest
}: Props) {
  const cls = cn(
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2',
    'text-sm font-medium whitespace-nowrap',
    'transition-all duration-150',
    variants[variant],
    className,
  );

  if (href) {
    const isExternal = href.startsWith('http');
    if (isExternal) {
      return (
        <a href={href} className={cls} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }

  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}
