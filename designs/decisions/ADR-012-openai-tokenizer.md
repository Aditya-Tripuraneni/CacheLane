# ADR-012: Add `tiktoken` for OpenAI token counting

**Status:** Accepted
**Date:** 2026-06-25

**Context:** Porting Cachelane to OpenAI-style tools requires counting tokens with
OpenAI's BPE encodings (`o200k_base` for gpt-4o/gpt-4.1/o-series, `cl100k_base` for
older models). The existing `@anthropic-ai/tokenizer` is claude-only and throws on
non-`claude-` model IDs.

**Decision:** Add the `tiktoken` npm package (Rust/WASM, MIT license) as the OpenAI
tokenizer backend, selected per-provider via the `Tokenizer` interface introduced in the
provider-portability work. WASM init is lazy and memoized per encoding.

**Consequences:** One new runtime dependency. The Anthropic token-counting path is
unaffected (still uses `@anthropic-ai/tokenizer`). Provider selection of the tokenizer is
handled by each `ProviderAdapter`.
