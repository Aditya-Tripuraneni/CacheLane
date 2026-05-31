import type { Metadata, Viewport } from 'next';
import { Lora, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const lora = Lora({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CacheLane — Local Caching and Context Orchestration for Claude Code',
  description:
    'Reduce repeated input token costs in Claude Code by 30% to 60% with local prompt caching, K-pruning, and adaptive keepalive.',
  metadataBase: new URL('https://cachelane.dev'),
  openGraph: {
    title: 'CacheLane',
    description: 'Local caching and context orchestration for Claude Code.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${lora.variable} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
