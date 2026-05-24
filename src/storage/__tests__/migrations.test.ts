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
  it("004_fail_open adds signals and request_mutated, migrating existing data safely", () => {
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
