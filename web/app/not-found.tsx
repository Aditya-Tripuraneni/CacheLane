'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Coffee } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--color-bg)] px-4 text-center text-[var(--color-fg)]">
      <Coffee size={48} className="text-[var(--color-accent)] animate-bounce mb-6" />
      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl mb-3">
        404 - Page Spilled
      </h1>
      <p className="max-w-md text-sm text-[var(--color-fg-muted)] mb-8 leading-relaxed">
        The documentation page you are looking for does not exist or has been pruned to save context space.
      </p>
      <Button variant="primary" href="/">
        Go Back Home
      </Button>
    </div>
  );
}
