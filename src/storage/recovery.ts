import Database from "better-sqlite3";
import { applyMigrations } from "./migrations.js";

export function isCorruptionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("file is not a database") ||
    msg.includes("database disk image is malformed") ||
    msg.includes("integrity_check failed") ||
    msg.includes("sqlite_notadb") ||
    msg.includes("sqlite_corrupt")
  );
}

export function tryOpen(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyMigrations(db);
  return db;
}
