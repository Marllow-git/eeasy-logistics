# WEB-4 · Platform console screens — design references

Found and read on 2026-11-02 with the Mobbin MCP (platform `web`, `search_screens` and `search_flows`). Saved to the Mobbin collection "eeasy-logistics · WEB-4" (https://mobbin.com/collections/39cbddad-70b5-4fc5-aaf9-a6d63554d36e): 23 screens and 3 flows, read back on 2026-11-02 and matched to the list below. Scope and rules from: `docs/roadmap.md` row WEB-4; `docs/architecture/web.md` §1 (the `apps/admin` routes, §1.1 layout), §3.5 ("Acting on account X" banner and the support reason prompt), §8 wave 0 rows for the platform screens; `docs/handbook/04-conventions.md` "Design references"; `docs/references/design/WEB-3.md` (shape). The notes come from Mobbin preview images and flow titles read on 2026-11-02. No reference was opened in a live product, so exact copy, timing, validation and colours are unverified. No reference is Arabic or right-to-left (see the RTL section). No asset, icon or copy is to be copied; ADR-0016 and ADR-0033 win over every reference.

## Summary for the lead

- Two to four references per family. Accounts list and create: Snowflake, Plain, Cofounder (dialog only), Square (empty state after filters). Lifecycle: Tailscale and Zendesk (suspend), Clerk (lock, reversible), Etsy (pending-closure banner with a cancel action). Rollout and flags: Shopify, Supabase, Buffer.
- Acting-on-account banner and support reason: weak. Two searches found no "viewing as" or impersonation banner with an exit control. The usable pieces are Etsy (a fixed banner with one action) and YNAB (time-limited support access, default off, save disabled until a choice).
- Outbox: Buffer (per-row retry with the error on the row), AirOps (bulk Accept All and Decline All), Gumloop (row detail drawer), Snowflake (failed detail with the message).
- Staff and destructive confirms: Uxcel and Grok (role change and dependent-data copy), hilos (removal with the access consequence), Toggl (role descriptions). TOTP reset: no reference for an admin reset of another person's factor; Shopify step-up is the nearest.
- Audit log: Customer.io (filter row, Export CSV), with Klaviyo, Gumloop and Google Ads reused from WEB-3 for the stamp, retention notice and "by user" column.
- No reference shows the provisioning form's full set (name, locale, limits, modules, owner invite), a per-account flag with a reason, a reactivate after suspend, or a bulk replay with a count confirm. No Arabic or RTL reference exists.

## Accounts list and provisioning (`/platform/accounts`, `/platform/accounts/new`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/44e250f3-4b73-459c-add6-4d9852e25823 | Snowflake, "Accounts" (2026-11-02) | tabs for active and dropped accounts (dropped maps to closed), one search, a count "1 Account", sortable column headers, one primary create action | the create menu that offers two account types, one of them marked "Preview"; WEB-4 has one provisioning path |
| https://mobbin.com/screens/52c56353-10cb-4e3e-a4f8-62bd60f6496a | Plain, "Companies" | a flat table with tab filters (All, My accounts, Free, VIP), search at the end, one "Create company" button at the top end | the side navigation with many sections; the owner column reads as a person's name, which our list must not confuse with the account name |
| https://mobbin.com/screens/9705c478-cd12-4c13-9a5c-3c3a4e2b9ad6 | Cofounder, "Create account" dialog | a small create dialog with a name, a second field and one "Create" action at the foot | two fields only; the provisioning form needs locale, limits, modules and the owner invite, so use a full page at `/accounts/new`, not this dialog. The blurred background is low contrast |
| https://mobbin.com/screens/c750ea27-ab70-4b2c-913e-1bfd7d807200 | Square, "Directory" with filters that match nothing (empty state) | the empty state after filters: one heading "No ... currently match these filters", one line "Try again by editing the filters", the filter chips and the "Edit filters" action kept on screen | the import, export and campaign buttons; the success toast left over from an earlier action |

Provisioning is a form with several sections (name, locale, limits, modules, owner invite). No reference shows a multi-section create form for a tenant. The Arabic and English name pair has no reference (see Unanswered).

## Account detail and lifecycle actions (suspend with a reason, reactivate, close)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/36af4d21-e18a-48e0-bf6c-52e2da27995c | Tailscale, "Suspending a user" (3 screens: row menu, confirm dialog, row after) | the destructive item "Suspend user…" set apart at the foot of the row menu in red; the dialog names the person and states what stops; Cancel and a red confirm; the row then carries a "Suspended" chip and a toast | no reason field (WEB-4 needs one); the empty sub-list "does not own any machines" |
| https://mobbin.com/flows/d8028fec-ed1b-4682-8567-26506f67a550 | Zendesk, "Suspending a customer" (4 screens) | after the action, a red inline banner "This user has been suspended" sits at the top of the detail page, so the state stays visible after the toast fades | the menu that groups "Suspend access" next to "Delete" with no separation; the toast stack that repeats the same fact twice |
| https://mobbin.com/flows/84fa1166-aece-4716-b46b-b5b005276300 | Clerk, "Locking a user" (3 screens: row menu, confirm, locked row) | the dialog says the action "can be undone" and what it blocks ("prevent the user from signing in"); a small lock icon on the locked row | the purple primary for a destructive action; the "Impersonate user" add-on and the "Ban" item with a Pro badge in the same menu |
| https://mobbin.com/screens/004dcbc3-1172-4081-b439-6b73cdcd5c31 | Etsy, "Account scheduled to be closed" (error-style banner) | a full-width banner that stays on every page of the pending account, with one action that reverses it ("Cancel account deletion") | the consumer copy and the "Go to Etsy.com" exit; the banner is for a pending close with a reversal window, which WEB-4 may not have (Unanswered) |

Reactivate after suspend has no reference of its own. WEB-3's Workable deactivated page (https://mobbin.com/flows/39b6b356-18cb-401b-8b4f-a2061380d413) shows a single "Activate now" on a deactivated item; reuse that pattern for reactivate.

## Rollout modes and per-account feature flags (`/platform/rollout`, `/platform/accounts/[accountId]/flags`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/ec3bc76f-7f80-4bde-8a23-2f108149f0e0 | Shopify, "Edit rollout" (Draft status, a reach control with the plain estimate "~16 visitors per month" under it, scheduled start and end) | the state of the rollout is a chip ("Draft") in the header; the reach is written in words under the control, so the effect is read before saving | the percentage slider itself: WEB-4 modes are off, allowlist and all, not a percentage; the "Unsaved changes" bar that holds Discard and Save at the top |
| https://mobbin.com/screens/d580533e-422d-42e0-b119-069eedae7a30 | Supabase, "Dashboard feature previews" | a list of features on the left with a status icon and a NEW badge, a detail pane with the feature's description and a "Please note" list of warnings before enabling, and one action ("Disable feature") | the one-switch-per-feature model with no scope: a flag here is global, and the per-account override with a reason has no reference |
| https://mobbin.com/screens/ec32cdce-affc-4901-b0a4-d25e75008e9b | Buffer, "Beta Features" | one line per flag saying what changes for the user, and a feedback control beside each flag; a notice after the change says it may take a few minutes to apply | the master "Enable Beta Features" switch that turns every flag on at once; a rollout mode per key must be set one key at a time |

Rollout modes (off, allowlist, all) with an account-level override and a reason field have no reference. The three-state control (off, allowlist, all) is a segmented choice in our design; no reference shows that shape (Unanswered).

## Acting on account X: banner and support-reason prompt (`/platform/accounts/[accountId]/…`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/198d69ec-5473-43de-a6ad-26f68f3dda91 | YNAB, "Support Access Mode" | the access choice is explicit with the default "Don't allow" set; the expiry is written in plain words ("disabled after 60 days"); the save action stays disabled until a choice is made; a banner at the top states that access is enabled and gives the date it ends | the customer-facing data-use paragraph (WEB-4 has no consent copy for merchants); the greyed "Contact Us" button |
| https://mobbin.com/screens/004dcbc3-1172-4081-b439-6b73cdcd5c31 | Etsy, pending-closure banner (also listed under lifecycle) | a fixed full-width banner with one action, visible on every page of the account | the red colour: red is also the usual error colour, and web.md §3.5 asks for a colour no merchant screen uses; the colour token is open |

No reference shows an impersonation or "viewing as" banner with an exit control. Two searches with that wording returned an image-saving app, a marketplace, a privacy tool and a budgeting app only. The "Acting on account X" banner, its exit control and the reason prompt before the first cross-tenant read (web.md §3.5) therefore have no visual reference beyond the two above.

## Outbox console (`/platform/outbox`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/af871c1d-00d1-4c74-a4a4-87ae2e9455c8 | Buffer, "All Channels" queue (status tabs Queue, Drafts, Approvals, Sent with counts; failed rows show the error in a red line above the row and a per-row "Retry Now") | status tabs with a count each, so rows by status read as the top layer; the failed reason sits on the row it belongs to, and the retry is on that row | the generic error text "An unknown error has occurred ... get in touch if this persists"; the outbox must show the stable error code and the attempt count; "Retry Now" fires with no confirm |
| https://mobbin.com/screens/88aed5b3-f244-49e5-94c6-a8b8df2790be | AirOps, "Content Production ... Prompts" review (search, "Decline All" and "Accept All" in the header, a checkbox and a per-row accept and decline) | bulk actions in the header beside the search; a row checkbox for selection; per-row actions at the row's end | bulk "Accept All" with no count and no confirm; the replay of dead rows in bulk must name how many rows it replays and ask once |
| https://mobbin.com/screens/1ddd873b-8113-4da3-9f53-2373318e9dd5 | Gumloop, "Flow Run" side drawer (summary: trigger, status, started, duration, credits; a run-details block; outputs as a code block; footer "View Run" and "Copy URL") | a row's detail opens in a right-hand drawer, so the list stays in view; the summary block of status, start and duration; the payload as a code block | the drawer's footer with "Copy URL" as the only action; the replay action is not in this drawer and must be added for WEB-4 |
| https://mobbin.com/screens/3c6c8389-0baa-4710-951c-772c518fbf16 | Snowflake, "Query" detail with a Failed chip (status, duration, start and end, the error message under the statement) | the status chip with the word "Failed", the duration, and the error message printed under the payload that failed | the copy icon after every identifier; the statement truncated behind "Show more" hides the part a reviewer needs |

The bulk replay of dead rows needs a count-confirm and an audit reason; no reference shows that exact step (Unanswered).

## Platform staff and roles, TOTP reset (`/platform/staff`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/296bf689-9d82-403b-9481-5f3214552261 | Uxcel, "Make Prototype an admin?" (role change confirm) | the confirm names the new power in one sentence ("They will have full control of the team, including billing permissions"); Cancel and Confirm | the one-word confirm; the dialog does not say what the person loses |
| https://mobbin.com/screens/8488b6d8-0c86-4925-8c64-d6cac7a2bfed | Toggl Track, role picker in the invite dialog (radio list: Organization Admin, Workspace Admin, Project Lead, Analyst, Member, each with a sentence) | each role states what it can do in one sentence; a sub-option appears under the selected role only | the sub-options for every role shown at once (dense); the purple Save |
| https://mobbin.com/screens/37771764-76f3-4732-9f4c-341e39363712 | hilos, "Remove jdoe from ... Workspace?" | the dialog names the person and gives the consequence ("They'll lose access to every channel and DM here"); Cancel on the left, the red destructive action on the right | no reason captured; WEB-4 needs one for a staff removal if the owner rules so |
| https://mobbin.com/screens/666157c7-7bb0-41da-9749-acc697ef3ef8 | Grok, "Are you sure?" (removal with the dependent data: "Any API keys created by Alex will have to be deleted"; "you'll need to invite them again") | the dependent data is spelled out in the confirm; the reversal (invite again) is stated | the title "Are you sure?" with no object named; the black "Continue" for a destructive step |

TOTP reset of another staff member's second factor has no reference. The step-up before a sensitive action (below) is the nearest pattern.

## Second-factor reset and step-up (`/platform/staff`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/25cf1a04-3470-43eb-b512-18b43716b046 | Shopify, "Verify your account to continue" (a six-box authenticator code shown over the sensitive dialog) | the sensitive action asks for the operator's own code first, in a small modal over the page; the code boxes are one per digit | the dialog title does not say which action the code unlocks |
| https://mobbin.com/screens/b6216049-f735-4242-9efe-c83c7fc3f478 | Klaviyo, "Require multi-factor authentication" (also in WEB-3) | say what happens to each group at their next sign-in, before the confirm; Cancel and a confirm | it turns on a policy for all users; it is not a reset of one person's factor |

## Platform audit log (`/platform/audit`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/decad923-b3e9-4e22-8166-7b20e6c22140 | Customer.io, "Audit Logs" (a notice above the table; filter row with Date range, Team member, IP address and Event type; "Export CSV" in the header; rows with an expand chevron at the start and the timestamp at the end) | the filter row as named facets (actor, IP, event type, date); Export CSV beside the title; an expand control on each row for the full change | the account-verification notice on top, which is setup copy; the timestamp at the far end (check the mirror for Arabic) |
| https://mobbin.com/screens/1f44450b-8a6f-4d19-83e8-24addf2ca0e8 | Klaviyo, "Activity log" (also in WEB-3) | the "Last synced: now" stamp with refresh; a timeframe chip with Clear; the download uses the same filters | the full-screen overlay (WEB-4 keeps the page) |
| https://mobbin.com/screens/200aea49-95f5-44c3-872d-13ee256af405 | Gumloop, "Activity" (also in WEB-3) | the notice that says how far back the log reaches | the time histogram above the rows |
| https://mobbin.com/screens/9d1a56f8-9548-434d-a7c0-4ed5b2ab4a6b | Google Ads, "Change history" (also in WEB-3) | the "User / Date" column with the time under the name; the note that a change "can't be undone" | the metric cards above the table |

The platform audit log also has to show the support reason and the account for cross-tenant rows (web.md §3.5, `X-Support-Reason`). No reference shows a reason column in an audit table (Unanswered).

## Right-to-left and Arabic

- No reference in this set is Arabic or right-to-left. No Arabic-language search was run for WEB-4; the WEB-3 search found no RTL reference either, and none of the WEB-4 previews is Arabic.
- Mirror rules of web.md §5 apply to every reference: the row menu, the banner action and the drawer edge move to the start edge in Arabic; chevrons and back arrows mirror; the lock, checkmark and status icons do not.
- Identifiers (account numbers, IP addresses, emails, codes, amounts) render with `<bdi dir="ltr">`; no reference shows this.
- Latin digits, Gregorian dates and Asia/Riyadh time (web.md §5) have no reference; the Toggl and Customer.io previews show Latin digits only.

## Unanswered

- Acting-on-account banner and the support-reason prompt before the first read: no reference shows an impersonation or "viewing as" banner with an exit control, or a reason prompt before access.
- Provisioning form with several sections (name, locale, limits, modules, owner invite): no reference.
- Per-account feature flag with a reason, and a three-state rollout control (off, allowlist, all): no reference.
- Reactivate after suspend: only the WEB-3 Workable pattern; no platform example.
- Close: is it reversible? Only the Etsy banner shows a reversal window; if WEB-4's close is terminal, that banner does not apply.
- Bulk replay of dead outbox rows: no reference shows a count-confirm for a bulk replay.
- Admin reset of another staff member's TOTP with a reason: no reference.
- Reason on staff removal and on suspend: no reference shows a required reason beside a destructive confirm on a platform console (the 7shifts reason select in WEB-3 is the nearest).
- Red as the banner colour versus the error colour (web.md §3.5 asks for a colour no merchant screen uses): the token is an owner or design decision.
- RTL and Arabic: no Arabic or RTL reference for any WEB-4 screen. A review of the Arabic layout is needed before sign-off (the same gap as WEB-2 and WEB-3).
- Mobbin previews only: every observation comes from preview images and flow titles read on 2026-11-02. Exact copy, validation, timing and colours are unverified.
