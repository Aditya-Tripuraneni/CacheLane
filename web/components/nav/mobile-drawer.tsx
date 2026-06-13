'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X } from 'lucide-react';
import { Sidebar } from '@/components/docs/sidebar';

export function MobileDrawer() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Delay portal mount to after hydration so createPortal doesn't run on the server
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // The header has backdrop-blur-md, which makes `position: fixed` children
  // relative to the header (not the viewport). Portal escapes that containment.
  const drawer = (
    <div
      aria-modal={open}
      aria-hidden={!open}
      className={`fixed inset-0 z-[500] lg:hidden ${
        open ? 'visible pointer-events-auto' : 'invisible pointer-events-none'
      }`}
    >
      {/* Semi-transparent backdrop — no backdrop-blur to avoid Safari bleed-through */}
      <div
        className={`absolute inset-0 bg-[#191816]/60 transition-opacity duration-300 ease-out ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={() => setOpen(false)}
      />

      {/* Sidebar panel — explicit z-10 to stack above backdrop */}
      <aside
        className={`absolute left-0 top-0 h-full w-72 border-r border-[var(--color-border)] bg-[var(--color-bg)] flex flex-col overflow-hidden transition-transform duration-300 ease-in-out z-10 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Header row with close button */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-[var(--color-border)] shrink-0">
          <span className="font-mono text-sm font-bold tracking-tight text-[var(--color-fg)]">
            cachelane
          </span>
          <button
            onClick={() => setOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-bg-elev)] transition-colors cursor-pointer"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable nav */}
        <div className="flex-1 overflow-y-auto p-4">
          <Sidebar onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] lg:hidden cursor-pointer"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>

      {mounted && createPortal(drawer, document.body)}
    </>
  );
}
