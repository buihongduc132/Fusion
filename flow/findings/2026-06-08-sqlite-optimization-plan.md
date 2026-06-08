---
category: database
module: core
tags: [sqlite, performance, plan, indexing, pragma]
date: 2026-06-08
status: plan
---

# SQLite Optimization Plan — Least Resistance, Zero Breakage

## Principles

1. **NEVER rewrite** — only add indexes, adjust PRAGMA, add retention
2. **Tests BEFORE changes** — add PRAGMA test, then change PRAGMA
3. **Each change is independently deployable** — no coupled changes
4. **Verifier loop** — `pnpm test:gate` after each change
5. **Review gate** — `claude -p` review before commit
6. **DB config = no data loss** — PRAGMA changes are runtime, not schema

## Phase 1: Safe PRAGMA Tuning (runtime, no schema change)

### 1a. Add `cache_size` PRAGMA (8 MB → 80 MB)

**Spot:** `packages/core/src/db.ts:1643` (after `foreign_keys = ON`)
**What:** Add `this.db.exec("PRAGMA cache_size = -20000");` (negative = KiB)
**Risk:** Zero. Only affects in-memory page cache. Larger cache = fewer disk reads.
**Test first:** Create `packages/core/src/__tests__/db-pragma.test.ts`

```ts
// Test: verify PRAGMA settings after init
it("sets cache_size to 80 MB", () => {
  const db = new Database(":memory:");
  // ... init ...
  const row = db.prepare("PRAGMA cache_size").get();
  expect(row.cache_size).toBe(-20000); // negative = KiB
});
```

### 1b. Add `temp_store = MEMORY` PRAGMA

**Spot:** Same location as 1a
**What:** Add `this.db.exec("PRAGMA temp_store = MEMORY");`
**Risk:** Zero. Temp tables/indexes in RAM instead of disk. Lost on process restart (acceptable).

### 1c. Increase `journal_size_limit` (4 MB → 16 MB)

**Spot:** `packages/core/src/db.ts:1637`
**What:** Change `4194304` to `16777216`
**Risk:** Zero. Just allows WAL to grow larger before auto-checkpoint. Prevents frequent checkpoints.

### 1d. KEEP `synchronous = FULL` (DO NOT CHANGE)

The comment at line 1631-1634 explains: node:sqlite SIGSEGVs corrupted the DB before.
This stays FULL. The 2-3x write speedup from NORMAL is NOT worth the corruption risk.

### 1e. Verify PRAGMA test coverage

Create test that asserts ALL PRAGMA values after init. This prevents accidental regressions.

## Phase 2: Add Missing Indexes (schema addition, no rewrite)

**Spot:** `packages/core/src/db.ts` — each index goes in the migration block
**Principle:** `CREATE INDEX IF NOT EXISTS` — idempotent, no-op if exists

### Indexes to add (in order of query frequency):

```sql
-- tasks table: recovery sweeps
CREATE INDEX IF NOT EXISTS idxTasksStatus ON tasks(status);
-- tasks table: mission queries (4 distinct queries)
CREATE INDEX IF NOT EXISTS idxTasksMissionId ON tasks(missionId);
-- tasks table: worktree conflict detection
CREATE INDEX IF NOT EXISTS idxTasksWorktree ON tasks(worktree);
-- tasks table: branch conflict checks
CREATE INDEX IF NOT EXISTS idxTasksBranch ON tasks(branch);
-- tasks table: recovery paused sweep
CREATE INDEX IF NOT EXISTS idxTasksPaused ON tasks(paused) WHERE paused = 1;
-- tasks table: compound source query
CREATE INDEX IF NOT EXISTS idxTasksSourceTypeSourceId ON tasks(sourceType, sourceId);
-- agentTaskSessions: no indexes at all!
CREATE INDEX IF NOT EXISTS idxAgentTaskSessionsAgentId ON agentTaskSessions(agentId);
CREATE INDEX IF NOT EXISTS idxAgentTaskSessionsAgentIdTaskId ON agentTaskSessions(agentId, taskId);
-- mission_events: error queries
CREATE INDEX IF NOT EXISTS idxMissionEventsEventType ON mission_events(eventType);
CREATE INDEX IF NOT EXISTS idxMissionEventsMissionIdEventType ON mission_events(missionId, eventType);
```

### Test first:
- Run `pnpm test:gate` — must pass before AND after index addition
- Add test: `packages/core/src/__tests__/db-index-coverage.test.ts`
  - Asserts all expected indexes exist via `PRAGMA index_list`

## Phase 3: runAuditEvents Retention (data lifecycle)

**Spot:** New method in `packages/core/src/db.ts` or `packages/core/src/store.ts`
**What:** Add `cleanupOldAuditEvents(retentionDays: number)` method
- `DELETE FROM runAuditEvents WHERE timestamp < datetime('now', '-${retentionDays} days')`
- Default retention: 30 days
**When to run:** On engine startup or periodic heartbeat
**Test first:** Test the cleanup method with known timestamps

## Phase 4: Verify + Review

After each phase:
1. `pnpm test:gate` — must pass
2. `pnpm lint` — must pass
3. `pnpm build` — must pass
4. `claude -p "Review the SQLite performance changes in this diff for safety, correctness, and data integrity risks"` — must approve
5. Commit with `feat(FN-XXXX):` prefix

## Phase 5: Deploy Config to noco-mesh

PRAGMA changes (cache_size, temp_store, journal_size_limit) take effect on next DB open.
Deploy: `nomad job run ../noco-mesh/ops-fusion/nomad/fusion.nomad.hcl`
This restarts fusiond → new PRAGMAs applied on DB open.

## What We're NOT Doing (out of scope / too risky)

- ❌ Changing `synchronous=FULL` to `NORMAL` (corruption history)
- ❌ Normalizing JSON columns into separate tables (massive rewrite)
- ❌ Moving `log` column to separate table (contract change)
- ❌ Adding ORM (rewrite)
- ❌ Changing `rowToTask()` structure (contract change)
- ❌ Reducing JSON.parse calls in slim mode (needs API contract review)

## Deployment Status

### Phase 1: PRAGMA Tuning — DEPLOYED ✅

| PRAGMA | Before | After | Status |
|--------|--------|-------|--------|
| `cache_size` | default (2000 pages / 8 MB) | -20000 (80 MB) | ✅ Deployed |
| `temp_store` | 0 (FILE) | 2 (MEMORY) | ✅ Deployed |
| `journal_size_limit` | 4 MB | 16 MB | ✅ Deployed |
| `synchronous` | FULL | FULL (unchanged) | ✅ Kept |
| `wal_autocheckpoint` | 1000 | 1000 (unchanged) | ✅ Kept |

- Source code: `packages/core/src/db.ts` (lines 1637, 1644-1648)
- Test: `packages/core/src/__tests__/db-pragma.test.ts` (8 tests, all green)
- Deployed binary: `~/.local/fusion/node_modules/@runfusion/fusion/dist/bin.js` (patched)
- Daemon restarted: PID 1946882, healthy as of 2026-06-08T16:17:38Z
- Gate: `pnpm test:gate` passed (1085 tests)

### Phase 2-3: NOT YET DEPLOYED

Indexes and runAuditEvents retention pending next task cycle.
