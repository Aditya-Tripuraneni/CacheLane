import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// tsup bundles storage code into both dist/index.cjs (__dirname=dist/) and
// dist/cli/index.cjs (__dirname=dist/cli/). The migrations folder is always
// copied to dist/migrations/ by the tsup onSuccess hook, so we check both
// possible relative locations.
function findMigrationDir(): string {
  const candidates = [
    path.join(__dirname, "migrations"),
    path.join(__dirname, "..", "migrations"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  // Fallback — will error later with a clear ENOENT if missing
  return candidates[0]!;
}

export const MIGRATION_DIR = findMigrationDir();

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
