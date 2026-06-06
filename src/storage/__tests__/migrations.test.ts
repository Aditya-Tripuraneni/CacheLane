import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.join(__dirname, "..", "migrations");

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cachelane-migrations-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("Migrations", () => {
  describe("migration 001 — initial schema", () => {
    it("creates blocks, turns, block_references with correct columns", () => {
      const dbPath = path.join(tmpDir, "test.db");

      // Apply only migration 001 manually to verify its schema contribution in isolation
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `);
      const sql = fs.readFileSync(path.join(MIGRATION_DIR, "001_initial.sql"), "utf-8");
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("001_initial", Date.now());
      db.close();

      // Open via openDatabase (remaining migrations run on top; 001 tables already exist)
      const cachelaneDb = openDatabase(dbPath);

      // blocks table: verify table exists and key columns are present
      const tables = cachelaneDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as { name: string }[];
      const tableNames = tables.map(t => t.name);

      expect(tableNames).toContain("blocks");
      expect(tableNames).toContain("turns");
      expect(tableNames).toContain("block_references");

      // blocks columns — only those defined in 001_initial.sql
      const blockCols = (cachelaneDb.pragma("table_info(blocks)") as { name: string }[]).map(c => c.name);
      expect(blockCols).toContain("id");
      expect(blockCols).toContain("workspace_id");
      expect(blockCols).toContain("session_id");
      expect(blockCols).toContain("content_hash");
      expect(blockCols).toContain("kind");
      expect(blockCols).toContain("volatility");
      expect(blockCols).toContain("is_pinned");
      expect(blockCols).toContain("token_count");
      expect(blockCols).toContain("added_at_turn");
      expect(blockCols).toContain("last_referenced_at_turn");
      expect(blockCols).toContain("unused_turns");
      expect(blockCols).toContain("is_stub");
      expect(blockCols).toContain("stub_summary");
      expect(blockCols).toContain("refetch_handle");
      expect(blockCols).toContain("created_at");
      expect(blockCols).toContain("updated_at");

      // turns columns — only those defined in 001_initial.sql
      const turnCols = (cachelaneDb.pragma("table_info(turns)") as { name: string }[]).map(c => c.name);
      expect(turnCols).toContain("id");
      expect(turnCols).toContain("workspace_id");
      expect(turnCols).toContain("session_id");
      expect(turnCols).toContain("turn_number");
      expect(turnCols).toContain("model");
      expect(turnCols).toContain("input_tokens");
      expect(turnCols).toContain("output_tokens");
      expect(turnCols).toContain("cache_creation_5m_tokens");
      expect(turnCols).toContain("cache_creation_1h_tokens");
      expect(turnCols).toContain("cache_read_tokens");
      expect(turnCols).toContain("effective_cost_units");
      expect(turnCols).toContain("prefix_breakpoint_hash");
      expect(turnCols).toContain("middle_breakpoint_hash");
      expect(turnCols).toContain("pruned_blocks_count");
      expect(turnCols).toContain("keepalive_pings_since_last_turn");
      expect(turnCols).toContain("created_at");

      // block_references columns — only those defined in 001_initial.sql
      const refCols = (cachelaneDb.pragma("table_info(block_references)") as { name: string }[]).map(c => c.name);
      expect(refCols).toContain("id");
      expect(refCols).toContain("block_id");
      expect(refCols).toContain("turn_id");
      expect(refCols).toContain("reference_type");
      expect(refCols).toContain("evidence");
      expect(refCols).toContain("created_at");

      cachelaneDb.close();
    });
  });

  describe("migration 002 — restored_at_turn", () => {
    it("adds restored_at_turn column to blocks", () => {
      const dbPath = path.join(tmpDir, "test.db");

      // Apply migration 001 manually to simulate a pre-002 database
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `);
      const sql001 = fs.readFileSync(path.join(MIGRATION_DIR, "001_initial.sql"), "utf-8");
      db.exec(sql001);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run("001_initial", Date.now());
      db.close();

      // Open via openDatabase to trigger migrations 002 and beyond
      const cachelaneDb = openDatabase(dbPath);

      // Verify restored_at_turn was added to blocks by migration 002
      const blockCols = (cachelaneDb.pragma("table_info(blocks)") as { name: string }[]).map(c => c.name);
      expect(blockCols).toContain("restored_at_turn");

      // Verify the column accepts NULL (nullable column, no default)
      const colMeta = (cachelaneDb.pragma("table_info(blocks)") as { name: string; notnull: number; dflt_value: unknown }[])
        .find(c => c.name === "restored_at_turn");
      expect(colMeta).toBeDefined();
      expect(colMeta!.notnull).toBe(0);
      expect(colMeta!.dflt_value).toBeNull();

      cachelaneDb.close();
    });
  });

  describe("migration 003 — turn_explanations", () => {
    it("creates turn_explanations table with all columns", () => {
      const dbPath = path.join(tmpDir, "test.db");

      // Apply migrations 001 and 002 manually to simulate a pre-003 database
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `);
      for (const file of ["001_initial.sql", "002_restored_at_turn.sql"]) {
        const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
        db.exec(sql);
        db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(
          path.basename(file, ".sql"),
          Date.now()
        );
      }
      db.close();

      // Open via openDatabase to trigger migration 003 and beyond
      const cachelaneDb = openDatabase(dbPath);

      // Verify turn_explanations table exists
      const tables = cachelaneDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all() as { name: string }[];
      expect(tables.map(t => t.name)).toContain("turn_explanations");

      // Verify key columns from migration 003
      const expCols = (cachelaneDb.pragma("table_info(turn_explanations)") as { name: string }[]).map(c => c.name);
      expect(expCols).toContain("id");
      expect(expCols).toContain("turn_id");
      expect(expCols).toContain("workspace_id");
      expect(expCols).toContain("session_id");
      expect(expCols).toContain("turn_number");
      expect(expCols).toContain("model");
      expect(expCols).toContain("prefix_breakpoint_hash");
      expect(expCols).toContain("middle_breakpoint_hash");
      expect(expCols).toContain("mutated");
      expect(expCols).toContain("pruned_blocks_count");
      expect(expCols).toContain("prune_decisions_json");
      expect(expCols).toContain("block_metadata_json");
      expect(expCols).toContain("region_metadata_json");
      expect(expCols).toContain("signals_json");
      expect(expCols).toContain("usage_input_tokens");
      expect(expCols).toContain("usage_output_tokens");
      expect(expCols).toContain("usage_cache_creation_5m_tokens");
      expect(expCols).toContain("usage_cache_creation_1h_tokens");
      expect(expCols).toContain("usage_cache_read_tokens");
      expect(expCols).toContain("usage_effective_cost_units");
      expect(expCols).toContain("created_at");
      expect(expCols).toContain("updated_at");

      cachelaneDb.close();
    });
  });

  describe("migration 004 — fail_open signals", () => {
    it("adds signals and request_mutated, migrating existing data safely", () => {
      const dbPath = path.join(tmpDir, "test.db");

      // 1. Manually apply up to 003 to simulate older db
      const db = new Database(dbPath);

      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        )
      `);

      const files = ["001_initial.sql", "002_restored_at_turn.sql", "003_turn_explanations.sql"];
      for (const file of files) {
        const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
        db.exec(sql);
        const id = path.basename(file, ".sql");
        db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(id, Date.now());
      }

      // 2. Insert dummy old data into turns
      db.prepare(`
        INSERT INTO turns (
          id, workspace_id, session_id, turn_number, model,
          input_tokens, output_tokens, cache_creation_5m_tokens,
          cache_creation_1h_tokens, cache_read_tokens, effective_cost_units,
          pruned_blocks_count, keepalive_pings_since_last_turn, created_at
        ) VALUES (
          'test-turn-1', 'ws-1', 'sess-1', 1, 'model-x',
          10, 20, 0, 0, 0, 100, 0, 0, 123456789
        )
      `).run();

      db.close();

      // 3. Open via openDatabase to trigger remaining migrations (004)
      const cachelaneDb = openDatabase(dbPath);

      // 4. Verify columns exist on the table
      const columns = cachelaneDb.pragma("table_info(turns)") as { name: string; type: string; dflt_value: unknown }[];
      const names = columns.map(c => c.name);

      expect(names).toContain("signals");
      expect(names).toContain("request_mutated");

      // 5. Verify existing row is preserved and defaults are correct
      const turn = cachelaneDb.prepare("SELECT * FROM turns WHERE id = 'test-turn-1'").get() as Record<string, unknown>;
      expect(turn).toBeDefined();
      expect(turn.signals).toBeNull();
      expect(turn.request_mutated).toBe(0);

      // 6. Verify we can insert a new turn with the new fields
      cachelaneDb.insertTurn({
        id: "test-turn-2",
        workspace_id: "ws-1",
        session_id: "sess-1",
        turn_number: 2,
        model: "model-x",
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_5m_tokens: 0,
        cache_creation_1h_tokens: 0,
        cache_read_tokens: 0,
        effective_cost_units: 100,
        prefix_breakpoint_hash: null,
        middle_breakpoint_hash: null,
        pruned_blocks_count: 0,
        keepalive_pings_since_last_turn: 0,
        signals: JSON.stringify(["test_signal"]),
        request_mutated: 1,
        created_at: 123456790
      });

      const turn2 = cachelaneDb.prepare("SELECT * FROM turns WHERE id = 'test-turn-2'").get() as Record<string, unknown>;
      expect(turn2.signals).toBe('["test_signal"]');
      expect(turn2.request_mutated).toBe(1);

      cachelaneDb.close();
    });
  });
});
