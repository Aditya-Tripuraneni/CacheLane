# cachelane-audit

See where your Claude Code input tokens went, and why the prompt cache rebuilt. Reads your local transcripts (`~/.claude/projects`). Usage metadata only, nothing leaves your machine. Zero dependencies.

```bash
npx cachelane-audit              # last 30 days
npx cachelane-audit --days 7 --project .
npx cachelane-audit --json --no-paths
```

It reports:
- Your cache hit ratio.
- The share of input spend that went to cache rebuilds.
- What caused each rebuild: idle past the cache TTL, model switch, compaction, a proxy stripping cache markers, or a prefix change.

## Cold-cache guard (Claude Code plugin)

```
/plugin marketplace add Aditya-Tripuraneni/CacheLane
/plugin install cachelane@cachelane
```

When you come back to a session whose cache has expired and whose context is large (150k tokens by default), the guard blocks your first message once. It shows what continuing, `/compact`, and `/clear` would cost. To proceed anyway, send the same message again within 2 minutes.

```bash
npx cachelane-audit guard off | on | status | threshold 200000
```

Dollar figures use Anthropic API list prices. On a Pro/Max plan, read them as relative usage.
