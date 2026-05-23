import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATION_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

export function applyMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = new Set(
    (
      db
        .prepare("SELECT id FROM schema_migrations ORDER BY id")
        .all() as { id: string }[]
    ).map((row) => row.id),
  );
  const insertMigrationStmt = db.prepare(
    "INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)",
  );

  const files = fs
    .readdirSync(MIGRATION_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const id = path.basename(file, ".sql");
    if (applied.has(id)) continue;

    const sql = fs.readFileSync(path.join(MIGRATION_DIR, file), "utf-8");
    const applyOne = db.transaction(() => {
      db.exec(sql);
      insertMigrationStmt.run(id, Date.now());
    });
    applyOne();
  }
}
