import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import './globals.css';

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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
