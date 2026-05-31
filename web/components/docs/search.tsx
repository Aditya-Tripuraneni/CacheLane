'use client';

import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search as SearchIcon, X, FileText } from 'lucide-react';
import Fuse from 'fuse.js';
import { useRouter } from 'next/navigation';

type SearchItem = {
  title: string;
  category: string;
  url: string;
  content: string;
};

const searchDatabase: SearchItem[] = [
  // Getting Started
  {
    title: 'Introduction',
    category: 'Getting Started',
    url: '/docs/getting-started#introduction',
    content: 'CacheLane is a local prompt orchestration layer for Claude Code. It reorders prompt blocks and places cache_control breakpoints to get a 10x discount on API costs.'
  },
  {
    title: 'Installation',
    category: 'Getting Started',
    url: '/docs/getting-started#installation',
    content: 'To install CacheLane locally, run npm install -g cachelane, compile the source files, then run npm link to establish global CLI availability.'
  },
  {
    title: 'Idempotent setup',
    category: 'Getting Started',
    url: '/docs/getting-started#setup',
    content: 'Running cachelane install registers the stdio MCP server in ~/.claude/mcp.json and hooks under ~/.claude/hooks/.'
  },
  {
    title: 'Validation & Health Checks',
    category: 'Getting Started',
    url: '/docs/getting-started#verification',
    content: 'Run cachelane doctor to check Node version, Claude Code connectivity, config parsing, and SQLite database health.'
  },
  // Architecture
  {
    title: 'Prompt Volatility Classification',
    category: 'Architecture',
    url: '/docs/architecture#volatility-regions',
    content: 'Context blocks are segregated into STABLE (system, schemas), SEMI (dialogue history), and VOLATILE (user query, latest outputs) regions.'
  },
  {
    title: 'Interception Hook Pipeline',
    category: 'Architecture',
    url: '/docs/architecture#pipeline',
    content: 'A PreRequest hook reorders blocks and places breakpoints; a PostResponse hook detects used references and updates logs.'
  },
  {
    title: 'Trajectory-Aware K-Pruning',
    category: 'Architecture',
    url: '/docs/architecture#k-pruning',
    content: 'Stale tool outputs idle for K consecutive turns (default K=3) are replaced with stubs containing brief summaries and expansion handles.'
  },
  {
    title: 'Keepalive Scheduler',
    category: 'Architecture',
    url: '/docs/architecture#keepalive',
    content: 'Keepalive schedules minimal synthetic user pings with max_tokens=1 to keep the Anthropic 5-minute cache prefix warm.'
  },
  // CLI
  {
    title: 'CLI Commands Index',
    category: 'CLI Reference',
    url: '/docs/cli-reference',
    content: 'Complete CLI suite details: stats, explain, prune, keepalive, pin, exclude, disable, enable, doctor, and uninstall.'
  },
  {
    title: 'Pruning Tuning',
    category: 'CLI Reference',
    url: '/docs/cli-reference#pruning-config',
    content: 'Configure pruning K thresholds: default K=3, aggressive K=2, conservative K=5 using cachelane prune command.'
  },
  {
    title: 'Pinning and Excluding',
    category: 'CLI Reference',
    url: '/docs/cli-reference#pin-exclude',
    content: 'Pin files using cachelane pin to prevent them from ever being pruned, or exclude files via cachelane exclude.'
  },
  // MCP
  {
    title: 'Exposed MCP Tools',
    category: 'MCP Tools',
    url: '/docs/mcp-tools',
    content: 'Claude Code invokes cachelane:stats, cachelane:explain, and cachelane:expand tools to inspect and restore context.'
  },
  {
    title: 'Expand Stub Refetching',
    category: 'MCP Tools',
    url: '/docs/mcp-tools#expand-tool',
    content: 'When Claude encounters a stubbed block, it triggers cachelane:expand. The proxy refetches and restores content in the suffix.'
  },
  // Privacy
  {
    title: 'Local Privacy Policy',
    category: 'Privacy',
    url: '/docs/privacy',
    content: 'CacheLane stores database logs locally at ~/.cachelane/cachelane.db. It does not store prompt text, file bodies, or API keys.'
  }
];

export function Search() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchItem[]>([]);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      setQuery('');
      setResults([]);
    }
  }, [open]);

  const fuse = new Fuse(searchDatabase, {
    keys: ['title', 'category', 'content'],
    threshold: 0.3
  });

  const handleSearch = (text: string) => {
    setQuery(text);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    const searchRes = fuse.search(text).map(res => res.item);
    setResults(searchRes);
  };

  const handleSelect = (url: string) => {
    setOpen(false);
    router.push(url);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full max-w-[240px] items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-3 py-1.5 text-left text-sm text-[var(--color-fg-faint)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg-muted)]"
      >
        <SearchIcon size={14} />
        <span className="flex-1">Search docs...</span>
        <kbd className="hidden font-mono text-xs text-[var(--color-fg-faint)] sm:inline-block bg-[var(--color-bg-inline)] border border-[var(--color-border)] rounded px-1">
          ⌘K
        </kbd>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-start justify-center bg-[var(--color-fg)]/25 p-4 pt-[10vh] backdrop-blur-sm cursor-pointer"
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-lg overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl cursor-default"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center border-b border-[var(--color-border)] px-4 py-3">
                <SearchIcon size={18} className="text-[var(--color-fg-muted)] mr-3" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Type to search documentation..."
                  value={query}
                  onChange={(e) => handleSearch(e.target.value)}
                  className="flex-1 bg-transparent text-sm text-[var(--color-fg)] placeholder-[var(--color-fg-faint)] outline-none"
                />
                <button
                  onClick={() => setOpen(false)}
                  className="text-[var(--color-fg-faint)] hover:text-[var(--color-fg-muted)]"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="max-h-[350px] overflow-y-auto p-2">
                {query === '' ? (
                  <p className="p-4 text-center text-xs text-[var(--color-fg-faint)]">
                    No search query entered. Try searching for <code className="font-mono bg-[var(--color-bg-inline)] px-1 rounded">K-pruning</code> or <code className="font-mono bg-[var(--color-bg-inline)] px-1 rounded">doctor</code>.
                  </p>
                ) : results.length === 0 ? (
                  <p className="p-4 text-center text-xs text-[var(--color-fg-faint)]">
                    No matching results found for &ldquo;{query}&rdquo;.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {results.map((item, idx) => (
                      <li key={idx}>
                        <button
                          onClick={() => handleSelect(item.url)}
                          className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-[var(--color-bg-elev)] transition-colors group"
                        >
                          <FileText size={16} className="text-[var(--color-fg-faint)] group-hover:text-[var(--color-accent)] mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-[var(--color-fg)] group-hover:text-[var(--color-accent)] truncate">
                                {item.title}
                              </span>
                              <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--color-fg-faint)] bg-[var(--color-bg-inline)] border border-[var(--color-border)] px-1.5 py-0.5 rounded">
                                {item.category}
                              </span>
                            </div>
                            <p className="text-xs text-[var(--color-fg-muted)] mt-1 line-clamp-2">
                              {item.content}
                            </p>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
