# Adversary review of the API contracts

Part of foundation document 3. Date: 2026-10-31. One security review pass (`adversary`) of `docs/contracts/` returned 4 high, 11 medium and 10 low findings, no critical, plus 3 gaps it could not assess. Each is listed with its outcome. Owner points that came out of the fixes are in `README.md` §12.

| Id | Finding | Outcome |
|---|---|---|
| H1 | D-23 trusted `client_ts` | fixed: `client_ts` bounded to the assignment window plus an offline window (account setting `offline_window_hours`, default 12); D-23 refused when the device made an authenticated call after the reassignment; collection business date is `min(client_ts, server_ts)`; `422 client_ts_out_of_range` (`driver.yaml` `driverPostOrderEvent`, `errors.md`) |
| H2 | Cash PIN at replay | fixed under document 4 §3.2, no ADR: `cash_pin` required with any cash collection (schema `if/then`); every failure counts toward the lock; online at the door a wrong PIN is refused (`403 cash_pin_invalid`, `423 cash_pin_locked`); on replay the fact is recorded and the driver is `cash_blocked`; `pin_review` only in `StaffCodCollection`; the PIN is never persisted, hashed or logged. The 120 s online window is a proposal (README §12.2) |
| H3 | Webhook scope | fixed: event type → read permission table, checked at create, update and every delivery; `created_by_key_id` and `created_by_membership_id`; `paused` with `paused_reason` on key revocation, scope loss or member revocation; `delivery.proofs.read` and `wms.receipts.read` are allowed key scopes (`webhooks.md` §4, README §11) |
| H4 | Secrets in the idempotency store | fixed: the seven secret-bearing operations store the response without the secret; a replay returns `409 secret_already_issued`; named in README §3 |
| M1 | SSE outlived credentials | fixed: streams close on token expiry, member or device revocation and suspension; recipient stream re-checks the token row every 60 s (README §6, ADR-0029) |
| M2 | Webhook SSRF | fixed: port 443, resolve once and connect to the checked IP, no redirects, extended deny list, reachability and verification through the outbox, fixed `error_class` in the log, 5 creates or URL changes per hour (`webhooks.md`, `errors.md`, ADR-0030, README §7) |
| M3 | Platform reads without a reason | fixed: `X-Support-Reason` and `x-cross-tenant` on outbox, publication and audit reads and bulk replay; outbox lists without `account_id` return metadata only |
| M4 | Cash races | fixed: handover collections must be the driver's own, cash, `collected` and in no other open handover; row locks on confirm and deposit; deposit sum and reversal rules; `collection_not_eligible`, `deposit_sum_mismatch` |
| M5 | Liability entries | fixed: reason enum, `handover_id` or `reference`, negative entries approved by the caller who is not the handover's cashier (`403 separation_of_duties`), audited |
| M6 | Non-cash collections | fixed: `external_reference` required for card, mada and wallet; `allowed_cod_methods` setting; `method_not_allowed` |
| M7 | `cod_amount` edits | fixed: locked from `picked_up` (`409 order_locked`), every change audited |
| M8 | Uploads | fixed: write-once tickets with `upload_id`, size, content type and sha256 bound, 10-minute expiry; proof upload only while `pending_upload`; ownership 404; server-chosen keys; `slip_upload_id`; reads from a separate domain as attachments |
| M9 | Member roles | fixed: `StaffRole` without `driver`; only the owner grants or removes `owner`; `role_combination_forbidden` |
| M10 | Offer leaked the order | fixed: `Offer.order` is `OfferOrderView` until acceptance |
| M11 | Code brute force | fixed: 5 attempts per code or challenge, 5-minute challenges, used TOTP codes refused (README §3) |
| L1 | 403 leaked existence | fixed: 404 off the driver's run and outside `site_ids`; `driver_not_assignee` only for a former assignee |
| L2 | Stream and tracking exposure | fixed: `ReducedEnvelope`; tracking history is status and time only; proposed D-24 wording in README §12.5 for the lead to apply to document 2 |
| L3 | Recipient reschedule and token checks | fixed: slot must be in the order's site and zone (`slot_not_available`); purpose → permission mapping and per-request revocation check in `recipient.yaml` |
| L4 | Token leakage | fixed: `Referrer-Policy: no-referrer`, query strings excluded from logs (README §6) |
| L5 | Proof scope for keys | fixed by H3 |
| L6 | Driver dedupe | fixed: replay must match principal and request hash, else `idempotency_key_reused` |
| L7 | PIN in logs | fixed by H2 |
| L8 | Password length | fixed: `maxLength: 256` on every password field |
| L9 | Coverage ids from another account | fixed: `platformProvisionCoverage` requires every id in the path account (404) |
| L10 | Verification token at rest | fixed: stored as a SHA-256 hash (`webhooks.md`, ADR-0030) |
| G1 | Choosing the account | fixed: `account_selection_required` login response with a selection token, `POST /auth/select-account`, `POST /auth/switch-account`; the `acc` claim comes only from these |
| G2 | Second-factor enrolment | fixed: staff `second-factor/enrol` and `/confirm`; platform invitation accept, `totp/enrol`, `totp/confirm`, super-admin TOTP reset; enrolment only within 5 minutes of the password step and only when none is enrolled (`reauthentication_required`, `second_factor_already_enrolled`) |
| G3 | Who holds which permission | fixed: role bundle table in README §11 (proposed, for the owner to confirm with document 4) |

## Second pass

The second adversary pass verified 25 of 28 fixes as complete (the 3 gaps included), found 5 partial (M4, M8, M10, G1, G2) and raised 12 new findings on the new surface. Partial items are closed by the new findings named.

| Id | Finding | Outcome |
|---|---|---|
| G1 (partial) | account choice skipped factors | closed by N1 |
| G2 (partial) | enrolment needed a stricter session | closed by N2 |
| M10 (partial) | offer stream and push still carried the order | closed by N4 |
| N1 (high) | select-account and switch-account skipped the target account's second factor | fixed: the session records `amr`; `select-account` and `switch-account` return `401 second_factor_required` with a challenge when the target account needs a factor the session lacks; memberships are listed only after every factor any of the user's accounts requires (README §1, `staff.yaml`) |
| N2 (medium) | enrolment from a full session; no member reset | fixed: enrolment only with a 10-minute enrolment token from login or a redeemed re-enrolment link; `resetMemberSecondFactor` (owner or admin, not on oneself, emailed link, member notified); `redeemEnrolmentLink` needs link and password; a super admin cannot reset their own TOTP and the user is notified |
| N3 (medium) | channel OAuth state and store takeover | fixed: single-use state nonce bound to account, member and connection, 10 minutes, PKCE where offered; `409 store_already_connected`; no connection from an install webhook without a pending state (README §1, `createChannelConnection`) |
| N4 (medium) | offered event payload | fixed: `OrderOfferedPayload` with `OfferOrderView` only, on the driver stream and in push payloads (`components.yaml`, `driver.yaml`, README §6) |
