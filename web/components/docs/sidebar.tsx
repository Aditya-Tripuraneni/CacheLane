'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export type NavLink = { label: string; href: string };
export type NavGroup = { title: string; links: NavLink[] };

export const SIDEBAR_NAV: NavGroup[] = [
  {
    title: 'Getting Started',
    links: [
      { label: 'Introduction & Setup', href: '/docs/getting-started' },
    ],
  },
  {
    title: 'Architecture',
    links: [
      { label: 'Technical Flow & Pruning', href: '/docs/architecture' },
      { label: 'Stub Lifecycle (Interactive)', href: '/lifecycle' },
    ],
  },
  {
    title: 'CLI Reference',
    links: [
      { label: 'CLI Commands Index', href: '/docs/cli-reference' },
    ],
  },
  {
    title: 'MCP Server',
    links: [
      { label: 'MCP Tools Reference', href: '/docs/mcp-tools' },
    ],
  },
  {
    title: 'Privacy',
    links: [
      { label: 'Privacy & Database', href: '/docs/privacy' },
    ],
  },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6">
      {SIDEBAR_NAV.map((group) => (
        <div key={group.title}>
          <p className="text-xs font-mono uppercase tracking-wider text-[var(--color-fg-faint)] mb-2 font-bold">
            {group.title}
          </p>
          <ul className="space-y-1">
            {group.links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={onNavigate}
                    className={cn(
                      'block rounded-md px-2 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-[var(--color-bg-elev)] text-[var(--color-fg)] font-semibold border-l-2 border-[var(--color-accent)] pl-1.5'
                        : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev)]/50',
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
