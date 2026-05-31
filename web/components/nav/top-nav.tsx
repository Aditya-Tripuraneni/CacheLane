import Link from 'next/link';
import { Github, Coffee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MobileDrawer } from './mobile-drawer';
import { Search } from '@/components/docs/search';

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="flex items-center gap-2 font-mono text-sm font-bold tracking-tight text-[var(--color-fg)]"
          >
            <Coffee size={18} className="text-[var(--color-accent)]" />
            <span>cachelane</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <Link
              href="/docs/getting-started"
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors font-medium"
            >
              Docs
            </Link>
            <Link
              href="/docs/architecture"
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors font-medium"
            >
              Architecture
            </Link>
            <Link
              href="/docs/cli-reference"
              className="text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors font-medium"
            >
              CLI Reference
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden sm:block">
            <Search />
          </div>
          <a
            href="https://github.com/Aditya-Tripuraneni/CacheLane"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-[var(--color-fg-faint)] transition-colors hover:text-[var(--color-fg)]"
          >
            <Github size={18} />
          </a>
          <Button variant="primary" href="/docs/getting-started">
            Install
          </Button>
          <MobileDrawer />
        </div>
      </div>
    </header>
  );
}
