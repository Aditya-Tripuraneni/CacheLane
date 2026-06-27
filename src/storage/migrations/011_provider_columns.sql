-- Provider portability: tag each turn with its provider and record a
-- provider-neutral total cache-write figure alongside the existing
-- Anthropic-tier columns (cache_creation_5m_tokens / cache_creation_1h_tokens,
-- cache_read_tokens). Tier-less providers (e.g. OpenAI implicit cache) write
-- only cache_write_tokens; the Anthropic path keeps populating the tier columns.
ALTER TABLE turns ADD COLUMN provider TEXT NOT NULL DEFAULT 'anthropic';
ALTER TABLE turns ADD COLUMN cache_write_tokens INTEGER NOT NULL DEFAULT 0;

-- Backfill the neutral total for existing rows from the Anthropic tier columns.
UPDATE turns
SET cache_write_tokens = cache_creation_5m_tokens + cache_creation_1h_tokens;
