export type TokenBreakdown = {
  input: number;          // Full-price input tokens (1.0×)
  output: number;         // Output tokens
  cacheRead: number;      // Cache read tokens (0.1×)
  cacheWrite5m: number;   // Cache write 5-min TTL (1.25×)
  cacheWrite1h: number;   // Cache write 1-hour TTL (2.0×)
};

export type CachelaneEvent = 
  | 'prefix_cached'
  | 'middle_breakpoint_placed'
  | 'prefix_cache_write'
  | 'middle_cached'
  | 'stub_created'
  | 'stub_expanded'
  | 'keepalive_sent'
  | 'cache_expired';

export type ToolCall = {
  name: string;
  args: string;
  output: string;        // Truncated for display
  fullTokens: number;    // Token count of the full output
};

export type RegionSnapshot = {
  stable: { tokens: number; cached: boolean; description: string };
  semi: { tokens: number; cached: boolean; description: string; stubbedBlocks?: string[] };
  volatile: { tokens: number; description: string };
};

export type TeachingMoment = {
  title: string;
  description: string;
  icon: 'zap' | 'trending-down' | 'scissors' | 'refresh-cw' | 'shield' | 'clock' | 'layers';
};

export type TurnData = {
  turn: number;
  suggestedPrompt: string;
  toolCalls?: ToolCall[];
  assistantResponse: string;
  standard: TokenBreakdown;
  cachelane: TokenBreakdown;
  cachelaneEvents: CachelaneEvent[];
  regions: RegionSnapshot;
  teachingMoment: TeachingMoment;
};

export function effectiveCost(t: TokenBreakdown): number {
  return (
    t.input * 1.0 +
    t.cacheRead * 0.1 +
    t.cacheWrite5m * 1.25 +
    t.cacheWrite1h * 2.0
  );
}

export function cumulativeCost(turns: TurnData[], upTo: number, variant: 'standard' | 'cachelane'): number {
  return turns
    .filter((t) => t.turn <= upTo)
    .reduce((sum, t) => sum + effectiveCost(t[variant]), 0);
}

export function savingsPercent(turns: TurnData[], upTo: number): number {
  const stdCost = cumulativeCost(turns, upTo, 'standard');
  const clCost = cumulativeCost(turns, upTo, 'cachelane');
  if (stdCost === 0) return 0;
  return Math.round(((stdCost - clCost) / stdCost) * 100);
}

export function costInUSD(effectiveUnits: number): number {
  // Claude 3.5 Sonnet: $3.00 per 1M input tokens.
  // 1 effectiveUnit = 1 input token equivalent.
  return (effectiveUnits / 1_000_000) * 3.00;
}

export function quotaPercent(effectiveUnits: number): number {
  // Claude Pro allows roughly 45 max-context messages per 5 hours.
  // We estimate 450,000 effective units = 100% of the 5-hour quota for simple visualization.
  return Math.min(100, (effectiveUnits / 450_000) * 100);
}

