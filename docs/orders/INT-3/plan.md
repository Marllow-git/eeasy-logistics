# INT-3 · Recipient messages, wave 1

- **Status:** planned 2026-11-02; registers and briefs when DEL-2 (PR #139) is on `main` (the orders it reads) and an executor slot is free (files disjoint from DRV-1 and DEL-5: `modules/kernel/messaging`, `modules/delivery/messaging` new, `packages/i18n` `messages`; the `packages/contracts` seam carries two additions, checked against the in-flight orders at the brief).
- **Date:** 2026-11-02
- **Wave:** 1 (roadmap §1.2). **Depends on:** PLAT-9 (merged: `MessageSender`, the `message` outbox kind, caps, quiet hours, the opt-out list, `MessagingUsage`), DEL-2 (orders, `OrderReader`), PLAT-13 (merged: the provisioning door's limits), INT-4 (merged: nothing shared; push is a different kind). **Unblocks:** the wave 1 exit criterion "recipient messages at assignment, out for delivery, attempt and delivery"; DEL-6, DEL-7 and DEL-8 produce the events and the tracking link this order consumes.
- **Lead:** architecture lead. **Executor:** `executor-api` (Opus), own worktree, native stack scratch databases, Redis (the caps), the WhatsApp stub. **Adversary:** yes, Opus (recipient phones and names in message rows and logs, caps and budget bypass, opt-out enforcement, the engine's template parameters; data §10).
- **Issue:** opened at registration. **Merge danger:** two-way door (no migration; two contract additions: `AccountLimits.messages_per_month`, `AccountSettings.recipient_messages`). Blast radius: the worker's message handler gains a read port; four templates await the provider's approval before anything reaches a phone (integrations §5.2).
- **Paths:** `apps/api` (`modules/delivery/messaging/` new: the four event consumers and the order-state read port implementation; `modules/kernel/messaging/templates.ts` four registry rows; `modules/kernel/messaging/` the tracking-link port and the recipient-template toggle read; `worker/system/message-handler.ts` the staleness read through the port and the toggle check; `modules/kernel/provisioning/account-input.ts` the new limit key; `modules/kernel/accounts/` the settings merge of the new object; `test/integration/recipient-messages.http.test.ts`), `packages/i18n` (`<locale>/messages.json` four templates, both locales), `docs/contracts/openapi/components.yaml` (`AccountLimits.messages_per_month`; `AccountSettings.recipient_messages`), `packages/contracts` regenerated, `docs/architecture/integrations.md` §5.1 (the port note), `docs/architecture/data.md` (the limit key), `.serena/memories`.
- **Design references:** none (API only).

## 0. Goal

When a dispatcher assigns an order, a driver starts the stop, attempts it or delivers it, the recipient receives one approved WhatsApp template in their language with the merchant's name and the facts of that moment, unless the account turned that template off, the recipient opted out, a cap or the monthly budget is reached, or the order has moved on by send time; the merchant's monthly message limit exists on the account and the usage counter counts every sent row, so that the wave 1 field loop ends with the recipient informed and the merchant's bill bounded.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: side effects through the outbox (every message is a `message` row written by a consumer in its own transaction, never by the order door); tenancy (the consumer reads the order under the event's account); Arabic and English for every template; secrets never in rows (no parameter is secret here; OTP's sealing stays PLAT-9's).
- ADR-0037 in full (approved templates only, no free text, no SMS, quiet hours for messages a person did not trigger, per-order and per-phone caps, the staleness check, the opt-out list, the `messages_per_month` limit with a visible skip at 100 %), ADR-0036 (seven outbox kinds; `message` carries the channel), ADR-0016 (bilingual), ADR-0026 (the read port lives in Delivery public).
- `docs/architecture/integrations.md` §2.4 (`MessageSender`), §4.3 (supersede keys; the handler re-reads the order through a Delivery read port and drops a message whose state has passed), §5.1 (the four wave 1 templates, their parameters and triggers; the account's choice of templates with the defaults out for delivery, attempted, delivered), §5.2 (approval: the `elx_` prefix, the three-week rule), §5.4 (6 per order, 10 per phone and account a day; these four are never delayed), §5.5 (opt-out; the merchant sees "messages off"), §5.6 (the limit, the counter, 100 % skip with reason `budget`).
- `docs/architecture/domain-model.md` §6.3 rows `delivery.order.assigned`, `.out_for_delivery`, `.attempted`, `.delivered` (payloads: ids, driver, ETA, attempt number and reason code, COD summary; no recipient data: the consumer reads the order row).
- `docs/architecture/data.md` §10 (recipient name and phone: never in logs; the message row's payload holds the phone for the send and is purged on PLAT-9's schedule), §2.1 `core_messaging_opt_outs`, `core_messaging_usage`.
- PLAT-9 plan 2.3 (the template registry shape: `channel`, `category`, `params`, `secretParams`, `deferrable`, `engineMessageType`; the i18n parity test), 2.5 (the handler: staleness through "a read port that wave 1 implements", caps in Redis, opt-out skip `opted_out`, `MESSAGING_DISABLED`), 2.7 (`OptOutList`), 2.8 (`MessagingUsage.increment`; the check at send time reads the limit "when present"); PLAT-13 8.3 #3 (the limit key is undecided: ruled here, 2.5); DEL-2 plan 2.10 (`OrderReader`), 2.9 (the per-status events `delivery.order.<to_status>`, 8.2 #16); DEL-4 plan 2.3 (the `driver_invitation` row as the pattern for a `message` row with `supersedeKey`, `locale`, `params`, `deferrable`).
- Memories `core`, `api/core`, `api/delivery`.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Templates | `packages/i18n/<locale>/messages.json`: `order_assigned` (merchant name, order number), `order_out_for_delivery` (merchant name, driver first name, ETA window, tracking link), `order_attempted` (merchant name, the attempt reason as the account's localised reason-code label, the order number; the reschedule link is wave 2: the text says "we will try again" until then, recorded), `order_delivered` (merchant name, order number, the COD amount in SAR when non-zero, else a variant without it: two template bodies `order_delivered` and `order_delivered_cod`, since an approved template cannot drop a parameter); registry rows with `channel: 'whatsapp'`, `category: 'utility'`, `params` as listed, `secretParams: []`, `deferrable: false` (never delayed, §5.4), `engineMessageType` per the engine's catalogue (the executor reads PLAT-9 leg 2's mapping and picks the nearest shipment types, recorded); the `elx_` namespace prefix applies as PLAT-9 configured; the parity test covers both locales |
| 2.2 | Consumers | `modules/delivery/messaging/recipient-messages.consumer.ts`: `@OnDomainEvent` for the four events; each reads the order through DEL-2's `OrderReader` under the event's account (the payload carries no recipient data), decides (2.3), and writes one `message` row: `to` the recipient's E.164 phone, `locale` the recipient's `preferred_language` else the account's default locale, `params` from the order and the account (`merchant_name` = the account name bounded at 80 characters as `driver_invitation` does), `supersedeKey` `order_recipient:<orderId>` (so an unsent "assigned" is superseded by "out for delivery", §4.3), `aggregate` the order at its version, `deferrable: false`; the row is written in the consumer's own tenant transaction (PLAT-8's consumer pattern), idempotent per event through the consumer receipt |
| 2.3 | The decision at write time | Skip (no row, a log line with the reason and the order id, never the phone) when: the account's `recipient_messages.<template>` is off (2.4); the order kind is `pickup_request` (the "recipient" is a supplier: §7 #2); the recipient phone is on the opt-out list (PLAT-9's `OptOutList.has`); the per-order cap (6) or the per-phone cap (10 a day) is reached (PLAT-9's Redis counters, read here and charged by the handler at send: the executor records the exact split so a skipped row never charges); the monthly budget is at 100 % (2.5). Staleness is the handler's: the Delivery read port (2.6) answers the order's current status and the handler drops the row as `superseded` when the status is past the template's (assigned → anything but `assigned`; out for delivery → not `out_for_delivery`; attempted → the attempt count moved on or the order is terminal; delivered → never stale) |
| 2.4 | Account toggles | `AccountSettings.recipient_messages` (contract addition, additive): `{ order_assigned: boolean, order_out_for_delivery: boolean, order_attempted: boolean, order_delivered: boolean }` with defaults `false, true, true, true` (§5.1); PLAT-12's settings merge and `effectiveSettings` carry it; the owner edits it through `updateAccountSettings` (WEB-3's settings form gains the section in a later WEB order; the API accepts it now) |
| 2.5 | The monthly limit | `AccountLimits.messages_per_month` (contract addition; closes PLAT-13 8.3 #3): required by the provisioning door like the other keys? No: optional with a default of 3,000 when absent (so the console's form and the existing census need no change today; the console shows it once the schema carries it), `>= 0`, `0` means no recipient messages; `platformUpdateAccount` may change it; PLAT-9's send-time check reads it (the "when present" branch becomes the default); OTP counted, never blocked; the 80 % owner notice stays WEB-3's follow-up (§6) |
| 2.6 | Read ports | Delivery public: `OrderStateReader.state(accountId, orderId) → { status, attemptCount, version } | undefined` (implemented over DEL-2's `OrderReader` on the app pool under the account), injected into the worker's message handler through the kernel's token the handler already declares for "a read port that wave 1 implements" (PLAT-9 2.5); kernel: `TrackingLinkPort.linkFor(accountId, orderId) → string | undefined` with a default implementation answering `undefined` until DEL-8 registers the token-backed one; an `order_out_for_delivery` whose link is `undefined` is skipped with reason `tracking_unavailable` in `staging` and `production`, and sent with a placeholder link `PUBLIC_WEB_URL/track/pending` in `local` and `ci` so the flow can be tested (recorded; §7 #1) |
| 2.7 | Observability | PLAT-9's counters gain the reasons `template_off`, `kind_excluded`, `tracking_unavailable`; a per-template sent count; no phone, name or body in any log line |
| 2.8 | Tests | Unit: the decision table of 2.3 (toggle × opt-out × caps × budget × kind), the staleness rule per template, the parameter bounds, the i18n parity. HTTP and worker on the PLAT-5 harness with the stub sender and DEL-2's fixtures: write each of the four events through the outbox writer for a seeded order (DEL-6 and DEL-7 do not exist yet) and see the row, the stub's received template and parameters in `ar` and `en`; the supersede of an unsent `assigned` by `out_for_delivery`; the staleness drop when the order moved on before the handler ran; opt-out skip; the per-order cap after six rows; the per-phone cap across two orders; the budget at 100 % with the usage counter; `recipient_messages` off; `pickup_request` excluded; the tracking placeholder in ci and the `tracking_unavailable` skip with `APP_ENV=staging` in a unit test; the limit key provisioned with the default and changed through `platformUpdateAccount`; both RLS lanes; contract scenarios for the two touched doors (`updateAccountSettings`, `platformUpdateAccount`); the baseline suites `accounts.http`, `provisioning.http`, `messaging`, `features.http` |

### 2a. Lead's improvements over the roadmap row

- **The limit key is decided** (`messages_per_month`, 2.5) with a default so no console or census changes block the order; PLAT-13 left it open.
- **Per-account template toggles** (2.4) exist from the first message, as §5.1 requires, instead of every template firing for everyone.
- **The tracking link is a port** (2.6), so DEL-8 plugs in without touching the consumer, and production never sends a dead link.
- **Two delivered bodies** (2.1) because an approved template cannot omit a parameter; the no-COD case is the common one.
- **`pickup_request` is excluded** (2.3): its "recipient" is a supplier address and the texts would mislead.
- **Supersede keys per order** (2.2) implement §4.3's "an unsent assigned is dropped by out for delivery" without a new table.

## 3. Build list

| Item | Delivers | Verify |
|---|---|---|
| A | Contract additions, settings and limits plumbing, the four templates and registry rows per 2.1, 2.4, 2.5 | contracts regenerate identically twice; parity test; `accounts.http`, `provisioning.http` |
| B | Consumers, the decision, the two ports, the handler's staleness and toggle checks per 2.2, 2.3, 2.6, 2.7 | HTTP and worker per 2.8 |
| C | integrations §5.1 note, data.md key, plan §8, memories, draft PR | full local gate; counts in §8.0 |

## 4. Commit plan

One commit per item `INT-3: <letter> <title>` with its §8.0 row, pushed after each; draft PR from the template with the exact headings; body lines `Release note: docs/release-notes/2026-11-<dd>-recipient-messages.md` (Arabic: the recipient receives messages at assignment, out for delivery, attempt and delivery; the merchant chooses which; the monthly limit) and `Memories:`.

## 5. Exit criteria

- Each of the four events produces one row with the right template, language and parameters, and the stub shows it; an unsent "assigned" is superseded by "out for delivery"; a stale row is dropped at send time.
- A toggled-off template, an opted-out phone, a reached cap, a full budget and a `pickup_request` produce no row, each with its reason counted.
- The limit key provisions with its default and is changeable; the counter counts sent rows only.
- No log line, audit row or event payload carries a recipient's phone or name; both RLS lanes green; the two contract additions are additive.

## 6. Not in this order

The templates' submission to the provider (OPS, with the owner; §5.2's three-week rule starts when this order starts); the inbound webhook for replies and provider status (the INT channels order; PLAT-9's test-only opt-out entry stays); the 80 % owner notice and the settings form section (a WEB-3 follow-up); the reschedule and address-pin templates (wave 2); the "messages off" marker on the order view (WEB-5 with a `getOrder` field); SMS (ADR-0037).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | `order_out_for_delivery` before DEL-8's tracking links | Skipped in staging and production until DEL-8; a placeholder link in local and ci |
| 2 | Messages for `pickup_request` orders (the "recipient" is a supplier) | None in wave 1 |
| 3 | The default monthly limit | 3,000 messages when the provisioning door sends none |
| 4 | Template defaults | assigned off; out for delivery, attempted, delivered on (§5.1) |

## 8. Executor notes (filled by the executor)

### 8.0 Counts

### 8.1 Deviations

### 8.2 Notes

### 8.3 Not done here

## 9. Lead review and adversary
