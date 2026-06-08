---
category: database
module: core
tags: [sqlite, performance, indexing, pragma, optimization]
problem_type: performance
applies_when: DB grows beyond 50 tasks or query latency becomes noticeable
date: 2026-06-08
---

# SQLite Performance Audit — Fusion DB Layer

## Architecture

- **One monorepo** (`@runfusion/fusion` npm package), BE + FE in same repo
- `@fusion/core` = domain model + SQLite DB + all store logic (private)
- `@fusion/engine` = triage/executor/reviewer/merger/scheduler (private)
- `@fusion/dashboard` = Express routes + React SPA (private)
- Dashboard imports core/engine directly (static, not HTTP)
- **100% raw SQL** via `node:sqlite` `DatabaseSync` — no ORM
- Pattern: `.prepare(sql).all/get/run(params)`
- Helper: `fromJson<T>()` parses JSON columns on read

## DB Stats (fusion-web project, 2026-06-08)

| Metric | Value |
|--------|-------|
| DB file | 26 MB |
| WAL mode | Yes |
| Tables | 77 |
| Indexes | 129 |
| Active tasks | 38 |
| Largest table | `runAuditEvents` (13K rows, 4 MB) |
| Task log JSON | avg 40 KB/row, max 193 KB |
| PRAGMA | `synchronous=FULL`, `busy_timeout=5000`, `wal_autocheckpoint=1000` |

## Identified Issues

### 1. Missing Indexes (query full-scan risks)

| Table | Missing Index | Query Pattern | Store File |
|-------|--------------|---------------|------------|
| `tasks` | `status` | `WHERE status = ?` (recovery, self-healing) | store.ts |
| `tasks` | `missionId` | `WHERE missionId = ?` (4 queries) | mission-store.ts |
| `tasks` | `(sourceType, sourceId)` | compound WHERE | store.ts |
| `tasks` | `worktree` | `WHERE worktree = ?` (conflict detection) | store.ts |
| `tasks` | `branch` | `WHERE branch = ?` (branch conflict) | store.ts |
| `tasks` | `paused` | `WHERE paused = 1` (recovery sweeps) | store.ts |
| `agentTaskSessions` | **none** | `WHERE agentId = ? AND taskId = ?` | agent-store.ts |
| `mission_events` | `eventType` | `WHERE eventType = 'error'` | mission-store.ts |
| `mission_events` | `(missionId, eventType)` | compound WHERE | mission-store.ts |

### 2. JSON Parsing Hot Path

`rowToTask()` at `packages/core/src/store.ts:1709` parses **22 JSON columns per row**.
`listTasks()` calls this for every task on every board refresh/poll.
Board slim mode only drops `log` — still parses 21 other JSON columns.

### 3. DB Configuration (PRAGMA at db.ts:1620-1643)

Current:
```
PRAGMA synchronous = FULL     ← safest, slowest writes
PRAGMA cache_size = default   ← 2000 pages (8 MB)
PRAGMA wal_autocheckpoint = 1000
PRAGMA journal_size_limit = 4194304  (4 MB)
```

Note: `synchronous=FULL` was set deliberately after node:sqlite SIGSEGV corruption.
The comment at line 1631-1634 explains why — MUST NOT change without understanding risk.

### 4. Unbounded Growth

- `runAuditEvents`: 13K rows, 4 MB — no retention/rotation
- `activityLog`: 2K rows — no retention
- `agentLogEntries` written to per-task JSONL files (mitigated)

### 5. Schema Bloat in tasks table

60+ columns in `tasks` table. 10 JSON array columns stored as TEXT.
`log` alone is ~40 KB avg per row — always loaded even in slim mode.

## Key Files

| File | Lines | SQL Ops | Purpose |
|------|-------|---------|---------|
| `packages/core/src/db.ts` | 5087 | 34 prepare | Schema, migrations, PRAGMA |
| `packages/core/src/store.ts` | ~12000 | heavy | Task CRUD, listTasks hot path |
| `packages/core/src/mission-store.ts` | 4293 | 341 | Mission/feature queries |
| `packages/core/src/agent-store.ts` | 2946 | 176 | Agent/run CRUD |
| `packages/core/src/chat-store.ts` | 1107 | 112 | Chat sessions/messages |

## Existing Test Coverage

- `packages/cli/src/commands/__tests__/db.test.ts` — VACUUM command only
- `packages/core/src/__tests__/archive-db-init-performance.test.ts` — archive perf
- `packages/core/src/__tests__/central-db.test.ts` — multi-project DB
- **No tests for PRAGMA settings** — this is a gap
- Store tests use in-memory SQLite — won't surface WAL/checkpoint issues
