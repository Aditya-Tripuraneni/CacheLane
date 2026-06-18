import { PageHeader } from '@/components/docs/page-header';
import { Prose } from '@/components/docs/prose';
import { Callout } from '@/components/docs/callout';
import { FadeIn } from '@/components/motion/fade-in';
import { InlineCode } from '@/components/code/inline-code';
import { CodeBlock } from '@/components/code/code-block';

export default function GettingStartedPage() {
  return (
    <>
      <PageHeader
        eyebrow="Get started"
        title="Introduction &amp; Setup"
        description="Learn how to install, register, and verify CacheLane on your local machine."
      />
      <Prose>
        <FadeIn>
          <section id="introduction">
            <h2>What is CacheLane?</h2>
            <p>
              CacheLane is a **local-first caching and context-discipline middleware** for Claude Code. It sits invisibly between your CLI client and the Anthropic API, intercepting request payloads and structuring them to maximize prompt-cache matches.
            </p>
            <p>
              By combining cache-aware block reordering with turn-based context pruning (K-pruning) and background keepalive pings, CacheLane reduces billing tokens for long multi-turn sessions by **30% to 60%** without discarding information or changing your workflow.
            </p>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section id="prerequisites">
            <h2>Prerequisites</h2>
            <ul>
              <li>
                <strong>Node.js:</strong> <InlineCode>v20.10.x</InlineCode> or later. Node 20 is strongly recommended as native SQLite bindings are optimized for Node 20.
              </li>
              <li>
                <strong>Claude Code:</strong> <InlineCode>v0.6.x</InlineCode> or later.
              </li>
            </ul>
          </section>
        </FadeIn>

        <FadeIn delay={0.1}>
          <section id="installation">
            <h2>Installation</h2>
            <p>To compile and install CacheLane globally from source:</p>
            <CodeBlock language="bash">{`# Clone the repository
git clone https://github.com/Aditya-Tripuraneni/CacheLane.git
cd CacheLane

# Install package dependencies
npm install

# Compile the TypeScript files
npm run build

# Link globally to your local npm registry
npm link`}</CodeBlock>
          </section>
        </FadeIn>

        <FadeIn delay={0.15}>
          <section id="setup">
            <h2>Integration with Claude Code</h2>
            <p>
              Once linked, initialize the idempotent installation command. This registers the stdio MCP server in Claude's global settings and copies hook descriptors into place:
            </p>
            <CodeBlock language="bash">cachelane install</CodeBlock>
            <p>This command automatically executes the following changes:</p>
            <ol>
              <li>Registers the CacheLane MCP server inside <InlineCode>~/.claude/mcp.json</InlineCode>.</li>
              <li>Writes PreRequest and PostResponse hook configurations into <InlineCode>~/.claude/hooks/</InlineCode>.</li>
              <li>Scaffolds a default configuration file at <InlineCode>~/.cachelane/config.json</InlineCode> if none exists.</li>
            </ol>
          </section>
        </FadeIn>

        <FadeIn delay={0.2}>
          <section id="verification">
            <h2>Verifying the Installation</h2>
            <p>
              Verify your setup by running the built-in diagnostic tool. It checks Node compatibility, hook registration, configuration schemas, and database write access:
            </p>
            <CodeBlock language="bash">cachelane doctor</CodeBlock>
            <Callout kind="tip" title="Fail-Open Guarantee">
              If CacheLane ever encounters a runtime exception or database lock, it will log the error and **immediately pass the unmodified payload through** to Anthropic. Your Claude Code sessions will never break or crash.
            </Callout>
          </section>
        </FadeIn>
      </Prose>
    </>
  );
}
