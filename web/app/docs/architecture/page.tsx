import { PageHeader } from '@/components/docs/page-header';
import { Prose } from '@/components/docs/prose';
import { Callout } from '@/components/docs/callout';
import { FadeIn } from '@/components/motion/fade-in';
import { InlineCode } from '@/components/code/inline-code';

export default function ArchitecturePage() {
  return (
    <>
      <PageHeader
        eyebrow="Architecture"
        title="Technical Flow &amp; Pruning"
        description="Deep dive into CacheLane's core caching strategies, K-pruning logic, and request cycle interception."
      />
      <Prose>
        <FadeIn>
          <section id="volatility-regions">
            <h2>Prompt Volatility Classification</h2>
            <p>
              Anthropic prompt caching is **prefix-based**. Any change in a prefix invalidates all cache data after that point. CacheLane optimizes for this behavior by decomposing your prompt into atomic blocks, classifying them by volatility, and sorting them:
            </p>
            <ul>
              <li>
                <strong>STABLE Region (Base Cache):</strong> Contains slow-changing contexts (System instructions, MCP tool definitions, pinned rules, CLAUDE.md). Bounded by the first <InlineCode>cache_control</InlineCode> breakpoint.
              </li>
              <li>
                <strong>SEMI Region (Mid-Cache):</strong> Holds dialogue history turns. These shift on each turn, but follow a predictable FIFO structure. Bounded by the second <InlineCode>cache_control</InlineCode> breakpoint.
              </li>
              <li>
                <strong>VOLATILE Region (Paid Full):</strong> Ephemeral workspace contexts, latest tool call outputs, and the current user question.
              </li>
            </ul>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section id="pipeline">
            <h2>Interception Hook Pipeline</h2>
            <p>
              CacheLane deploys as a middleware proxy that intercepts Claude Code traffic. The request pipeline executes in two primary phases:
            </p>
            <ol>
              <li>
                <strong>PreRequest Interception (Turn Start):</strong> Intercepts outgoing requests, queries database stats, groups prompt content blocks, prunes unreferenced blocks, places breakpoints, and forwards the payload to Anthropic.
              </li>
              <li>
                <strong>PostResponse Interception (Turn End):</strong> Monitors incoming responses, extracts model references to blocks (e.g. file paths in tool calls or block ID mentions), logs turn token costs, and updates block idle counters.
              </li>
            </ol>
          </section>
        </FadeIn>

        <FadeIn delay={0.1}>
          <section id="k-pruning">
            <h2>Trajectory-Aware K-Pruning</h2>
            <p>
              In long sessions, tool outputs and file reads bloat the context window. CacheLane's **K-pruner** automatically manages this:
            </p>
            <ul>
              <li>
                Each turn a block goes unreferenced by the model's response, its <InlineCode>unused_turns</InlineCode> count increments.
              </li>
              <li>
                When <InlineCode>unused_turns &ge; K</InlineCode> (default <InlineCode>K=3</InlineCode>), the block's text content is discarded and replaced with a compact stub containing its unique identifier, a brief summary, and a refetch command.
              </li>
              <li>
                If Claude decides it needs the block again, it issues a call to the <InlineCode>cachelane:expand</InlineCode> MCP tool. CacheLane intercepts this tool call, restores the block from database references, and inserts it back into the suffix.
              </li>
            </ul>
            <Callout kind="note" title="Pruning State Machine">
              Blocks in the stable region (system prompts, tool definitions, pinned files) are exempt from K-pruning and never expire.
            </Callout>
          </section>
        </FadeIn>

        <FadeIn delay={0.15}>
          <section id="keepalive">
            <h2>Keepalive Scheduler</h2>
            <p>
              Anthropic prompt caches expire after **5 minutes** of idle time. During long pauses, users face full write cost penalties. 
            </p>
            <p>
              CacheLane spawns a light keepalive scheduler in the background. When the user is idle, it issues minimal synthetic API queries (<InlineCode>max_tokens=1</InlineCode> with the identical prefix structure) at 4-minute intervals, resetting the TTL and keeping the cache warm.
            </p>
          </section>
        </FadeIn>
      </Prose>
    </>
  );
}
