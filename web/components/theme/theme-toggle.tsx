'use client';

import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from '@/components/providers/theme-provider';
import { cn } from '@/lib/cn';

export function ThemeToggle() {
  const { theme, setTheme, effectiveTheme } = useTheme();

  const themes: { value: 'light' | 'dark' | 'system'; icon: typeof Sun; label: string }[] = [
    { value: 'light', icon: Sun, label: 'Light' },
    { value: 'dark', icon: Moon, label: 'Dark' },
    { value: 'system', icon: Monitor, label: 'System' },
  ];

  return (
    <div className="flex items-center gap-1">
      {themes.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          className={cn(
            'relative rounded-md p-2 transition-colors',
            'hover:bg-[var(--color-bg-elev)]/50',
            'focus-visible:outline-2 focus-visible:outline-[var(--color-accent)] focus-visible:outline-offset-2',
            theme === value
              ? 'text-[var(--color-accent)]'
              : 'text-[var(--color-fg-faint)] hover:text-[var(--color-fg-muted)]'
          )}
          title={label}
        >
          <Icon size={16} />
          {theme === value && (
            <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-[var(--color-accent)]" />
          )}
        </button>
      ))}
    </div>
  );
}
