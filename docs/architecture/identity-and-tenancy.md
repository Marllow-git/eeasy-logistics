# Identity, tenancy and authorization

Foundation document 4. Date: 2026-10-31. Status: for owner review. Governed by ADR-0006 (allowlist rollout), ADR-0023 (own identity), ADR-0025 (structural tenancy); informs the contracts document (3) and the data architecture (5).

## 1. Actors

| Actor | Belongs to | Signs in with | Surface |
|---|---|---|---|
| Platform staff (super admin, admin, support) | the platform | email + password + mandatory TOTP | web, admin area |
| Merchant staff (owner, admin, dispatcher, site staff, warehouse staff, cashier, viewer) | one account | email + password, optional phone OTP second factor | web |
| Driver | one account | phone OTP over WhatsApp, device-bound; PIN for cash actions | driver app |
| Integrator | one account | API key | public API |
| Recipient | an order | no sign-in; signed per-order token in a link | public pages |

A **user** row is a person; a **membership** binds a user to one account with one role set. The same person can belong to several accounts (a consultant, a franchise owner); platform staff have no membership and act cross-tenant under audit (section 6).

## 2. Roles and permissions

Permissions are flat strings `<module>.<resource>.<action>`, for example `delivery.orders.read`, `delivery.orders.dispatch`, `delivery.cash.receive`, `wms.movements.write`, `platform.accounts.provision`. A **role** is a named bundle of permissions. Roles are system-defined in wave 0; account-defined custom roles are a later order and need no schema change beyond a `custom` flag.

| Role | Scope | Holds, in short |
|---|---|---|
| owner | account | everything in the account, including billing and member management |
| admin | account | everything except billing and owner transfer |
| dispatcher | account | orders, dispatch, drivers, zones, slots; read cash |
| site staff | account, restricted to assigned sites | receive, hand over, accept and reject at their sites |
| warehouse staff | account, restricted to assigned sites | inbound, picking, packing, counting at their sites |
| cashier | account, restricted to assigned sites | receive cash handovers, record deposits; never dispatch |
| viewer | account | read-only |
| driver | account | the driver API only; never the web app |
| platform super admin | platform | rollout modes, feature switches, account provisioning, role grants to platform staff |
| platform admin | platform | provisioning, account enable and suspend, support tools; cannot change rollout modes |
| platform support | platform | read any account, run the diagnose console fixes that are whitelisted as safe |

Site restriction is data, not a role: a membership carries `site_ids`; site-scoped permissions are evaluated against it. Separation of duties the ledgers need: the role that confirms a cash handover (cashier) is never the role that holds the cash (driver), and no single role may both approve and record a stock adjustment above a per-account threshold (a wave 3 setting).

## 3. Authentication flows

### 3.1 Merchant staff
- Invitation: an owner or admin invites by email; the invite is a one-time token valid 72 hours; accepting sets the password and creates the membership.
- Password: Argon2id, minimum 12 characters, breached-password check against a local k-anonymity list; no composition rules.
- Second factor: phone OTP over WhatsApp, optional per user, enforceable per account by the owner.
- Reset: email link, one-time token valid 30 minutes, invalidates all sessions on success.

### 3.2 Drivers
- Phone number normalised to E.164 before anything else (two formats of one Saudi number must share one budget: an eeasynew hardening finding).
- OTP: six digits, valid 5 minutes, single use enforced by a row lock on verification so two concurrent verifications cannot both succeed; resend cooldown 60 seconds; budget 5 requests per phone per hour and 20 per IP per hour; an invalid code and a disabled account return the same `otp_invalid` so the login door leaks nothing.
- Device binding: the app sends a device id and a push token at verification; the refresh token is bound to the device row; an account's driver may have at most two active devices; a dispatcher can revoke a device.
- Cash PIN: four to six digits, Argon2id, required for recording a COD collection and for confirming a handover request; five failures lock cash actions until a dispatcher resets.
- Shift: a driver session is distinct from a shift; going on shift records the vehicle and starts position reporting; going off shift stops it. Tokens survive shift changes.

### 3.3 Platform staff
Email + password + TOTP, no exceptions. Sessions expire after 12 hours idle. Super-admin rights are granted by another super admin and recorded in the audit log.

### 3.4 Integrators
API keys are per account, created by an owner or admin, shown once, stored as a SHA-256 hash with a public prefix for identification, scoped to a permission subset, rotatable with an overlap window, and revocable. Keys never grant driver or platform permissions. Usage is counted per key per day.

