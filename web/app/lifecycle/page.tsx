import Link from 'next/link';
import type { Metadata } from 'next';
import { Coffee, Cpu, Bot, Gauge } from 'lucide-react';
import { TopNav } from '@/components/nav/top-nav';
import { FadeIn } from '@/components/motion/fade-in';
import { StubLifecycle } from '@/components/lifecycle/stub-lifecycle';

export const metadata: Metadata = {
  title: 'K-Pruning Stub Lifecycle · CacheLane',
  description:
    'An interactive, step-by-step walkthrough of how CacheLane stubs an idle tool-result block, what the model sees vs. what SQLite stores, and how cachelane:expand restores it non-lossily.',
};

export default function LifecyclePage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <TopNav />

      {/* Header */}
      <section className="px-4 pt-12 pb-8 sm:px-6 lg:px-8 lg:pt-16">
        <div className="mx-auto max-w-6xl">
          <FadeIn>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-1 text-xs font-medium text-[var(--color-fg-muted)]">
              <Cpu size={13} className="text-[var(--color-accent)]" />
              Interactive · K-Pruning
            </div>
          </FadeIn>
          <FadeIn delay={0.05}>
            <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight text-[var(--color-fg)] sm:text-5xl">
              The K-Pruning <span className="bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-warn)] bg-clip-text text-transparent">Stub Lifecycle</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.1}>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--color-fg-muted)] sm:text-lg">
              Step through exactly how an idle tool-result block becomes a stub, what the model reads versus what SQLite
              stores, and how <code className="rounded bg-[var(--color-bg-inline)] px-1 font-mono text-[0.9em] text-[var(--color-fg)]">cachelane:expand</code> brings it back without ever losing a byte. Use the stage buttons,
              or your arrow keys, to play along.
            </p>
          </FadeIn>
        </div>
      </section>

      {/* Interactive animation */}
      <section className="px-4 pb-8 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <FadeIn delay={0.15}>
            <StubLifecycle />
          </FadeIn>
        </div>
      </section>

      {/* Essay: who runs the show */}
      <section className="border-t border-[var(--color-border)] bg-[var(--color-bg-elev)]/30 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <FadeIn>
            <p className="mb-2 font-mono text-xs uppercase tracking-wider text-[var(--color-fg-faint)]">
              The mental model
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-[var(--color-fg)]">Who actually runs the show?</h2>
            <p className="mt-4 text-base leading-relaxed text-[var(--color-fg-muted)]">
              The most important thing to understand about K-pruning is that CacheLane never reads the user&apos;s mind, and
              never connects one question to another. It does something far simpler, and the model&apos;s own intelligence
              does the rest.
            </p>
          </FadeIn>

          <div className="mt-10 space-y-8">
            <FadeIn delay={0.05}>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-accent)]">
                    <Bot size={18} />
                  </span>
                  <h3 className="text-lg font-bold text-[var(--color-fg)]">The model is the orchestrator</h3>
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
                  When a stub is created, CacheLane leaves a literal sticky-note in the conversation:{' '}
                  <code className="rounded bg-[var(--color-bg-inline)] px-1 font-mono text-[0.88em] text-[var(--color-fg)]">[stub:01KPRUNE] … | refetch via cachelane_expand(block_id=01KPRUNE)</code>.
                  That note stays in the model&apos;s context on every turn, just tiny now. When the user later asks{' '}
                  <em>&ldquo;what did auth.ts look like again?&rdquo;</em>, phrased completely differently from the original
                  request, the <strong className="font-semibold text-[var(--color-fg)]">model</strong> reads both the new
                  question and the stub, recognizes they&apos;re about the same thing, and decides on its own to call{' '}
                  <code className="rounded bg-[var(--color-bg-inline)] px-1 font-mono text-[0.88em] text-[var(--color-fg)]">cachelane:expand</code>.
                  No NLP, no semantic matching, no intent detection lives in CacheLane. The model&apos;s reasoning bridges the
                  two questions.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-accent)]">
                    <Coffee size={18} />
                  </span>
                  <h3 className="text-lg font-bold text-[var(--color-fg)]">CacheLane is the infrastructure</h3>
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
                  CacheLane&apos;s job is mechanical and deterministic: watch the idle counter, replace the block with a
                  descriptive stub when it crosses K, expose the{' '}
                  <code className="rounded bg-[var(--color-bg-inline)] px-1 font-mono text-[0.88em] text-[var(--color-fg)]">cachelane:expand</code>{' '}
                  tool, and, when that tool is called, re-run the original deterministic tool call to restore the content.
                  It makes the prompt <strong className="font-semibold text-[var(--color-fg)]">smaller</strong>, and leaves a
                  recoverable pointer. Rather than building fragile, model-specific intent detection into the system, the
                  reasoning is offloaded to the model&apos;s native capability. The stub just has to be descriptive enough that
                  any sufficiently capable model knows what to do with it.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.15}>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-6">
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] text-[var(--color-accent)]">
                    <Gauge size={18} />
                  </span>
                  <h3 className="text-lg font-bold text-[var(--color-fg)]">The model&apos;s capability is the bottleneck</h3>
                </div>
                <p className="text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
                  Because the model drives the restore flow, CacheLane&apos;s effectiveness scales with model quality. Not
                  in the obvious &ldquo;raw intelligence&rdquo; way, but in <strong className="font-semibold text-[var(--color-fg)]">context fidelity under pressure</strong>. Three failure modes:
                </p>
                <ul className="mt-3 space-y-2 text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
                  <li className="relative pl-5">
                    <span className="absolute left-0 text-[var(--color-accent)]">1.</span>
                    <strong className="font-semibold text-[var(--color-fg)]">Context saturation.</strong> In a long enough
                    session, the stub can fall outside the model&apos;s effective attention window, so it reads right past the
                    refetch hint.
                  </li>
                  <li className="relative pl-5">
                    <span className="absolute left-0 text-[var(--color-accent)]">2.</span>
                    <strong className="font-semibold text-[var(--color-fg)]">Instruction-following drift.</strong> The stub is
                    an embedded instruction, and models follow those less reliably as sessions grow.
                  </li>
                  <li className="relative pl-5">
                    <span className="absolute left-0 text-[var(--color-accent)]">3.</span>
                    <strong className="font-semibold text-[var(--color-fg)]">Tool selection under ambiguity.</strong> On a vague
                    question the model might answer from memory or issue a fresh read instead of calling{' '}
                    <code className="rounded bg-[var(--color-bg-inline)] px-1 font-mono text-[0.88em] text-[var(--color-fg)]">cachelane:expand</code>.
                  </li>
                </ul>
                <p className="mt-4 text-[15px] leading-relaxed text-[var(--color-fg-muted)]">
                  On a strong model it is essentially self-managing, with stubs noticed and acted on reliably. On a weaker
                  model you&apos;d see more silent misses. That is the deliberate trade-off: the system&apos;s correctness ceiling
                  is set by the model, not by CacheLane&apos;s own logic.
                </p>
              </div>
            </FadeIn>

            <FadeIn delay={0.2}>
              <blockquote className="rounded-xl border border-[var(--color-border)] border-l-[3px] border-l-[var(--color-accent)] bg-[var(--color-bg)] px-6 py-5">
                <p className="font-mono text-sm leading-relaxed text-[var(--color-fg-muted)]">
                  <span className="text-[var(--color-fg)]">Token saving</span> → CacheLane&apos;s job (happens at stubbing,
                  ongoing, no intent needed)
                  <br />
                  <span className="text-[var(--color-fg)]">Re-fetching</span> → the model&apos;s job (reads the stub, decides to
                  restore, no NLP needed)
                </p>
              </blockquote>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* Authors */}
      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <FadeIn>
            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elev)]/50 p-8 text-center">
              <p className="font-mono text-xs uppercase tracking-wider text-[var(--color-fg-faint)]">Built by</p>
              <p className="mt-3 text-xl font-bold text-[var(--color-fg)]">
                Aditya Tripuraneni <span className="text-[var(--color-fg-faint)]">&amp;</span> Rajan Chavada
              </p>
              <p className="mt-2 text-sm text-[var(--color-fg-muted)]">
                CacheLane, a local, fail-open caching middleware for Claude Code.
              </p>
            </div>
          </FadeIn>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-elev)]/20 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2 font-mono text-sm font-bold text-[var(--color-fg)]">
            <Coffee size={16} className="text-[var(--color-accent)]" />
            cachelane
          </div>
          <p className="text-xs text-[var(--color-fg-faint)]">
            Built by Aditya Tripuraneni &amp; Rajan Chavada · &copy; 2026 CacheLane Project · MIT License.
          </p>
          <div className="flex gap-4 text-xs text-[var(--color-fg-muted)]">
            <Link href="/docs/architecture" className="hover:text-[var(--color-fg)]">Architecture</Link>
            <a href="https://github.com/Aditya-Tripuraneni/CacheLane" className="hover:text-[var(--color-fg)]">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
