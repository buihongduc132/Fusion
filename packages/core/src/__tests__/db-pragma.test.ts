import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database, createDatabase } from "../db.js";

/**
 * PRAGMA settings are applied in Database constructor (non-in-memory mode).
 * These tests verify the runtime DB configuration is correctly applied.
 *
 * In-memory DBs skip WAL-only PRAGMAs — we test with file-backed DBs.
 *
 * Note: node:sqlite PRAGMA column names may differ from the PRAGMA keyword.
 * e.g. PRAGMA busy_timeout returns { timeout: N }, not { busy_timeout: N }.
 */
describe("Database PRAGMA configuration", () => {
  let tempDir: string;
  let db: Database;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "fusion-pragma-test-"));
  });

  afterEach(() => {
    try {
      db?.close();
    } catch {
      // ignore
    }
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3 });
  });

  function openFileDb(): Database {
    mkdirSync(join(tempDir, ".fusion"), { recursive: true });
    const database = createDatabase(tempDir);
    database.init();
    return database;
  }

  it("sets journal_mode to WAL", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA journal_mode").get() as Record<string, unknown>;
    expect(Object.values(row)[0]).toBe("wal");
  });

  it("sets synchronous to FULL", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA synchronous").get() as Record<string, unknown>;
    // FULL = 3 in SQLite docs, but node:sqlite may report 2 in WAL mode.
    // What matters: it's not 0 (OFF) or 1 (NORMAL).
    expect(Object.values(row)[0]).toBeGreaterThanOrEqual(2);
  });

  it("sets busy_timeout to 5000ms", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA busy_timeout").get() as Record<string, unknown>;
    // Column name is "timeout" in node:sqlite
    expect(Object.values(row)[0]).toBe(5000);
  });

  it("enables foreign keys", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA foreign_keys").get() as Record<string, unknown>;
    expect(Object.values(row)[0]).toBe(1);
  });

  it("sets cache_size to at least 20000 pages", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA cache_size").get() as Record<string, unknown>;
    // Negative = KiB. Verify it's well above default (2000 pages).
    expect(Math.abs(Number(Object.values(row)[0]))).toBeGreaterThanOrEqual(20000);
  });

  it("sets temp_store to MEMORY", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA temp_store").get() as Record<string, unknown>;
    // MEMORY = 2
    expect(Object.values(row)[0]).toBe(2);
  });

  it("sets wal_autocheckpoint to 1000", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA wal_autocheckpoint").get() as Record<string, unknown>;
    expect(Object.values(row)[0]).toBe(1000);
  });

  it("sets journal_size_limit to at least 16 MB", () => {
    db = openFileDb();
    const row = db.prepare("PRAGMA journal_size_limit").get() as Record<string, unknown>;
    // 16 MB = 16777216 bytes
    expect(Number(Object.values(row)[0])).toBeGreaterThanOrEqual(16777216);
  });
});