### 3.5 Recipients
Public pages open through a signed token in the link (HMAC over order id, purpose and expiry). Tracking tokens live until the order closes plus 30 days; address-pin and reschedule tokens are purpose-bound and expire in 48 hours. No account data is reachable from a recipient token beyond the order's public view.

## 4. Tokens and sessions

| Property | Web (staff) | Driver app | Public API |
|---|---|---|---|
| Access token | JWT, 15 minutes, in an httpOnly SameSite=Lax cookie | JWT, 15 minutes, bearer | API key, bearer |
| Refresh token | opaque, 30 days, rotating, httpOnly cookie | opaque, 90 days, rotating, device-bound, secure storage | none |
| Revocation | `token_version` on the user plus refresh-row deletion | same, plus device revocation | key revocation |
| Claims | `sub`, `acc` (account id or null for platform), `mem` (membership id), `roles`, `scopes` hash, `sites`, `ver` | plus `dev` (device id) | key id, scopes |

Refresh rotation: every refresh returns a new token and marks the old one used; reuse of a used token revokes the whole family (theft detection). Access tokens are verified locally by signature; revocation is checked only on refresh and on sensitive actions (cash, member management), which re-read `token_version`.

## 5. Tenancy

- Every operational table carries `account_id` (ADR-0025). A schema test lists the exemptions (platform tables, users, the outbox relay cursor) and fails CI on any other table without the column and an index on it.
- The request context (account id, membership, user, device, acting-on-behalf flag) is resolved once in a NestJS guard from the token and stored in `AsyncLocalStorage`; repositories read it from there and add the predicate. No handler receives `account_id` as input.
- Cross-tenant access exists only for platform staff and is explicit: a platform handler declares `@CrossTenant()` and every call writes an audit row with the target account; the UI shows a visible "acting on account X" banner.
- Row-level security: once the schema is stable (end of wave 1), policies on every operational table using a session variable set by the guard; application predicates stay as the first line.
- Background jobs carry the account id in the job payload and set the same context before any repository call; a job without an account context can touch only platform tables.

## 6. Provisioning, rollout and suspension

- A platform admin creates an account (name, country, default locale, limits), invites its owner, and sets module flags. A module is visible to the account only when the platform rollout mode for that module is `all`, or it is `allowlist` and the account's flag is `enabled` with `provisioned_by` set to a platform user (ADR-0006). Nothing is created on first use.
- Own-fleet coverage is part of provisioning (ADR-0015).
- Suspension cascades: a suspended account's users cannot refresh tokens, its drivers go off shift, its API keys reject, its outbox effects pause. Data is kept.
- Every provisioning, flag, limit, suspension and role change writes an audit row with actor, target, before and after.

## 7. Audit log

Append-only `audit_log`: actor (user or key), acting account, target type and id, action, before and after JSON (redacted of secrets), request id, IP, user agent, timestamp. Written synchronously inside the same transaction for admin and ledger-adjacent actions; asynchronously through the outbox for high-volume reads that must be audited (platform cross-tenant reads). Retained two years; exportable per account.

## 8. Abuse and rate limits

Per-route budgets in Redis keyed by the stable identity (E.164 phone, email, API key id) and secondarily by IP; login and OTP routes return identical timing and bodies for unknown and disabled identities; CAPTCHA is not used for drivers (field conditions) and is reserved for the staff sign-up door if one is opened. Webhook endpoints are signed and replay-protected with a timestamp window and a nonce table.

## 9. Adversary checklist for every auth PR

1. Can a token or parameter name another account's id and be honoured anywhere?
2. Does any 4xx differ between "exists" and "does not exist"?
3. Is every write idempotent under retry and single-use where it must be (OTP, invites, resets)?
4. Does a revoked device, key or member lose access within one access-token lifetime?
5. Is every admin and ledger-adjacent action in the audit log with before and after?
6. Are secrets (keys, OTPs, PINs) stored hashed and never logged?

## 10. Open questions for the owner

1. Mandatory second factor for merchant owners, or optional per account?
2. Maximum active driver devices per driver: two (proposed) or one?
3. Should platform support be allowed to impersonate a merchant user in read-only mode, under audit, for support? Proposed: yes, read-only, time-boxed to one hour, banner shown.
