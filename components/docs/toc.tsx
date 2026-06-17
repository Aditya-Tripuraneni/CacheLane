'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

type Heading = { id: string; text: string; level: 2 | 3 };

export function Toc() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const els = Array.from(
      document.querySelectorAll<HTMLElement>('article h2[id], article h3[id]'),
    );

    setHeadings(
      els.map((el) => ({
        id: el.id,
        text: el.innerText,
        level: el.tagName === 'H2' ? 2 : 3,
      })),
    );

    if (els.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) {
          setActive(visible[0].target.id);
        }
      },
      { rootMargin: '-80px 0px -70% 0px' },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <nav className="text-sm" aria-label="Table of contents">
      <p className="text-xs font-mono uppercase tracking-wider text-[var(--color-fg-faint)] mb-3 font-bold">
        On this page
      </p>
      <ul className="space-y-2 border-l border-[var(--color-border)]">
        {headings.map((h) => (
          <li key={h.id} className={cn(h.level === 3 && 'pl-3')}>
            <a
              href={`#${h.id}`}
              className={cn(
                '-ml-px block border-l pl-3 py-0.5 transition-colors text-xs',
                active === h.id
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-semibold'
                  : 'border-transparent text-[var(--color-fg-faint)] hover:text-[var(--color-fg-muted)]',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
