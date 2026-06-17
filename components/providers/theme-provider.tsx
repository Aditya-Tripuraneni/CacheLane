'use client';

import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  effectiveTheme: 'light' | 'dark';
};

const initialState: ThemeProviderState = {
  theme: 'system',
  setTheme: () => null,
  effectiveTheme: 'light',
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'cachelane-theme',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (typeof window !== 'undefined' ? (localStorage.getItem(storageKey) as Theme) : defaultTheme) || defaultTheme
  );
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    const resolvedTheme = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;

    setEffectiveTheme(resolvedTheme);
    root.classList.add(resolvedTheme);

    // Apply theme-specific CSS variables
    if (resolvedTheme === 'dark') {
      root.style.setProperty('--color-bg', 'oklch(0.18 0.005 75)');
      root.style.setProperty('--color-bg-elev', 'oklch(0.21 0.005 75)');
      root.style.setProperty('--color-bg-inline', 'oklch(0.24 0.01 75)');
      root.style.setProperty('--color-fg', 'oklch(0.95 0.005 75)');
      root.style.setProperty('--color-fg-muted', 'oklch(0.75 0.01 75)');
      root.style.setProperty('--color-fg-faint', 'oklch(0.55 0.01 75)');
      root.style.setProperty('--color-border', 'oklch(0.30 0.01 75)');
      root.style.setProperty('--color-border-strong', 'oklch(0.40 0.01 75)');
    } else {
      root.style.setProperty('--color-bg', 'oklch(0.965 0.005 75)');
      root.style.setProperty('--color-bg-elev', 'oklch(1 0 0)');
      root.style.setProperty('--color-bg-inline', 'oklch(0.93 0.01 75)');
      root.style.setProperty('--color-fg', 'oklch(0.15 0.005 75)');
      root.style.setProperty('--color-fg-muted', 'oklch(0.40 0.01 75)');
      root.style.setProperty('--color-fg-faint', 'oklch(0.55 0.01 75)');
      root.style.setProperty('--color-border', 'oklch(0.90 0.005 75)');
      root.style.setProperty('--color-border-strong', 'oklch(0.75 0.01 75)');
    }
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
    effectiveTheme,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
};
