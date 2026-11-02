# Feature book 12: platform, tenancy, administration and billing

- **Date:** 2026-11-02. **Chapter:** 12 of the eeasy-logistics feature book. **Branch:** `docs/feature-book-12-platform` from `origin/main` 6ca087e.
- **Status:** research note. Proposals only; `docs/roadmap.md` changes after an owner ruling and an amendment row.
- **Labels:** [S] the source states it. [I] my inference from [S] facts. [U] unverified: a search summary, a vendor or a secondary page. [M] from memory, not checked in this session. Source ids (R, T, W, ADR) and their read dates are in the source list at the end.
- **Roadmap state read on 2026-11-02** (R7 §0): merged PLAT-9, PLAT-10 to PLAT-13, WEB-1 to WEB-4, WEB-19, WEB-3 (#109), WEB-4 (#129). OPS-1 waits on the owner (Q-10, Q-12). DEL-2 and DRV-1 are building.

## Summary for the lead

- Covered and merged: tenancy by `account_id`, roles and site scoping, provisioning with rollout modes and flags, suspension, the platform console, staff and platform sign-in, the audit log, the outbox screen, the support-reason banner (R7 §0, R13, R14).
- Missing from the roadmap: every billing feature (plans, trial, subscriptions, invoices, VAT, ZATCA, merchant gateway), self-serve signup, SSO, a status page, and any GCC money model. Q-33 says "pricing before wave 2" but no order carries it (R7 Q-33; T-FC §2 item 3).
- ADR-0017 gates digital COD at the door. It does not cover merchant subscription payments, so the gateway needs its own ADR [I] (R6 §2.9; ADR-0017).
- Money, country and time are CHECK constants (SAR, `SA`, `Asia/Riyadh`). Adding GCC is a one-way migration, so the country, currency and timezone ADR should come before the next money table (R5 §1; R12 §2.1; T-FC §2 item 1).
- A lapse for non-payment should map to a read-only state, not `suspended`, because `suspended` pauses outbox effects and ends driver shifts (R2 K-2; T-WA §2.7).
- Tax records of Eeasy's own invoices (six years, [U]) collide with the 90-day closed-account deletion (Q-38). They need their own retention class (R5 §13 Q2; T-PIC S23).
- Audit export: the roadmap row says "list and export"; PLAT-7 §2.9 defers export to a platform tool in wave 1 (R7 PLAT-7 row; R15 §2.9).
- ZATCA, read today: wave 25 = VAT-subject revenue above SAR 187,500 in 2022 to 2025, integrate by 1 Feb 2027 [S W25]; wave 24 = SAR 375,000 for 2022 to 2024, integrate by 30 June 2026 [U W24]. Eeasy's own wave is unknown (Unanswered 1).
- The coverage note calls the wave 24 and 25 dates a "conflict" (T-PIC §1 ZATCA row). They are two waves with two thresholds, so they do not conflict.

## Scope and method

- Twenty-three features, each with the same ten aspects: 1 definition and goal; 2 workflow; 3 rules and KSA/GCC specifics; 4 data; 5 surfaces; 6 permissions and audit; 7 dependencies and integrations; 8 metrics; 9 market and our shape; 10 roadmap mapping and owner questions.
- Contract counts (R8, R9): `platform.yaml` has 48 operations and `staff.yaml` 51. No contract operation exists for billing, invoices, plans, subscriptions, signup, SSO or status. The contracts README says billing "and owner transfer are not permission strings and stay with the owner" (R11 line 184).
- Teardown facts are cited to the notes; the teardown and coverage notes were read on 2026-11-02 from their branches. Vendor pages were not re-read here except where a source id says so.

## Feature sections

### F1 Multi-tenant accounts and provisioning

- **1 Definition.** An account is the tenant every operational row carries. A platform admin provisions it with name, country, locale, limits and modules, then invites the owner. Goal: a merchant with its own drivers and stock is isolated and onboarded without code (R1 §1, §6; R2 K-1; ADR-0025; ADR-0006).
- **2 Workflow.** States `provisioned → active ⇄ suspended → closed` (R2 §2.1). Happy path: `platformProvisionAccount` (idempotent, one transaction, owner invitation mailed) → owner accepts → activation hook sets `active` (R13 §2.2 to §2.3). Exceptions: an invitation never accepted leaves the account `provisioned`, visible in the console; re-inviting an active owner is `409 invalid_transition` (R14 §2.5; R8).
- **3 Rules and KSA/GCC.** Name 1 to 80 characters, no line break, no `://` (R13 §2.2). `country` CHECK `SA`; `timezone` CHECK `Asia/Riyadh`; default locale `ar` or `en` (R12 §2.1). Limit defaults are provisional: 5,000 orders a month, 25 drivers, 5 sites, 5 API keys (R12 §7 Q1). Own-fleet coverage is part of provisioning (ADR-0015 via R1 §6).
- **4 Data.** `core_accounts` (platform table, no `account_id`): name, country, locale, timezone, status, `limits` jsonb, `settings` jsonb, `provisioned_by`, `closed_at`, `version` (R12 §2.1). Invariant K-1: no account without a provisioning act (R2 §2.1).
- **5 Surfaces.** Console `/accounts` and `/accounts/new` (R14 §2.3). API `platformProvisionAccount`, `platformGetAccount`, `platformUpdateAccount`, `platformInviteOwner` (R8). Merchant `getAccount` (R9). Invitation mail in `ar` and `en` is a census check (R13 §2.12).
- **6 Permissions and audit.** `platform.accounts.provision` and `platform.accounts.read`; merchant `core.account.read` and `core.account.manage` (R8; R9). Audit `core.account.provisioned` and `core.account.updated` with changed fields before and after (R13 §2.10).
- **7 Dependencies.** Invitations and mail (PLAT-11, PLAT-9); outbox event `core.account.provisioned` (R13 §2.2); coverage step (DEL-1; A-9 retag to wave 1).
- **8 Metrics.** Enabled count per module and rollout mode on the admin screens (R7 ADR-0006 consequences). No account totals on the console home by design (R14 §2a, ADR-0029). No sales metric is defined.
- **9 Market and shape.** Onfleet keeps multi-brand and multi-region tiers on Enterprise [S, via T-PIC S14]. Wasal and Torod sign up without sales contact [S, T-WA §2.7; T-TO]. Chosen shape [I]: keep admin provisioning (ADR-0006, ADR-0025, built). Change: country, currency and timezone move from CHECK constants to account and site attributes under the ADR of F19 to F21. This differs from the roadmap.
- **10 Roadmap.** Covered: PLAT-12, PLAT-13, WEB-4 (all merged). Partial: the fixed money and country model (F19, F20). Owner: Q-33 limits (provisional).

### F2 Self-serve signup with approval

- **1 Definition.** A merchant asks for an account itself; a platform user approves before any access exists. Goal: onboard SME merchants without a sales call (T-PIC §1 row).
- **2 Workflow.** Not built. Identity §6 says the platform admin creates accounts; nothing is created on first use (R1 §6; ADR-0006). Proposed: request (name, contact, country, CR number) → platform queue → approve runs PLAT-13 provisioning → owner invitation. Reject sends a reason; no access is granted by a request alone [I].
- **3 Rules and KSA/GCC.** ADR-0006 records the failure that self-enrolled accounts slipped into the allowlist, so no self-activation [S, ADR-0006]. The only CAPTCHA reserved in the identity design is for a staff sign-up door "if one is opened" [S, R1 §8]. Torod's free plan needs only proof of identity [S, T-TO §onboarding]. The CR-number check is [M].
- **4 Data.** None exists. Proposed platform table `core_signup_requests`: contact, name, country, status (requested, approved, rejected), decided_by, decided_at, reason [I].
- **5 Surfaces.** A new console queue (not in WEB-4); a public request form on the marketing site (not planned); mail to the requester [I].
- **6 Permissions and audit.** `platform.accounts.provision` to approve; one audit row per decision with the reason (K-7 pattern) [I].
- **7 Dependencies.** PLAT-13 provisioning, mail, anti-abuse limits (R1 §8 per-route budgets).
- **8 Metrics.** Requests per week, time to decision, approval rate. None defined [I].
- **9 Market and shape.** Torod's low-friction intake [S, T-TO] against ADR-0006's no-self-activation. Chosen shape [I]: borrow the intake, keep the approval gate, build on PLAT-13. This is a new feature; the roadmap has no row.
- **10 Roadmap.** Missing. Proposed with BILL-1 in wave 2 (T-PIC §1 row). Owner: is self-serve wanted at all (T-FC Q8).

### F3 Platform console

- **1 Definition.** The platform staff's application for accounts, rollout, outbox, staff and audit. It is separate from the merchant app so merchant bundles carry no admin routes (ADR-0038). Goal: operate many merchants without exposing the admin surface.
- **2 Workflow.** Sign in (email, password, TOTP) → home with cards for permitted areas and a consumers block → account route with the reason banner → actions. Diagnose console (DEL-15, WEB-12) is wave 2 (R7; R14 §2.2).
- **3 Rules.** Own app and hostname `admin.<domain>`; the edge answers `/v1/platform/*` only there (ADR-0038; R4 §1.2). Arabic default and RTL (R4 §5). No totals anywhere (ADR-0029 as cited in R14 §2a).
- **4 Data.** No new tables. Reads platform tables and cross-tenant views.
- **5 Surfaces.** `apps/admin` routes: `/accounts`, `/rollout`, `/outbox`, `/staff`, `/audit` (R14 §2). API: 48 platform operations (R8).
- **6 Permissions and audit.** `platform.*` strings checked by the PLAT-10 guard; `<Can>` and `useCan()` on `platformGetMe` (R14 §2.1). `X-EL-Client: web` and `Origin` check on writes (R4 §3.3; ADR-0032).
- **7 Dependencies.** WEB-2 session and refresh, WEB-19 scaffold, OPS-1 edge routing; optional IP allowlist at the edge (ADR-0038).
- **8 Metrics.** Consumer lag, parked and dead counts per consumer, bounded (R14 §2.2). No product metrics.
- **9 Market and shape.** WEB-4 §2.4 to §2.5 name the design references (Tailscale, Zendesk, Gumloop); no teardown covers a platform console [I]. Chosen: own application (ADR-0038, ruled 2026-11-01). Billing screens would be a new area in the same app [I].
- **10 Roadmap.** Covered: WEB-19, WEB-4 (merged). Missing: billing, plan, invoice, signup and status screens. Partial: diagnose (WEB-12, wave 2).

### F4 Rollout modes and feature flags

- **1 Definition.** Each module or risky feature has a mode `off`, `allowlist` or `all`, default `allowlist`. Under `allowlist` an account sees a feature only through a per-account flag set by a platform admin. Goal: pilot one merchant without code and without self-enrolment (ADR-0006).
- **2 Workflow.** A super admin sets the mode with a reason of 5 to 500 characters; an admin sets an account flag with a reason. Visibility is resolved by `FeatureGate`; a closed feature answers `403 feature_not_enabled`. An admin without `platform.rollout.manage` gets `rollout_change_forbidden` (R13 §2.5 to §2.6; R8).
- **3 Rules.** K-6 visibility rule (R2 §2.4). Invariant `NOT enabled OR provisioned_by IS NOT NULL` (R13 §2.1). Wave 0 feature keys: `delivery` and `wms`; later orders add `channels`, `api_keys`, `webhooks` (R13 §7 Q1).
- **4 Data.** `core_rollout_modes` (platform, `feature_key` PK, `mode`, `updated_by`); `core_feature_flags` (per account, `enabled`, `provisioned_by`, `enabled_at`, unique key) (R13 §2.1).
- **5 Surfaces.** Console `/rollout` and the account Flags tab (R14 §2.6). API `platformListRolloutModes`, `platformSetRolloutMode`, `platformListFeatureFlags`, `platformSetFeatureFlag` (R8). Merchant navigation reads `Me.features` (R4 §4).
- **6 Permissions and audit.** `platform.rollout.manage` (super admin only); `platform.flags.manage` (admin and super admin). Audit `core.rollout_mode.changed` and `core.feature_flag.changed` with reason; outbox `core.feature_flag.changed` (R13 §2.10).
- **7 Dependencies.** Redis cache keyed by account and feature (R13 §2.5); later orders register their keys.
- **8 Metrics.** Enabled count per mode (R7 ADR-0006 consequences). No per-feature usage metric.
- **9 Market and shape.** Not covered by the teardowns. Chosen shape [I]: keep rollout flags platform-owned and separate from commercial entitlements. A plan limit or paid add-on gets its own `entitlements` record; it must not reuse `core_feature_flags`. This is new and differs from the roadmap.
- **10 Roadmap.** Covered: PLAT-13 (merged #104). Missing: the entitlement split (F14). Owner: none open.

### F5 Suspension and closure

- **1 Definition.** A platform action that stops an account's staff sessions, driver shifts and outbox effects while keeping its data. Closure ends the account; data is kept until the deletion tool runs (R1 §6; R2 K-2; R5 §13 Q2).
- **2 Workflow.** `active → suspended` (reason; staff families revoked; shifts ended; relay holds external effects) → `suspended → active` by reactivation, or `suspended → closed` after the name is typed. Built after fix L-3: `provisioned → closed` is also allowed, with open invitations expired (R13 §8.2 item 62; R14 §2a). PLAT-13 §2.7 still reads suspended-only; the built rule is the reference [I]. A closed account refuses staff doors with `404` and stays readable cross-tenant (R13 §2.7).
- **3 Rules and KSA/GCC.** A suspended account's refresh is refused with `403 account_suspended` and the merchant sees a full-page notice (R4 §3.4). Closure is terminal; no cancel-closure in the console (R14 §7 Q1). Nothing KSA-specific in the sources read.
- **4 Data.** `core_accounts.status` and `closed_at`; outbox rows `core.account.suspended`, `core.account.reactivated`, `core.account.closed` (R13 §2.10). Retention per F22 (Q-38 provisional).
- **5 Surfaces.** Console Suspend, Reactivate and Close dialogs with reason (R14 §2.5); merchant `/account-suspended` page (R4 §1); API `platformSuspendAccount`, `platformReactivateAccount`, `platformCloseAccount` (R8).
- **6 Permissions and audit.** `platform.accounts.suspend`; audit rows with reason, before and after (R13 §2.10).
- **7 Dependencies.** PLAT-8 relay hold (A-23 excludes `internal_event`); PLAT-11 refresh refusal; DEL-5 shift end (R13 §2.7).
- **8 Metrics.** No suspended-account count on screen (ADR-0029). Proposed: closures and suspensions per month [I].
- **9 Market and shape.** Wasal turns an account read-only after a 14-day trial and does not describe suspension [S, T-WA §2.7]. Chosen shape [I]: add a read-only state (or entitlement) for trials and billing lapses, separate from `suspended`, so drivers and the outbox keep running for a late payer. This differs from the roadmap.
- **10 Roadmap.** Covered: PLAT-13, WEB-4. Partial: closure retention (Q-38, provisional). Owner: which lapses suspend and which go read-only.

### F6 Roles, permissions and site scoping

- **1 Definition.** Fixed system roles bundle flat permission strings `<module>.<resource>.<action>`. Site restriction is data: a membership carries `site_ids` (R1 §2).
- **2 Workflow.** An owner or admin invites a member with roles and sites → acceptance → role or site change revokes that member's staff families so new roles apply within one access-token lifetime (R12 §2.7 to §2.8; R1 §4). The last active owner cannot lose `owner`; no one changes their own roles; drivers are not member roles (R12 §2.7 to §2.8).
- **3 Rules and KSA/GCC.** Owner: everything including billing and member management. Admin: all except billing and owner transfer (R1 §2). Cashier never dispatches; separation of duties for stock adjustments is a per-account threshold in wave 3 (R1 §2; Q-17). Custom account roles are not scheduled (R7 §6). No KSA-specific rule in the sources.
- **4 Data.** Membership row: `roles`, `site_ids`, `status`, `version`, `user_id`, `account_id` (R12 §2.7; R2 §2.2).
- **5 Surfaces.** Merchant `/settings/members` and `/settings/sites` (WEB-3, merged). API `listMembers`, `inviteMember`, `updateMember`, `revokeMember`, `resetMemberSecondFactor`, `listSites`, `createSite` (R9).
- **6 Permissions and audit.** `core.members.read|manage`, `core.sites.read|manage`, `core.account.read|manage` (R12 §2.11). Audit `core.member.invited|updated|revoked|second_factor_reset` (R12 §2.12).
- **7 Dependencies.** PLAT-11 invitations and families; PLAT-10 guard; WEB-3 `<Can>`.
- **8 Metrics.** None. Member count is not limited (R12 §7 Q2).
- **9 Market and shape.** Wasal has unlimited members and layouts for admin, dispatcher and distributor; other role names are not published [S, T-WA §2.6]. Torod caps seats at 5 and roles at 3 on its free plan [S, T-TO]. Chosen [I]: fixed roles and unlimited members in wave 0; seat caps are a pricing lever (F14), not a security control. Billing needs a decision: either a `core.billing.*` string (a change to the contracts README rule) or owner-only.
- **10 Roadmap.** Covered: PLAT-10, PLAT-12, WEB-3. Missing: a billing permission (R11). Owner: custom roles (R7 §6, deferred).

### F7 Enterprise SSO

- **1 Definition.** Merchant staff sign in with the merchant's identity provider (SAML 2.0 or OIDC) instead of Eeasy's password and OTP. Goal: larger merchants' IT controls.
- **2 Workflow.** Not built. Own identity: email and password, optional WhatsApp OTP (R1 §3.1). ADR-0023: an "Eeasy sign-in" door may come in wave 4 as an identity provider, never the only path (R7 §6).
- **3 Rules and KSA/GCC.** No Saudi requirement found in the sources read; the census marks buyer demand as unknown [U, T-PIC row]. Account-level enforcement would follow the `second_factor_required` pattern (R12 §2.3) [I].
- **4 Data.** Would need an identity-provider config per account and a federated identity link. None exists; users are platform rows (R1 §1; R2 §2.2) [I].
- **5 Surfaces.** Merchant `/sign-in`; owner settings. No API [I].
- **6 Permissions and audit.** Owner sets the provider; audit each change (K-7) [I].
- **7 Dependencies.** An IdP per customer; the token model (R1 §4) stays; no SAML library chosen.
- **8 Metrics.** None defined.
- **9 Market and shape.** Onfleet offers SAML SSO on Enterprise only [S, T-PIC S14]. ShipHero lists SAML2 SSO [S, T-SH §3.2 security row]. Chosen [I]: keep ADR-0023 and defer; sell SSO as an entitlement once plans exist (F14). Same as the roadmap.
- **10 Roadmap.** Missing by design (R7 §6). Owner: which merchants need it, and at which tier (T-PIC unanswered 9).

### F8 Merchant staff authentication and second factor

- **1 Definition.** Email and password, with an Argon2id hash, 12 characters minimum and a breached-password check. An optional phone OTP over WhatsApp is the second factor, optional per user and enforceable per account by the owner. Goal: quick sign-in for site staff; a second factor for owners who want one.
- **2 Workflow.** Invitation (72 hours, single use) → accept sets the password → sign-in → second factor if required → session. Reset by one-time email link (30 minutes) that ends all sessions. Admin reset of a second factor issues a re-enrolment link (R1 §3.1; R4 §1; R13 §2.10).
- **3 Rules and KSA/GCC.** Access token 15 minutes in an httpOnly SameSite=Lax cookie; refresh token 30 days, rotating; reuse grace 30 seconds (Q-23 provisional; A-3 done) (R1 §4; R7 A-3). Phone numbers normalised to E.164 before anything else (R1 §3.2, driver rule). Saudi mobile numbers are +966 [M].
- **4 Data.** `core_users` (password hash, second-factor phone); one `core_auth_challenges` table for intermediate states (A-26); `core_refresh_tokens` with `surface`, `token_version`, `successor_ciphertext` (R7 A-26). OTP rows deleted 1 hour after expiry (R5 §10).
- **5 Surfaces.** `/sign-in`, `/sign-in/second-factor`, `/sign-in/select-account`, `/password-reset` (R4 §1). API `login`, `requestSecondFactor`, `verifySecondFactor`, `refreshSession`, `logout` (R9).
- **6 Permissions and audit.** Membership-scoped; `core.auth.second_factor_reset` audited (R12 §2.10; R13 §2.9).
- **7 Dependencies.** WhatsApp through eeasynew's `whatsapp-engine` on a new number, `auth_otp` template approval as an OPS-1 staging check (A-25; ADR-0041; R7 §0). A messaging outage blocks second-factor sign-in [I]. TOTP is used for platform staff only (R1 §3.3).
- **8 Metrics.** OTP failure-rate spike alert (R3 §7). Failed sign-ins per account are not defined [I].
- **9 Market and shape.** Not covered by the teardowns. Chosen: as built. Trade-off the sources name: the second factor depends on a messaging provider; TOTP is the alternative for merchants and is not planned [I].
- **10 Roadmap.** Covered: PLAT-11, WEB-2 (merged #83, #91). Owner: Q-7 default is optional per account, enforceable by the owner; mandatory 2FA for owners is open (R1 §10 Q1).

### F9 Platform staff and TOTP

- **1 Definition.** Platform staff (super admin, admin, support) sign in with email, password and a mandatory TOTP code. A super admin invites and grants roles. Goal: strong sign-in for cross-tenant operators.
- **2 Workflow.** Invite (`platformInviteStaff`, one role) → accept → enrol TOTP by QR → sign in with the code. Reset by a super admin (`platformResetStaffTotp`) mails a re-enrolment link → password → enrol again (R13 §2.9; R14 §2.9 to §2.10).
- **3 Rules and KSA/GCC.** TOTP has no exceptions; sessions expire after 12 hours idle (R1 §3.3). One role per staff member in wave 0 (R13 §8.2 item 43). Granting `super_admin` needs a super admin; the last super admin cannot lose the role; a reset is never on oneself (R13 §2.9). No KSA-specific rule.
- **4 Data.** `core_platform_staff`: roles, `revoked_at`, `totp_secret_ciphertext` (AES-256-GCM with key id), `totp_key_id`, `totp_last_step`, `token_version` (R5 §10; R13 §2.9).
- **5 Surfaces.** Console `/sign-in/totp`, `/totp/enrol/[token]`, `/staff` (R4 §1; R14 §2.9). API `platformLogin`, `platformVerifyTotp`, `platformEnrolTotp`, `platformConfirmTotp`, `platformRedeemEnrolmentLink`, `platformListStaffUsers`, `platformInviteStaff`, `platformSetStaffRoles`, `platformResetStaffTotp` (R8).
- **6 Permissions and audit.** `platform.staff.manage`; audit `core.platform_staff.invited`, `roles_changed`, `totp_reset` (R13 §2.10). A staff role change takes no reason (R14 §7 Q3).
- **7 Dependencies.** TOTP key store (secret store, R5 §10); mail through PLAT-9.
- **8 Metrics.** None on screen; no totals (ADR-0029) [I].
- **9 Market and shape.** Not covered by the teardowns. Chosen: as built, in its own app (ADR-0038). Optional edge IP allowlist (ADR-0038).
- **10 Roadmap.** Covered: PLAT-11, PLAT-13, WEB-4. Owner: a reason field for role changes (R14 §7 Q3); multi-role staff is not supported in wave 0.

### F10 Support access with reasons and impersonation

- **1 Definition.** A cross-tenant platform read needs a written reason shown in a banner and audited on every call. Impersonation, acting as a merchant user, is proposed as read-only, one hour, with a banner (Q-9 provisional). Goal: support merchants without their passwords.
- **2 Workflow.** Open the account route → reason dialog (5 to 200 characters in the header) → cross-tenant reads carry `X-Support-Reason` → banner until exit. Body reasons (5 to 500) on suspend, flags, replays (R14 §2.4). Impersonation: not built and no order exists (R7 Q-9 row).
- **3 Rules.** Reason held per tab in `sessionStorage`, keyed by user and account; cleared on exit, sign-out and session end (R14 §2.4; R14 §9 M-1). A duplicated tab inherits the reason (accepted, R14 §9 L-3). Arabic reasons are percent-encoded UTF-8 and format characters are refused (R14 §9 L-1). The platform-wide view is not recorded (R14 §9 L-2, deferred). The web note says "held in memory for that tab" (R4 §3.5); the built reading is `sessionStorage` (R14 §2a).
- **4 Data.** Reason stored on the audit row; contract bounds 5 to 500 (R10 `SupportReason`).
- **5 Surfaces.** Console banner and `ReasonDialog`; header `X-Support-Reason` on every `x-cross-tenant` call (R10; R4 §3.5).
- **6 Permissions and audit.** `platform.tenants.read` for member reads; `platform.audit.read` for the audit view; `@CrossTenant()` handlers audit each call with the target account (R1 §5; R13 §2.8).
- **7 Dependencies.** The `elx_platform` database pool (ADR-0031); audit log (PLAT-7).
- **8 Metrics.** Cross-tenant reads per staff member per week would show abuse; none defined [I].
- **9 Market and shape.** Not covered by the teardowns. Chosen [I]: keep reasons as built. If the owner rules yes on impersonation, it needs an order: read-only session, one hour, banner, no writes (R1 §10 Q3).
- **10 Roadmap.** Partial: WEB-4 (reasons, banner), PLAT-13 (cross-tenant reads). Missing: impersonation. Owner: Q-9 (provisional yes; no order row).

### F11 Audit log and export

- **1 Definition.** Append-only record of admin and ledger-adjacent actions: actor, acting account, target, action, before and after (secrets redacted), request id, IP, user agent (R1 §7; R2 K-7).
- **2 Workflow.** Synchronous write in the same transaction for admin and ledger actions; asynchronous through the outbox for high-volume cross-tenant reads (R1 §7). Lists with filters. Export per account is a platform tool, not a contract operation (R15 §2.9).
- **3 Rules and KSA/GCC.** Two years, dropped by monthly partitions (R1 §7; R5 §10). PLAT-7 review set global retention with a 24-month floor [S, R15 §7 note]. Update and delete rejected by trigger (R2 K-7). No KSA rule; the draft PDPL amendments do not change the audit design in the sources read [U, T-PIC].
- **4 Data.** `core_audit_log` monthly partitions; `actor_type`, `actor_id`, `account_id`, `target_type`, `target_id`, `action`, `before`, `after`, `request_id`, `ip`, `user_agent`, `reason` (R10 `AuditLogEntry`).
- **5 Surfaces.** Merchant `/settings/audit` (WEB-3); console `/audit` (WEB-4); API `listAuditLog` (R9), `platformListAudit` and `platformListAccountAudit` (R8). No export operation in any contract.
- **6 Permissions and audit.** `core.audit.read` (merchant), `platform.audit.read` (console) (R9; R8).
- **7 Dependencies.** PLAT-7, PLAT-8 (async reads), partition job in `api --role migrate` (A-21).
- **8 Metrics.** None defined; async audit lag shows in the outbox-age alert (R3 §7) [I].
- **9 Market and shape.** ShipHero exports Parquet FULL and DELTA with 24-hour signed URLs, as a merchant feature [S, T-SH data-exports row]. Chosen [I]: per-account CSV from the platform tool in wave 1 (R15 §2.9 default); a staff export operation only if merchants ask (R15 Q1).
- **10 Roadmap.** Partial. The roadmap row says "list and export" (PLAT-7), but PLAT-7 §2.9 defers export. Owner: PLAT-7 question 1 (export as a staff operation or a platform tool only).

### F12 Outbox operations

- **1 Definition.** Console view of outbox rows by status, kind, aggregate and account, with replay of dead rows and consumer lag (R14 §2.8).
- **2 Workflow.** Rows move `pending → enqueued → done`, or to `dead` or `superseded`. Dead rows are replayed one at a time with a reason; bulk replay needs an account filter (R14 §2.8; R8 `platformReplayDeadOutbox`).
- **3 Rules.** One dead row never blocks others, except later rows for the same aggregate where order matters (R2 K-11). The relay holds a suspended account's external effects, except `internal_event` (R7 A-23). Alert when the oldest unsent row is over 5 minutes old (R3 §7). Per-kind thresholds wait on ADR-0036 (R7 A-2).
- **4 Data.** `core_outbox`: immutable envelope, delivery state (`kind`, `status`, attempts, `next_attempt_at`, last error, `supersede_key`); `core_consumer_receipts` (R2 §2.7). Retention: 7 days done, 30 days dead for `message` rows (R5 §10).
- **5 Surfaces.** Console `/outbox` with a drawer and `CodeBlock` payload (R14 §2.8); API `platformListOutbox`, `platformGetOutboxRow`, `platformReplayOutboxRow`, `platformReplayDeadOutbox`, `platformListConsumers` (R8).
- **6 Permissions and audit.** `platform.outbox.read`, `platform.outbox.replay`; reasons on replay (R14 §2.4).
- **7 Dependencies.** PLAT-8 relay and BullMQ queue per kind (R6 §4); PLAT-14 alerts.
- **8 Metrics.** Parked, dead and lag per consumer, bounded (R14 §2a). Outbox age.
- **9 Market and shape.** ShipHero publishes webhook health states and alerts; Omniful and Anchanto show failed logs with manual re-sync [S, T-PC §2]. Chosen [I]: keep the console replay with reasons; webhook health belongs to INT-10 (T-PC §4).
- **10 Roadmap.** Covered: PLAT-8, WEB-4. Partial: diagnose fixes (DEL-15, WEB-12, wave 2).

### F13 Account limits and usage counters

- **1 Definition.** Each account has numeric limits (orders per month, drivers, sites, API keys) and counters. A create beyond a limit returns `422 limit_exceeded` (R12 §2.1 to §2.5; R10 `AccountLimits`).
- **2 Workflow.** Provisioning sets every limit. An admin can change limits; lowering one blocks only new creates (R13 §2.4). Site creation compares the active count under an account lock (R12 §2.5). Orders increment `core_usage_counters` in the order-insert transaction (R12 §2.2).
- **3 Rules and KSA/GCC.** Limits `>= 0`. Monthly orders use the Asia/Riyadh month start (R12 §2.2). Drivers counted from driver memberships once DEL-4 exists (R12 §2.2; DEL-4 merged, #114, count not checked). No member limit (R12 §7 Q2).
- **4 Data.** `core_usage_counters`: `account_id`, `metric` (orders, drivers, sites, api_keys), `period` (date), `value >= 0`, primary key on account, metric and period; RLS on (R12 §2.1). `core_accounts.limits` jsonb.
- **5 Surfaces.** Console account detail shows usage beside each limit (R14 §2.5). Merchant `getAccount` returns `limits` and `usage` (R9). No merchant alert before a limit.
- **6 Permissions and audit.** Read with `core.account.read`; set by `platform.accounts.provision` or the update door (R13 §2.4). Changes audited with before and after (R13 §2.10).
- **7 Dependencies.** DEL-2 order insert (in build); DEL-4 drivers; WMS sites; API keys (wave 4).
- **8 Metrics.** Usage against each limit, per account per month: the only usage metric defined (R12 §2.2).
- **9 Market and shape.** ShipHero meters credits (4,004 per account, restored at 60 a second) and 7,000 requests in five minutes, with 429 above it [S, T-SH §3.3]. Wasal counts base stops when a stop is added to a route, whatever the outcome [S, T-WA key findings item 4]. Chosen [I]: keep per-account counters; add a per-key request budget (adapt ShipHero); the counting rule is an owner decision (Unanswered 5).
- **10 Roadmap.** Partial: PLAT-12 (merged). Owner: Q-33 default numbers (provisional) and the counting rule.

### F14 Plans and metering

- **1 Definition.** A named plan bundles limits, entitlements and a price. Metering records usage per period for billing (base volume plus overage). Goal: a price the merchant can read and a bill the team can check.
- **2 Workflow.** Not built. Proposed: plan assigned at provisioning or by the team → counters per period → overage calculation → invoice run (F16). Wasal: change plan at any time, cancel without a fee [S, T-WA §2.7].
- **3 Rules and KSA/GCC.** Wasal homepage, SAR excl. 15% VAT: 469 a month (500 orders), 750 a month or 0.75 per order (1,000 orders), Expert custom [S, T-WA §4.2]. Wasal in-app: USD 125, 200 and 1,000 shown as SAR 469, 750 and 3,750 under Al Rajhi; the two models conflict [S, T-WA key findings item 3]. Torod: Free 0 SAR, Premium 199 SAR, Pro 399 SAR a month; annual 2,100 and 4,188 SAR on the homepage [S, T-TO]. Fulfillor's $750 monthly base is a sample rate card, not a price list [S, T-FU §4.3]. No Eeasy price exists; Q-33 says pricing before wave 2 [R7].
- **4 Data.** Proposed platform tables `core_plans` (limits, entitlements, price per period in halalas with currency) and `core_account_plans` (account, plan, effective dates) [I]. Money as integer halalas (R5 §1).
- **5 Surfaces.** Console plan assignment (new). Merchant plan and usage page (not planned; T-PIC §3 "merchant usage view"). No API in wave 0.
- **6 Permissions and audit.** Platform billing permission (new; not in `roles.yaml`) [I]. Merchant read: owner only (R11).
- **7 Dependencies.** F13 counters, F15 subscriptions, F16 invoices, F18 gateway, F5 read-only state.
- **8 Metrics.** Monthly recurring revenue, usage against plan, overage revenue, active accounts by plan. None defined [I].
- **9 Market and shape.** Wasal: base plus overage [S]. Torod: flat tiers with per-city rates [S, T-TO]. ShipHero publishes no prices and bills 3PL clients by profile [S, T-SH §4.2]; 3PL billing is out of scope under ADR-0002 [I]. Chosen [I]: a plan is a limit bundle and a price stored as data, not code, so the price can wait for Q-33 without a code change. Reject carrier-style rate cards (ADR-0001, ADR-0014). Differs from the roadmap: new order.
- **10 Roadmap.** Missing as an order. Partial: counters (PLAT-12). Proposed BILL-1 in wave 2 (T-PIC §4); the Wasal note calls the same proposal "BIL-1" (T-WA §6). Owner: price, counting rule, whether COD transfer fees are a plan item (T-TO).

### F15 Subscriptions and trial

- **1 Definition.** A subscription is an account's paid period on a plan, with renewal, change and cancel. A trial is a time-limited plan that needs no card at start (T-WA §2.7).
- **2 Workflow.** Not built. Wasal: 14-day trial with no card; read-only after it ends until a payment method is added; asked to choose a plan after 30 days without one [S, T-WA §2.7]. Torod: free plan with no subscription and no minimum shipments [S, T-TO]. Proposed: trial → add payment method → active → renewal → lapse → read-only → suspension only after notice (F5) [I].
- **3 Rules and KSA/GCC.** Trial length 14 days and the 30-day window come from Wasal [S]. Renewal and invoice amounts in SAR excl. VAT, VAT added on the invoice (F16) [I]. Proration on mid-period changes is not in any source read (Unanswered 7).
- **4 Data.** Proposed `core_subscriptions`: account, plan, status (trialing, active, past_due, read_only, cancelled), period start and end, `trial_ends_at`. Card data stays with the gateway; only a token reference is stored [I].
- **5 Surfaces.** Merchant plan-and-billing page (Wasal's `/plan-and-billing` [S, T-WA §2.7]); console subscription view; mail at trial milestones [I].
- **6 Permissions and audit.** Owner manages (R11); console `platform` billing permission [I]. Audit each state change [I].
- **7 Dependencies.** Gateway (F18), invoices (F16), messaging (PLAT-9), read-only state (F5).
- **8 Metrics.** Trial-to-paid conversion, monthly churn, MRR; none defined [I].
- **9 Market and shape.** Wasal's read-only trial is the closest pattern [S]. Chosen [I]: copy the read-only shape (no new routes or stops, drivers keep working). Differs from the roadmap.
- **10 Roadmap.** Missing. Proposed BILL-1 (T-PIC §4). Owner: trial length and the read-only rule.

### F16 Merchant invoices with VAT

- **1 Definition.** Eeasy's invoices to its merchants for subscription and usage, with VAT, Arabic and English fields, and a six-year archive if VAT applies [U, T-PIC S23]. Invoices from a merchant to its own customers are a different question (Unanswered 2).
- **2 Workflow.** Not built. Proposed: monthly run from metered usage → draft → finalise → mail with PDF → paid or overdue. A finalised invoice is immutable; corrections use a credit note [I]. Fulfillor prepares invoices after team review [S, T-FU §2 billing row].
- **3 Rules and KSA/GCC.** VAT 15%: the Wasal homepage quotes prices excl. 15% VAT [S, T-WA §4.2]; T-PIC cites 15% [U]. The rate itself is set by law [M]. Books kept in KSA [U, T-PIC]. Eeasy's VAT registration and whether it is the seller of record are unknown (T-PIC unanswered 1 and 2). Arabic invoice fields and the 15-digit VAT number format are [M], not checked in this session.
- **4 Data.** Proposed `bil_invoices`: gap-free number per issuer, seller legal name (ar and en), seller VAT number, CR number, buyer VAT number, lines with tax per line, totals in halalas with currency (R5 §1) [I].
- **5 Surfaces.** PDF download and mail to the account's billing contact; console invoice list; no API in wave 0 [I].
- **6 Permissions and audit.** Owner views and downloads; platform billing manages; audit finalise and void (K-7) [I].
- **7 Dependencies.** F14, F15, F17 (QR and clearance), object storage for PDFs (INT-1; signed URLs only, R3 §2).
- **8 Metrics.** Invoices issued, overdue ageing, VAT collected per month [I].
- **9 Market and shape.** Wasal lists invoices in SAR or USD by currency [S, T-WA §2.7]. Chosen [I]: an own immutable record, PDF generated from it, built after the ZATCA research (F17). Differs from the roadmap.
- **10 Roadmap.** Missing. Proposed BILL-2 in wave 2, before the first merchant invoice (T-PIC §4). Owner: Eeasy VAT position and seller of record.

### F17 ZATCA phase 2 e-invoicing

- **1 Definition.** Saudi mandatory e-invoicing through the Fatoora platform: UBL 2.1 XML, invoice hash chain, cryptographic stamp, QR code. Standard invoices are cleared before issue; simplified invoices are reported within 24 hours [U, W-INV; T-PIC row]. Phase 2 applies by waves of taxpayers.
- **2 Workflow.** ZATCA announces a wave and gives notice; later waves get at least six months' notice [S, W25]. Onboarding of an EGS unit and CSID; integration by the wave's deadline; clearance or reporting for each invoice [M for EGS and CSID, not checked]. Wave 24: integrate by 30 June 2026 [U, W24]. Wave 25: published 24 July 2026; integrate by 1 February 2027 [S, W25].
- **3 Rules and KSA/GCC.** Wave 25 covers taxpayers with VAT-subject revenue above SAR 187,500 in 2022, 2023, 2024 or 2025 [S, W25]. Wave 24 threshold SAR 375,000 for 2022 to 2024 [U, W24]. Eeasy's wave depends on its own VAT-subject revenue; unknown. One secondary source says simplified invoices apply below SAR 1,000; the others do not confirm it [U, W-INV]. Arabic field list, QR fields and CR-number rule: [M], not read. The ZATCA wave table itself is an image (T-PIC S1).
- **4 Data.** Per invoice: UUID, counter, previous hash, invoice hash, status (cleared or reported), QR payload, XML [M]. Keys (EGS private key, CSID) in the secret store with a key id (R5 §10 pattern) [I].
- **5 Surfaces.** Invoice PDF with QR; submission to Fatoora through the outbox, because side effects go through the outbox (AGENTS.md hard rules; ADR-0024). The outbox kind list has no ZATCA kind yet (R6 §4) [I].
- **6 Permissions and audit.** Owner views; platform keeps the keys; audit each submission and status (K-7) [I].
- **7 Dependencies.** F16; Fatoora APIs; secret store; the outbox.
- **8 Metrics.** Clearance or reporting success, time to report (24 hours), rejections. None defined [I].
- **9 Market and shape.** Fulfillor claims phase 2 clearance and reporting, sandbox-certified, production onboarding per tenant, with the KSA page "subject to configuration" [S, T-FU §2 row, a vendor claim]. Anchanto's invoices are in its labels and Salla flow [S, T-AN row 40]. Chosen [I]: research first (OPS-8, proposed by T-PC §4), then build. Do not copy a vendor shape before the wave and scope are known.
- **10 Roadmap.** Missing: no ZATCA row, no OPS-8 row. Proposed BILL-2 in wave 2 after research (T-PIC §4). Owner: Eeasy's wave, and whether the product issues invoices for merchants' customers.

### F18 Payment gateways

- **1 Definition.** A provider that takes card, mada or wallet payments for Eeasy's subscriptions (merchant pays Eeasy). This is distinct from recipient payments at the door (digital COD, ADR-0017).
- **2 Workflow.** Not built. Hosted checkout or payment link, provider webhook on paid, refund, optional recurring token. Wasal uses gateway checkout and billing-portal sessions created server-side [S, T-WA §2.7].
- **3 Rules and KSA/GCC.** ADR-0017 gates digital COD. Card and wallet at the door are recorded as collected elsewhere with custody `not held` [S, ADR-0017; R6 §2.9]. It does not name subscription billing, and it waits on a merchant-of-record decision the owner has not made [S, ADR-0017]. Provider facts (read from T-PIC, not re-read here): Moyasar offers mada, Visa, Mastercard, UnionPay, Apple Pay, STC Pay and Google Pay, with Payments, Invoices and Payouts APIs and a sandbox [S, T-PIC S8]. HyperPay offers COPYandPAY, server-to-server, subscriptions and registration tokens; currencies not stated [S, S9]. Tap offers recurring payments, invoices, payouts and merchant onboarding; settlement not stated [S, S10]. PayTabs offers hosted payment, invoices and PayLinks; recurring not on its overview page [S, S11]. Wasal uses Al Rajhi for SAR and Stripe for USD [S, T-WA §4.2].
- **4 Data.** Only a provider token and charge reference; never card data [I, hosted-checkout model]. Payment rows in halalas with currency; provider webhook verification per provider not read.
- **5 Surfaces.** Hosted checkout page; receipt mail; console refund action [I].
- **6 Permissions and audit.** Owner pays; platform billing manages refunds; audit each charge and refund [I].
- **7 Dependencies.** F15, F16; a new ADR; a provider contract; merchant-of-record decision.
- **8 Metrics.** Charge success rate, failed payments, dunning recovery [I].
- **9 Market and shape.** Four KSA providers are listed above; Wasal picked Al Rajhi for SAR. Chosen [I]: a new ADR and a platform-side billing port, separate from the delivery `PaymentPort` (R6 §2.9), with one provider chosen after a sandbox test. The coverage note proposes BILL-3 "behind the ADR-0017 unlock" [S, T-PIC §4]; I read ADR-0017's scope as narrower, so a separate ADR is needed. Differs from the roadmap.
- **10 Roadmap.** Missing. Proposed BILL-3, wave 2 or 3 (T-PIC). Owner: which gateway; whether ADR-0017 is unlocked for merchant billing (T-FC Q4).

### F19 Multi-country

- **1 Definition.** Accounts and sites in more than one GCC country, each with its own locale, currency, timezone, tax and calendar.
- **2 Workflow.** Not built. Country is a CHECK constant `SA` (R12 §2.1).
- **3 Rules and KSA/GCC.** UAE federal government moved to Saturday and Sunday weekends from 1 January 2022, with private employers free to choose [U, W-UAE, a 2021 summary]. Oman's weekend is Friday and Saturday in one search summary [U]. Kuwait, Bahrain, Qatar and Saudi weekends were not confirmed in this session; Saudi Friday–Saturday is [M]. Torod serves GCC and international on its Pro tier only [S, T-TO]. Fulfillor sells in Oman, Qatar, Saudi Arabia and UAE [S, T-FU §1]. The KSA geocoder chain (SPL and Sayyar) and the `+966`-only driver phone list are KSA-only today [S, T-FC §2 item 1].
- **4 Data.** Proposed: `country` on account and site; tax profile and calendar per country [I].
- **5 Surfaces.** Provisioning form (country field, currently fixed), driver phone input (`+966` only), geocoding per country [I].
- **6 Permissions and audit.** Platform admin sets country at provisioning; audit the change [I].
- **7 Dependencies.** F20 and F21 (same ADR); geocoding (INT-2); WhatsApp numbers per country; Gulf-region hosting (ADR-0022, not read).
- **8 Metrics.** Accounts and sites per country; none defined [I].
- **9 Market and shape.** Torod, Fulfillor and Anchanto run GCC operations [S]. Chosen [I]: country on account and site, currency and timezone per country under one ADR; wave 1 stays KSA-only (T-FC §2 item 1). Differs from the roadmap, which has no GCC row.
- **10 Roadmap.** Partial: `SA` CHECK only (R12 §2.1). Owner: is GCC in scope before wave 4 (T-FC Q2). The ADR must come before the next money or country table.

### F20 Multi-currency and three-decimal GCC currencies

- **1 Definition.** Money stored as an integer count of minor units with an ISO 4217 currency code; displayed with that currency's minor-unit exponent.
- **2 Workflow.** None. Money is integer halalas with `currency` CHECK `SAR` (R5 §1). The contract `Money` schema allows only `SAR` and `amount` with minimum 0 (R10); a signed variant exists for ledger rows (R10 `SignedMoney`).
- **3 Rules and KSA/GCC.** SAR, AED and QAR have two minor units; KWD, BHD and OMR have three [S via T-PIC S20, an ISO 4217 table read through Wikipedia; not re-read here]. For three-decimal currencies, 1 KWD is 1,000 fils [I]. Rounding for VAT on three-decimal currencies is undecided (Unanswered 10).
- **4 Data.** Proposed: a currency table with minor-unit exponent; `currency` on every money row without the CHECK; `bigint` stays for report totals (R5 §1) [I].
- **5 Surfaces.** `<Money>` component renders per currency (R4 §5); invoices and statements; the driver's cash counting in dinars [I].
- **6 Permissions and audit.** None beyond the owning module [I].
- **7 Dependencies.** Every money column in the data design (R5 §1 to §3); the ADR of F19.
- **8 Metrics.** None.
- **9 Market and shape.** Torod shows USD fees for Shopify and SAR on its homepage [S, T-TO U12]. Chosen [I]: keep integer minor units (no floats, R2 §8) and add the exponent. Changing `currency` and CHECK constraints touches every money table, so it is a one-way door: decide before the next money table. Differs from the roadmap.
- **10 Roadmap.** Partial (R5 §1). Not scheduled. Owner: GCC before wave 4 (T-FC Q2).

### F21 Timezones and business dates

- **1 Definition.** Each account has a timezone. Business dates (cash day, slot day, billing month) are computed in it. Every timestamp is `timestamptz` (R5 §1).
- **2 Workflow.** No change exists. Nightly jobs run at 03:00 Asia/Riyadh for the ledger assertions (R5, assertions paragraph) and channel reconciliation (R6 §8). WhatsApp quiet hours run 22:00 to 08:00 Asia/Riyadh (R6 §5.4).
- **3 Rules and KSA/GCC.** A driver holding cash from a previous Asia/Riyadh business day is cash-blocked (R2 D-11). Monthly counters start at the Asia/Riyadh month (R12 §2.2). Opening hours use `weekday` 0 to 6 with `HH:MM`, and `closes` may be earlier than `opens` for an overnight window; the numbering base for `weekday` (0 = Sunday or Monday) is not stated (R12 §2.5). Weekend facts are in F19.
- **4 Data.** `core_accounts.timezone` CHECK `Asia/Riyadh` (R12 §2.1). Proposed: `timezone` on site, account default (T-FC §2 item 1).
- **5 Surfaces.** Date formatting fixes `timeZone: 'Asia/Riyadh'` in the i18n module (R4 §5).
- **6 Permissions and audit.** None.
- **7 Dependencies.** Shared formatting module (WEB-1); slots (DEL); cash reports (DEL-11); billing run date (F16).
- **8 Metrics.** None.
- **9 Market and shape.** The teardowns did not cover timezones [unknown]. Chosen [I]: site timezone with an Asia/Riyadh default; billing months on the account timezone; the formatting module takes a timezone parameter. Differs from the roadmap, which hard-codes the zone.
- **10 Roadmap.** Covered for KSA (PLAT-12, DEL-11; T-PIC §1 row). Missing for GCC. Owner: depends on F19.

### F22 Data retention and closed-account deletion

- **1 Definition.** How long each class of personal and business data is kept, and how a closed account is exported and deleted (R5 §10).
- **2 Workflow.** Close (from `suspended` or `provisioned`) → sessions and invitations ended → 90-day window with export (Q-38 provisional) → per-account export by the platform tool on `elx_maintenance` → deletion of rows, children first, ledgers included → object-storage prefixes; the deletion's audit rows are kept with ids only (R5 §10; R5 §13 Q2).
- **3 Rules and KSA/GCC.** Audit two years; proof files two years after the order is terminal; OTP rows one hour after expiry; refresh tokens and invitations seven days after expiry or use; driver trails 90 days; inbound payloads 30 days; backups 35 days, so deletion is complete within 35 days (R5 §10). Recipient data kept for the life of the account (Q-37 provisional). Tax records: six-year archive is [U, T-PIC S23], which conflicts with immediate deletion of the account's invoices (F16) [I]. The draft PDPL amendments would add a 30-day deemed-rejection rule for data requests and an in-Kingdom storage duty [U, T-PIC S3 and S4, consultation to 5 November 2026].
- **4 Data.** Classes in R5 §10. Ledgers are deleted only by the maintenance role with `elx.purge_account` (ADR-0031; R5 §10).
- **5 Surfaces.** Console close dialog (R14 §2.5); the per-account export tool (wave 1 data order, R5 §10); no merchant notice yet.
- **6 Permissions and audit.** `elx_maintenance` role only; a platform admin starts it [I]. Deletion audit keeps ids, no personal data (R5 §10).
- **7 Dependencies.** `storage_lifecycle` outbox kind (ADR-0036; R6 §4); backups; PLAT-7 partitions; ADR-0031 roles.
- **8 Metrics.** Deletion job results and overdue deletions [I].
- **9 Market and shape.** Torod states no fixed retention period and no PDPL statement [S, T-TO data protection]. Wasal ties data history to plan tier: 30 days, 1 year and 5 years [S, T-WA gap table, row 'Data history by tier']; T-WA rejects copying it as a privacy decision. Chosen [I]: fixed classes by data kind, not by plan; add a tax-record class excluded from account deletion.
- **10 Roadmap.** Partial: Q-37 and Q-38 provisional; the deletion tool is a wave 1 data order (R5 §10); PDPL-1 proposed for wave 1 exit (T-PIC §4). Owner: Q-38 length, immediate deletion on request, and the tax-record rule (Unanswered 12).

### F23 Platform observability and status page

- **1 Definition.** Traces, metrics, logs, error tracking and alerts for the platform, plus a public status page and incident notes for merchants.
- **2 Workflow.** Alerts go to the owner's channel: `/ready` failing; p95 API latency above 800 ms for 5 minutes; outbox age above 5 minutes; dead-lettered job; nightly ledger assertion not green; OTP failure spike; disk and backup failures (R3 §7). Incident notes: none; no status page (T-PIC §2 missing row).
- **3 Rules and KSA/GCC.** OpenTelemetry in api and worker; Sentry with release tags; PostHog with ids only (R3 §7). Logs redact phone numbers to the last four digits and remove tokens from URLs (R6 §11). Backups restored monthly into staging (R3 §6). Per-kind thresholds replace "any dead job" when ADR-0036 is accepted (R7 A-2).
- **4 Data.** Traces and logs carry request id and account id (R3 §7). Telemetry retention periods are not stated in the sources read (Unanswered 19).
- **5 Surfaces.** Sentry, PostHog, the alert channel; console consumers block (R14 §2.2). No merchant-facing health or status page.
- **6 Permissions and audit.** Owner channel; no merchant access; logs keep account ids (R3 §7) [I].
- **7 Dependencies.** OPS-1 host (waits on Q-10 and Q-12), Cloudflare in front (R3 §8), alert channel.
- **8 Metrics.** The alert set in R3 §7. No published uptime or SLA figure: Wasal publishes none [S, T-WA §4.2]; the platform has no SLA target in any document read [I].
- **9 Market and shape.** ShipHero runs a public status page for WMS, mobile and API [S, T-SH §3.2, search evidence]. Chosen [I]: an external hosted status page fed from the alert set, with incident notes in Arabic and English, added to the OPS-2 runbook list.
- **10 Roadmap.** Partial: PLAT-14 (merged), OPS-1 (waiting). Missing: status page and incident communication; proposed as an OPS-2 addition or SEC-1 (T-PIC §4). Owner: Q-10 and Q-12 gate OPS-1.

## Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| F1 Multi-tenant accounts and provisioning | covered (merged) | PLAT-12, PLAT-13, WEB-4 | 0 | Q-33 default limits |
| F2 Self-serve signup with approval | missing | none (proposed with BILL-1) | 2 | Wanted at all? (T-FC Q8) |
| F3 Platform console | covered; billing screens missing | WEB-19, WEB-4; WEB-12 | 0; 2 | none |
| F4 Rollout modes and feature flags | covered | PLAT-13 | 0 | entitlements kept separate (decision) |
| F5 Suspension and closure | covered; read-only state missing | PLAT-13, WEB-4 | 0 | Q-38; suspend or read-only per lapse |
| F6 Roles, permissions, site scoping | covered; billing permission missing | PLAT-10, PLAT-12, WEB-3 | 0 | billing permission; custom roles (R7 §6) |
| F7 Enterprise SSO | missing by design | ADR-0023 door, none scheduled | 4 or later | which merchants and tier (T-PIC Q9) |
| F8 Merchant staff auth and second factor | covered | PLAT-11, WEB-2 | 0 | Q-7 mandatory 2FA for owners |
| F9 Platform staff and TOTP | covered | PLAT-11, PLAT-13, WEB-4 | 0 | reason on staff role change |
| F10 Support access, reasons, impersonation | partial | WEB-4, PLAT-13; impersonation none | 0 | Q-9 |
| F11 Audit log and export | partial (list yes, export deferred) | PLAT-7 | 0; export 1 | PLAT-7 Q1 export form |
| F12 Outbox operations | covered | PLAT-8, WEB-4; DEL-15, WEB-12 | 0; 2 | ADR-0036 thresholds (A-2) |
| F13 Limits and usage counters | partial | PLAT-12; DEL-2 increments | 0 | Q-33 numbers; counting rule |
| F14 Plans and metering | missing | BILL-1 (proposed) | 2 | Q-33 price; counting rule |
| F15 Subscriptions and trial | missing | BILL-1 (proposed) | 2 | trial length; proration |
| F16 Merchant invoices with VAT | missing | BILL-2 (proposed) | 2 | Eeasy VAT position; seller of record |
| F17 ZATCA phase 2 e-invoicing | missing | OPS-8 research, then BILL-2 | 2 (research first) | Eeasy's wave; invoices to customers? |
| F18 Payment gateways | missing | BILL-3 and a new ADR | 2 or 3 | which gateway; ADR-0017 scope |
| F19 Multi-country | partial (SA CHECKs) | ADR (proposed); no order | ADR before next money table; GCC 4 | GCC before wave 4? (T-FC Q2) |
| F20 Multi-currency, three-decimal | partial (SAR only) | ADR (proposed); no order | before next money table | VAT rounding; GCC scope |
| F21 Timezones and business dates | covered for KSA; GCC missing | PLAT-12, DEL-11 | 0; 2 | follows F19 |
| F22 Retention and closed-account deletion | partial | Q-37, Q-38; deletion tool (R5 §10) | 1 | Q-38; tax-record class |
| F23 Observability and status page | partial (PLAT-14); status page missing | PLAT-14, OPS-1, OPS-2 | 0; status 2 | Q-10, Q-12 gate OPS-1 |

## Unanswered

1. Is Eeasy VAT-registered, and which ZATCA wave applies to its VAT-subject revenue for 2022 to 2025 (threshold SAR 187,500 in wave 25)? [S W25 gives the rule; Eeasy's facts are not in any source.]
2. Is Eeasy the seller of record for delivery fees, and does the product issue invoices for merchants' own customers, as Anchanto and Fulfillor do? (T-PIC unanswered 2; T-AN row 40.)
3. The EGS unit, CSID onboarding, invoice XML and QR fields: not read. The Fatoora technical specification is needed before F17 is estimated.
4. CR number and buyer VAT-number rules on Arabic invoices: not read [M].
5. Counting rule for base volume: order created, stop added, or delivered (Wasal counts at add, T-WA key findings item 4).
6. Price points and whether Q-33 pricing gates wave 2 or a later wave. Wasal's two price models conflict [S, T-WA key findings item 3].
7. Trial length beyond the Wasal reference, the read-only period, and proration on mid-period changes.
8. Gateway choice; whether ADR-0017 is unlocked for merchant billing or a new ADR is written (T-FC Q4, T-PIC Q10).
9. Weekend and holiday calendars for KSA, Kuwait, Bahrain and Qatar (only UAE and Oman partly read); the `weekday` numbering in `opening_hours` (R12 §2.5).
10. VAT rounding for three-decimal currencies (KWD, BHD, OMR).
11. Whether GCC is in scope before wave 4 (T-FC Q2).
12. Tax-record retention against Q-38 and the draft PDPL rules (deemed rejection, in-Kingdom storage); counsel needed (T-PIC unanswered 4 to 6).
13. Whether read-only impersonation (Q-9) is wanted; if yes, it needs an order (R1 §10 Q3).
14. Whether self-serve signup is wanted at all (T-FC Q8).
15. Whether SSO is required and at which tier (T-PIC Q9).
16. PLAT-7 export: staff operation or platform tool only (PLAT-7 §7 Q1). Roadmap row to be reconciled.
17. Billing permission string or owner-only (R11 line 184).
18. Status page owner, and whether incident notes are bilingual and published by whom (T-PIC unanswered 16).
19. Retention of logs and traces (R3 §7 names none).

## Source list

Repository (read 2026-11-02 at origin/main 6ca087e unless stated):
- R1 `docs/architecture/identity-and-tenancy.md`, full.
- R2 `docs/architecture/domain-model.md` §2, §3.1, §3.18, §8 (money row), §9.
- R3 `docs/architecture/platform.md` §2, §3, §6, §7, §8, §10.
- R4 `docs/architecture/web.md` §1.1, §1.2, §3.1 to §3.6, §4, §5.
- R5 `docs/architecture/data.md` §1 (money row), §4.5 area, §10, §13.
- R6 `docs/architecture/integrations.md` §2.9, §4, §5.4, §11, and the outbox kind table.
- R7 `docs/roadmap.md` §0, the PLAT-10 to PLAT-16, WEB-3, WEB-4, WEB-19, OPS-1, OPS-2, DEL-15, WEB-12 rows, §4 rows Q-7, Q-9, Q-10 to Q-12, Q-33, Q-37, Q-38, §5 amendments A-2, A-3, A-9, A-21, A-23, A-25, A-26, §6.
- R8 `docs/contracts/openapi/platform.yaml`: account, member, settings, site, rollout, flag, audit, outbox, staff operations (48 operations counted).
- R9 `docs/contracts/openapi/staff.yaml`: `getAccount`, `getAccountSettings`, `updateAccountSettings`, member, site and `listAuditLog` operations (51 operations counted).
- R10 `docs/contracts/openapi/components.yaml`: `SupportReason`, `Money`, `SignedMoney`, `Account`, `AccountLimits`, `AccountSettings`, `AuditLogEntry`.
- R11 `docs/contracts/README.md` line 184.
- R12 `docs/orders/PLAT-12/plan.md` §2, §7.
- R13 `docs/orders/PLAT-13/plan.md` §2, §7, §8.2 item 62 (fix L-3), §9.
- R14 `docs/orders/WEB-4/plan.md` §2, §2a, §7, §9.
- R15 `docs/orders/PLAT-7/plan.md` §2.9, §7.
- ADR-0002, ADR-0005, ADR-0006, ADR-0017, ADR-0023, ADR-0025, ADR-0031, ADR-0032, ADR-0038 in `adr/` (read 2026-11-02). ADR-0022, ADR-0024, ADR-0036 and ADR-0041 are cited from the roadmap and the architecture documents, not read in full.

Research branches (read 2026-11-02):
- T-FC `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` (tip 7396dcc), §1 to §4.
- T-PIC `origin/docs/feature-coverage:docs/research/features-platform-integrations-compliance-2026-11.md`, §1 platform, tenancy and billing; §4 compliance; sources S1 to S28; unanswered list. Its vendor sources (S8 to S11, S14, S20, S23) were not re-read here.
- T-PC `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` (tip d75ed6f), §1 to §5.
- T-WA `origin/docs/platform-teardowns:docs/research/teardown-wasal-2026-11.md` (commit ff2d534), §1, §2.6, §2.7, §4.2, §6 and the plan proposals P7.
- T-SH `origin/docs/platform-teardowns:docs/research/shiphero-teardown-2026-11.md`, §3.2, §3.3, §4.2, §7.
- T-TO `origin/docs/platform-teardowns:docs/research/teardown-torod-2026-11.md`, billing, data protection and onboarding sections, §7 rows.
- T-AN `origin/docs/platform-teardowns:docs/research/teardown-anchanto-2026-11.md`, §4 rows 26, 27 and 40.
- T-FU `origin/docs/platform-teardowns:docs/research/teardown-fulfillor-2026-11.md` (commit e1ca9e9), §1, §2, §4.3 to §4.7.

Web (read 2026-11-02 unless stated):
- W25 ZATCA, Wave 25 of e-invoicing phase two, 24 July 2026: https://zatca.gov.sa/en/MediaCenter/News/Pages/Wave25-E-invoicing.aspx (WebFetch; the page is the primary source for the wave 25 rule).
- W24 Wave 24 deadline summaries (search snippets, secondary): https://www.vatupdate.com/2026/06/16/wave-24-deadline-30-june-2026-sar-375000-threshold/ and https://www.grantthornton.sa/insights/articles-and-publications/wave_24_implementation_of_e_invoicing_in_saudi_arabia/
- W-INV ZATCA reporting and clearance summaries (search snippets, secondary): https://www.fonoa.com/resources/country-tax-guides/saudi-arabia/e-invoicing-and-digital-reporting
- W-UAE UAE working week from 1 January 2022 (summary of a December 2021 announcement; not updated): https://squirepattonboggs.com/en/insights/publications/2021/12/uae-working-week-changes-from-1-january-2022

Not read or not settled in this session: ZATCA technical specification (EGS, CSID, QR, Arabic fields), Saudi labour-law weekend, GCC weekends for Kuwait, Bahrain and Qatar, the Saudi VAT rate on the official page, and every vendor billing page. These are marked [M] or [U] where used.
