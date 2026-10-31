# Error codes

Part of foundation document 3 (`README.md` §4). Every non-2xx response is `{ "code", "message", "details"?, "request_id" }` (handbook 04, plan 2.4). `code` is stable: it is never renamed or reused for another meaning; a new situation gets a new code (additive, README §2). `message` is localised by `Accept-Language`. Invariant numbers refer to `docs/architecture/domain-model.md`; "doc 4" is `identity-and-tenancy.md`.

## 1. Common (every surface)

| Code | HTTP | When | Enforces |
|---|---|---|---|
| `validation_failed` | 400 | body or parameter fails the schema; `details.fields[]` holds `{ pointer, code, message }` | contract schemas; D-4 (non-negative halalas) |
| `idempotency_key_required` | 400 | a retryable write without `Idempotency-Key` | K-8, README §3 |
| `idempotency_key_reused` | 422 | same key, different request hash within 24 h | K-8 |
| `unauthenticated` | 401 | no credential, bad signature, credential of another surface | doc 4 §4 |
| `token_expired` | 401 | access JWT, invite, reset or recipient token past `expires_at`; the client refreshes or asks for a new link | doc 4 §3.1, §3.5, §4 |
| `token_invalid` | 401 | unknown, used or revoked one-time token; reuse of a rotated refresh token also revokes the family | doc 4 §3.1, §4 |
| `forbidden` | 403 | the principal lacks the operation's `x-permission` or the site is outside its `site_ids` | doc 4 §2 |
| `feature_not_enabled` | 403 | the module or feature is `off`, or `allowlist` without the account flag | K-6, ADR-0006 |
| `account_suspended` | 403 | any write, refresh or API key call on a suspended account | K-2 |
| `not_found` | 404 | no such resource in the caller's account; also returned for another account's id, for a site outside the member's `site_ids`, and for orders and offers that are not on the driver's run | K-3, ADR-0025 |
| `version_required` | 428 | dispatcher write to Order or Assignment without `If-Match` | D-22 |
| `version_conflict` | 409 | `If-Match` differs from the current `version`; `details` holds `current_status`, `version` | D-22 |
| `invalid_transition` | 409 | the arrow is not in the state machine or not for this actor, or the aggregate is terminal; `details` holds `current_status`, `version` | D-5, D-8, §3.14 to §3.17, §4.11 to §4.15 |
| `secret_already_issued` | 409 | replay of an operation that returned a one-time secret (API key, webhook secret, tracking link); `details.resource_id` names the resource, the secret is not returned again | README §3, doc 4 §3.4 |
| `limit_exceeded` | 422 | an account limit (orders per month, drivers, sites, API keys) is reached | §2.1 limits |
| `rate_limited` | 429 | route budget spent; `details.retry_after_s` and `Retry-After` | doc 4 §8 |

## 2. Authentication and devices

| Code | HTTP | When | Enforces |
|---|---|---|---|
| `role_combination_forbidden` | 422 | a membership would combine `driver` with a role holding a cash permission | doc 4 §2 (separation of duties) |
| `invalid_credentials` | 401 | wrong email or password; same body and timing for unknown and disabled users | doc 4 §8 |
| `second_factor_required` | 401 | password accepted and a factor is pending; also on `select-account` or `switch-account` when the target account requires a factor the session's `amr` lacks; `details.challenge_id` | doc 4 §3.1, §3.3 |
| `reauthentication_required` | 401 | second-factor or TOTP enrolment without a password step in the last 5 minutes | doc 4 §3.1, §3.3 |
| `second_factor_already_enrolled` | 409 | enrolment when a phone second factor or TOTP is already enrolled; changing it needs an owner, admin or super admin reset | doc 4 §3.1, §3.3 |
| `otp_invalid` | 401 | wrong, expired or used OTP or TOTP, a code or challenge past 5 attempts or 5 minutes, or a disabled driver; one code for all so the door leaks nothing | doc 4 §3.2, §3.3 |
| `device_limit_reached` | 409 | a third active device for a driver | doc 4 §3.2, §3.5 of document 2 |
| `device_revoked` | 401 | refresh from a revoked device | doc 4 §3.2 |
| `app_update_required` | 426 | `X-App-Version` below the `min_app_version` for `X-App-Platform` (proposed, document 8 open question 5); usable on every driver operation except the outbox-replay routes (order events, proof upload and confirm, `/locations`, shift pause, resume, end); not a security control | document 8 |
| `cash_pin_invalid` | 403 | wrong cash PIN on `cash-pin/verify`, a handover request, a PIN change, or a live cash `delivered` event (no other authenticated call from the device after `client_ts`); not stored under the Idempotency-Key; every failure, including one found at replay, counts toward the lock | doc 4 §3.2 |
| `cash_pin_locked` | 423 | five PIN failures; cash actions locked until a dispatcher resets; a replayed field fact is still recorded and the driver is `cash_blocked` | doc 4 §3.2, D-23 |

## 3. Delivery

