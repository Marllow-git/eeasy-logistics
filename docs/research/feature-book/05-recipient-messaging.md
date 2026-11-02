# Feature book 05: Recipient experience and messaging

Date: 2026-11-02. Status: research input for the lead; proposals only, nothing here changes the roadmap. Branch `docs/feature-book-05-recipient` from `origin/main` at `b58760d`. Every source was read on 2026-11-02 unless its entry says otherwise; source ids (R, FC-R, FC-C, P, W) are in the source list in section 4.

## Summary for the lead

1. Wave 1 covers the core: the token and public page (DEL-8, WEB-8), four WhatsApp event messages (INT-3), opt-out, caps and a monthly budget. Reschedule and address pin are wave 2 (DEL-14, WEB-11, INT-7). Delivery instructions, recipient OTP, ratings, recipient return requests, branded tracking and queue position have no order or only a proposal.
2. Largest divergence: integrations §2.4 and §5.2, the INT-3 plan and the wave 0 and wave 1 exit boxes assume Meta-approved WhatsApp templates. ADR-0041 (proposed, 2026-11-01, owner ruling A-25) replaces this with free text rendered from our bilingual templates, sent through eeasynew's engine, with no approval and no categories. Those documents were not amended.
3. Wave 1 has no ETA source: `eta` is nullable, the out-for-delivery template carries an ETA window, and INT-6, the only ETA source, moved to the end of wave 2 (A-24).
4. The INT-3 default budget (3,000 messages a month) is about two days of the first-customer profile in integrations §5.6 (500 orders a day, three messages each, about 45,000 a month). Both numbers cannot stand.
5. No roadmap row owns inbound WhatsApp callbacks (delivery status and replies). Stop-word opt-out, the delivered rate and the undelivered-rate evidence that ADR-0037 needs all depend on them.
6. The recipient OTP at the door has a proof kind (domain §3.10) but no template, no capture order (DRV-4) and no rule on whether its code is exempt from opt-out and caps the way driver OTP is.
7. Recipient-initiated returns stay in wave 4 (DEL-18) unless pulled forward. Torod and OTO list the feature for KSA merchants (P3, FC-R).
8. Branded tracking contradicts integrations §5.1 today. The proposed logo setting could land in wave 1 (WEB-8) or wave 4 (WEB-20); the owner must choose.
9. KSA marketing hours and stop timing are not settled by any primary source read. CITC Decision 395/1439 (2018) requires an opt-out option and gives no hours (W1). Vendor hours conflict (20:00 to 08:00, 22:00 to 07:00, 08:00 to 21:00) and the 24-hour stop is secondary. Our 22:00 to 08:00 window is a design choice; counsel must classify the four templates first.
10. No document has a weekend or holiday rule. The Saudi weekend has been Friday and Saturday since 29 June 2013 (W3). Quiet hours, ETA windows and slot days need a calendar rule before wave 2.

## 1. Conventions

- Each feature has the ten aspects of the brief as numbered items 1 to 10. "(inferred)" marks my inference. Everything else is stated by the cited source.
- Shape vocabulary: borrow (take the market shape), adapt (take the idea and change the shape to our rules), own (our design, no market shape taken), no (rejected, with the rule that decides it).
- Roadmap status: covered (an order names it and its scope matches), partial (an order exists and misses part), missing (no order), proposed (only in the census notes FC-R and FC-C, not in the roadmap).
- Chosen shape in item 9 is a proposal for the lead, as the brief asks. Where it differs from the current roadmap, item 10 says so.
- New open questions raised by this chapter are numbered CH5-1 to CH5-17 in section 5. Existing register ids (Q-4, Q-18, Q-19, Q-20, Q-21, Q-27, Q-33, Q-37, Q-38) keep their meaning.
- Scope: KSA is wave 1 (FC-C section 2 item 1). No GCC source was read; GCC differences are listed as unanswered, not researched.

## 2. Features

### F1. Tracking tokens

1. Definition and goal: a signed per-order, per-purpose link that gives a recipient the order's public view without an account. Purposes `track`, `reschedule`, `address_pin` (R2 §3.12, R3 §3.5).
2. Workflow: staff issue a token with `issueTrackingToken`, which returns the link once; a replay gets `409 secret_already_issued`; an optional WhatsApp send goes through the outbox (R11, `/orders/{id}/tracking-tokens`). Revoke with `revokeTrackingToken`. Each recipient request re-checks expiry and `revoked_at` (R10 description); the stream re-reads the row on connect and every 60 s (R13 §6). Expired or invalid token: one bilingual page, no reason given (R4 §9). Who triggers issue at assignment or out-for-delivery is not stated (CH5-1).
3. Rules and edge cases: `track` lives until the order closes plus 30 days; reschedule and pin links 48 hours (R3 §3.5). Recipient rate limit 60 a minute per token; reschedule and pin writes 5 per token per hour (R13 rate-limit table). Lookup by phone, order number or AWB is refused by our design; Torod looks up by AWB, order id or mobile (P3 §2, row 9).
4. Data: `del_tracking_tokens` with `order_id`, `purpose`, `expires_at`, `revoked_at`; the row exists for revocation and audit (R2 §3.12). Deleted daily after expiry (R5 §10). The HMAC key's rotation is not described for tracking tokens (inferred gap; R1 principle 4 covers per-account secrets only).
5. Surfaces: recipient `GET /v1/recipient/tracking`, `/tracking/stream`, `/tracking/slots`, `/tracking/reschedule`, `/tracking/address-pin` (R10); staff token endpoints (R11); pages `/track/[token]`, `/reschedule/[token]`, `/pin/[token]` (R4 §9). Token travels as `X-Recipient-Token`, and as `?token=` only for the stream.
6. Permissions and audit: the purpose grants `delivery.tracking.view`, `.reschedule` or `.pin_address`, not a role (R13 §2). Staff need `delivery.tracking.manage` (R11). No audit row is stated for issue or revoke; R3 §7 requires audit only for admin and ledger-adjacent actions, so this is a gap (inferred). The role bundle for the new permission is not in R3 §2.
7. Dependencies: the signing secret through `packages/config` (R1 principle 4); the outbox `message` kind for the WhatsApp send (R1 §4.1); `PUBLIC_WEB_URL` for the link base (R14 §2.6).
8. Metrics: none defined. Candidates from the surfaces: issues, revocations, `token_expired` responses, recipient 429s (inferred; R1 §10 names no token metric).
9. Market and chosen shape: Wasal gives each stop a `tracking_token` sent by SMS, email or WhatsApp (P2 §2.5). Torod's public lookup accepts phone numbers, which we refuse (P3 row 9). Chosen: borrow Wasal's per-stop token; own the rule that a token is the only key (R3 §3.5, D-24). Reason: lookup by phone exposes personal data.
10. Roadmap: DEL-8 (wave 1) covers issue, revoke and the public view (R15). Partial: DEL-8 and INT-3 do not say who issues the link the out-for-delivery message carries; INT-3 §2.6 needs DEL-8 to register the token-backed port. Open: CH5-1.

