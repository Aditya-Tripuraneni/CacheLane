import { PageHeader } from '@/components/docs/page-header';
import { Prose } from '@/components/docs/prose';
import { FadeIn } from '@/components/motion/fade-in';
import { InlineCode } from '@/components/code/inline-code';

export default function McpToolsPage() {
  return (
    <>
      <PageHeader
        eyebrow="MCP Server"
        title="MCP Tools Reference"
        description="Learn how Claude Code interacts with the CacheLane local Model Context Protocol tools."
      />
      <Prose>
        <FadeIn>
          <section id="tools-overview">
            <h2>Model-Facing Capabilities</h2>
            <p>
              When CacheLane is installed, it runs a local stdio MCP server. This registers several tools that Claude Code automatically discovers and can execute mid-session to inspect cache state or expand stubs.
            </p>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section id="stats-tool">
            <h2>cachelane:stats</h2>
            <p>
              Returns detailed turn counts, cache-hit ratios, baseline cost units, effective cost units, savings ratios, keepalive pings, and pruner status.
            </p>
            <p>
              <strong>Inputs:</strong>
            </p>
            <ul>
              <li><InlineCode>scope</InlineCode> (string, optional): One of <InlineCode>"session"</InlineCode>, <InlineCode>"workspace"</InlineCode>, or <InlineCode>"all"</InlineCode>. Defaults to <InlineCode>"session"</InlineCode>.</li>
              <li><InlineCode>since</InlineCode> (string, optional): ISO duration string to filter records.</li>
            </ul>
          </section>
        </FadeIn>

        <FadeIn delay={0.1}>
          <section id="explain-tool">
            <h2>cachelane:explain</h2>
            <p>
              Allows the model (and the user) to inspect the exact region segregation, active breakpoints, and pruning decisions for the latest turn or a requested historical turn.
            </p>
            <p>
              <strong>Inputs:</strong>
            </p>
            <ul>
              <li><InlineCode>turn</InlineCode> (integer, optional): The target turn index to query. Defaults to the latest turn.</li>
            </ul>
          </section>
        </FadeIn>

        <FadeIn delay={0.15}>
          <section id="expand-tool">
            <h2>cachelane:expand</h2>
            <p>
              This tool is invoked by Claude Code whenever it encounters a pruned block stub in its context that it needs to access in full.
            </p>
            <p>
              When called, CacheLane retrieves the block from the local SQLite log, materializes its text, and inserts it back into the suffix of the prompt on the next turn.
            </p>
            <p>
              <strong>Inputs:</strong>
            </p>
            <ul>
              <li><InlineCode>block_id</InlineCode> (string, required): The target unique block identifier (8-character hash prefix accepted).</li>
            </ul>
          </section>
        </FadeIn>
      </Prose>
    </>
  );
}
