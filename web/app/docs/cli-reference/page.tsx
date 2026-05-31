import { PageHeader } from '@/components/docs/page-header';
import { Prose } from '@/components/docs/prose';
import { FadeIn } from '@/components/motion/fade-in';
import { InlineCode } from '@/components/code/inline-code';
import { CodeBlock } from '@/components/code/code-block';

export default function CliReferencePage() {
  return (
    <>
      <PageHeader
        eyebrow="Reference"
        title="CLI Commands Index"
        description="Comprehensive guide to the CacheLane command line interface utility."
      />
      <Prose>
        <FadeIn>
          <section id="commands-overview">
            <h2>Command Line Suite</h2>
            <p>
              The global <InlineCode>cachelane</InlineCode> CLI command exposes several utilities to manage, verify, and tune CacheLane's behavior locally.
            </p>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section id="lifecycle-commands">
            <h2>Lifecycle and Setup</h2>
            
            <h3>cachelane install</h3>
            <p>Registers the CacheLane stdio MCP server in Claude's configuration and writes hook configurations.</p>
            <CodeBlock language="bash">cachelane install [--force]</CodeBlock>

            <h3>cachelane doctor</h3>
            <p>Runs runtime health checks. Verifies Node compatibility, database accessibility, and configurations.</p>
            <CodeBlock language="bash">cachelane doctor [--json]</CodeBlock>

            <h3>cachelane uninstall</h3>
            <p>Removes the CacheLane integrations. Use <InlineCode>--purge</InlineCode> to completely wipe config files and SQLite database logs.</p>
            <CodeBlock language="bash">cachelane uninstall [--purge]</CodeBlock>
          </section>
        </FadeIn>

        <FadeIn delay={0.1}>
          <section id="tuning-commands">
            <h2>Performance Tuning</h2>

            <h3>cachelane stats</h3>
            <p>Prints cache ratios, turn counters, and estimated API savings.</p>
            <CodeBlock language="bash">cachelane stats [--scope session|workspace|all] [--since {'<'}duration{'>'}]</CodeBlock>

            <h3>cachelane explain</h3>
            <p>Explains context classification and pruning choices made during turn <InlineCode>N</InlineCode>.</p>
            <CodeBlock language="bash">cachelane explain [--turn {'<'}number{'>'}]</CodeBlock>

            <h3>cachelane prune</h3>
            <p>Configures pruning threshold variables. Default is <InlineCode>K=3</InlineCode>; aggressive is <InlineCode>K=2</InlineCode>; conservative is <InlineCode>K=5</InlineCode>.</p>
            <CodeBlock language="bash">cachelane prune --default | --aggressive | --conservative</CodeBlock>

            <h3>cachelane keepalive</h3>
            <p>Configures adaptive prompt TTL keepalive worker behaviors.</p>
            <CodeBlock language="bash">cachelane keepalive off | static | adaptive | auto</CodeBlock>
          </section>
        </FadeIn>

        <FadeIn delay={0.15}>
          <section id="pin-exclude">
            <h2>Pinning and Exclusions</h2>

            <h3>cachelane pin</h3>
            <p>Pins a target file or glob pattern, locking it inside the stable caching region to prevent it from ever being pruned.</p>
            <CodeBlock language="bash">cachelane pin {'<'}file|glob{'>'}</CodeBlock>

            <h3>cachelane exclude</h3>
            <p>Excludes files matching a glob pattern from cache-aware categorization.</p>
            <CodeBlock language="bash">cachelane exclude {'<'}file|glob{'>'}</CodeBlock>
          </section>
        </FadeIn>
      </Prose>
    </>
  );
}