### F2. Tracking page and embed

1. Definition: the public recipient page showing status, ETA, driver first name, slot, merchant name, status history and, while out for delivery, the driver's last position (R12 `PublicTrackingView`; R4 §9).
2. Workflow: the server component sends the token as a header, never a cookie or stored value, with `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store` (R4 §9). The page streams events and falls back to polling every 10 to 15 s (R13 §6). The stream closes at a terminal state. Happy path: assigned, out for delivery, delivered.
3. Rules and edge cases: Arabic default with one toggle; the first screen fits a phone and the status reads without the map (R4 §9). Language resolution is `?lang=`, else account default, else `ar` (R4 §5). Embedding: `/embed/track/[token]` may be framed only from account `embed_origins` (at most 10 https origins, wave 2, R13 §6); until ruled the page answers `frame-ancestors 'none'` (R4 §9). Q-20 default is off. Embedding by merchants is not confirmed in any source read (FC-R, embedded tracking).
4. Data: reads the public view only (D-24). `embed_origins` is a proposed additive array on `AccountSettings` (R4 §9); not in the contracts yet.
5. Surfaces: recipient web pages; recipient API (R10). Edge access logs drop the path segment after `/track/` (R4 §9).
6. Permissions and audit: token purpose only; no staff cookie forwarded; no staff component importable from the recipient group (R4 §9). No audit or view metric is stated (gap, inferred).
7. Dependencies: DEL-8 view; WEB-1 shell and design system (R15); PostHog and Sentry replace the token segment with `:token` (R4 §9).
8. Metrics: page budget per doc 7 §10.2 is a wave 1 exit box (R15 §2). No page-view or link-open metric exists (gap).
9. Market and chosen shape: Onfleet, Shipday and Tookan have tracking pages (FC-R S14, S15, S17). Wasal's standard page is on every tier, branded from Premium (P2 §2.5). Chosen: own (server-rendered, token-only, no staff path, R4 §9); keep embedding fail-closed until Q-20 is ruled. Reason: D-24 and the fail-closed rule already in WEB-8.
10. Roadmap: WEB-8 (wave 1) covers the page; embedding is partial, since WEB-8 "fails closed until embedding is ruled" (R15). The `embed_origins` contract row is not in wave 1. Owner: Q-20.

### F3. Live map while out for delivery

