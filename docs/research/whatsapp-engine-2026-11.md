# Research: eeasynew's WhatsApp engine as eeasy-logistics's sender

Read on 2026-11-01. Question from the lead: can `services/whatsapp-engine` carry platform OTP and merchant-linked sends for eeasy-logistics, and where does it collide with our design.

Path shorthand (all under `/Users/sajjad/Documents/eeasynew`): **E** = `services/whatsapp-engine`, **D** = `docs/whatsapp-engine`, **B** = `backend`. "Stated" means a source says it; "Inferred" means my reading. Secret values were never read into this note; only variable names.

## Summary for the lead

1. The engine is Baileys 7.0.0-rc14 (WhatsApp Web multi-device, QR or pairing-code linked number), not the Meta Cloud API. No template approval exists; free-form text up to 65,536 chars is accepted (E/package.json:12; E/src/api/commands.ts:196-200).
2. Outbound media is PDF documents only (XLSX also for the assistant). Image, video, audio, location, buttons and lists are refused by name (E/src/api/commands.ts:72-81; E/README.md:49-51).
3. eeasynew already runs the owner's exact model in one engine: a platform OTP sender linked by an admin, plus merchant-linked numbers (B/app/Services/WhatsApp/Providers/EngineProvider.php:23-31).
4. The engine is single-product by construction: one hard-coded caller identity, one secret pair, one deploy-time callback base URL, eeasynew integer account/store ids as tenant keys, one assistant instance per engine (E/src/index.ts:96; E/src/config.ts:385; E/migrations/019_instances_inbound_mode.sql:10-12). Inferred: serving eeasy-logistics needs a second deployment, or code changes.
5. It already enforces pacing (3-8 s Gaussian gap, health slowdown, no count cap), idempotency, FIFO lanes, hold/expiry, durable signed callbacks (56 attempts), dead letters and a 7-day content purge. Our outbox would duplicate most of that.
6. Mismatches with our design: no templates, approval or `listTemplates`; no quiet hours, caps, budget; different opt-out words; OTP body kept up to 7 days vs our 1 h; signed-envelope callbacks, not Meta webhooks (section 6).
7. Production already runs it: PM2 on the eeasy.sa Plesk host, Node 24.21.0, loopback port 8787, same host as eeasynew's Laravel (E/ecosystem.config.cjs:20-37; B/docs/DEPLOYMENT.md:21; scripts/deploy-prod.sh:72).
8. Risks: unofficial protocol (ban of the number carrying OTPs), release-candidate Baileys plus a local patch, WhatsApp Web version drift. Meta ToS position is stated nowhere in the checkout.

## 1. What the engine is

- Stack: TypeScript, Node `>=22 <25`, `@whiskeysockets/baileys` `7.0.0-rc14` (exact pin), `bullmq 5.78.0`, `ioredis`, `pg`, `pino`, `prom-client`, `sharp`, `zod`, `libphonenumber-js` (E/package.json:8-23). Stated.
- Linking is by QR (`instance.qr`) or phone-number pairing code (`instance.pairing_code`, Baileys `requestPairingCode`) (E/src/api/commands.ts:36,51; E/src/session/socket.ts:349,832). Stated.
- Baileys auth state is stored encrypted in the engine's PostgreSQL (`auth_states`, AES-256-GCM) (E/migrations/002_auth_states.sql; E/test/t02-auth-state-ciphertext.test.ts). Stated.
- No Cloud API in the engine. The assistant doc says the Cloud API is a future transport: "Runs on our own Baileys engine today; designed to move to the Cloud API by swapping one transport binding" (B/docs/system-reference/27-whatsapp-assistant.md:7, 150). Stated.

