'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { 
  Github, 
  Terminal, 
  Coffee, 
  Cpu, 
  ShieldAlert, 
  Database, 
  Zap, 
  ArrowRight, 
  Copy, 
  Check, 
  Layers 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TopNav } from '@/components/nav/top-nav';
import { FadeIn, standardEase } from '@/components/motion/fade-in';
import { DemoVideo } from '@/components/demo/demo-video';

export default function HomePage() {
  const [copied, setCopied] = useState(false);

  const copyCmd = () => {
    navigator.clipboard.writeText('npm install -g cachelane && cachelane install');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[var(--color-bg)] text-[var(--color-fg)]">
      <TopNav />

      {/* Hero Section */}
      <section className="relative px-4 pt-16 pb-20 sm:px-6 lg:px-8 lg:pt-24 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-radial-[at_top_right] from-[var(--color-bg-elev)]/50 via-transparent to-transparent -z-10" />
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-8 items-center">
            
            {/* Hero Text */}
            <div className="lg:col-span-7 space-y-6">
              <FadeIn>
                <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-1 text-xs font-medium text-[var(--color-fg-muted)]">
                  <span className="flex h-2 w-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
                  Local Caching Middleware
                </div>
              </FadeIn>
              
              <FadeIn delay={0.05}>
                <h1 className="text-4xl font-bold font-serif tracking-tight sm:text-5xl lg:text-6xl text-[var(--color-fg)] leading-[1.05]">
                  Pay <span className="bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-warn)] bg-clip-text text-transparent">90% Less</span> on Repeated Claude Code Tokens
                </h1>
              </FadeIn>

              <FadeIn delay={0.1}>
                <p className="max-w-xl text-base sm:text-lg text-[var(--color-fg-muted)] leading-relaxed">
                  CacheLane is a local prompt-caching and trajectory-aware orchestration layer. 
                  It segregates your context into volatility tiers and prunes stale tool outputs, keeping your sessions fast and affordable.
                </p>
              </FadeIn>

              <FadeIn delay={0.15} className="flex flex-wrap gap-4 pt-2">
                <Button variant="primary" href="/docs/getting-started" className="h-11 px-6 text-base group">
                  Get Started
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                </Button>
                <Button variant="secondary" href="/docs/architecture" className="h-11 px-6 text-base">
                  How It Works
                </Button>
              </FadeIn>
            </div>

            {/* Hero Interactive Terminal / Code Pane */}
            <div className="lg:col-span-5">
              <FadeIn delay={0.2}>
                <div className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 shadow-xl font-mono text-sm">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] pb-3 mb-4">
                    <div className="flex gap-1.5">
                      <span className="h-3 w-3 rounded-full bg-[var(--color-danger)]/70" />
                      <span className="h-3 w-3 rounded-full bg-[var(--color-warn)]/70" />
                      <span className="h-3 w-3 rounded-full bg-[var(--color-accent)]/70" />
                    </div>
                    <span className="text-xs text-[var(--color-fg-faint)]">Terminal</span>
                  </div>
                  <div className="space-y-2 text-[var(--color-fg-muted)]">
                    <p className="text-[var(--color-fg-faint)]"># Install globally</p>
                    <div className="flex items-center justify-between bg-[var(--color-bg)]/80 border border-[var(--color-border)] rounded-md p-2">
                      <code className="text-[var(--color-fg)]">npm install -g cachelane</code>
                    </div>
                    <p className="text-[var(--color-fg-faint)] pt-2"># Integrate with Claude Code hooks</p>
                    <div className="flex items-center justify-between bg-[var(--color-bg)]/80 border border-[var(--color-border)] rounded-md p-2">
                      <code className="text-[var(--color-fg)]">cachelane install</code>
                      <button 
                        onClick={copyCmd}
                        className="text-[var(--color-fg-faint)] hover:text-[var(--color-fg)] p-1 rounded transition-colors"
                        title="Copy command"
                      >
                        {copied ? <Check size={16} className="text-[var(--color-success)]" /> : <Copy size={16} />}
                      </button>
                    </div>
                    <p className="text-[var(--color-fg-faint)] pt-2"># Diagnose and verify local setup</p>
                    <div className="flex items-center justify-between bg-[var(--color-bg)]/80 border border-[var(--color-border)] rounded-md p-2">
                      <code className="text-[var(--color-fg)]">cachelane doctor</code>
                    </div>
                  </div>
                </div>
              </FadeIn>
            </div>

          </div>
          <div className="w-full">
            <DemoVideo />
          </div>
        </div>
      </section>

      {/* Side-by-Side Comparison Section */}
      <section className="bg-[var(--color-bg-elev)]/30 border-y border-[var(--color-border)] py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <FadeIn>
              <h2 className="text-3xl font-bold font-serif tracking-tight sm:text-4xl text-[var(--color-fg)]">
                Side-by-Side: The Caching Edge
              </h2>
              <p className="text-[var(--color-fg-muted)] text-base sm:text-lg">
                See how standard conversation context cost compounds vs. CacheLane's region reordering and K-pruning.
              </p>
            </FadeIn>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
            
            {/* No CacheLane */}
            <FadeIn delay={0.05}>
              <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-2xl p-6 shadow-md relative overflow-hidden flex flex-col justify-between h-full">
                <div className="absolute top-0 right-0 bg-[var(--color-danger)]/10 text-[var(--color-danger)] font-mono text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-bl-xl border-l border-b border-[var(--color-border)]">
                  Standard Claude Code
                </div>
                <div>
                  <h3 className="text-lg font-bold font-serif mb-1 text-[var(--color-fg)]">Linear Cost Accumulation</h3>
                  <p className="text-xs text-[var(--color-fg-faint)] mb-6">No breakpoint management or context pruning.</p>

                  <div className="space-y-4 font-mono text-xs">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Turn 1 (Initial Prompt)</span>
                        <span className="font-bold text-[var(--color-danger)]">1.0× Cost</span>
                      </div>
                      <div className="h-6 w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded overflow-hidden">
                        <div className="bg-[var(--color-danger)]/60 h-full w-[25%]" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Turn 5 (Accumulating files & schemas)</span>
                        <span className="font-bold text-[var(--color-danger)]">5.0× Cost</span>
                      </div>
                      <div className="h-6 w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded overflow-hidden">
                        <div className="bg-[var(--color-danger)]/60 h-full w-[65%]" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Turn 10 (Large workspace context bloat)</span>
                        <span className="font-bold text-[var(--color-danger)]">10.0× Cost</span>
                      </div>
                      <div className="h-6 w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded overflow-hidden">
                        <div className="bg-[var(--color-danger)]/60 h-full w-full" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[var(--color-border)] mt-8 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-fg-muted)]">Cumulative Input cost:</span>
                    <span className="font-bold text-[var(--color-danger)]">55,000 Billed Tokens</span>
                  </div>
                </div>
              </div>
            </FadeIn>

            {/* With CacheLane */}
            <FadeIn delay={0.1}>
              <div className="bg-[var(--color-bg)] border-2 border-[var(--color-accent)] rounded-2xl p-6 shadow-lg relative overflow-hidden flex flex-col justify-between h-full">
                <div className="absolute top-0 right-0 bg-[var(--color-success)]/10 text-[var(--color-success)] font-mono text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-bl-xl border-l border-b border-[var(--color-border)]">
                  With CacheLane
                </div>
                <div>
                  <h3 className="text-lg font-bold font-serif mb-1 text-[var(--color-fg)]">Cache-Aware Flattened Curve</h3>
                  <p className="text-xs text-[var(--color-fg-faint)] mb-6">Orchestration reorders blocks; K-pruning stubs idle content.</p>

                  <div className="space-y-4 font-mono text-xs">
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Turn 1 (Write Prefix Cache)</span>
                        <span className="font-bold text-[var(--color-warn)]">1.25× Cost (Write)</span>
                      </div>
                      <div className="h-6 w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded overflow-hidden flex">
                        <div className="bg-[var(--color-warn)]/60 h-full w-[25%]" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Turn 5 (Cache Reads + Keepalives)</span>
                        <span className="font-bold text-[var(--color-success)]">0.45× Cost (82% hit ratio)</span>
                      </div>
                      <div className="h-6 w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded overflow-hidden flex">
                        <div className="bg-[var(--color-success)]/60 h-full w-[10%]" />
                        <div className="bg-[var(--color-accent)]/20 h-full w-[50%] border-l border-[var(--color-border)]" title="Cached prefix" />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <span>Turn 10 (K-Pruned Stubs Restrain Context)</span>
                        <span className="font-bold text-[var(--color-success)]">0.55× Cost (K-pruning active)</span>
                      </div>
                      <div className="h-6 w-full bg-[var(--color-bg-elev)] border border(--color-border) rounded overflow-hidden flex">
                        <div className="bg-[var(--color-success)]/60 h-full w-[12%]" />
                        <div className="bg-[var(--color-accent)]/20 h-full w-[52%] border-l border-[var(--color-border)]" title="Cached prefix" />
                        <div className="bg-[var(--color-border-strong)]/20 h-full w-[36%] border-l border-[var(--color-border)] flex items-center justify-center text-[9px] text-[var(--color-fg-faint)] font-sans" title="Pruned blocks replaced by stubs">
                          Pruned &amp; Stubbed (Flat Growth)
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="border-t border-[var(--color-border)] mt-8 pt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-fg-muted)]">Cumulative Input cost:</span>
                    <div className="text-right">
                      <span className="font-bold text-[var(--color-success)]">18,500 Billed Tokens</span>
                      <span className="block text-[10px] text-[var(--color-success)] font-semibold">-66% cost reduction</span>
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>

          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
            <FadeIn>
              <h2 className="text-3xl font-bold font-serif tracking-tight sm:text-4xl text-[var(--color-fg)]">
                Local Optimization, Zero Configuration
              </h2>
              <p className="text-[var(--color-fg-muted)] text-base sm:text-lg">
                CacheLane operates completely locally behind the scenes, ensuring optimal pricing without manual intervention.
              </p>
            </FadeIn>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            
            {/* Orchestration */}
            <FadeIn delay={0.05}>
              <div className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl p-6 h-full space-y-4 hover:-translate-y-1 transition-transform duration-200">
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg w-fit text-[var(--color-accent)]">
                  <Layers size={20} />
                </div>
                <h3 className="text-lg font-bold font-serif text-[var(--color-fg)]">Cache-Aware Orchestration</h3>
                <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                  Automatically classifies incoming context blocks and aligns them into three regions with dual `cache_control` breakpoints.
                </p>
              </div>
            </FadeIn>

            {/* K-Pruning */}
            <FadeIn delay={0.1}>
              <div className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl p-6 h-full space-y-4 hover:-translate-y-1 transition-transform duration-200">
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg w-fit text-[var(--color-accent)]">
                  <Cpu size={20} />
                </div>
                <h3 className="text-lg font-bold font-serif text-[var(--color-fg)]">Trajectory K-Pruning</h3>
                <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                  Identifies stale files and tool-outputs unreferenced for consecutive turns and swaps them out for light, refetchable stubs.
                </p>
              </div>
            </FadeIn>

            {/* Keepalive */}
            <FadeIn delay={0.15}>
              <div className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl p-6 h-full space-y-4 hover:-translate-y-1 transition-transform duration-200">
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg w-fit text-[var(--color-accent)]">
                  <Zap size={20} />
                </div>
                <h3 className="text-lg font-bold font-serif text-[var(--color-fg)]">Adaptive Keepalive</h3>
                <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                  Schedules low-cost, single-token background pings when idle to keep your prompt cache hot, avoiding cold-start write penalties.
                </p>
              </div>
            </FadeIn>

            {/* Local First */}
            <FadeIn delay={0.2}>
              <div className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl p-6 h-full space-y-4 hover:-translate-y-1 transition-transform duration-200">
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg w-fit text-[var(--color-accent)]">
                  <Database size={20} />
                </div>
                <h3 className="text-lg font-bold font-serif text-[var(--color-fg)]">100% Local-First</h3>
                <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                  All references, database metrics, and logs are kept in a local SQLite file. Your prompts and files never leave your environment.
                </p>
              </div>
            </FadeIn>

            {/* Fail-Safe */}
            <FadeIn delay={0.25}>
              <div className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl p-6 h-full space-y-4 hover:-translate-y-1 transition-transform duration-200">
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg w-fit text-[var(--color-accent)]">
                  <ShieldAlert size={20} />
                </div>
                <h3 className="text-lg font-bold font-serif text-[var(--color-fg)]">Fail-Open Invariants</h3>
                <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                  Built to be completely invisible. Any internal runtime error gracefully returns the raw prompt, never breaking your editor session.
                </p>
              </div>
            </FadeIn>

            {/* CLI Dashboard */}
            <FadeIn delay={0.3}>
              <div className="bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded-xl p-6 h-full space-y-4 hover:-translate-y-1 transition-transform duration-200">
                <div className="p-3 bg-[var(--color-bg)] border border-[var(--color-border)] rounded-lg w-fit text-[var(--color-accent)]">
                  <Terminal size={20} />
                </div>
                <h3 className="text-lg font-bold font-serif text-[var(--color-fg)]">TUI &amp; CLI Dashboard</h3>
                <p className="text-sm text-[var(--color-fg-muted)] leading-relaxed">
                  Use simple command line options like `cachelane stats` or `cachelane explain` to get transparent reports of your cache savings.
                </p>
              </div>
            </FadeIn>

          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border)] py-12 bg-[var(--color-bg-elev)]/20 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl flex flex-col sm:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 font-mono text-sm font-bold text-[var(--color-fg)]">
            <Coffee size={16} className="text-[var(--color-accent)]" />
            cachelane
          </div>
          <p className="text-xs text-[var(--color-fg-faint)] text-center">
            Built by Aditya Tripuraneni &amp; Rajan Chavada
            <span className="hidden sm:inline"> · </span>
            <br className="sm:hidden" />
            &copy; 2026 CacheLane Project. Distributed under the MIT License.
          </p>
          <div className="flex gap-4 text-xs text-[var(--color-fg-muted)]">
            <Link href="/docs/getting-started" className="hover:text-[var(--color-fg)]">Docs</Link>
            <a href="https://github.com/Aditya-Tripuraneni/CacheLane" className="hover:text-[var(--color-fg)]">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
