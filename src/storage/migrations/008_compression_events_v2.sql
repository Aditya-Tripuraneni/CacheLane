ALTER TABLE compression_events ADD COLUMN compressor_id TEXT;
ALTER TABLE compression_events ADD COLUMN mode TEXT;
ALTER TABLE compression_events ADD COLUMN lossiness TEXT;
ALTER TABLE compression_events ADD COLUMN outcome TEXT;
ALTER TABLE compression_events ADD COLUMN latency_ms REAL;
ALTER TABLE compression_events ADD COLUMN token_model TEXT;
ALTER TABLE compression_events ADD COLUMN retention_handle TEXT;
