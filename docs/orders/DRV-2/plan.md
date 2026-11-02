# DRV-2 · Offline outbox and sync screen

- **Status:** planned 2026-11-02; registers and briefs when DRV-1 (both legs) is on `main` and the driver executor slot is free (files disjoint from the API and web orders: `apps/driver`, the `driver` i18n namespace).
- **Date:** 2026-11-02
- **Wave:** 1 (roadmap §1.2). **Depends on:** DRV-1 (the session, the device id, the refresh lease table, the shell and the driver kit), DEL-5 (merged or merging: the shift doors the `shift` lane replays), the driver contract (`driver.yaml`: `driverPostOrderEvent`, `driverListRun`, `driverGetOrder`, `driverListOffers`, `driverListReasonCodes`, `driverListVehicles`; DEL-6 and DEL-7 implement the order doors later, so this order tests the outbox against contract-shaped fixture responses, §2.9). **Unblocks:** DRV-3 (location tracking and shift start, which reuse the outbox triggers), DRV-4 (the field loop writes every event through the outbox).
- **Lead:** architecture lead. **Executor:** `executor-driver` (Opus), own worktree, native stack (the API on a scratch port with DEL-4 and DEL-5's doors, the WhatsApp stub), the iOS simulator and the Android emulator through the device tools. **Adversary:** yes, Opus (SQLCipher key handling, what the outbox stores, PIN material never in SQLite, the support bundle's contents, another driver's items on the same phone; driver-app §3, §7.4, §11 and ADR-0034).
- **Issue:** opened at registration. **Merge danger:** two-way door (no API or contract change). Blast radius: `apps/driver` only; the app gains an encrypted database that every later driver order writes to; a native build is required (SQLCipher through the `expo-sqlite` config plugin).
- **Paths:** `apps/driver` (`src/sync/outbox/*` new: schema, migrations, the replayer, lanes, backoff, results; `src/sync/read-model/*`; `src/sync/clock.ts`; `src/platform/sqlite.ts` (SQLCipher open, the key in the secure store); `src/observability/log-ring.ts`, `support-bundle.ts`; `app/(app)/(tabs)/sync.tsx`; the run tab's badge; `test/` with `better-sqlite3`; `maestro/`), `packages/i18n` (`driver` namespace additions), `docs/architecture/driver-app.md` §3.2 (the chosen SQLCipher wiring) and §13 (answered questions), `docs/release-notes`, `.serena/memories`.
- **Design references:** `docs/references/design/DRV-1.md` (the shell and offline banners; a DRV-2 note is not needed: the sync screen's shape is driver-app §4.5 and the Buffer and Gumloop queue references of `docs/references/design/WEB-4.md`).

## 0. Goal

Every driver write that may happen without signal is recorded first in an encrypted SQLite outbox with a client-minted idempotency key, folded onto the local read model so the screen shows the driver's own action at once, and replayed in strict per-order order when the network returns, with the server's answer written back as truth and every rejection kept and shown on a sync screen the driver cannot miss; a support bundle and a local log ring let support see what happened without any silent upload, so that DRV-4's field loop can write a delivery in a basement and DRV-3's tracker can share the same triggers.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: secrets never readable (the SQLCipher key and per-item PINs live in the secure store only; the PIN never enters SQLite, logs or analytics); Arabic and English for every string; the server is the judge of every transition (D-5).
- ADR-0008 "Decision" in full (local first with a client key, replay in order, a sync screen, the API returns the original result on replay and `409` on a stale transition), ADR-0034 (the PIN of a pending cash event is kept in the secure store under the item id, injected at send time, deleted after the result), ADR-0039 (SQLCipher for the driver database; owner ruling 2026-11-01), ADR-0021.
- `docs/architecture/driver-app.md` §2 (layers), §3.1 to §3.6 in full (what goes through the outbox and what does not; the schema with its two indexes; the lanes `order:<id>`, `shift`, `device`; the replay rules: one in flight per lane, three in total, the shift barrier, single requests, the triggers, crash recovery, backoff with jitter to a 5-minute cap and `Retry-After`, attempts never capped; the results table and what the app does for each; the read model tables and the projection with "not synced" marks; the clock offset), §4.5 (the sync screen's three groups, the header, the badge), §7.4 (what sign-out and revocation clear and keep; items bound to `driver_id`; another driver's open items shown read-only), §11 (the log ring: 5,000 lines or 7 days, no PIN, token, phone or recipient data; the support bundle through the share sheet; the outbox metrics to PostHog), §12.1 (Jest on `better-sqlite3` with the same SQL and migrations; the deterministic replay with an injected clock, an injected UUIDv7 source and a fake transport playing recorded or contract-shaped responses; the interleaving property test), §12.4 (SQLite migrations forward-only and additive; an outbox payload shape is never changed in place).
- `docs/architecture/domain-model.md` §3.13 (the five driver arrows the local machine knows; `offered → assigned` is online only), D-15, D-16, D-23; `docs/contracts/README.md` §5 (driver transitions through one replayable door; replays return the original result).
- `docs/contracts/openapi/driver.yaml` `driverPostOrderEvent` (`DriverOrderEvent`: `event_id`, `to_status`, `client_ts`, `point`, `note`, `proofs`, `cod_collections`; the result `DriverOrderEventResult` with `order`, `event`, `attempt`; the codes `driver_not_assignee`, `cash_pin_invalid`, `invalid_transition`, `stale_driver_event`, `shift_not_active`, `proof_required`, `cod_amount_mismatch`, `cod_not_allowed`, `idempotency_key_reused`, `client_ts_out_of_range`, `cash_pin_locked`), `driverPauseShift`, `driverResumeShift`, `driverEndShift`, `driverUpdatePushToken`, `driverListRun` (`RunStop`), `driverGetOrder`, `driverListOffers`, `driverGetMe`, `driverListReasonCodes`, `driverListVehicles`; `docs/contracts/errors.md`.
- DRV-1 plan §2 (the session and the single-flight refresh with the SQLite lease row this order's database joins; the device id; the driver kit; the version headers), DEL-5 plan 2.4 (pause, resume and end replay by key; a new key on an ended shift is `409 invalid_transition`), DEL-4 plan §8.2 #37 to #43 (the session's refusals the replayer meets).
- Owner rule: Expo skills first (`expo:expo-overview`, then `expo:expo-router`, `expo:expo-native-ui`, `expo:expo-ui`, `expo:expo-data-fetching`, `expo:expo-dev-client`); SDK 58 docs, never `latest`; versions and dates in §8.1. Context7 for `expo-sqlite`'s SQLCipher plugin and `expo-background-task`.
- Memories `core`, `driver/core`.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | The database | `expo-sqlite` with `useSQLCipher: true` in the config plugin (`app.json`); one file per install; WAL; the 256-bit key generated with `expo-crypto` on first open and kept in `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, never backed up), applied with `PRAGMA key` right after open; the app refuses to start when `PRAGMA cipher_version` answers no row (a build without SQLCipher would store data in clear); migrations numbered, forward-only and additive in `src/sync/outbox/migrations/`, run at open; DRV-1's `refresh_lease` table moves into this database's migration 1 if DRV-1 kept it in a separate file (the executor records which) |
| 2.2 | Schema | `outbox_items` exactly as driver-app §3.2 (the columns, `outbox_lane_seq` unique, `outbox_open` partial index); `read_model` tables `run_stops` (order id, the `RunStop` JSON, `version`, `fetched_at`), `offers`, `me`, `reference` (reason codes, vehicles, fetched at); `log_lines` (the ring: id, level, time, component, message, ids JSON); `clock` (the offset and when measured); `proof_files` is DRV-4's and is not created here (the migration that adds it is DRV-4's number) |
| 2.3 | Recording a write | `Outbox.record({ lane, kind, eventType?, payload, clientTs })` in one SQLite transaction: the item with a UUIDv7 id (the `Idempotency-Key` and, for order events, `event_id`), `seq` from a per-lane counter, `status: pending`, the read-model overlay for the order (2.5); the PIN for a cash event is never in `payload`: the caller passes it separately and the outbox stores it in the secure store under the item id (ADR-0034), the transport adds it at send time and deletes it on ack or rejection review; this order ships the mechanism and DRV-4 the first cash event |
| 2.4 | Replay | `Replayer`: triggers on connectivity regained (`expo-network`), app foreground, a successful stream connect (DRV-4's hook; a no-op slot here), every 15 s while items are open and the app is in front, and from the background location task and an `expo-background-task` job (registered here, running the drain only); lanes in parallel with at most three requests in flight; per lane only the lowest open `seq`; a lane whose head is `rejected` halts (later items "waiting on" it); the shift barrier for `shift_pause`, `shift_resume`, `shift_end` (sent only after every order-lane item with an earlier `client_ts` is settled); `device` lane latest-wins for `push_token` (older pending ones superseded locally); single requests with the item's key and the headers of DRV-1's session; crash recovery (`sending → pending` at start); backoff per §3.3 (2 s doubling to 5 min with full jitter, `Retry-After` honoured, attempts counted never capped); timeouts 20 s; `401 token_expired` refreshes once through DRV-1's single-flight and resends the same key; `token_invalid` and `device_revoked` stop replay and run DRV-1's revocation path; `account_suspended` and `feature_not_enabled` pause replay behind the banner |
| 2.5 | Results and the read model | The results table of §3.4 implemented as data (`resultOf(response) → { status, action }`) with a unit test per row; on `200` the returned `order` (and `attempt`) replace the snapshot in `run_stops` by `version`, `replayed: true` and `superseded_dispatcher_change` marked; `rejected` items keep `last_error` with `http`, `code`, `message`, `details`, `request_id`; the projection: the server snapshot with the open items of that order folded through the local state machine (the five driver arrows of §3.13 as data in `src/domain/order-machine.ts`, shared with DRV-4), each unconfirmed fold carrying "not synced"; a snapshot that contradicts a pending item (cancelled before pickup) shows the item "at risk" and does not fold it; server truth wins; the "never drop" rule: a rejected item stays until the order is terminal or reassigned and the driver opened the item |
| 2.6 | Read-model refresh | `driverListRun` and `driverGetOrder` fill `run_stops` (on sign-in, foreground, every ack, a poll with `updated_from` every 15 s in front until DRV-4's stream); `driverListOffers` fills `offers` (poll); `driverGetMe` fills `me` (sign-in, foreground, every shift action ack); `driverListReasonCodes` and `driverListVehicles` fill `reference` (sign-in and once a day; used offline); every fetch records the clock offset from the `Date` header (2.7); the run tab (DRV-1's placeholder) renders the projected stops list minimally here (number, status, "not synced") so the fold is visible; DRV-4 builds the real run list |
| 2.7 | Clock | `client_ts` = the device clock plus the offset measured from the server `Date` header on every response, stored with the time measured; an offset above two minutes is logged and shown in settings (DRV-1's settings gain the line) |
| 2.8 | The sync screen, the badge, the bundle and the ring | `(app)/(tabs)/sync`: the three groups of §4.5 ("needs attention": rejected items with the code's localised message, the server's `current_status`, the request id, "call dispatcher" (`tel:` of the home site when known, else the text), "fix and resend" where the table allows (a new item with a new key; the rejected one stays), and "retry" for `shift_not_active` (re-queues the same item and key); "waiting": pending and sending items with attempts, next retry, age, and "sync now"; "done": the last 7 days with `replayed` and superseded marks), the header (connectivity, last contact, clock offset, outbox depth), the uninstall warning while items are open, the sign-out confirmation text (items stay on the phone); another driver's open items on this device shown read-only in a fourth group (§7.4); the run tab badge with the "needs attention" count, never hidden; the local log ring (`log_lines`, capped at 5,000 lines or 7 days, no PIN, token, phone or recipient data by construction: the logger takes ids only); the support bundle: one JSON through the share sheet with app and update version, device and OS, clock offset, open and rejected items with errors and request ids (payloads included, PINs never), the upload rows without files (DRV-4 fills them), the last 2,000 log lines; nothing uploads silently; PostHog outbox metrics every 15 minutes while items are open and on foreground (depth by status, oldest age, rejections by code, replay latency) with ids only |
| 2.9 | Tests | Jest on `better-sqlite3` with the same SQL and migrations: the schema and indexes; record and the overlay in one transaction (a crash leaves all or none: a failing step rolls back); per-lane order and lanes in parallel with the three-in-flight cap; the shift barrier; crash recovery; every row of the results table with an injected clock and a fake transport playing contract-shaped responses built from `packages/contracts` `./driver/schemas` (recorded responses arrive when DEL-7's contract tests exist; the fixture files live in `apps/driver/test/fixtures/` and are checked against the Zod schemas so a contract change breaks them); backoff and `Retry-After`; the interleaving property test (random offline periods, timeouts, lost responses and restarts end with the same server-visible effects and no item lost); the PIN never in SQLite (a grep of the database file's plaintext after a cash record through the mechanism); the log ring's cap and its refusal of forbidden keys; the bundle's shape. Maestro: record a shift pause offline (airplane mode through the device tools), see it waiting on the sync screen with the badge, go online, see it done; a rejected item (the stub API answering `409` for a seeded case) pinned under "needs attention" with "call dispatcher"; the support bundle exported; `ar` and `en` with screenshots reviewed |
| 2.10 | Release note | Arabic `docs/release-notes/2026-11-<dd>-driver-app-offline-sync.md` (the app records work without signal and shows what is waiting) |

### 2a. Lead's improvements over the roadmap row

- **The results table as data with a test per row** (2.5), so DRV-4 adds field cases without touching the replayer.
- **The PIN mechanism ships before the first cash event** (2.3), proven by a plaintext scan of the database, so ADR-0034's rule is tested in isolation.
- **Contract-shaped fixtures checked against the Zod schemas** (2.9) stand in for the recorded responses until DEL-7 exists, and break when the contract changes.
- **The minimal projected run list** (2.6) makes the fold visible and testable here instead of first appearing inside DRV-4's screens.
- **The startup refusal without SQLCipher** (2.1) is a test, not a comment.

## 3. Build list

### Leg 1 (the database, the outbox, the replayer)

| Item | Delivers | Verify |
|---|---|---|
| A | SQLCipher database, migrations, the schema, the clock, the log ring per 2.1, 2.2, 2.7 | Jest schema and ring tests; the startup refusal test |
| B | Record, the PIN mechanism, the replayer with lanes, barrier, backoff and results, the read model and projection per 2.3 to 2.6 | Jest replay, results and property tests |
| C | Plan §8 for the leg, memories, draft PR | full local gate; counts in §8.0 |

### Leg 2 (the sync screen, the bundle, the release note)

| Item | Delivers | Verify |
|---|---|---|
| D | The sync screen, the badge, the support bundle, the PostHog metrics, the settings offset line per 2.8 | Maestro flows in `ar` and `en` |
| E | driver-app.md §3.2 and §13 amendments; release note per 2.10; plan §8 complete; memories | gate passes |

## 4. Commit plan

One commit per item `DRV-2: <letter> <title>` with its §8.0 row, pushed after each; draft PR from the template with the exact headings; body lines `Release note: docs/release-notes/2026-11-<dd>-driver-app-offline-sync.md` and `Memories:`.

## 5. Exit criteria

- A write recorded offline appears on the screen at once with "not synced", replays in order when online with the same key, and the server's answer replaces the local fold.
- Every row of the results table behaves as §3.4 says; a rejected item is never dropped and is pinned on the sync screen with the badge.
- The shift barrier holds; two lanes replay in parallel within three requests in flight; a crash mid-send resends the same key.
- The database is encrypted with a key in the secure store; the PIN of a cash event is never in SQLite, logs, analytics or the bundle; a build without SQLCipher refuses to start.
- The support bundle exports through the share sheet with the listed contents; the Arabic screenshots are reviewed; the Arabic release note exists.

## 6. Not in this order

The proof upload queue and files (DRV-4 with INT-1); the field screens and the real run list (DRV-4); the location buffer and tracker (DRV-3); the SSE client (DRV-4); offers and acceptance (online, DRV-4); the server-side copy of rejected events (driver-app §13 #3, owner); a cap on attempts (none by design).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Rejected field events with cash (driver-app §13 #3): should the API keep a copy for dispatchers? | Not in this order; the sync screen and the bundle carry it; the API side is a DEL follow-up if the owner wants it |
| 2 | Retention of acknowledged items on the phone | 7 days in the "done" group, then deleted; rejected ones until resolved |
| 3 | The background drain job cadence | `expo-background-task` at the OS minimum (about 15 minutes), opportunistic only |

## 8. Executor notes (filled by the executor)

### 8.0 Counts

### 8.1 Deviations

### 8.2 Notes

### 8.3 Not done here

## 9. Lead review and adversary
