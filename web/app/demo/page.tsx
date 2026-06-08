import type { Metadata } from 'next';
import { TopNav } from '@/components/nav/top-nav';
import { DemoPlayground } from '@/components/demo/demo-playground';

export const metadata: Metadata = {
  title: 'Interactive Demo | CacheLane',
  description: 'Experience how CacheLane orchestrates context and drastically reduces token costs compared to standard Claude Code caching.',
};

export default function DemoPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)] text-[var(--color-fg)]">
      <TopNav />
      <main className="flex-1 pb-20 pt-10">
        <div className="mx-auto max-w-5xl px-4 text-center md:px-6">
          <h1 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Interactive Playground
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-[var(--color-fg-muted)]">
            Type a prompt below (or use the suggested ones) to step through a simulated Claude Code session. Compare the real-time token costs of standard caching versus CacheLane's orchestration and K-pruning.
          </p>
        </div>
        <DemoPlayground />
      </main>
      
      {/* Minimal footer */}
      <footer className="border-t border-[var(--color-border)] py-8 text-center text-sm text-[var(--color-fg-muted)]">
        <p>© 2026 CacheLane. Open source under the MIT License.</p>
      </footer>
    </div>
  );
}