| Code | HTTP | When | Enforces |
|---|---|---|---|
| `outside_coverage` | 422 | accepting, offering or assigning an order whose point is in no zone covered by its site; the order stays `pending` with `pending_reason` | D-3, ADR-0015 |
| `cod_not_allowed` | 422 | non-zero `cod_amount` on kind `return_pickup` or `pickup_request` | D-4 |
| `order_locked` | 409 | editing items or recipient after `picked_up` | §3.2 |
| `driver_cash_blocked` | 422 | offer or assignment to a driver holding cash from a previous business day | D-11, D-12 |
| `driver_not_eligible` | 422 | driver not `active`, no active shift with a vehicle, or site does not cover the zone | D-12 |
| `capacity_exceeded` | 422 | the driver's `active_orders` would exceed `limit` | D-10 |
| `driver_not_assignee` | 403 | an event from the order's former assignee that D-23 does not save; orders never on the driver's run are `404 not_found` | D-6, D-23 |
| `shift_not_active` | 409 | driver transition or location batch outside an `active` or `paused` shift; shift action from the wrong shift state | D-6, §3.17 |
| `offer_expired` | 409 | accepting an offer past `expires_at` | §3.14 |
| `offer_withdrawn` | 409 | accepting an offer after another driver won or the dispatcher withdrew it | D-13 |
| `proof_required` | 422 | `delivered` without the proofs the account's proof policy needs | D-7 |
| `cod_amount_mismatch` | 422 | `delivered` with collections that do not sum exactly to `cod_amount` | D-7 |
| `method_not_allowed_for_cash` | 422 | a card, mada or wallet collection added to a handover or deposit | D-18 |
| `client_ts_out_of_range` | 422 | driver event `client_ts` before the assignment started, after `min(server_ts, assignment.ended_at + offline window)` (default 12 h) | D-6, D-23 |
| `stale_driver_event` | 409 | driver event superseded by a dispatcher change and D-23 does not apply; shown on the sync screen | D-16 |
| `collection_not_eligible` | 422 | a handover or deposit lists a collection that is not the driver's own, not cash, not in the expected custody, or already in another open handover or deposit | D-18, D-19 |
| `deposit_sum_mismatch` | 422 | deposit `amount` differs from the sum of its collections | D-19, D-21 |
| `method_not_allowed` | 422 | a collection method outside the account `allowed_cod_methods`, or a non-cash collection without `external_reference` | D-18, ADR-0017 |
| `upload_mismatch` | 422 | proof or slip confirmation whose stored object is missing or whose `sha256` differs | §3.10, D-17 |
| `slot_not_available` | 422 | a chosen slot is outside the order's site and zone, or its day is closed | §3.9 |
| `slot_full` | 409 | booking a slot with `booked = capacity` or on a closed slot day | §3.9 |
| `handover_amount_required` | 422 | confirming a handover without `counted_amount` | D-20 |
| `cash_report_unbalanced` | 409 | closing a report while a cash collection of the day is still `collected` or a difference has no liability entry | D-21 |
| `site_in_use` | 409 | deactivating a site with open orders, unsettled cash or stock on hand | K-5 |
| `site_kind_mismatch` | 422 | a Delivery reference to a `warehouse` site or a WMS location on a `branch` site | K-4, W-1 |

## 4. WMS

| Code | HTTP | When | Enforces |
|---|---|---|---|
| `location_tree_invalid` | 422 | parent on another site, a cycle, a tote inside a tote | W-1, W-2 |
| `tracking_mode_locked` | 409 | changing `tracking_mode` after the first movement | W-3 |
| `tracking_mode_mismatch` | 422 | lot or serial given or missing against the product's mode; serial quantity other than 1 | W-4 |
| `insufficient_stock` | 409 | a movement would take `on_hand` below zero, or allocation above `available` | W-6, W-8 |
| `approval_required` | 422 | receiving above PO tolerance, or a count variance or adjustment above threshold, without an approver | W-15, W-16 |
| `separation_of_duties` | 403 | the approver is the counter or the requester | W-16, doc 4 §2 |
| `package_not_measured` | 422 | choosing a fulfilment method before weight and all three dimensions are above zero | W-10 |
| `method_change_forbidden` | 409 | a second method while one is active, or any change after `handed_over` | W-13 |
| `store_already_connected` | 409 | the channel store (`external_store_id`) is already connected to another account; refused at the OAuth callback | document 9 §3.1 |
| `channel_credentials_invalid` | 422 | the Eeasy shipping API key failed validation when connecting | document 9, ADR-0014 |
| `carrier_unavailable` | 503 | Eeasy shipping is not configured for the account; the request is not queued | W-12, ADR-0014 |

`outside_coverage` (above) is also returned when `own_fleet` is chosen for an address `CoverageQuery` does not cover (W-11).

## 5. Public API, webhooks and platform

| Code | HTTP | When | Enforces |
|---|---|---|---|
| `api_key_revoked` | 401 | revoked or rotated-out key past its overlap window | doc 4 §3.4 |
| `webhook_url_invalid` | 422 | subscription URL is not `https` on port 443, or is a literal or resolved address in a refused class; reachability is checked later through the outbox, not here | ADR-0030 |
| `verification_token_invalid` | 422 | wrong or reused subscription verification token | ADR-0030 |
| `reason_required` | 400 | cross-tenant platform call without `X-Support-Reason` | doc 4 §5, §7 |
| `rollout_change_forbidden` | 403 | a platform admin (not super admin) changing a rollout mode | §2.4, doc 4 §2 |
| `replay_not_allowed` | 409 | replaying an outbox row that is not `dead` | K-10, K-11 |
| `fix_not_whitelisted` | 403 | a diagnose fix not marked safe for the caller's role | doc 4 §2 |
