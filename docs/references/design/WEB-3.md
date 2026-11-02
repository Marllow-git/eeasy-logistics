# WEB-3 · Merchant settings screens — design references

Found and read on 2026-11-02 with the Mobbin MCP (platform `web`, `search_screens` and `search_flows`). Saved to the Mobbin collection "eeasy-logistics · WEB-3" (https://mobbin.com/collections/572a7d58-1141-4e36-bc08-b4d119d34bd9), 30 items. Scope and rules from: `docs/roadmap.md` row WEB-3; `docs/architecture/web.md` §1 (route groups and layout), §4 (authorization in the UI: `getMe`, route manifest, `<Can>`, site scoping), §5 (bilingual fields, logical CSS, `dir`), §6.3 (`DataTable`, `Form`, `BilingualInput`, `StatusChip`, `ConflictNotice`), §8 wave 0 rows for Home, Account settings, Members, Sites and Audit log; `docs/handbook/04-conventions.md` "Design references". The notes come from Mobbin preview images and flow titles. No reference was opened in a live product, so exact copy, timing and validation are unverified. The merchant screens mirror for Arabic (ADR-0016); no reference is Arabic or RTL (see the RTL section).

## Summary for the lead

- Two to four references per family. Members and invite: Bonsai, Browserbase, Searchable. Revoke and deactivate with consequences: Jobber, 7shifts, Square, Workable. Sites and hours: Square (business hours per weekday), Deputy (location list), Aboard (address search with a map pin). Audit log: Klaviyo, Gumloop, Snowflake, Google Ads, Base44. Account settings: Base44, Klaviyo, Meetup, WeTransfer. Second-factor requirement and reset: Klaviyo, Calendly. Permission gating: incident.io, Calendly.
- Take per-section Save with a disabled button until a change is made (Klaviyo, Meetup), and the consequence sentence in every destructive dialog (Jobber, Square, Workable, 7shifts). Keep it to one dialog with Cancel and a red confirm, as Square and Jobber do.
- Members status: a row status chip plus an All / Pending tab pair (Searchable). Invite is a dialog with email, role and access per row; the access dropdown offers "All" with a note that it includes future items (Browserbase), which is the pattern for "all sites".
- Audit log: a filter row of dropdowns, a search, a date-range chip with Clear, a "last synced" stamp, and a retention notice above the table (Klaviyo, Gumloop, Base44, Snowflake). No reference shows cursor "load more" paging; the table skeleton is from Unify.
- Empty states: one plain sentence plus one primary action, no mascot (Sprig, Shopify); the Home modules show their own empty line each (Attio, incident.io).
- No Mobbin reference shows a bilingual name pair (Arabic and English inputs for one name), a National Address short code, or an Arabic or RTL layout. Those parts of WEB-3 have no reference (Unanswered).

## Account settings (`/settings/account`)

Covers intake rule, max attempts, proof policy, reason codes with Arabic and English labels, auto-dispatch, second-factor requirement and allowed COD methods.

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/8f24f2cf-9305-45b0-b031-e4d8537737e4 | Base44, "Preferences" settings page | a left list of sections and grouped cards, one card per topic; the two-factor card lists each method with a one-line description and an "Enable" action | the rows that offer upgrades and the connected-account rows; a card holds one topic only |
| https://mobbin.com/screens/09574b00-25ec-4f85-aaf0-0e65323d88a3 | Klaviyo, personal settings with grouped cards | each card has its own Save button; a live preview under the regional format select shows what the choice produces | the many tabs across the top; the physical-layout tabs above the cards |
| https://mobbin.com/screens/51dd7316-557c-4b58-a50c-b30dfa7e5652 | Meetup, "Account management" | Save disabled until a field changes; help text under the time-zone select explains its effect; the password row states that other sessions end | the side navigation with many items; the deactivate-account link at the foot |
| https://mobbin.com/screens/ea913d90-3ae3-4353-ab2b-a43e7f4c22d3 | WeTransfer, "Profile and security" | a section list at the side that jumps to each section of one long page | the avatar block; the right-hand section list (it moves to the start edge in Arabic; check the mirror) |
| https://mobbin.com/screens/b6216049-f735-4242-9efe-c83c7fc3f478 | Klaviyo, "Require multi-factor authentication" confirmation | the second-factor requirement is switched on in a dialog that says who is affected ("existing users ... will be required to set it up the next time they log in"), with Cancel and a confirm button | the red warning row above the list; the "Set up" buttons with red dots |

Reason-code labels (Arabic and English, one row each) and the COD-method checklist have no reference. The bilingual pair is covered in the bilingual section below.

## Home (`/`, visible modules)

Home shows only the modules the account can see (`docs/architecture/web.md` §4); a module with no content still needs one line.

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/612b31fa-ffd1-4da4-8b40-134a7a03851f | Attio, home with separate "Meetings" and "Tasks" modules | each module has its own heading and count, and its own empty line with one action ("Next day with meetings", "New task") | the chat-first input at the top; the "Getting started" counter at the foot |
| https://mobbin.com/screens/ade5a045-319d-43f7-8200-9b95bb24ae67 | incident.io, "Home" with no active incidents | the empty module says what state it is in, in one line, next to a filter for the list | the joke copy ("Silence is golden"); the blocking "Declare" button, which is not a WEB-3 action |
| https://mobbin.com/screens/02f3ee8b-2206-400a-8868-21d3c3b72be5 | Base44, home as a grid of cards with a title each | a grid of equal cards, each with a title, a short description and its state | the promotional banner with a countdown; the gradient hero |

## Members list, status and site filters (`/settings/members`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/92365a5f-7639-4187-9b21-8ecaa0762f8e | Searchable, "Inviting teammates" (team settings) | a table of name, role and status; the status chip reads "Active" or "Pending" with the words, and the list has All and Pending tabs as the status filter | the brand-modal frame; the "last active" column, which WEB-3 does not show |
| https://mobbin.com/flows/8e5cd60b-8667-4a6f-9308-cd5f55341af5 | Bonsai, "Inviting a member" (settings, Team tab) | a settings tab with the member table (name, email, role pill, projects, joined); "Invite pending" as the state of a row; a toast "Invite sent." after the send | the initials avatars; the green primary button colour |
| https://mobbin.com/flows/9e76f810-f90a-488e-a2bd-2fa559a8bd00 | Browserbase, "Inviting a member" | per-row email, role and access; the access select lists single items and an "All" option whose text says it includes future items | the three empty rows shown by default; the bulk send row |

The Members status filter and the role column follow `DataTable` (web.md §6.3): status and role as text with the chip, sorted and filtered on the server. The filter has no reference beyond the Searchable tabs (Unanswered).

## Invite member dialog (email, name, roles, sites)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/8e5cd60b-8667-4a6f-9308-cd5f55341af5 | Bonsai, "Inviting a member" (modal: Email, Role, Projects, then "Invite team member") | one modal, three fields in order, a single primary button that stays disabled until the email is typed | the top-level "Projects" select with no "all" option; WEB-3 needs the sites list and a "all sites" choice |
| https://mobbin.com/flows/9e76f810-f90a-488e-a2bd-2fa559a8bd00 | Browserbase, "Inviting a member" (access select: single item, then "All ... access to current and future") | the site-access choice as a checklist under the field with an explicit "all" line that explains future sites; the role beside it | the orange button; the "People with access" disclosure, which WEB-3 does not show |
| https://mobbin.com/flows/92365a5f-7639-4187-9b21-8ecaa0762f8e | Searchable, "Inviting teammates" (pending invitation list after the send) | the pending row shows the role and the state "Pending" until the invitee accepts, which matches the invitation flow of WEB-2 | the email-only entry with an "Add" button per line |

Roles are a multi-select in WEB-3 (the list of roles on the invite). No reference shows a multi-role picker; the Bonsai and Browserbase selects are single-value (Unanswered).

## Member detail and edit (roles, sites), revoke

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/3df6b185-fe8c-4b8e-842c-d14cfa3d5787 | Square, "Deactivating a team member" (side panel for one member: an invitation banner "hasn't accepted yet", a Permissions section with an Edit link, then the actions in an overflow menu) | the detail panel with the status banner at the top and each section's own Edit link; revoke in the overflow menu, not beside Edit | the calendar colour and the bookable-hours block; the permissions summary with its long feature list |
| https://mobbin.com/flows/b5372408-f181-4a69-b373-e47eb69cc254 | Jobber, "Deactivating a user" (list, then confirm, then the row reads "Deactivated") | the revoke dialog lists what happens in bullets; after the action the row keeps its name and reads "Deactivated"; a toast confirms | the video card beside the table; the trial banner |
| https://mobbin.com/flows/bc2d4066-14ed-4a6c-9fbd-1b4ba0da07fc | 7shifts, "Deactivating an employee" (bullets of effects, a reason select, a free-text comment, "Deactivate ... now") | the reason as a select with a comment box beside it, both on the same dialog as the confirm, so a revoke records why; the inactive record with a Reactivate action at the top | the "rehire" question; the termination-date field, which the merchant revoke does not use |
| https://mobbin.com/screens/6afa165c-1cca-41b5-a9ef-62d3913d5996 | Calendly, "Editing permissions" (list of people with their role in brackets, a note that owners and admins can always edit) | the note of who can change the list, and each person shown with a role in brackets | the search box that adds people without a role; WEB-3 adds members from the invite only |

Edit of roles and sites on the detail page: the Square side panel and the Calendly list are the closest. Revoke and deactivate are the same action in WEB-3 (the members API has `revokeMember`), so the copy must say what stops (sign-in and the sessions) and what is kept (the audit trail), as Jobber does.

## Second-factor reset with a reason (`/settings/members/[memberId]`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/12ba8949-597b-43f8-bb9e-fed3e19c3410 | Calendly, "Disable setting: Two-factor authentication" | a warning callout in the dialog ("reduces your account's security"), a re-check field before the red action, Cancel and a red confirm | the toggle row behind the dialog |
| https://mobbin.com/flows/bc2d4066-14ed-4a6c-9fbd-1b4ba0da07fc | 7shifts, "Deactivating an employee" (reason select and free-text comment on the same dialog) | the reason as a required select and an optional comment, both on the confirm dialog | the rehire radio |
| https://mobbin.com/screens/b6216049-f735-4242-9efe-c83c7fc3f478 | Klaviyo, "Require multi-factor authentication" | say what happens to each user group at the next sign-in, before the confirm | the fact that the reference turns on a policy, not a reset of one person |

No reference shows a reset of another person's second factor. The reason list (fixed codes or free text) and its Arabic and English labels have no reference (Unanswered).

## Permission-gated controls (`<Can>`, web.md §4)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/1956c3a9-5676-47f2-9d02-957e1e7c66f3 | incident.io, "Permissions" (base roles with the count of users in each; the info icon on "Has all permissions"; custom roles behind a badge) | each role row states its count and what it grants; a locked item says why it is locked (the badge) | the plan badge and the Upgrade button on custom roles; WEB-3 hides a module with no feature (K-6, web.md §4), it does not sell it |
| https://mobbin.com/screens/dbe98df6-d6cc-4be3-8bc2-4da72a5873a2 | Base44, tools panel with a read-only operations set (Read ticked; Create, Update, Delete shown but not allowed) | the operations a role may use shown as separate checkboxes, with the ones it may not use visible and not ticked | the greyed-out "All Entity Slots Used" item, which is a locked choice without its reason beside it |
| https://mobbin.com/screens/6afa165c-1cca-41b5-a9ef-62d3913d5996 | Calendly, "Editing permissions" | the explanation of who may edit, under the heading | the add-user field that is always on |

No reference was found for a disabled button with a tooltip that names the missing permission. web.md §4 asks for a disabled control "with an explanation"; the copy and placement are not in any reference (Unanswered).

## Sites list and detail (`/settings/sites`, `/settings/sites/[siteId]`)

Covers kind, bilingual names, address, National Address short code, a map pin (point), opening hours per weekday, activate and deactivate. Five references, one above the two-to-four range, because the add-flow reference (Deputy) is the only one that shows the steps of a site.

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/22bf27cd-1941-4096-bd37-ed28b019ef36 | Square, "Setting up location" (business hours: one row per weekday, a checkbox to open the day, from and to time fields that grey out for a closed day, a time-zone select above the rows) | one row per weekday with the same two time fields; a closed day shows its fields disabled; time zone set once above the rows | the marketing step (business description, photos, "Get started with Square Go") and the 9:30 start that is preset on Monday |
| https://mobbin.com/flows/e5193e0d-06af-4ccc-9a54-b02fbab13eab | Aboard, "Adding a workplace" (address search, then the name filled from the address, then a time-zone select, then a map with a pin on the address) | the address search places the pin, and the pin is the point the site needs; the name is editable after it fills | the emoji and colour picks; the name fill-in, which for WEB-3 must be a bilingual pair, not one name |
| https://mobbin.com/flows/485e7870-8fd1-4ec9-8840-e4effc2978c4 | Deputy, "Adding a location" (steps with a progress bar; a yes/no switch for "has a physical address") | the step structure for a site: name, then address, then hours; a one-line hint under a switch | the "areas of work" step, which is not a WEB-3 concept |
| https://mobbin.com/flows/08b28fb7-c56a-4428-a8a3-85b2076d6675 | Deputy, "Locations" (table: location name, address, the "Edit Settings" action per row; a map view and a snapshot view as tabs over the same list) | the list with name, address and one row action; the map as a view of the same list, not a second page | the Google map styling and its attribution bar (the map is `MapProvider`, web.md §6.4); the right-hand teams panel |
| https://mobbin.com/flows/39b6b356-18cb-401b-8b4f-a2061380d413 | Workable, "Deactivating features" (confirm dialog: what users lose, "You can reactivate ... at any time"; the deactivated page with a green "Activate now" and a toast) | the deactivate dialog says what stops and that the action reverses; the page of a deactivated item shows its state and the single activate action | the feature list and its illustrations |

Sites have no reference for a National Address short code, for the kind selector, or for bilingual names. The short-code field and the Arabic and English name pair need the bilingual section below and a design decision (Unanswered).

## Bilingual field pairs (`name_ar` and `name_en`, web.md §5)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/6d186f22-7865-491d-999c-3cb7d24417a9 | ZARA, "New address" (name and surname in one row; the phone prefix as its own short field beside the number) | a prefix and a number as two inputs, the short one narrower; the labels above the fields | the uppercase labels; the underline-only inputs |
| https://mobbin.com/screens/4aed33da-0cc0-4cf7-b679-9c0e2a83a120 | Klaviyo, "Where's your business registered?" (legal name with a one-line rule under it: "Must match the legal business name ...") | a helper line under a name field that says what the value must match | the radio question under the name |

No reference shows two inputs for one name in two languages, with Arabic first. The web.md §5 rule (Arabic first, each with its own `dir`) is from the architecture, not from a reference. Mobbin's Square "Tell us about your business" (https://mobbin.com/screens/bd2e6dca-b375-4b32-a677-98b1cbda9544) has one name field only.

## Audit log table with filters and cursor paging (`/settings/audit`)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/1f44450b-8a6f-4d19-83e8-24addf2ca0e8 | Klaviyo, "Activity log" (search by ID or value; Users, Roles and Action selects; a "Last week" date chip with Clear; a "Last synced: now" stamp with refresh; Download report) | the filter row above the table in this order, the applied date chip with a Clear, a last-synced line, and a download control that uses the same filters | the full-screen overlay (WEB-3 keeps the page); the sentence-case action text in the rows, which reads as a message, not as an event code |
| https://mobbin.com/screens/200aea49-95f5-44c3-872d-13ee256af405 | Gumloop, "Activity" (a notice above the table: "Showing activity from ... because your plan limits activity history"; a Filters button; columns for time, user, source) | a notice that says how far back the log reaches, placed above the table; the time column first | the time histogram above the rows; the plan wording (WEB-3 has no plan limit, so the notice must state the retention the platform actually keeps) |
| https://mobbin.com/screens/ad4cad64-a7ce-44d9-8be6-ffe9ceb1619f | Snowflake, "Query History" (status, user and date filter chips; "Filters 4" with a count; "15 Queries" count; status with an icon and the word "Success" or "Failed") | the applied filters as chips with a count, the result count, and a status that carries an icon and a word (StatusChip rule, web.md §6.3) | the eight-column dense table with truncated text; the SQL text column, which truncates long statements |
| https://mobbin.com/screens/4b32f017-4d8d-4946-9184-f654511a4829 | Base44, "Logs Explorer" (a search "Filter by email" in the table head; an "All events" select; an "Errors only" checkbox) | a text filter for the actor (email) with a select for the event type and one checkbox for a narrow case | the dark side menu |
| https://mobbin.com/screens/9d1a56f8-9548-434d-a7c0-4ed5b2ab4a6b | Google Ads, "Change history" (date range button with the range written out; filter chips above the table; a "User / Date" column with the date under the name) | the date range written as dates, a "User / Date" column that puts the time under the name | the overview metric cards above the table; the icon row of Metrics, Adjust and Download above the chart |
| https://mobbin.com/screens/be3c7516-09ef-469f-a861-f08395a61f38 | Unify, a table while it loads ("Assembling your list", skeleton rows under the column headers, a Cancel action) | the column headers stay in place and skeleton rows fill the body; a loading line says what is loading | the cancel for a list load (WEB-3's audit load is a read and has no cancel) |

Cursor paging: no reference shows a "Load more" control under an audit table. The web.md §6.3 `DataTable` rule (cursor paging with "load more", no page numbers, ADR-0029) has no Mobbin example in this set (Unanswered).

## Empty states (across the families)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/20b41041-1173-4e0f-af93-10be683f33e1 | Sprig, "Studies" with no items ("Your studies will appear here", "Get started by adding your first study") | a heading, a one-line explanation and the primary action; the empty area keeps the filters visible | the illustration in grey; the Free plan tag |
| https://mobbin.com/screens/5ce950f4-f624-482f-817c-42c390e84a5c | Shopify, "Customers" with no items (a one-line title, "Add customer" and "Import customers", a "Learn more" link under) | a primary action and a secondary action side by side, and a documentation link under them | the marketing band with app suggestions below |
| https://mobbin.com/screens/852cbc29-9ba0-42d0-b04b-8ce2660f2813 | Klaviyo, a list with no members ("There isn't anyone in this list", a list of the ways to add) | the empty heading names the object; the way out is a list of actions, not a single one | the five-option list; WEB-3 has one way to add a member (invite) |

No reference shows an empty state after a filter returns nothing ("no results for these filters, clear filters"). That state is needed for the members and audit filters (Unanswered).

## Right-to-left and Arabic

- Searches for an Arabic or right-to-left settings, dashboard or form screen returned Klaviyo's reviews settings, Microsoft Copilot's settings (Arabic chosen as the voice language, the layout stays left-to-right), Shopify's language list and Gemini NotebookLM's settings. None is a right-to-left layout.
- The logical-CSS and mirror rules (web.md §5) apply to every reference above. Chevrons and back arrows mirror; checkmarks and the map pin do not (web.md §5).
- The digits, dates and money rules of web.md §5 (Latin digits, Gregorian dates, `Asia/Riyadh`) have no reference. Klaviyo's personal-settings preview shows Latin digits and English dates only.

## Unanswered

- Bilingual field pairs: no reference shows Arabic and English inputs for one name. The pair layout (Arabic first, each `dir` set) and the labels of reason codes need a design decision.
- National Address short code: no reference found. The field's format, placement and error copy are open.
- Second-factor reset reason: no reference shows an admin reset of another person's second factor. Whether the reason is a fixed list or free text, and its labels, are open.
- Permission-gated control: no reference shows a disabled control with a tooltip that names the missing permission. The placement of the explanation is open.
- Cursor "load more" for the audit table: no reference shows it.
- Empty state after filters return nothing: no reference.
- Multi-role picker on invite and member edit: the references show single-value role selects only.
- RTL and Arabic: no Arabic or right-to-left reference for any WEB-3 screen. A review of the Arabic layout is needed before sign-off (the same gap as WEB-2).
- Mobbin previews only: every observation comes from preview images and flow titles read on 2026-11-02. Exact copy, validation and timing are unverified.