1. Definition: a map on the tracking page showing the driver's last position, only while the order is `out_for_delivery` and a position exists (R4 §9).
2. Workflow: the map chunk loads only in that state; the driver marker moves on `telemetry.driver_location` from the stream, or on a 12-second poll; "updated X seconds ago" uses `position_updated_at` (R4 §9). The stream closes at a terminal state. A stale tracking alert for staff fires after 5 minutes without a point on an active shift (R15 DEL-5). What the recipient sees when the position is stale is not stated (CH5-4 scope).
3. Rules and edge cases: D-24 allows the last position only while out for delivery (R2 §3.18). Driver positions are not domain events and bypass the outbox (ADR-0028, proposed). The driver's ring is overwritten within one hour; trails are kept 90 days (R5 §6, §10; Q-5). Wasal shows real-time driver location with no retention or consent statement (P2 §4.4), a counter-example.
4. Data: `del_driver_locations` ring and heads (one hour), `del_driver_trails` (90 days) (R5 §10). The recipient receives `last_position` and `position_updated_at` only (R12).
5. Surfaces: recipient stream and polling twin `GET /v1/recipient/tracking` (R10, R13 §6); the recipient map in WEB-8.
6. Permissions and audit: `delivery.tracking.view` (token). The driver is shown by first name only (R12). No audit is stated.
7. Dependencies: DEL-5 pings (R15), ADR-0039 own tracker on the driver side, battery budget 4 % an hour (ADR-0039; Q-39 ruled); map provider and tiles (WEB-6 `MapProvider`; Q-19 open).
8. Metrics: position age at render and stream resync count (inferred; neither is defined in R1 §10).
9. Market and chosen shape: Onfleet and Shipday show a live map (FC-R S14, S15); Wasal shows drivers in real time (P2 §2.5). Chosen: adapt (map in one state only, stricter than Wasal's always-on view), grounded in D-24 and R4 §9. Reason: position is personal data and the rule is already in the domain model.
10. Roadmap: covered by WEB-8 (wave 1 exit: "the recipient sees the driver move while out_for_delivery", R15 §2). Gap: stale-position behaviour and the privacy notice to recipients (CH5-4, CH5-15).

### F4. ETA and queue position modes

1. Definition: ETA is an arrival window shown to the recipient. Queue position is the Wasal mode "You are #3 in queue" with a "next in queue" notice (P2 §2.5).
2. Workflow: ETA comes from route sequencing: INT-6 rung 1 produces a stop order and per-stop ETA (R1 §6.4). `PublicTrackingView.eta` is nullable (R12). The out-for-delivery template carries an "ETA window" (R1 §5.1). Queue position has no defined source; it would be the stop's place in the driver's remaining sequence (inferred).
3. Rules and edge cases: no ETA source exists in wave 1, because INT-6 is deferred to the end of wave 2 (A-24) and slots (DEL-9) are wave 2 (R15). The buffer rule is not in our docs; Onfleet uses an ETA range with a buffer rounded to quarter hours (FC-R S16, search summary). KSA windows such as "4 to 6 pm" are inferred from the channel's habit (FC-R, ETA window). No weekend or holiday rule (summary item 10).
4. Data: `eta` on the public view (R12); no ETA history is defined (inferred gap). Q-18 decides where the sequence and ETA live (R15 §4).
5. Surfaces: recipient page; out-for-delivery message parameter (R1 §5.1); staff dispatch board (not stated).
6. Permissions and audit: public view only (D-24); the driver's first name is visible with the ETA (R12).
7. Dependencies: INT-6 (wave 2, end), DEL-9 slots, INT-5 matrix (Hudhud or OSRM), VROOM (ADR-0010, R1 §2.1, §2.3).
8. Metrics: ETA accuracy (promised window against actual) is not defined in R1 §10 or DEL-17 (gap).
9. Market and chosen shape: Onfleet gives a predictive ETA with delay alerts (FC-R S15, S16); Shipday sends ETA by SMS (FC-R S14); Torod shows expected arrival (P3 row 30); Wasal has the queue-position mode (P2 §2.5). Chosen: adapt. Window mode first, from the slot window when DEL-9 exists or from INT-6 when it lands, and null otherwise. Queue position is a second mode of the same view, only after INT-6 gives a stop order. Reason: no ETA source before wave 2; the sequence is the input (ADR-0010).
10. Roadmap: partial. DEL-8 has the field; INT-3 carries the window; no source until INT-6. Queue position and "next in queue" are missing; P1 §4 (the DEL-8 and WEB-8 amendment) proposes them, not an order. Owner: Q-18, CH5-2.

### F5. WhatsApp templates per event, with approval

1. Definition: one bilingual message per recipient event. Wave 1: `order_assigned`, `order_out_for_delivery`, `order_attempted`, `order_delivered`. Wave 2: `reschedule_request`, `address_pin_request`, `order_rescheduled` (R1 §5.1; R15 INT-3, INT-7).
2. Workflow: a consumer on `delivery.order.*` writes one `message` outbox row in its own transaction; the handler re-reads the order and drops stale rows as `superseded` (R14 §2.2 to §2.3; R1 §4.3). Skip reasons are counted: `template_off`, `kind_excluded`, `tracking_unavailable`, `opted_out`, `budget` (R14 §2.7). Delivery status and replies arrive on a callback no order owns (see F8).
3. Rules and edge cases: text in `packages/i18n` per locale, parameters from domain data only, no free text (R7 decision 1; R1 §5). Approval as written in R1 §5.2: templates are submitted under the verified business, with Meta review "up to 24 hours" (R17 §7, read 2026-10-31) and no published rule on re-categorising utility templates as marketing (R17; R18). ADR-0041 decision 3 says Meta approval and template categories no longer apply, because the engine takes text (R8; R16 §1). Until R1 §2.4 and §5.2 are amended, the two documents disagree. The wave 0 and wave 1 exit boxes still say "approved" (R15 §2). Under CITC's categories (W1 lists awareness, personal, promotional, service and warning), our templates would plausibly be service messages (inferred; no source classifies them; CH5-3, CH5-4).
4. Data: `message` row with `to` (E.164), `locale`, `params`, `supersedeKey` `order_recipient:<orderId>`, `aggregate`, `deferrable: false` (R14 §2.2). Outbox retention: done rows 7 days, dead rows 30 days (R5 §10). OTP rows are a separate rule (F18).
5. Surfaces: the WhatsApp message; merchant toggles `AccountSettings.recipient_messages` (R14 §2.4); "messages off" marker on the order (later, WEB-5, R14 §6). No recipient API.
6. Permissions and audit: owner or admin edits toggles through `updateAccountSettings`; the settings write is audited (R3 §6). The engine's instance linking is a platform action (R8 decision 2).
7. Dependencies: `EngineMessageSender` and the signed callback door (PLAT-9 leg 2, A-25, not built); engine deployment by OPS-1 (R8 consequences); provider name to confirm (Q-27); `whatsapp-stub` for local and CI (R1 §9); the Delivery read port `OrderStateReader` (R14 §2.6).
8. Metrics: `messages_sent_total{template, locale}` and `messages_skipped_total{reason}` (R1 §10). Missing: delivered, read and failed rates from callbacks. ADR-0037 requires the undelivered rate to be measured (R7 consequences); no metric defines it.
9. Market and chosen shape: Shipday sends SMS and WhatsApp (FC-R S14); Torod sends SMS at each stage (P3 row 11); Wasal sends per-event notices for scheduled, next in queue, delivered and failed (P2 §2.5); Logestechs names providers without content (P4 §1.1). Chosen: own. Kernel-rendered bilingual templates, text to the engine, templates-only as a product rule (ADR-0037, ADR-0041); borrow Wasal's per-event list. Reason: owner ruling 2026-11-01 (A-25) and the ban risk of linked numbers (R16 §1).
10. Roadmap: INT-3 (wave 1) and INT-7 (wave 2) cover the templates, but INT-3 still assumes Meta approval (R14 §1, §6) and R1 §2.4 and §5.2 are unamended. Partial. Owner: Q-27, CH5-3, ADR-0037 and ADR-0041 acceptance (both proposed).

### F6. Quiet hours

1. Definition: no sends between 22:00 and 08:00 Asia/Riyadh for messages a person did not trigger at that moment. Those wait until 08:00 and pass the staleness check (R1 §5.4; R7 decision 3).
2. Workflow: a held message waits in the queue with `next_attempt_at` at 08:00 (inferred from R1 §4.4), then the staleness check runs. Delivery-now messages and OTP are never delayed (R1 §5.4).
3. Rules and edge cases: the window is our design, not a sourced rule (R1 §5.4). Sources read: CITC Decision 395/1439 gives no hours (W1). Vendor claims: marketing barred 20:00 to 08:00 (W2, D7 Networks); promotional 09:00 to 20:00 (W2, unnamed vendor); 08:00 to 21:00 (W2); 22:00 to 07:00 (W2, WaveCell). Our window is shorter than the 20:00 claim, so it fails that claim if it applies to our messages. Which applies depends on the message category (CH5-4). No calendar rule: the Saudi weekend is Friday and Saturday since 29 June 2013 (W3); public holidays and Ramadan hours are not researched.
4. Data: no table; the held state is the message row (inferred).
5. Surfaces: none for recipients. No merchant setting is defined (gap; Wasal offers restriction periods on Premium, P2 §2.5).
6. Permissions and audit: platform configuration only; no audit defined (inferred).
7. Dependencies: the relay's `next_attempt_at` (R1 §4.4); the staleness check (R1 §4.3).
8. Metrics: no counter for "held until 08:00"; a held message is not a skip (gap, inferred).
9. Market and chosen shape: Wasal's restriction periods are a Premium feature (P2 §2.5). Chosen: own, fixed window, from ADR-0037; account-level configuration only if counsel requires a different window (inferred). Reason: the window is unsourced and must be checked before it is made configurable.
10. Roadmap: covered by INT-7 (wave 2). Not in INT-3 by design, since all four wave 1 messages are delivery-now. Missing: calendar rules and counsel's check (CH5-4).

### F7. Caps

1. Definition: at most 6 recipient messages per order, and at most 10 a day per recipient phone and account (R1 §5.4; R7 decision 3).
2. Workflow: INT-3 checks the caps when it writes the row, read only; the handler charges the counters at send, so a skipped row never charges (R14 §2.3). A skip completes the row as `done` with its reason (R1 §4.4). No retry.
3. Rules and edge cases: the per-phone cap spans orders (R14 §2.8 test). Phones normalised to E.164 so two formats of one number share a budget (R3 §3.2). With three attempts (D-14 default, R2 §9 Q-3), the cap can bind before delivery (inferred: assigned, out, attempted, out, attempted, out, attempted, out, delivered can exceed six; superseding reduces it).
4. Data: Redis counters per order and per phone and day; Redis is not a source of truth (R1 §4.4; R15 A-24 keeps Redis local and in CI). Cap values are constants, with no account setting named (inferred).
5. Surfaces: none to recipients or merchants; skips are visible in the platform outbox list (R1 §4.5).
6. Permissions and audit: fixed in code; platform change only through a release (inferred).
7. Dependencies: Redis (production choice Q-42, R15 A-24); PLAT-9 handler (R14 §1).
8. Metrics: `messages_skipped_total{reason}` (R1 §10); the cap reasons are PLAT-9's counters (R14 §2.7), not defined by name.
9. Market and chosen shape: no market source states a per-order cap (P2, P3 silent). Chosen: own, fixed caps from ADR-0037. Reason: cost and spam bound, as the ADR states.
10. Roadmap: covered by INT-3 (wave 1). Gap: the values have no owner ruling and no register row (CH5-5).

### F8. Opt-out and stop words

1. Definition: a recipient stops non-OTP messages from one account by a quick-reply button or a stop word, stored per (account, phone). A start word reverses it (R1 §5.5).
2. Workflow: the reply or button reaches the callback door and writes the opt-out list. Later sends are skipped with `opted_out` (R14 §2.3). The merchant sees "messages off" on the order (R1 §5.5; the marker is deferred to WEB-5, R14 §6). Provider-side blocks in status callbacks are treated the same (R1 §5.5).
3. Rules and edge cases: stop words `STOP`, `إيقاف`, `الغاء`; start words `START`, `اشتراك` (R1 §5.5); ADR-0041 adds `تشغيل` and takes the union with the engine's list (R8 decision 3). OTP is never blocked for drivers or staff (R1 §5.5). Buttons: the engine refuses buttons and lists by name (R16 summary item 2), so the quick-reply path in R1 §5.5 does not exist under ADR-0041 (inferred). CITC treats a message without an opt-out option as spam (W1, secondary). A 24-hour stop is claimed by a secondary source (FC-R S39) and vendors (W2), not verified. Arabic spelling variants of the stop words are not specified (inferred gap).
4. Data: `core_messaging_opt_outs` (account, phone) (R14 §1). Retention not stated. Inbound reply bodies are inbound webhook payloads kept 30 days (R5 §10).
5. Surfaces: the reply itself; the merchant's "messages off" marker (later).
6. Permissions and audit: no recipient auth. Writes come from the callback door; a platform test-only entry exists (R14 §6). Audit of opt-out writes is not stated (gap).
7. Dependencies: the inbound callback door, which no roadmap row builds (R14 §6 refers to "the INT channels order"; none is in R15 §1); the engine's `suppression.changed` callback (R8 decision 3).
8. Metrics: opt-outs per account, start reversals, provider blocks; none defined in R1 §10.
9. Market and chosen shape: Unifonic states opt-out must be as easy as opt-in (W2, vendor); Al Tamimi reports a stop within 24 hours (FC-R S39, secondary); Torod names no consent model (P3 row 11). Chosen: own. Both-language stop words, union with the engine list, OTP exempt. Reason: ADR-0037 and ADR-0041.
10. Roadmap: INT-3 covers the list and the skip (wave 1). Partial: no inbound order. Owner: CH5-6 (who builds the callback door), CH5-4 (the 24-hour clock).

### F9. Monthly budget

1. Definition: per-account `messages_per_month` with a usage counter. At 80 % the owner gets a notice; at 100 % recipient messages are skipped with reason `budget`; OTP is counted, never blocked (R1 §5.6; R7 decision 4).
2. Workflow: the counter increments when a row is sent, not when queued (R1 §5.6). The check happens at send time (R14 §2.5). The 80 % notice is a WEB-3 follow-up (R14 §6).
3. Rules and edge cases: INT-3's default is 3,000 messages a month when the provisioning door sends none, marked provisional (R14 §2.5, §7 item 3). The first-customer profile is 500 orders a day with three recipient messages each, about 45,000 a month and USD 450 to 700 at about USD 0.01 a message, marked "estimate, to confirm" (R1 §5.6). At that profile the 3,000 default reaches 100 % in about two days (inferred arithmetic). Saudi per-message rates are not stated in the sources read: Meta's rate card amounts were not readable, and third-party figures conflict and must not be budgeted from (R18 pricing rows).
4. Data: `core_messaging_usage` counters and `AccountLimits.messages_per_month` (contract addition, R14 §1, §2.5). Calendar boundary for "per month" is not stated; Asia/Riyadh is used elsewhere (inferred).
5. Surfaces: platform console sets the limit (`platformUpdateAccount`); the owner sees usage in settings (WEB-3 follow-up).
6. Permissions and audit: limit set by platform through the provisioning door (R3 §6, ADR-0006); every limit change writes an audit row (R3 §6).
7. Dependencies: PLAT-13 limits key (R14 §2.5); PLAT-9 `MessagingUsage` (R14 §2.8).
8. Metrics: `message_budget_used_ratio{account}` (R1 §10); `messages_sent_total`.
9. Market and chosen shape: Wasal bills base stops with overage and counts a stop when it is added, whatever the outcome (P2 §2.7, §4.2); Torod bills per city by plan (P3 §4). Chosen: own. A per-account send cap with a visible skip, not a price (ADR-0037). Reason: pricing is an owner decision (Q-33, provisional).
10. Roadmap: INT-3 covers the counter and default (wave 1). Conflict: the default against R1 §5.6 (CH5-7). Q-33 governs pricing.

### F10. SMS fallback

1. Definition: an SMS path for recipients or staff without WhatsApp. Not in the product before wave 3 (R7 decision 2).
2. Workflow: none in waves 0 to 2. A number without WhatsApp receives nothing and the order flow continues; OTP has no fallback (R1 §5.3).
3. Rules and edge cases: ADR-0037 bars SMS before wave 3; the roadmap may schedule it on evidence of undelivered rates (R1 §5.3). ADR-0041 is WhatsApp-only (R8). Sender-ID registration and marketing routes are vendor claims (W2), not verified; custom sender names are a Wasal Premium feature (P2 §2.5).
4. Data: none. `MessageSender` keeps an SMS adapter slot with no implementation (R1 §2.4).
5. Surfaces: none.
6. Permissions and audit: none; the ADR must be amended to change this.
7. Dependencies: an SMS provider (not chosen); the message cost input to D6 pricing (R7 consequences); the undelivered-rate metric (not defined).
8. Metrics: undelivered rate per account, which R7 says must be measured (no metric exists).
9. Market and chosen shape: Shipday uses SMS and WhatsApp (FC-R S14); Tookan uses SMS and email (FC-R S17); Wasal bills SMS per message at a regional rate (P2 §2.5); Torod sends SMS at each stage (P3 row 11). Chosen: own, deferred: keep ADR-0037. Reason: a second provider and template set for a minority of recipients, before evidence (R7 alternatives).
10. Roadmap: missing by ADR; no order before wave 3. Owner: CH5-8.

### F11. Reschedule and address-pin links

1. Definition: a 48-hour link where the recipient picks a new slot (reschedule) or drops a map pin for the address (pin). Both are purpose-bound (R10; R3 §3.5).
2. Workflow: after an attempt, the template `reschedule_request` or `address_pin_request` carries the link (R1 §5.1); intake below the confidence threshold sends the pin request (R1 §6.2). Reschedule: list slots, choose one; `409 slot_full` shows the current state and the remaining choices (R4 §9, R10). Pin: `PinPicker` centred on the geocoded point; geolocation offered, not required; a confirmation screen; `recipientPinAddress` re-resolves zone and coverage (R10, R4 §9). Order locked returns `409 order_locked` (R10).
3. Rules and edge cases: slot must belong to the order's site and zone, else `422 slot_not_available`; allowed before pickup or after an attempt (R10). Pin note up to 300 characters, "directions for the driver" (R10). Outside coverage returns `422 outside_coverage`; a recipient pin sets `pin_source = recipient_pin` and a higher-trust source is never overwritten (R1 §6.2, D-3). Default confidence threshold 0.6 (R1 §5.1). Weekend and holiday slot rules are not defined (summary item 10).
4. Data: order `slot_id`, `point` with `pin_source`, the pin note (storage of the note not stated: gap). Address point is recipient PII (R5 §10).
5. Surfaces: `/reschedule/[token]`, `/pin/[token]` (WEB-11, wave 2); staff dialogs (WEB-11); the driver's pin-at-door step (DRV-7, R15).
6. Permissions and audit: `delivery.tracking.reschedule`, `.pin_address` through the token; staff via DEL-14. `delivery.order.rescheduled` is emitted (R10, R2 §6.3). Audit row for pin changes is not stated (gap).
7. Dependencies: DEL-9 slots (wave 2); DEL-14; INT-2 geocoder (merged, R15); map tiles (Q-19); embedding (Q-20).
8. Metrics: link opened, slot chosen, pin confirmed, pin rejected for coverage; none defined.
9. Market and chosen shape: Wasal does not document reschedule or pin (P2 §4.3). Logestechs has a "postponed" approval state (P4 §1.1). Chosen: own, purpose-bound 48-hour tokens already in our contract (R3 §3.5). Reason: the mechanics are settled; the open choice is how the pin note is stored.
10. Roadmap: covered (DEL-14, WEB-11, INT-7, wave 2). Owner question: Q-20 extension to these pages (R4 §12 item 4).

### F12. Delivery instructions and preferences

1. Definition: notes that reach the driver (gate code, leave at the door, landmark) and recipient delivery preferences. No such feature exists; the nearest is the 300-character pin note (R10).
2. Workflow: none defined. The proposal is an optional instruction field on the order and recipient, shown to the driver and on the reschedule and pin pages (FC-C DEL-19, wave 2).
3. Rules and edge cases: free text in Arabic and English renders with `dir="auto"` (R4 §5). KSA addresses lean on landmarks and the National Address short code (FC-R, delivery instructions, inferred; INT-2 is merged, R15). Access codes are not classified in R5 §10 (gap).
4. Data: none yet. A new recipient field needs a `pii:recipient` comment and a row in R5 §10 (R5 §10 rule).
5. Surfaces: recipient pages (proposed), driver order detail (DRV-4), staff order edit (R11 line 451 already lets staff edit notes before pickup).
6. Permissions and audit: staff edit under the order permissions; the order edit is an event (inferred).
7. Dependencies: DEL-2 order model (R2 §3.1); DRV-4; the data inventory (R5 §10).
8. Metrics: share of orders with instructions; failed attempts coded "no access" (inferred; none defined).
9. Market and chosen shape: no competitor source read confirms the feature (FC-R, delivery instructions). Chosen: own, later. Reason: no PII class or retention rule exists for access codes; the pin note covers the wave 2 need.
10. Roadmap: missing (no row). The pin note is partial cover (DEL-14). Owner: CH5-9.

### F13. Recipient OTP at the door

1. Definition: the driver asks the recipient for a code sent by WhatsApp; the driver enters it; the server verifies it and records a proof of kind `recipient_otp` (R2 §3.10).
2. Workflow: not defined. Inferred steps: out for delivery, code message to the recipient, driver enters the code, server verifies once under a row lock, proof written with its upload status (inferred from R3 §3.2 and R2 §3.10). The driver app supports this kind only when a wave order defines its capture; a proof policy naming it blocks delivery until then (R6, proof capture paragraph).
3. Rules and edge cases: R1 §5.1 has no recipient OTP template; FC-R flags this as an inconsistency (FC-R summary item 6). Driver OTP budgets (5 a phone an hour, 20 an IP) are the nearest rule (R3 §3.2), applicability to recipients inferred. ADR-0037's "OTP is never delayed, capped or blocked by opt-out" is written for driver and staff OTP (R1 §5.4 to §5.5), so recipient codes are not covered (CH5-10). A recipient without WhatsApp cannot receive a code (inferred). Logestechs puts a delivery `pinCode` in its status webhook (P4 §3.3), which our PII rules forbid (R1 §11).
4. Data: `del_proofs` kind `recipient_otp` (R2 §3.10). The code is stored hashed, as R3 §9 rule 6 requires for OTPs; if the code travels in an outbox row it is encrypted and deleted an hour after send (R5 §10).
5. Surfaces: driver capture screen (not in DRV-4; proposed DRV-8, FC-C); the WhatsApp message (no template); staff proof view.
6. Permissions and audit: the driver's device token (R3 §3.2); verification attempts audited (inferred; not stated).
7. Dependencies: DEL-7 proofs; a new template in INT-3 (proposed, FC-C); DRV-8 (proposed); `MessageSender`.
8. Metrics: verification failure rate; share of COD deliveries with a code; none defined.
9. Market and chosen shape: no competitor source read confirms recipient OTP (FC-R, OTP proof). Wasal's POD is signature and photo per stop policy (P2 §2.4); Logestechs sends a delivery PIN (P4). Chosen: adapt. The domain's proof kind plus a driver step, verified server-side under the driver OTP rules. Reason: the kind exists (R2 §3.10) and the app refuses fake proofs (R6).
10. Roadmap: partial. DEL-7 has the kind; DRV-4 lists photo and signature only (R15). Missing: template and capture. Owner: CH5-10 (FC-R unanswered 2; FC-C section 4 item 7).

### F14. Ratings and feedback

1. Definition: after delivery the recipient rates the service and may comment; the rating is stored with the order and shown to the merchant (FC-R, ratings).
2. Workflow: none in the roadmap. The census proposes a survey template after `delivered` with a link (FC-C DEL-29). A feedback link needs a token purpose that TrackingToken does not have (R2 §3.12).
3. Rules and edge cases: whether a survey is transactional or marketing under PDPL is unanswered (FC-R unanswered 13); the PDPL text was not read. CITC's categories include service messages (W1); classification of a survey is not sourced (inferred). Caps and quiet hours would apply.
4. Data: no entity. A rating and comment linked to a recipient is personal data and needs a row in R5 §10.
5. Surfaces: recipient page (new purpose), staff order detail, merchant reports.
6. Permissions and audit: new token purpose; staff read through `delivery.orders.read` (inferred).
7. Dependencies: DEL-8 token, INT-3 template, caps and opt-out (F7, F8).
8. Metrics: response rate, average rating (none defined).
9. Market and chosen shape: Onfleet sends a survey after each delivery; Shipday requests feedback after delivery; Tookan has a feedback page on the tracking link (FC-R S14, S15, S17, the last from search). Chosen: own, later, after the consent ruling. Reason: consent class open and no entity.
10. Roadmap: missing. FC-C proposes DEL-29 in wave 4; FC-R proposes wave 3 (inconsistent). Owner: CH5-11.

### F15. Recipient-initiated returns

1. Definition: the recipient asks to return an item or exchange one from the tracking page, gives a reason, and a pickup is booked (FC-R, recipient return request; P3 A5).
2. Workflow: none in the roadmap. Torod offers self-serve returns and exchanges with merchant-set conditions and a reverse label on Salla (P3 row 12). OTO takes return requests by SMS link or dashboard with approval (FC-R S9). Our DEL-18 builds `return_pickup` and `exchange` (wave 4) but no recipient entry, reason list or approval state (FC-R, approve or reject returns).
3. Rules and edge cases: token purposes do not include a return (R2 §3.12). Exchange shape is Q-4 (one order by default); Logestechs's SWAP and BRING carry two money fields (P1 §5 item 4). The failed-to-returned path exists (R2 §3.13). Refund and COD reversal are undefined (FC-R, COD reversal, FC-C DEL-23).
4. Data: a return order of kind `return_pickup` (R2 §3.1); reason code (inferred: an account reason list, as for attempts, R2 §3.10).
5. Surfaces: a recipient return page (new); staff approval (DEL-18).
6. Permissions and audit: a new token purpose would be needed (inferred); staff approval permission not defined.
7. Dependencies: DEL-8, DEL-18 (wave 4), Q-4, Q-6, an INT-3 template, WMS-8.
8. Metrics: return rate by reason (none).
9. Market and chosen shape: Torod and OTO list it (P3 row 12; FC-R S9); Loop and Happy Returns offer exchanges (FC-R, exchange and return pickup). Chosen: adapt, later. A recipient request creates a return order through DEL-18's model with staff approval, and no self-service carrier label: own fleets need no carrier label (ADR-0005, ADR-0014; FC-R, return label, inferred). Reason: scope rule ADR-0005.
10. Roadmap: partial. DEL-18 (wave 4) covers the flow without the recipient entry. Owner: CH5-12 and FC-C unanswered 4.

### F16. Branded tracking

1. Definition: the merchant's logo, colours or branded link on the recipient page and in messages.
2. Workflow: none. Integrations §5.1 says merchant branding beyond the merchant's name in text is not available, because templates are platform-level (R1 §5.1). The page shows the merchant name only (R4 §9).
3. Rules and edge cases: a logo is uploaded content, so it needs format and size rules, not stated anywhere (gap). Arabic and English names (ADR-0016). WhatsApp sends from our number and display name, not the merchant's (Q-27, R15). Torod shows the store logo on tracking and returns pages (P3 row 10); Wasal's branded page is Premium and above (P2 §2.5).
4. Data: a proposed `AccountSettings` logo (inferred: stored under the account prefix, R1 §2.6).
5. Surfaces: recipient page header only.
6. Permissions and audit: owner or admin writes settings (R4 §9 pattern for `embed_origins`); audit as other settings (R3 §6).
7. Dependencies: object storage signed reads (R1 §2.6); design tokens (ADR-0033, proposed); Q-21 (merchant UI brand, not the recipient page).
8. Metrics: none.
9. Market and chosen shape: Shipday offers logo, colours and branded links (FC-R S14); Torod and Wasal as above. Chosen: adapt, a logo and colour setting on the page only, Arabic and English, no logo in WhatsApp text. Reason: FC-R and P3 propose it; R1 §5.1 forbids it today, so the owner must rule.
10. Roadmap: missing in wave 1. Options: P3 A4 amends WEB-8 (wave 1); FC-C proposes WEB-20 (wave 4). Owner: CH5-13.

### F17. Language choice

1. Definition: the language of messages and the recipient page. The recipient's `preferred_language` is `ar` or `en` (R12 line 247; R2 §3.1).
2. Workflow: the template uses the recipient's `preferred_language`, else the account default locale (R1 §5.1; R14 §2.2). The page uses `?lang=`, else the account default, else `ar`, and sends `Accept-Language` (R4 §5). No rule links the two.
3. Rules and edge cases: Arabic default; RTL; Gregorian dates and Western digits (ADR-0016; R4 §5). The page does not read the order's `preferred_language` (inferred from R4 §5). Who sets `preferred_language` at intake, and from which channel, is not stated (CH5-14). Languages beyond ar and en are a separate open decision for the driver app (FC-C section 2 item 2).
4. Data: `preferred_language` on the order recipient (R2 §3.1); `locale` on each message row (R14 §2.2).
5. Surfaces: page toggle; WhatsApp template language; dates on the page.
6. Permissions and audit: staff edit recipient fields before pickup (R11 line 451).
7. Dependencies: `packages/i18n` parity test (ADR-0016; R14 §2.8).
8. Metrics: messages per locale (`messages_sent_total{template, locale}`, R1 §10); page language switches (none defined).
9. Market and chosen shape: Onfleet branding and messages (FC-R S15, languages not confirmed). Wasal's app is Arabic default with English strings and its marketing site is Arabic only (P2 §1, §2.10). Chosen: own (ADR-0016), stronger than the sample.
10. Roadmap: partial. INT-3 and WEB-8 cover ar and en; the intake default and the page link to the recipient's language are missing (CH5-14).

### F18. Recipient data protection and retention

1. Definition: rules for recipient personal data (name, phone, address and point, proofs, messages, tokens, inbound payloads): storage, logging, retention and erasure (R5 §10; R1 §11).
2. Workflow: one recipient's erasure request redacts the mutable recipient columns in place (R5 §10). Account closure: export, then purge (Q-38 proposes 90 days with export, R15 §4). No request workflow exists in the roadmap; PDPL-1 is proposed for wave 1 exit (FC-C section 2 item 4).
3. Rules and edge cases: recipient records live for the life of the account (Q-37, R5 §10). Proof files two years after terminal (R5 §10). Inbound payload bodies 30 days, then deleted (R5 §10). OTP rows: deleted an hour after done (R5 §10), but ADR-0041 default 4 keeps verification text sealed in the engine for up to seven days until a purge option exists (R8 decision 4). These conflict (CH5-16). Logs keep the last four digits of a phone and redact address text (R1 §11). PDPL: the consultation draft and localisation claims come from secondary sources that disagree (R18 §PDPL row; FC-C section 2 item 4); the statute was not read (CH5-15). Quiet and weekend rules do not apply here.
4. Data: the table in R5 §10, with a `pii:` comment on each column (R5 §10).
5. Surfaces: platform export and deletion tools on `elx_maintenance` (R5 §10); audit rows kept with ids and no personal data (R5 §10).
6. Permissions and audit: platform only; recipients have no access or erasure door (gap, inferred from R3 §1, which lists no recipient request).
7. Dependencies: the engine purge option, asked of eeasynew (R8 decision 4; R15 A-25); backups expire after 35 days (R5 §10); Sentry and PostHog scrubbing (R4 §9).
8. Metrics: request count and time to erase (none defined; FC-C proposes a 30-day clock).
9. Market and chosen shape: Torod states no fixed retention, shares with unnamed third parties and gives no breach timeline (P3 §4); Wasal's privacy page returns the landing page and it keeps driver location with no retention statement (P2 §4.4); Wasal sells history by tier of 30 days, one year or five years (P2 §5, "Data history by tier" row, "not a feature to copy"). Chosen: own. The R5 §10 table is stricter than the sampled market. Reason: ledger and proof rules (R5 §3, R5 §10).
10. Roadmap: partial. R5 §10 defines retention; no order builds erasure, request handling or the OTP rule. Owner: Q-37, Q-38 (provisional), CH5-15, CH5-16.

## 3. Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| F1 Tracking tokens | Partial | DEL-8 | 1 | CH5-1 |
| F2 Tracking page and embed | Partial | WEB-8 | 1 | Q-20 |
| F3 Live map while out for delivery | Covered | WEB-8, DEL-5 | 1 | Q-19; CH5-4 |
| F4 ETA and queue position | Partial | INT-6, DEL-8 | 2 (ETA); queue position missing | Q-18; CH5-2 |
| F5 WhatsApp templates and approval | Partial | INT-3, INT-7 | 1, 2 | Q-27; CH5-3 |
| F6 Quiet hours | Covered | INT-7 | 2 | CH5-4 |
| F7 Caps | Covered | INT-3 | 1 | CH5-5 |
| F8 Opt-out and stop words | Partial (no inbound order) | INT-3 | 1 | CH5-6; CH5-4 |
| F9 Monthly budget | Partial | INT-3 | 1 | CH5-7; Q-33 |
| F10 SMS fallback | Missing by ADR-0037 | none | 3 or later | CH5-8 |
| F11 Reschedule and address pin | Covered | DEL-14, WEB-11, INT-7 | 2 | Q-20 |
| F12 Delivery instructions | Missing (proposed DEL-19) | none | 2 (proposed) | CH5-9 |
| F13 Recipient OTP at the door | Partial (kind only) | DEL-7; DRV-8 proposed | 1 kind; 2 capture (proposed) | CH5-10 |
| F14 Ratings and feedback | Missing (proposed DEL-29) | none | 3 or 4 (proposed) | CH5-11 |
| F15 Recipient return requests | Partial | DEL-18 | 4 | Q-4; CH5-12 |
| F16 Branded tracking | Missing (WEB-8 logo or WEB-20 proposed) | none | 1 or 4 (proposed) | CH5-13 |
| F17 Language choice | Partial | INT-3, WEB-8 | 1 | CH5-14 |
| F18 Data protection and retention | Partial (table only) | none | 1 (exit) | Q-37, Q-38; CH5-15, CH5-16 |

## 4. Source list

Repo sources, read 2026-11-02 at `origin/main` `b58760d` in worktree `feature-book-05-recipient`:

- R1 `docs/architecture/integrations.md` §1, §2.4, §2.6, §3.2, §4.3 to §4.5, §5.1 to §5.6, §6.2, §10, §11.
- R2 `docs/architecture/domain-model.md` §3.1, §3.10, §3.12, §3.13, §6.3, §9 (Q-6), D-3, D-14, D-24.
- R3 `docs/architecture/identity-and-tenancy.md` §1, §2, §3.2, §3.5, §6, §7, §9.
- R4 `docs/architecture/web.md` §5, §9, §10.4, §12.
- R5 `docs/architecture/data.md` §2.1, §3, §10.
- R6 `docs/architecture/driver-app.md`, proof capture paragraph (the `recipient_otp` rule), order detail paragraph.
- R7 `adr/0037-messaging-templates-only-no-sms-before-wave-3.md` (status: proposed, 2026-10-31).
- R8 `adr/0041-messaging-through-the-eeasy-whatsapp-engine.md` (status: proposed, 2026-11-01).
- R9 ADR status checks: `adr/0009` accepted; `adr/0028` proposed; `adr/0039` accepted (2026-11-01); `adr/0040` accepted (2026-11-01); `adr/0016` accepted; `adr/0017` accepted.
- R10 `docs/contracts/openapi/recipient.yaml` (all operations and descriptions).
- R11 `docs/contracts/openapi/staff-delivery.yaml` lines 451 (order edit), 1037 to 1074 (tracking tokens), 1229 to 1236 (issue request).
- R12 `docs/contracts/openapi/components.yaml` lines 247 (`preferred_language`), 556 (`OrderStatus`), 903 (`TrackingToken`), 913 (`PublicTrackingView`).
- R13 `docs/contracts/README.md` §2 (permissions), §6 (SSE rules), rate-limit table.
- R14 `docs/orders/INT-3/plan.md` §1, §2.1 to §2.8, §6, §7.
- R15 `docs/roadmap.md` §0, §1 rows (INT-3, INT-6, INT-7, DEL-5, DEL-7, DEL-8, DEL-9, DEL-14, DEL-18, DRV-4, DRV-7, WEB-3, WEB-5, WEB-6, WEB-8, WEB-11), §2 (wave 0 and 1 exit boxes, wave 2 box), §4 (Q-4, Q-5, Q-6, Q-18, Q-19, Q-20, Q-21, Q-27, Q-33, Q-37, Q-38, Q-39, Q-42), §5 (A-24, A-25).
- R16 `docs/research/whatsapp-engine-2026-11.md` (on `main`; summary items 1 to 6, §1, §2.2).
- R17 `docs/research/provider-facts-2026-10.md` §7 (Meta template review; its reads dated 2026-10-31).
- R18 `docs/research/whatsapp-providers-2026-10.md` (template approval, opt-out and PDPL rows; its reads dated 2026-10).

Branch research, read 2026-11-02 with `git show`:

- FC-R `origin/docs/feature-coverage:docs/research/features-recipient-cash-returns-2026-11.md` (source ids S9, S14 to S17, S39, S40 are in its registry; summaries and search-only rows are marked there).
- FC-C `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` §1 to §4.
- P1 `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` §2, §4, §5.
- P2 `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md` §1, §2.4, §2.5, §2.7, §2.10, §4.2 to §4.4, §5 ("Data history by tier" row), §6.
- P3 `origin/docs/platform-teardowns:docs/research/teardown-torod-2026-11.md` §2, §3, §4, §5 rows 9 to 13 and 30, §6 (A4 to A6).
- P4 `origin/docs/platform-teardowns:docs/research/teardown-logestechs-2026-11.md` §2, §3, §5.

External, read 2026-11-02:

- W1 Legal 500 summary of CITC Decision 395/1439 (2018), fetched through WebFetch: https://www.legal500.com/intelligence/saudi-arabia/media-telecoms-it-entertainment/kingdom-of-saudi-arabia-introduces-anti-spam-regulations (a secondary summary; the article gives no hours and no unsubscribe deadline).
- W2 Search results on Saudi messaging hours and opt-out, vendor and aggregator guides, not opened: https://d7networks.com/sms/saudi-arabia/sms-regulations/ ; https://support.wavecell.com/hc/en-us/articles/900003333866-SAUDI-ARABIA-SMS-Products-and-Compliance ; https://docs.unifonic.com/docs/compliance-sms . Tamimi's page redirected and was not read.
- W3 Search results on the Saudi weekend change, the Royal Order of 23 June 2013 effective 29 June 2013, not opened: https://www.crowell.com/en/insights/client-alerts/saudi-arabia-changes-weekend-to-friday-saturday-from-29-june-2013 ; https://www.arabnews.com/news/455923

## 5. Unanswered

CH5-1. Who issues the track link and when: staff on request (the contract as written), or automatically at assignment or out for delivery (the template needs it)?
CH5-2. Wave 1 ETA: a slot window, an interim estimate, or none until INT-6? Is queue position a wave 2 mode?
CH5-3. Under ADR-0041, do the wave 0 and wave 1 exit boxes ("approved") and integrations §2.4 and §5.2 change, and who rewrites INT-3's plan §1 and §6?
CH5-4. Counsel: classify the four service templates against CITC Decision 395/1439 and the CST text; confirm the 22:00 to 08:00 window, the 24-hour stop clock, and the Friday, Saturday and holiday calendar. No primary text was read.
CH5-5. Ratify the caps (6 per order, 10 per phone per day). Do attempts count toward the order cap?
CH5-6. Who builds the inbound WhatsApp callback door (delivery status, replies, STOP and START)? No roadmap row owns it.
CH5-7. Default `messages_per_month`: 3,000 (INT-3 plan) or the profile in integrations §5.6 (about 45,000 a month)?
CH5-8. Accept SMS before wave 3 for recipients without WhatsApp (FC-R unanswered 1)?
CH5-9. Delivery instructions and access codes: which wave, and which retention class for access codes?
CH5-10. Recipient OTP: which wave; is its code exempt from opt-out and caps like driver OTP; may a merchant require it?
CH5-11. Ratings: is a feedback survey transactional or marketing under PDPL; wave 3 (FC-R) or wave 4 (FC-C)?
CH5-12. Recipient return requests: pull part of DEL-18 forward from wave 4 (FC-C DEL-28)?
CH5-13. Branded tracking: logo and colours on the page in wave 1 (P3 A4) or wave 4 (FC-C WEB-20)? Never in WhatsApp text?
CH5-14. Who sets `preferred_language` at intake, and should the page read it instead of the account default?
CH5-15. PDPL: the statute (not read) on controller or processor status for recipient data, the retention basis, the PDPL-1 scope, and whether driver location shown to recipients needs a notice.
CH5-16. OTP retention: data §10's one-hour rule against ADR-0041's default 4 (engine keeps verification text up to seven days until a purge option exists).
CH5-17. GCC: which recipient rules differ in Bahrain, Kuwait, Oman and the UAE (weekend, currency, messaging law)? Not researched; outside wave 1 KSA scope.