Implications:
- **No template approval.** `message.send.text` takes a rendered `body`; the engine does no template resolution or substitution (E/src/api/commands.ts:193-200; D/INTERNAL-API-CONTRACT.md:496). `template_version` is audit/idempotency only. Stated.
- **Free text allowed**, including OTP text (`message.send.verification`, body max 4,096) (E/src/api/commands.ts:214-220). Stated.
- **Ban exposure is a first-class concern.** Instance status includes `banned`; HTTP 403 maps to `forbidden_account_likely_banned` (E/migrations/001_instances.sql:21-22; E/src/session/reconnect.ts:50,153,286). Pacing exists because "section 20.1 makes ban avoidance a product concern" (E/src/deliverability/pacing.ts:1-35). Stated.
- **Pacing:** gap 3,000-8,000 ms with Gaussian jitter between consecutive sends of one sender; an isolated send goes at once; health multiplier 1.6x/2.5x/4x when failures reach 15%/30%/50% of at least 20 attempts (E/src/deliverability/pacing.ts:42-43,79-92,109-111). Stated.
- **No count cap by design.** "There is no daily/monthly count cap"; a test asserts no cap symbol exists anywhere (E/src/deliverability/pacing.ts:12-18; E/test/wa-b4-pacing-pause.test.ts:114-134). Stated. Inferred: volume limits must live in the caller.
- **Meta terms of service position:** not stated in any file read (grep for terms of service, unofficial, ban across D/*.md and the assistant doc found only the Cloud API note). Unanswered.
- **Media:** outbound `message.send.document` only, via a media lease (an id, never a URL); Laravel streams the file over the signed channel, ceiling 10 MiB (`WA_ENGINE_MEDIA_MAX_BYTES`), mime `application/pdf` (plus XLSX), sha256/size re-verified, no permanent copy (D/INTERNAL-API-CONTRACT.md:500-553; E/src/config.ts:65). Inbound media is never stored; only the single assistant instance forwards `.xlsx/.csv` up to 160 KiB (E/README.md:37-52). Own-device profile picture comes from a hard-coded WhatsApp CDN allowlist, sent as a 96x96 JPEG inside `connection.event` (D/INTERNAL-API-CONTRACT.md:155-202). Stated.

## 2. Internal API

### 2.1 Transport and auth
- One command door `POST /internal/v1/commands`; callback door on Laravel `POST /internal/whatsapp/v1/callbacks`; media route `GET /internal/whatsapp/v1/media/{lease}` on Laravel. The engine also serves `GET /health` (unauthenticated liveness), `GET /internal/health` (readiness: postgres and redis probes, dead-letter counts) and `GET /internal/metrics` (E/src/api/server.ts:34-40; D/INTERNAL-API-CONTRACT.md:27-28,35-40; B/routes/internal.php:25-35). Stated.
- Headers both ways: `X-Eeasy-Service`, `X-Eeasy-Key-Id`, `X-Eeasy-Timestamp` (RFC 3339, +-60 s), `X-Eeasy-Nonce` (32 hex), `X-Eeasy-Body-Sha256`, `X-Eeasy-Signature: v1=<hmac-sha256 hex>` over an 8-line canonical string (method, path, service, key id, timestamp, nonce, claimed body hash) (D/INTERNAL-API-CONTRACT.md:49-75). Stated.
- Verification order is fixed: size, service identity, key id, timestamp, header shape, constant-time HMAC, then body read and hash, then nonce reservation, then schema and tenancy binding. A bad signature costs zero body bytes (D/INTERNAL-API-CONTRACT.md:79-91; E/test/t08-internal-api-auth.test.ts:524,569). Stated.
- Replay cache: PostgreSQL `internal_request_nonces`, PK `(service_identity, nonce)`, nonce-shape CHECK, 24 h retention (E/migrations/008_internal_request_nonces.sql:14-22). Redis is never the sole source of accepted sends or auth. Stated.
- Two independent secrets (command, callback), each with key ids and optional `*_PREVIOUS_*` rotation pair on the Laravel side (B/config/whatsapp.php:47-55). Max body 256 KiB checked before reading (D/INTERNAL-API-CONTRACT.md:124-137). A non-loopback peer without https fails startup (D/INTERNAL-API-CONTRACT.md:151). Stated.
- Caller identity is a compiled constant `EXPECTED_PEER = 'eeasy-laravel-control-plane'` (E/src/index.ts:96); one `WA_ENGINE_COMMAND_SECRET`, not one per caller (E/src/config.ts:338). Stated; single-caller consequence inferred.

### 2.2 Commands (complete implemented set, E/src/api/commands.ts:34-53)
| Command | Purpose | Notable payload (schemas `.strict()`, unknown fields refused) |
|---|---|---|
| `instance.create` | register a sender, no socket | `scope account_default\|store_specific`, `label`, `request_uuid` (idempotent per account), `inbound_mode none\|assistant` (:147-155) |
| `instance.link` | start pairing, desired_state running | `actor_user_id`, `reason` (:157-162) |
| `instance.qr` | current QR, or `{qr:null,status:connected}` | empty (:163) |
| `instance.pairing_code` | pairing code for a typed phone | `actor_user_id`, `phone_number` E.164 (:275-281) |
| `instance.status`, `instance.events` | state, last disconnect, queue depth; last 50 connection events | empty (:164-167) |
| `instance.logout` / `instance.relink` | stop durably / back to pairing | `wipe_auth_state` / `reason` (:168-180) |
| `instance.pause\|resume`, `account.pause\|resume` | operator pause; holds, never expires or deletes | `actor_admin_id`, `reason`, `scope` (:183-188) |
| `message.send.text` | free text | `to_number` E.164, `body`, `locale ar\|en`, `lane_key`, `suppression_check`, optional `availability_policy hold\|reject_if_unavailable`, `business_expires_at`, `predecessor_eeasy_message_id`, `recipient_check` (:193-213) |
| `message.send.verification` | OTP, priority 1, `suppression_check` literal `false` | (:214-235) |
| `message.send.document` | PDF via media lease, optional caption | (:236-274) |
| `message.status` | state of one message by `eeasy_message_id` | (:146; D/INTERNAL-API-CONTRACT.md:599-612) |
| `contact.exists` | is this number on WhatsApp | `to_number` (:282-286) |

Envelope on every command: `command`, `eeasy_account_id` (integer), `eeasy_store_id`, `sender_instance_id`, `eeasy_message_id` (uuid), `message_type`, `priority_class 1-4`, `expires_at`, `idempotency_key` (<=255), `payload` (D/INTERNAL-API-CONTRACT.md:208-221). Success: `{ok:true, command, eeasy_message_id, sender_instance_id, result, engine_build_sha, server_time}`; failure: `{ok:false, error:{code,message,retryable}}` with HTTP 401/413/422 (:254-281). Stated.

No separate inbound-mode command: `inbound_mode none|assistant` is set at create (E/migrations/019_instances_inbound_mode.sql:6-12). Profile picture has no command; it arrives in `connection.event`.

### 2.3 Message types, priority, hold
Closed `message_type` enum: `verification` (priority 1, hold 600 s), `shipment_issued`, `return_label_pdf`, `assistant_reply`, `assistant_label_pdf` (2), `digest_*` (3), `manual_custom`, `connection_test` (4) (E/src/api/commands.ts:90-102; D/INTERNAL-API-CONTRACT.md:779-846). The engine re-derives `expires_at` and rejects a mismatch (`EXPIRY_MISMATCH`). A verification that cannot leave in 10 minutes becomes `expired`, never late. Inside one `(instance, lane_key)` lane strict acceptance order holds. Stated. Inferred: these are eeasynew business names; our own types need a code change.

### 2.4 Idempotency
- `idempotency_markers` PK `(instance_id, idem_key)`; a duplicate returns the original `eeasy_message_id`, no second wire send; markers are content-free, kept 90 days (E/migrations/004_outbox_idempotency_dead_letters.sql:28-43; D/INTERNAL-API-CONTRACT.md:892-901).
- Event identity: unique `event_key` stops a template edit from resending the same business event (E/migrations/004:39-41; D/INTERNAL-API-CONTRACT.md:903-912).
- Nonce is transport anti-replay; the idempotency key is business exactly-once and is reused with a fresh nonce on retry (D/INTERNAL-API-CONTRACT.md:116).
- Migration 013 `send_outbox.dispatch_seq` keeps BullMQ job ids deterministic across a Redis flush (E/migrations/013_send_outbox_dispatch_seq.sql:31). Stated.

### 2.5 Callbacks (engine to Laravel)
- Kinds: `message.status`, `suppression.changed`, `connection.event`, `inbound.message` (E/src/config.ts:144-149; E/migrations/019:14-19). `WA_ENGINE_CALLBACK_KINDS` can narrow the set; a kind left out is held silently (E/src/config.ts:100,128-143).
- Message states: `accepted, queued, held_connection, paused_by_admin, sending, sent, delivered, read, failed, expired, suppressed`; receipts are monotonic; `sent` means a wire id was returned (D/INTERNAL-API-CONTRACT.md:685-700).
- Durable `callback_outbox`: payload sealed per row, no destination column, `callback_id` minted once for receiver dedupe, row deleted on delivery or exhaustion (E/migrations/011_callback_outbox.sql:29-48).
- Signing as for commands, identity `eeasy-whatsapp-engine`, separate secret and nonce table (D/INTERNAL-API-CONTRACT.md:630). Retries: 56 attempts, 5 s doubling to a 30-minute cap, about 24 h, then a content-free `callback` dead letter (E/src/callbacks/dispatcher.ts:57-62). Laravel must answer 200 `{"ok":true}`; it deliberately answers non-200 for an unimplemented kind (B/app/Http/Controllers/Api/V1/WhatsApp/InternalCallbackController.php:29-32,55,84). Stated.
- Destination is `WA_ENGINE_LARAVEL_BASE` plus the compiled constant `CALLBACK_PATH`; no per-message or per-tenant URL (E/src/callbacks/poster.ts:11-25,40). Stated.

### 2.6 Multiple numbers, purge, usage, leases, health
- **Several numbers per scope (016):** drops the one-per-account and one-per-store unique indexes; authorization remains instance id plus immutable account/store binding (E/migrations/016_multiple_numbers_per_scope.sql:1-8). A trigger forbids rebinding an instance to another account or store (E/migrations/001:57-71). Stated.
- **Content purge (012 + purge.ts):** `to_number`, body and media_meta nulled 7 days after `terminal_at`; retry protos 30 days; idempotency markers 90; health counters 90; nonces 24 h; message skeleton row 90; resolved dead letters 7 days after resolution; callback backstop 30 (E/src/retention/purge.ts:53-85; E/migrations/012:16-19). Stated.
- **Usage aggregates (014):** per `(instance, day, message_type)` counts only (no number, body or message id), kept 396 days, explicitly not a ceiling (E/migrations/014_usage_aggregates.sql:39-55; E/src/retention/purge.ts:76-85). Stated.
- **Pause:** moves the queue to `paused_by_admin`, deletes and expires nothing early; resume sends in original lane order; reconnect does not undo a pause; `account.pause` is account-wide (E/test/wa-b4-pacing-pause.test.ts:192-296,350). Stated.
- **Leader leases (009):** PostgreSQL `leader_leases(lease_name, holder_id, expires_at, fence_token)`; purge and outbox recovery run only under a lease so two replicas cannot purge at once (E/migrations/009_leader_leases.sql:11-17; E/src/leader.ts:1-32; E/test/leader-lease.test.ts:36-98). Stated.
- **Health signals (007):** daily sent/delivered/undelivered/failed/expired counters per instance, pacing inputs only (E/migrations/007_health_signals.sql:14-23). `undelivered` is never incremented (E/src/deliverability/pacing.ts:70-77). Stated.
- **Recipient pre-check:** optional `recipient_check` and `contact.exists` ask WhatsApp whether the number is registered (E/src/api/commands.ts:210-213,282-286; E/test/wa-number-check.test.ts). Stated.

## 3. Data and isolation

- Own PostgreSQL (`WA_ENGINE_DATABASE_URL`) and optional Redis (`WA_ENGINE_REDIS_URL`; unset means an in-process `MemorySendQueue`) (E/src/config.ts:55,371-373,393; E/src/index.ts:85,174). Package description: "reaches no other Eeasy datasource"; test `t00-no-mariadb` pins it (E/package.json:5; E/test/t00-no-mariadb.test.ts). Stated.
- Per message: `eeasy_account_id`, `eeasy_store_id`, `eeasy_message_id`, `message_type`, priority, `lane_key_hash` (keyed hash), `to_number_ciphertext`, `body_ciphertext`, `media_meta`, status, `accept_seq`, `wire_message_id`, ack, attempt, error class, timestamps, `content_purged_at`, pending receipt, predecessor id (E/migrations/003_messages.sql:16-47; 015; 017). Outbound only; no inbound column exists by design (003:7-12). Content is sealed with `WA_ENGINE_ENCRYPTION_KEY`, purged at 7 days. Stated.
- **Tenant identity:** `eeasy_account_id BIGINT` plus optional `eeasy_store_id` plus an engine-minted instance UUID. The account is a request field checked against the instance's stored owner, not read from a token (E/migrations/001:15-16; D/INTERNAL-API-CONTRACT.md:223-232). Laravel derives it from the actor before calling (D/INTERNAL-API-CONTRACT.md:234-248). Stated.
- **Several products on one deployment:** nothing models a product or namespace. Evidence: single compiled caller identity (E/src/index.ts:96); one command secret and one callback secret (E/src/config.ts:338-339); one `WA_ENGINE_LARAVEL_BASE` for callbacks and media (E/src/config.ts:385); `request_uuid` unique per `(eeasy_account_id, request_uuid)` (E/migrations/010:27-29); `account.pause` addresses an integer account id (E/src/api/commands.ts:104); one assistant instance for the whole engine (E/migrations/019:10-12). Inferred: our integer account ids would share eeasynew's keyspace (collisions), and callbacks for our messages would post to eeasynew's Laravel. A separate engine deployment (own DB, secrets, callback base) avoids this with no code change; sharing needs a product dimension in schema, auth and callback target.

## 4. Deployment and operations

- **Dockerfile:** `node:22-bookworm-slim`, two stages, `COPY patches` before `npm ci`, runtime `npm ci --omit=dev` then greps two patch markers so a silent patch no-op fails the build; runs as `node`; no `EXPOSE` (E/Dockerfile:1-33).
- **Bind:** loopback only, default `127.0.0.1:8790`; non-loopback bind fails config (E/src/config.ts:323-335). Laravel's default base is `http://127.0.0.1:8787` and production health checks use 8787, so production sets the port explicitly (B/config/whatsapp.php:33; scripts/deploy-prod.sh:72,283). Local `.env` has `WA_ENGINE_BIND_PORT` (value not recorded).
- **PM2:** app `eeasy-whatsapp-engine`, fork mode, 1 instance, `kill_timeout 45000` (engine shutdown budget 40 s), `max_memory_restart 768M`, started through a wrapper script that sources a root-owned env file; reload with `pm2 startOrReload ecosystem.config.cjs --update-env` (E/ecosystem.config.cjs:20-37; E/README.md:9-17; E/src/index.ts:103). A short kill timeout once made a linked number ask for a new QR. Stated.
- **Production host:** Plesk vhost `eeasy.sa`, site user `eeasyapp`, Node 24.21.0, PM2; same host as the Laravel API (B/docs/DEPLOYMENT.md:17-21; scripts/deploy-prod.sh:66). Stated.
- **Env variable names** (E/src/config.ts:74-108): `WA_ENGINE_DATABASE_URL`, `_ENCRYPTION_KEY`, `_ENCRYPTION_KEY_ID`, `_LANE_HASH_KEY`, `_COMMAND_SECRET`, `_CALLBACK_SECRET`, `_COMMAND_KEY_ID`, `_CALLBACK_KEY_ID`, `_LARAVEL_BASE`, `_BIND_HOST`, `_BIND_PORT`, `_MAX_BODY_BYTES`, `_MEDIA_MAX_BYTES`, `_LOG_LEVEL`, `_DEFAULT_COUNTRY` (default `SA`), `_BUILD_SHA`, `_REDIS_URL`, `_WA_WEB_VERSION`, `_CALLBACK_KINDS`, `_RUN_MIGRATIONS`, `_ALLOW_DB_MUTATION`, plus test-only `_TEST_PG_URL`, `_TEST_REQUIRE_PG`, `_TEST_REDIS_URL`. Unknown `WA_ENGINE_*` keys fail startup (E/src/config.ts:300). Laravel side: `WA_ENGINE_BASE_URL`, same secret and key-id names plus `*_PREVIOUS_*`, `WA_PLATFORM_SENDER_USER_ID` (B/config/whatsapp.php:33-55,94).
- **Metrics:** prom-client text at `/internal/metrics`, about 40 `wa_engine_*` series (sends accepted/duplicate/wire/terminal/retries, queue depth, callback attempts/dead/queue depth, dead letters, sessions connected, QR and pairing codes, purged rows, RSS, auth failures, send addressing pn/lid) (E/src/observability/metrics.ts:37-455). Deploy script reads `callbacks_held_by_config_total` (scripts/deploy-prod.sh:340-344).
- **Logs:** pino with mandatory redaction of numbers, bodies, QR, secrets; a console bridge reroutes libsignal `console.*` (which prints ratchet keys) into scrubbed pino debug lines; after every Baileys bump `grep -cE 'Closing session: SessionEntry|privKey'` on the logs must stay 0 (E/src/observability/logger.ts:1-18; D/BAILEYS-7-UPGRADE.md "Log hygiene").
- **patches/:** patch-package on `@whiskeysockets/baileys@7.0.0-rc14`, two hunks. (1) `messages-recv.js` restores the `class="message"` ack on the successful-decrypt path (removed upstream in 6.7.20, still absent in rc14); without it WhatsApp closes the stream about 50 minutes after an unacked message with a 500/badSession (upstream issue #1910 cited in the patch). (2) `make-mutex.js`: marker only; the leak fix now ships upstream, the marker lets the deploy gate prove patch-package ran (E/patches/@whiskeysockets+baileys+7.0.0-rc14.patch:1-36).
- **Node:** `engines.node ">=22 <25"`; Docker builds on 22, production runs 24; 25 stays out until `sharp` and libsignal are verified (E/package.json:8; E/test/node-engines.test.ts:1-12).
- **Why Baileys 7:** iPhones are LID-only and 6.7.x opened PN-keyed sessions, causing "Waiting for this message" (D/BAILEYS-7-UPGRADE.md "Why"). Outbound-only instances needed no re-pair; only the inbound assistant did. Watch `wa_engine_send_addressing_total{addressing="pn"}`. Stated.
- **WhatsApp Web version:** the library bundles `[2,3000,1043857760]`; `WA_ENGINE_WA_WEB_VERSION=major.minor.build` overrides it without a release, never fetched from the network, so a 405 refusal loop is fixable by config (E/test/wa-review-wa-web-version.test.ts:1-9; E/src/session/socket.ts:603-608,651). Stated.
- Socket options: `countryCode: 'SA'`, `shouldIgnoreJid` drops groups/status/broadcast/newsletter (E/src/session/socket.ts:664-665). Stated.

## 5. How eeasynew's Laravel code uses it

- **Client:** `App\Services\WhatsApp\InternalEngineClient` (B/app/Services/WhatsApp/InternalEngineClient.php:37). `send(array $message)` signs and posts to `config('whatsapp.engine.base_url')`, 10 s timeout, with closed-vocabulary and no-absolute-URL checks first; a connection failure becomes `EngineRequestException ENGINE_UNAVAILABLE` (502). `verifyCallbackRequest()` checks callbacks with its own nonce table (`WhatsAppRequestNonce`). I saw no retry or breaker in the client (lines 68-151, 218-260 skimmed). Config in B/config/whatsapp.php:27-69.
- **Platform OTP:** `PlatformWhatsAppService` renders text from template-center rows (`phone_otp_whatsapp`, `registration_otp_whatsapp`, `salla_store_move_otp_whatsapp`; staff login code is code-owned) and uses `WhatsAppProviderFactory::forPlatform()`, which always returns `EngineProvider` (B/app/Services/WhatsApp/PlatformWhatsAppService.php:29-65; B/app/Services/WhatsApp/WhatsAppProviderFactory.php:14-24). Uses: phone login, registration code, staff 2FA, store-move code, password-reset link, phone-change notice, delivery PIN. On failure it logs and throws `RuntimeException('OTP delivery failed.')` (same file:54-65).
- **Platform sender:** `EngineProvider::sendText` finds the single `owner_type = platform` `WhatsAppConnection`, refuses unless it is `connected` and un-paused, writes a `WhatsAppMessage` log row (body not stored), and sends `message.send.verification`: priority 1, 600 s hold, `suppression_check:false`, locale hard-coded `ar`, fresh UUID idempotency key per send (B/app/Services/WhatsApp/Providers/EngineProvider.php:85-170). The platform sender hangs off the first super-admin, overridable by `WA_PLATFORM_SENDER_USER_ID` (B/config/whatsapp.php:85-94).
- **Admin links the platform number:** `EngineProvider::createSession` calls `ConnectionProvisioner::create` (`instance.create`, DB row, `instance.link`, in one transaction); `connectSession` sends `instance.link` and polls for the code up to 5 times at 1 s (B/app/Services/WhatsApp/Connections/ConnectionProvisioner.php:12-60; EngineProvider.php:40-50,190-215). Admin UI: `dashboard/apps/web/app/(admin)/admin/settings/general/page.tsx` via `Admin/WhatsAppProviderSettingsController`.
- **Merchant links his own number:** dashboard `app/(dashboard)/whatsapp/link-dialog.tsx` and `pairing-code-panel.tsx` call `POST /connections`, `GET /connections/{id}/qr`, `POST /connections/{id}/pairing-code` (feature-flagged by a setting), `GET .../status`, `.../events`, `.../avatar`, `POST .../relink`, `.../logout`, `DELETE`, `.../test-send` (B/routes/api/v1/api.php:1160-1205). Management routes need permission `whatsapp.connections.manage`. `ConnectionsController` resolves the account from the actor, answers 404 for a foreign instance before any engine command, and sends QR and pairing code under `Cache-Control: no-store`, never logged or stored (B/app/Http/Controllers/Api/V1/WhatsApp/ConnectionsController.php:29-48; B/app/Services/WhatsApp/Connections/PairingCode.php:11-20). Admin pause/resume of a connection or account: B/routes/api/v1/admin.php:859-870.
- **Merchant sends:** shipment-issued and return-label notifiers, daily/weekly/monthly digests, send-now, connection test, assistant replies (B/app/Services/WhatsApp/Shipment/*, Summaries/*, Connections/ConnectionTestSendService.php, Assistant/*); routing via `Routing/*`. Not read in detail.
- **Callbacks received:** `InternalCallbackController` verifies the envelope, dedupes by `callback_id`, bounds `occurred_at` to 300 s in the future, then hands to `MessageStatusCallbackHandler`, `ConnectionEventCallbackHandler`, `InboundMessageCallbackHandler` and the suppression handler (InternalCallbackController.php:55-121; B/config/whatsapp.php:96-119).
- **Failure surfacing:** connection status is mirrored from `connection.event`; `DisconnectAlertService` alerts at once on corroborated `needs_relink` and `banned` (B/app/Services/WhatsApp/Alerts/DisconnectAlertService.php:38); the assistant watchdog notifies via the platform OTP sender and email (B/routes/console.php:667-669); a refused or failed message sets `failed`, `error_class`, `error_code`, `resendable` on the log row (EngineProvider.php:152-162); `whatsapp:recover-intents` asks the engine `message.status` for intents stuck `accepted` (B/routes/console.php:618; D/INTERNAL-API-CONTRACT.md:612).

## 6. Fit with eeasy-logistics's documented design

Compared with docs/architecture/integrations.md §2.4 (lines 70-86) and §5 (259-296), ADR-0037, data.md §10. Concrete mismatches:

| Our design | Engine reality | Effect |
|---|---|---|
| `sendTemplate({template_key, locale, params})` | Only rendered free text (`body`); no template concept (E/src/api/commands.ts:193-200) | Our kernel renders AR/EN text from its own catalog and sends it. ADR-0037 "templates only" has no engine counterpart; it becomes our own catalog discipline, as eeasynew's template center is. |
| `listTemplates()` | No such command | Port method has no engine mapping; would return the local catalog or be dropped. |
| Approval (§5.2): Meta-verified business, own number, display name, quality rating | None; a number linked as a companion device | No approval wait and no business verification or quality rating; also no template-category rules (utility vs authentication). |
| Credentials "issued for this product only" | Deploy-time HMAC pair per engine, single caller identity, no per-tenant secret | Per-product isolation means a separate deployment (section 3). |
| Per-account linked numbers | Supported: instances per `eeasy_account_id`/store, several per scope (016) | Matches the owner's model; we store `sender_instance_id` per account and pass our integer account id. |
| Status callbacks (§3) | Signed callbacks, durable retry (56 attempts, ~24 h), dedupe by `callback_id`, Laravel must answer 200 | Our receiver would implement the engine envelope (service id, key id, timestamp, nonce table, body hash, HMAC v1), not Meta's webhook signature. Polling exists too: `message.status` command. |
| Idempotency by outbox row id; check reference before resend | `(instance, idempotency_key)` unique; duplicate returns original id; `message.status` lookup | Matches; the lookup marked "to confirm per provider" exists here. |
| Breaker per provider, 5 s timeout | Laravel client 10 s, no breaker seen; engine holds messages while a sender is disconnected | We keep our breaker and staleness check (§4.3). |
| Stub `whatsapp-stub` | No stub server in the engine | Our stub stays. |
| Quiet hours, per-order and per-phone caps (§5.4) | None; engine refuses count caps by design (E/test/wa-b4-pacing-pause.test.ts:114-134) | Stay in our kernel. |
| Opt-out words `STOP`, `إيقاف`, `الغاء`; `START`, `اشتراك`; keyed `(account_id, phone)` (§5.5) | Engine recognises exactly `stop`, `إيقاف`, `start`, `تشغيل`; suppression keyed `(sender_instance_id, number)`, reported by `suppression.changed`, enforced at send when `suppression_check:true`; OTP bypasses (E/src/inbound/stop-start.ts:38-39; E/src/api/commands.ts:214-235) | Keyword sets differ (`الغاء`, `اشتراك` not recognised); scope differs; no quick-reply button opt-out. |
| Budget `messages_per_month` (§5.6) | Engine counts per instance/day/type but cannot enforce | Budget stays ours; counts can feed it. |
| OTP encrypted on outbox row, deleted after 1 h (data §10) | Engine seals OTP text in `messages.body_ciphertext` until the 7-day purge (R1 counts from `terminal_at`) | Two copies; the engine's lives up to 7 days (inferred from the purge table). Either shorten engine retention for verification (code change) or amend our rule. |
| OTP never delayed, no fallback (§5.3-5.4) | Priority 1, 10 min hold, expires rather than sends late; pause holds it | Compatible. If the single admin sender disconnects, all OTPs expire; "No fallback to another sender" (D/INTERNAL-API-CONTRACT.md:232). |
| Account from the token | Account id is a request field checked against the instance owner | Compatible if our adapter derives it from the token before calling. |
| Outbox kind `message` | Engine adds `send_outbox`, BullMQ, `callback_outbox` | Duplicated at-least-once machinery: dedupe, retry/backoff, FIFO lanes, expiry, dead letters already in the engine. Our row still owns the business reference, staleness check and breaker. |

Already enforced by the engine and so duplicated if we add the same in our adapter: pacing (3-8 s per sender, health slowdown), per-sender FIFO and recipient-lane ordering, hold and exact expiry per type, idempotency markers, terminal-wire guard before retry, bounded retry, dead letters, receipt monotonicity, number-on-WhatsApp pre-check, STOP/START capture.

## 7. Risks and open questions for the owner

- **Ban exposure on the OTP number:** status `banned` exists; pacing reduces but does not remove the risk. All OTPs depend on one linked phone; eeasynew schedules a weekly reminder to open WhatsApp on the phone for the assistant (B/routes/console.php:677-679), a sign the linked-device model needs the primary phone to check in (inferred).
- **Release candidate:** `7.0.0-rc14` exact pin, plus a local vendor patch for an ack upstream still lacks (issue #1910 per the patch comment) (E/patches/...:12-18; D/BAILEYS-7-UPGRADE.md).
- **Protocol drift:** a stale Web version has produced a 405 loop; config override mitigates (E/test/wa-review-wa-web-version.test.ts:3-8).
- **Operator burden:** PM2 with 45 s kill timeout, wrapper env file, console-scrub check after each bump, Node 22 to 24 only.
- **Open for the owner:** who operates the engine and where; network path from our API; second-product isolation; secret issuance (see Unanswered).

## Unanswered

1. Meta/WhatsApp terms-of-service position for unofficial multi-device automation and for sending OTPs to non-contacts: no file in the checkout states it.
2. Who operates the engine for eeasy-logistics and where: same Plesk host as eeasynew (the only documented deployment), or separate. Not stated for a second product.
3. Network path from our API to the engine: it binds loopback only (E/src/config.ts:323-331) and the client requires https off-loopback (D/INTERNAL-API-CONTRACT.md:151). A cross-host path needs a proxy or mTLS design not in the checkout; whether the bind check can be relaxed by config is not confirmed.
4. Whether a second product shares eeasynew's engine deployment. No product dimension exists (section 3); the owner must choose a second deployment or an engine code change. No procedure exists for issuing us a service identity, secret pair and callback base.
5. Whether the platform OTP number and merchant numbers should be separate instances (supported) and what ban-blast-radius policy applies.
6. Whether verification bodies can be purged earlier than 7 days: R1 is global (E/src/retention/purge.ts:53-56); no per-type retention exists.
7. Behaviour for recipients who never contacted the number (no 24-hour window logic in the engine; cold-recipient delivery rate unknown).
8. Measured production delivery rates, ban history, throughput for the existing senders: metrics exist but no numbers were read.
9. `InternalEngineClient` retry and breaker detail beyond lines skimmed, and merchant routing rules (`Routing/*`), were not read in depth.
10. Whether eeasynew's Laravel has quiet hours or per-phone caps of its own (I did not search B for them).
