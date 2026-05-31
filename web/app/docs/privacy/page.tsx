import { PageHeader } from '@/components/docs/page-header';
import { Prose } from '@/components/docs/prose';
import { FadeIn } from '@/components/motion/fade-in';
import { InlineCode } from '@/components/code/inline-code';

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        eyebrow="Privacy"
        title="Privacy &amp; Database"
        description="Learn how CacheLane handles telemetry, config structures, and local databases."
      />
      <Prose>
        <FadeIn>
          <section id="local-first">
            <h2>Local-First Guarantee</h2>
            <p>
              CacheLane is designed to be fully local-first. We do not run hosted SaaS backend APIs, cloud databases, or external tracking servers. All telemetry, logs, and database metrics are kept entirely on your machine.
            </p>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section id="data-paths">
            <h2>Data Paths</h2>
            <p>CacheLane stores its state and logs in the following directories on your system:</p>
            <ul>
              <li><strong>Local Config:</strong> <InlineCode>~/.cachelane/config.json</InlineCode> (pruning variables, ignore files, telemetry choices).</li>
              <li><strong>SQLite Log:</strong> <InlineCode>~/.cachelane/cachelane.db</InlineCode> (turn cost statistics, block IDs, reference hashes, and stats).</li>
              <li><strong>Logs:</strong> <InlineCode>~/.cachelane/logs/*.log</InlineCode> (daily rotated structured logs with a 7-day retention limit).</li>
            </ul>
          </section>
        </FadeIn>

        <FadeIn delay={0.1}>
          <section id="sqlite-metrics">
            <h2>What is Stored in the SQLite Database?</h2>
            <p>
              To execute K-pruning and compile metrics for the <InlineCode>stats</InlineCode> panel, CacheLane stores block metadata. **It never stores the actual prompt text, file contents, assistant responses, or API keys.**
            </p>
            <p>Stored columns include:</p>
            <ul>
              <li>Unique block IDs and content hashes.</li>
              <li>Block type classification (e.g. system, user query, tool schema).</li>
              <li>Billed token count estimates from Anthropic responses.</li>
              <li>Volatility designations and reference counts.</li>
            </ul>
          </section>
        </FadeIn>

        <FadeIn delay={0.15}>
          <section id="telemetry">
            <h2>Telemetry Settings</h2>
            <p>
              Anonymous telemetry is **disabled by default**. Payloads only compile aggregated cache hits and baseline metrics. They never contain file names, content blocks, workspace keys, or session identifiers.
            </p>
          </section>
        </FadeIn>
      </Prose>
    </>
  );
}
