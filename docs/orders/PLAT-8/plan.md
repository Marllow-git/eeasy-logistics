# PLAT-8 · Outbox, relay and worker queues

- **Status:** planned; brief after PLAT-7 closes (both touch `apps/api`, `packages/db`, `packages/config`)
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-6 (merged, PR #41); Q-42 ruled 2026-11-01 (BullMQ on Valkey, ADR-0036 stands). PLAT-7 (audit writer) is a build dependency for replay audit rows, so this order starts after PLAT-7 merges.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack scratch databases and a scratch Valkey or Redis port. **Adversary:** yes (cross-tenant outbox reads and replay, payloads holding private data, the single-leader relay, dead-letter handling).
- **Issue:** #59. **Merge danger:** one-way door (migration 0007 with three tables; the worker gains the relay and the queues). **Legs:** three (A–C, D–F, G–H).
- **Paths:** `apps/api`, `packages/db`, `packages/config`, `compose.yaml`, `tools/native-stack.sh`, `.env.example`, `.github/workflows` (one env line), `.serena/memories`.

## 0. Goal

Every side effect leaves the business transaction as an outbox row and nothing else: a single-leader relay moves due rows into one BullMQ queue per kind on Valkey in per-aggregate order, workers execute them through kind handlers with per-kind retries and write the outcome back to the row, internal consumers deduplicate on receipts and park out-of-order events, dead rows are listed and replayed by platform staff under audit, and old rows are pruned, so that PLAT-9 onward add handlers and consumers into a frame where at-least-once delivery, ordering and tenancy are already enforced.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: side effects go through the outbox (no controller or service calls an external system directly); tenancy structural; config through `packages/config`.
- ADR-0024 "Decision" (outbox and queue), ADR-0027 "Decision" (envelope and versioning), ADR-0036 "Decision" (one queue per kind; `rate_limited` and `unauthorised` failures; `storage_lifecycle`; per-aggregate ordering by the relay with consumer parking; `jobId` = row id; sweeper; dead-letter paging by kind), ADR-0025, ADR-0031.
- `docs/architecture/domain-model.md` §2.7 "Outbox and consumer receipts" (K-10, K-11), §6.1 "Envelope", §6.2 "Delivery guarantees", §6.3 "Catalogue" (the `type` names and ordering scopes; no producer exists yet in wave 0 beyond the kernel's own events).
- `docs/architecture/data.md` §2.1 rows `core_outbox`, `core_consumer_receipts`, `core_consumer_dead_letters`, §3.1 (the `core_outbox_envelope_immutable` trigger from PLAT-5's 0001), §5.2 "core_outbox" (relay lock, batches, SKIP LOCKED, suspended accounts, stuck rows, supersede, pruning, dead letters), §5.3 "Consumer receipts and parked events".
- `docs/architecture/integrations.md` §4.1 "Kinds", §4.2 "Queues" (concurrency, limiter, attempts and backoff, dead-after per queue), §4.3 "Supersede and staleness", §4.4 "Relay", §4.5 "Dead letters and alerts".
- `docs/architecture/platform.md` §5 (workers drain on SIGTERM with a 30-second grace; single-leader relay), §7 (alert thresholds are PLAT-14's).
- `docs/contracts/openapi/platform.yaml` `platformListOutbox`, `platformGetOutboxRow`, `platformReplayOutboxRow`, `platformReplayDeadOutbox`, `platformListConsumers`; `components.yaml` `OutboxRow`, `BulkReplayRequest`, `ConsumerList`.
- PLAT-6 kernel (cross-tenant door with `@CrossTenant({ from: 'query', name: 'account_id' })` as PLAT-7 uses it, `ContractPipe`, idempotency on the replay writes, the worker role's job pattern with the Redis lock), PLAT-7 `AuditWriter` (`record` and `recordCommitted`) and partition-safe schema test.
- CHORE-1: Node 24, SWC build, `util.parseEnv`. Peer note: `bullmq` must be at least three days old at install (6.5.3 was published 2026-10-31); `@nestjs/bullmq` 12.0.0 declares Nest 12.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Tables | Migration `0007_core_outbox` (hand-written, `-- reviewed`): `core_outbox` exactly as data §2.1 (envelope columns with `id` = envelope id, `type`, `event_version`, `occurred_at`, `account_id` nullable for platform-only effects per §2.4, `aggregate_type`, `aggregate_id`, `sequence`, `causation_id`, `correlation_id`, `payload jsonb`, `kind` CHECK of the seven kinds; delivery state `status` CHECK pending, enqueued, done, dead, superseded, `attempts`, `next_attempt_at`, `last_error`, `supersede_key`, `enqueued_at`, `done_at`, `created_at`), the worker-scan indexes, `(account_id, status, created_at DESC)`, `(aggregate_id, sequence)`, the partial unique `(supersede_key) WHERE status = 'pending'`, trigger `BEFORE UPDATE` calling `core_outbox_envelope_immutable()` (K-10), policies `tenant_isolation` (all commands, on `account_id`) and `platform_access`; `core_consumer_receipts` (PK `(consumer, event_id)`, `account_id`, `processed_at`) and `core_consumer_dead_letters` (unique `(consumer, event_id)`, `attempts`, `last_error`, `replayed_at`) with policies; grants by the PLAT-5 defaults (SELECT, INSERT, UPDATE, DELETE for the runtime roles; delete is used only by the pruning job and the receipt purge, both platform-pool jobs); `pii:` comments on `payload` and `last_error`; schema test exemptions updated |
| 2.2 | Envelope and writer | `packages/db` gains nothing; the kernel module `modules/kernel/outbox/` exports `DomainEvent<T>` (the §6.1 envelope as a TypeScript type with `type` constrained to the catalogue names generated from a kernel list, extended by later orders), `OutboxWriter.enqueue(uow, { type, version, aggregate, payload, kind, supersedeKey?, causationId?, correlationId? })`: runs inside the caller's unit of work (tenant or platform), allocates `sequence` from the aggregate's `version` the caller passes (K-10; no separate sequence table), inserts the row `pending`, supersedes a pending row with the same `supersede_key` in the same statement set, and issues `NOTIFY elx_outbox` through `pg_notify` so the relay wakes on commit; `account_id` always from the context, never from the call; the row id is a UUIDv7 minted by the writer and returned as the envelope id |
| 2.3 | Relay | `--role worker` runs one relay per process competing for the Redis lock `elx:lock:outbox-relay` (`SET NX PX 10000`, renewed every 3 s, stop relaying when a renewal fails, integrations §4.4); the leader `LISTEN elx_outbox` on a dedicated platform-pool connection and polls every 1 s as fallback; each tick: `SELECT … FROM core_outbox o JOIN core_accounts a ON a.id = o.account_id OR o.account_id IS NULL WHERE o.status = 'pending' AND o.next_attempt_at <= now() AND (o.account_id IS NULL OR a.status <> 'suspended') ORDER BY o.id LIMIT 500 FOR UPDATE OF o SKIP LOCKED`, drops from the batch any row whose ordering scope (`aggregate_id` for `internal_event`; the §4.1 scope per kind, encoded by the kind handler's `orderingKey(row)`) has an earlier row not `done`, `dead` or `superseded`, adds BullMQ jobs to `outbox.<kind>` with `jobId` = row id and the kind's options, marks the rows `enqueued` with `enqueued_at`, in one transaction; a kind with no registered handler in this build is skipped and counted (metric `outbox_rows_without_handler`), never enqueued; the sweeper every minute returns rows `enqueued` for more than 5 minutes whose BullMQ job is absent to `pending` |
| 2.4 | Queues | One BullMQ `Queue` and `Worker` per kind, names `outbox.<kind>`, options exactly per integrations §4.2 as a typed constants table (`concurrency`, `limiter`, `attempts`, `backoff` with full jitter, dead-after) with the "to confirm" provider limits taken as written and flagged in §8.2; connection from `config.redis.url` (Valkey in production per Q-42; the client stays `ioredis`); prefix `elx`; `@nestjs/bullmq` 12.0.0 for module wiring; job data is `{ outboxId }` only, never the payload (the worker re-reads the row: Redis is not a source of truth) |
| 2.5 | Execution and outcome | A `KindHandler` port per kind: `execute(row) → { outcome: 'done' } | { outcome: 'retry', retryAfterS?, consumesAttempt: boolean } | { outcome: 'dead', error } | { outcome: 'superseded', reason }`; the worker writes the outcome back to the row in one transaction on the platform pool with `last_error` = provider status code plus a redacted message (the PLAT-7 redactor, never the payload); `rate_limited(retry_after_s)` reschedules without consuming an attempt; `unauthorised` parks the connection's rows (a `ConnectionParker` port that later orders implement; in this order it marks the row `retry` with `next_attempt_at` plus 1 h and logs); the handler registry in this order: `internal_event` (2.6) and a `storage_lifecycle` handler calling the `ObjectStorage.deleteMany` port with a stub adapter that refuses outside local and ci (the real adapter is OPS-1's), each executed batch audited through `AuditWriter.recordCommitted`; `webhook`, `message`, `push`, `channel_publish`, `carrier_call` have no handler yet (PLAT-9, INT orders) and are skipped by the relay per 2.3 |
| 2.6 | Internal consumers | `InternalEventDispatcher`: a registry `@OnDomainEvent(type)` on kernel-registered consumers (each consumer is a class with a stable `consumer` name); per event: open a platform-pool transaction with `set_config('elx.account_id', row.account_id)` when the row has an account, insert the receipt `(consumer, event_id)` first (a conflict means already processed: skip), run the consumer, commit; a `sequence` gap (receipt for `sequence - 1` of the same consumer and aggregate missing while `sequence > 1`) parks the job as a BullMQ delayed job (30 s, then doubling) up to 15 minutes, then writes `core_consumer_dead_letters` and marks the row `dead` for that consumer's share (the row itself is `done` only when every registered consumer has a receipt or a dead letter); one consumer ships in this order: `core.account.suspended` → a kernel consumer that logs (the real effects are DEL-5's), used by the tests |
| 2.7 | Platform operations | `platformListOutbox` (query `account_id` makes it a cross-tenant call through the door with `X-Support-Reason`; without it the rows are metadata only: no `payload`), `platformGetOutboxRow` (cross-tenant by the row's account; payload included), `platformReplayOutboxRow` (`@Idempotent()`; resets `attempts`, sets `pending` and `next_attempt_at = now()`; refuses rows not `dead`, and rows older than 35 days per data §5.2/§5.3 with `409 invalid_transition`; writes an audit row `platform.outbox_row.replayed` through `AuditWriter.record`), `platformReplayDeadOutbox` (bulk by kind and optional account, batches of 500, same rules, one audit row with counts), `platformListConsumers` (per consumer: parked and dead counts from the dead-letter table and BullMQ delayed counts); all through `ContractPipe`, presenters to `OutboxRow` and `ConsumerList`; permission enforcement is PLAT-10's |
| 2.8 | Pruning | Daily worker job (Redis lock `elx:lock:outbox-prune`): delete `done` and `superseded` rows older than 7 days and `dead` older than 30 days in batches of 5,000; receipts older than 35 days; dead letters older than 30 days; counts logged; never touches `pending` or `enqueued` |
| 2.9 | Shutdown | Workers close queues with a 30-second drain on SIGTERM (platform §5): `Worker.close()` awaits in-flight jobs; the relay releases its lock on shutdown; a job interrupted by the grace timeout stays `enqueued` and the sweeper returns it |
| 2.10 | Valkey | Compose profiles switch the Redis images to `valkey/valkey:8.1` (pinned by digest) and the native stack to the Homebrew `valkey` formula with a fallback to the existing `redis` when `valkey` is absent (the protocol is the same; the executor records which ran); `.env.example` and config keep `REDIS_URL` as the variable name (renaming is a later chore); PLAT-3's lanes keep the service names |
| 2.11 | Config | `OUTBOX_RELAY=on|off` (default on; a worker with it off runs queues only), `OUTBOX_RELAY_BATCH` (default 500), `OUTBOX_PRUNE=on|off`; added to `packages/config` with tests and `.env.example` |
| 2.12 | Tests | Integration on the PLAT-5 harness with a scratch Valkey/Redis database index: the writer inserts in the business transaction and the row is absent after a rollback; supersede keeps one pending row per key; the envelope trigger rejects an envelope change with `EL001`; the relay enqueues in order and holds a row whose predecessor is not done; two relays, one leader (the second never enqueues); a suspended account's rows stay pending; the sweeper returns an enqueued row without a job; a consumer receipt makes a redelivery a no-op; a sequence gap parks then dead-letters after the window (clock advanced in the test); outcomes written back (`done`, `retry` without attempt on `rate_limited`, `dead` after the budget); replay refuses a non-dead row and a row older than 35 days, audits a replay; prune deletes only what the rule says; a tenant token cannot reach any platform outbox route (401/403 by surface); `platformListOutbox` without `account_id` carries no payload |

## 3. Build list

### Leg 1 (storage, writer, relay)

| Item | Delivers | Verify |
|---|---|---|
| A | Migration 0007 per 2.1; schema test exemptions; Drizzle schema files for types | psql: tables, trigger, policies, indexes; migrate twice; schema test green; trigger test red then green |
| B | `DomainEvent`, `OutboxWriter` per 2.2 with the `NOTIFY` | integration: insert in transaction, rollback leaves nothing, supersede, `account_id` from context only (a passed value is ignored, test) |
| C | Relay per 2.3 with lock, LISTEN, ordering, suspended skip, sweeper; config per 2.11 | integration per 2.12 relay cases; two-relay leader test |

### Leg 2 (queues, execution, consumers)

| Item | Delivers | Verify |
|---|---|---|
| D | Queues and workers per 2.4 and 2.9 | unit: options table matches §4.2; integration: a job runs with `{ outboxId }` only; SIGTERM drain test with a slow handler |
| E | `KindHandler` port, outcome write-back, `storage_lifecycle` handler with the stub adapter and audit per 2.5 | integration: four outcomes; `rate_limited` keeps the attempt; redaction of `last_error`; storage batch audited |
| F | `InternalEventDispatcher`, receipts, parking and dead letters per 2.6 with the sample consumer | integration: receipt dedupe; gap parks then dead-letters; row `done` only when every consumer has a receipt |

### Leg 3 (platform operations, pruning, Valkey)

| Item | Delivers | Verify |
|---|---|---|
| G | The five platform operations per 2.7; pruning per 2.8; Valkey per 2.10 | HTTP tests with generated schemas; replay rules and audit; prune rule; CI lanes green on the Valkey image |
| H | README "Outbox" section; memories per `memory_upkeep`; plan §8; PR body | gate green; counts in §8.0 |

## 4. Commit plan

One commit per item `PLAT-8: <letter> <title>` with its §8.0 row; leg 1 opens the draft PR; legs 2 and 3 are fresh executors on the same branch.

## 5. Exit criteria

- A business change and its outbox row commit or roll back together; the envelope cannot be changed afterwards.
- Exactly one relay leader at a time; rows leave in per-aggregate order; a lost Redis job is recovered by the sweeper.
- Outcomes are on the row; Redis holds only job ids.
- Internal consumers are idempotent on receipts and park out-of-order events.
- Dead rows are listed and replayed under audit by platform staff; pruning keeps the windows of data §5.2.
- CI runs on Valkey; the adversary pass finds no critical or high.

## 6. Not in this order

Handlers for `webhook` (INT-10), `message` (PLAT-9), `push`, `channel_publish`, `carrier_call` (INT orders); the real object-storage adapter (OPS-1); alert routing (PLAT-14); the WMS `wms_channel_publications` feed of `channel_publish` (WMS orders); renaming `REDIS_URL`; BullMQ Pro.

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | The "to confirm" provider limits of integrations §4.2 (messaging 40/s, push 500/s, channel 1/s per store, carrier 5/s) | Taken as written as constants; each INT order confirms its provider's figure and adjusts the constant. |
| 2 | Valkey version and hosting | `valkey/valkey:8.1` in Compose; the production instance is OPS-1's choice. |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|

### 8.1 Skills, documents and versions consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review and adversary

Adversary: required (cross-tenant outbox reads and replay, payloads with private data, the relay, dead letters).
