---
description: Show where your Claude Code input tokens went and why the prompt cache rebuilt
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/bin/cachelane-audit.mjs" $ARGUMENTS`

Summarize the audit above in 3 bullets: the cache hit ratio, the share of spend on rebuilds with its top cause, and the recommended next step.
