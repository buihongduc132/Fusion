import { describe, expect, it } from "vitest";
import { ArchiveDatabase } from "../archive-db.js";

/**
 * Regression tests for the ArchiveDatabase CPU pegging issue.
 *
 * Root cause: normalizeDriftedTitlesOnce() ran a LIKE '%FN-%' scan on every
 * init(), even when archived_tasks was empty. With 137+ registered projects
 * each creating 2 ArchiveDatabase instances (resolver + engine), this caused
 * ~274 SQL scans at startup, pegging CPU at 40-80% and blocking the event loop.
 *
 * The fix:
 * 1. _titlesNormalized guard: normalizeDriftedTitlesOnce() runs at most once per instance
 * 2. Fast exit: skip the LIKE scan when archived_tasks is empty (most projects)
 * 3. Silent logging: only log when normalization actually changed something
 */
describe("ArchiveDatabase init performance regression", () => {
  it("init() is idempotent — normalizeDriftedTitlesOnce runs only once", () => {
    const db = new ArchiveDatabase("/tmp/fusion-init-idempotent-test", { inMemory: true });

    // First init sets _titlesNormalized = true
    db.init();

    // Access internal state to confirm guard is set
    expect((db as any)._titlesNormalized).toBe(true);

    // Calling init() again should NOT reset the guard or re-run normalization
    db.init();
    expect((db as any)._titlesNormalized).toBe(true);

    db.close();
  });

  it("init() skips normalization when archived_tasks is empty", () => {
    const db = new ArchiveDatabase("/tmp/fusion-init-empty-table-test", { inMemory: true });
    db.init();

    // The table exists but is empty — normalization should be a no-op
    const rawDb = (db as any).db;
    const count = rawDb.prepare("SELECT COUNT(*) as cnt FROM archived_tasks").get() as { cnt: number };
    expect(count.cnt).toBe(0);

    // Verify _titlesNormalized is true (ran once but fast-exited)
    expect((db as any)._titlesNormalized).toBe(true);

    db.close();
  });

  it("init() does not log when no titles need normalization", () => {
    const db = new ArchiveDatabase("/tmp/fusion-init-silent-test", { inMemory: true });

    // Capture console.log calls
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      const msg = args.join(" ");
      if (msg.includes("title-id-drift")) logs.push(msg);
    };

    try {
      db.init();

      // No title-id-drift logs when table is empty
      expect(logs).toHaveLength(0);

      // Insert a task that does NOT have FN- drift
      const rawDb = (db as any).db;
      const now = new Date().toISOString();
      rawDb.prepare(`
        INSERT INTO archived_tasks (id, taskJson, prompt, archivedAt, title, description, comments, createdAt, updatedAt, columnMovedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run("FN-300", JSON.stringify({
        id: "FN-300",
        title: "Clean title",
        description: "desc",
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      }), null, now, "Clean title", "desc", "[]", now, now, now);

      // Reset guard and re-init to test with non-empty table
      (db as any)._titlesNormalized = false;
      db.init();

      // Title "Clean title" has no drift relative to id "FN-300", so no log
      expect(logs).toHaveLength(0);
    } finally {
      console.log = origLog;
      db.close();
    }
  });

  it("init() DOES log when titles are actually normalized", () => {
    const db = new ArchiveDatabase("/tmp/fusion-init-normalize-test", { inMemory: true });
    db.init();

    // Insert a task WITH title-id drift
    const rawDb = (db as any).db;
    const now = new Date().toISOString();
    rawDb.prepare(`
      INSERT INTO archived_tasks (id, taskJson, prompt, archivedAt, title, description, comments, createdAt, updatedAt, columnMovedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("FN-400", JSON.stringify({
      id: "FN-400",
      title: "Feature: FN-999: implement foo",
      description: "desc",
      archivedAt: now,
      createdAt: now,
      updatedAt: now,
    }), null, now, "Feature: FN-999: implement foo", "desc", "[]", now, now, now);

    // Capture console.log
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      const msg = args.join(" ");
      if (msg.includes("title-id-drift")) logs.push(msg);
    };

    try {
      // Reset guard and re-init
      (db as any)._titlesNormalized = false;
      db.init();

      // Should have logged because normalization happened
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs[0]).toContain("archive-db normalized");
    } finally {
      console.log = origLog;
      db.close();
    }
  });

  it("multiple ArchiveDatabase instances init independently", () => {
    // Simulates the real-world scenario: 137 projects each create their own ArchiveDatabase.
    // Each instance should init independently without interference.
    const instances: ArchiveDatabase[] = [];

    for (let i = 0; i < 10; i++) {
      const db = new ArchiveDatabase(`/tmp/fusion-multi-init-${i}`, { inMemory: true });
      db.init();
      instances.push(db);
    }

    // All instances should have the guard set
    for (const db of instances) {
      expect((db as any)._titlesNormalized).toBe(true);
    }

    // Re-init all — should be no-ops
    for (const db of instances) {
      db.init();
      expect((db as any)._titlesNormalized).toBe(true);
    }

    for (const db of instances) {
      db.close();
    }
  });
});