export const SCENARIO: TurnData[] = [
  {
    turn: 1,
    suggestedPrompt: "Read my auth.ts file and explain the authentication flow",
    toolCalls: [
      {
        name: "Read",
        args: '{"path": "auth.ts"}',
        output: "import { Session } from 'next-auth';\\n// ... 800 lines of authentication logic ...\\nexport function authenticate(req: Request) { ... }",
        fullTokens: 3200,
      }
    ],
    assistantResponse: "The authentication flow in `auth.ts` uses NextAuth with session-based cookies. It exports an `authenticate` function that validates the request against the current session.",
    standard: { input: 15200, output: 300, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 3800, output: 300, cacheRead: 0, cacheWrite5m: 11400, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cache_write'],
    regions: {
      stable: { tokens: 8200, cached: false, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 0, cached: false, description: "No prior turns yet" },
      volatile: { tokens: 7000, description: "Current query + auth.ts contents" }
    },
    teachingMoment: {
      title: "Cache Investment",
      description: "First turn costs slightly more due to cache write (1.25× multiplier), but this investment pays off immediately on the next turn by placing a prefix breakpoint on the stable system prompt and tools.",
      icon: "zap"
    }
  },
  {
    turn: 2,
    suggestedPrompt: "Now read the database schema in schema.prisma",
    toolCalls: [
      {
        name: "Read",
        args: '{"path": "schema.prisma"}',
        output: "datasource db {\\n  provider = \"postgresql\"\\n  url      = env(\"DATABASE_URL\")\\n}\\n// ... 400 lines ...\\nmodel User { ... }",
        fullTokens: 1400,
      }
    ],
    assistantResponse: "The schema defines a PostgreSQL database with a `User` model, linking directly to the session mechanism we saw in `auth.ts`.",
    standard: { input: 22400, output: 250, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 5200, output: 250, cacheRead: 12800, cacheWrite5m: 2400, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cached', 'middle_breakpoint_placed'],
    regions: {
      stable: { tokens: 8200, cached: true, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 4600, cached: false, description: "Turn 1 dialogue (now caching)" },
      volatile: { tokens: 9600, description: "Current query + schema.prisma contents" }
    },
    teachingMoment: {
      title: "Cache Hit",
      description: "The system prompt and tools are already cached. CacheLane reads them at 0.1× cost instead of 1.0×. It also places a new 'middle breakpoint' to cache the conversation history.",
      icon: "trending-down"
    }
  },
  {
    turn: 3,
    suggestedPrompt: "Can you refactor the login function to use JWT instead of sessions?",
    assistantResponse: "Certainly! I'll update the `authenticate` function to issue a JWT token instead of establishing a server-side session.\\n\\n```typescript\\n// refactored logic here\\n```",
    standard: { input: 28600, output: 800, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 3400, output: 800, cacheRead: 17000, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cached', 'middle_cached'],
    regions: {
      stable: { tokens: 8200, cached: true, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 8800, cached: true, description: "Turns 1 & 2" },
      volatile: { tokens: 3400, description: "Current query" }
    },
    teachingMoment: {
      title: "Middle Breakpoint",
      description: "CacheLane caches prior turns too via the middle breakpoint. Almost everything is a cheap cache read now. The standard approach resends all history at full price.",
      icon: "layers"
    }
  },
  {
    turn: 4,
    suggestedPrompt: "Read tests/auth.test.ts and update the tests for the new JWT flow",
    toolCalls: [
      {
        name: "Read",
        args: '{"path": "tests/auth.test.ts"}',
        output: "import { authenticate } from '../auth';\\n\\ndescribe('Auth', () => {\\n  it('should create session', () => { ... });\\n});",
        fullTokens: 1200,
      }
    ],
    assistantResponse: "I've reviewed the tests. Here are the updates to verify JWT token generation instead of session creation.",
    standard: { input: 36200, output: 400, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 6800, output: 400, cacheRead: 21200, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cached', 'middle_cached'],
    regions: {
      stable: { tokens: 8200, cached: true, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 13000, cached: true, description: "Turns 1 to 3" },
      volatile: { tokens: 6800, description: "Current query + test file contents" }
    },
    teachingMoment: {
      title: "Block Tracking",
      description: "The auth.ts file from turn 1 is now unreferenced for 2 turns. CacheLane is silently counting unused turns in the background.",
      icon: "clock"
    }
  },
  {
    turn: 5,
    suggestedPrompt: "Explain the API rate limiting in middleware.ts",
    toolCalls: [
      {
        name: "Read",
        args: '{"path": "middleware.ts"}',
        output: "export function middleware(req: Request) {\\n  // rate limiting logic\\n}",
        fullTokens: 1800,
      }
    ],
    assistantResponse: "The middleware implements a sliding window rate limiter that restricts IPs to 100 requests per minute.",
    standard: { input: 44800, output: 300, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 5600, output: 300, cacheRead: 18400, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cached', 'middle_cached', 'stub_created'],
    regions: {
      stable: { tokens: 8200, cached: true, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 10200, cached: true, description: "Turns 2 to 4 + Stub for turn 1", stubbedBlocks: ["auth.ts (3,150 tokens removed)"] },
      volatile: { tokens: 5600, description: "Current query + middleware.ts contents" }
    },
    teachingMoment: {
      title: "K-Pruning Triggered",
      description: "Because auth.ts wasn't used for 3 turns (K=3), CacheLane replaced it with a 50-token stub note. The total token count actually dropped, saving 3,150 tokens per turn going forward.",
      icon: "scissors"
    }
  },
  {
    turn: 6,
    suggestedPrompt: "Actually, go back to auth.ts — what was the original session handling?",
    assistantResponse: "Ah, let me pull up the original `auth.ts` file to check the session handling logic.\\n\\n*Fetching original file contents...*",
    standard: { input: 50200, output: 200, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 7400, output: 200, cacheRead: 18800, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cached', 'stub_expanded'],
    regions: {
      stable: { tokens: 8200, cached: true, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 13400, cached: true, description: "Restored auth.ts + prior turns" },
      volatile: { tokens: 4600, description: "Current query + expanded content" }
    },
    teachingMoment: {
      title: "Lossless Restore",
      description: "The model recognized the stub and autonomously called `cachelane:expand`. The full content was instantly restored from the local SQLite database. Zero data loss.",
      icon: "refresh-cw"
    }
  },
  {
    turn: 7,
    suggestedPrompt: "Continue working on the middleware rate limiter",
    assistantResponse: "I will update the `middleware.ts` to implement a token bucket algorithm for finer-grained rate limiting.",
    standard: { input: 52800, output: 400, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelane: { input: 4200, output: 400, cacheRead: 22400, cacheWrite5m: 0, cacheWrite1h: 0 },
    cachelaneEvents: ['prefix_cached', 'middle_cached', 'keepalive_sent'],
    regions: {
      stable: { tokens: 8200, cached: true, description: "System prompt, tools, CLAUDE.md" },
      semi: { tokens: 14200, cached: true, description: "All prior turns" },
      volatile: { tokens: 4200, description: "Current query" }
    },
    teachingMoment: {
      title: "Keepalive (after 5 min pause)",
      description: "Standard caching expired after 5 minutes of inactivity, causing a massive full-price resend. CacheLane's adaptive keepalive sent a tiny ping at the 4-minute mark, keeping the cache hot and saving thousands of tokens.",
      icon: "shield"
    }
  }
];
