# Merchant comfort catalogue · 2026-11-03

**Order:** RES-2, merchant comfort catalogue. **Date:** 2026-11-03. **Author:** researcher agent for the lead.

**Purpose.** The feature book (`docs/research/feature-book/00-index.md`, 283 rows) lists what the platform does. This note lists the layer below: the small conveniences competitors ship that make daily work fast and pleasant, which the feature book does not list as rows. Each item says what the merchant gets, where the market shows it, what the API must offer, and which roadmap order or proposal it belongs to. Items that refine an existing feature-book row say so; they are not new rows.

**Sources.** Repository notes read 2026-11-03 (their own reads are dated 2026-11-02): the eight teardowns, `shiphero-teardown-2026-11.md`, `platform-comparison-2026-11.md`, `feature-coverage-2026-11.md`, `ksa-platform-census-2026-11.md`, and the feature-book index and chapter headings. Roadmap order ids from `docs/roadmap.md` §1. Mobbin screens read 2026-11-03 (search_screens, standard mode). Public web pages read 2026-11-03. The full source list is at the end.

**Limits.**
- No logged-in access to any competitor. Most competitor evidence comes from public help centres, marketing pages and search summaries.
- Web items marked [S] are search-result summaries, not fetched pages. The Onfleet support site returned a TLS error, so Onfleet rests on search summaries only.
- Mobbin returned no Arabic-language or right-to-left merchant screen for any query. Arabic and RTL items therefore rest on the repository, not on screenshots.
- Shopify's official keyboard page (fetched) confirms `?` for the shortcut list and `A` then `P` for add product. A search summary also gives `S` for search, `F` for filters and `GO` for orders; the fetched page did not list them, so they are not counted here.
- Items marked "proposal" have no competitor or repository citation. They are our own suggestions.

---

## 1. Catalogue

The table holds 96 items, inside the brief's range of 60 to 120. Items are grouped by theme. "Maps to" names an existing roadmap id where one fits, a feature-book chapter row where the item refines one, a proposal id from the feature-coverage or feature-book registry, or "new" with a pointer to §3.

### 1.1 Finding things (search, filters, saved views)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-1 | One search box, reached by `/` or Ctrl or ⌘ plus K, that finds orders, recipients, drivers, stops, SKUs and sites | Any record in two keystrokes without knowing which list holds it | Shopify admin search with ⌘K [M14]; Shopify help says press `?` for shortcuts [W1]; incident.io and Base44 palettes [M10, M11] | Account-scoped search endpoint over indexed names and ids; no personal data in logs | new (§3 SRCH-1) |
| C-2 | Search by any identifier: order number with or without `D-`, tracking number, AWB, phone in any format | A pasted number from WhatsApp or a label works without edits | Torod lookup by AWB, order id or mobile [TOR §2 "Public tracking"]; COD search by name, number, email or tracking [TOR §2 "COD search"]; order number already accepts both forms [FB ch.01 §1.9] | `q` on list endpoints across number, source reference, tracking and normalised phone | WEB-5 (refines FB ch.01 §1.9) |
| C-3 | Scanner input in the search box: a scan lands in search and opens the match | Warehouse and dispatch staff skip typing | Bluetooth HID scanners with no pairing step [SHB §1.10]; barcode scanning throughout the driver app [LGT §1.2] | A parcel barcode column with a unique index and a lookup; FB index §2 notes no scannable parcel identifier exists beyond number and source reference | new (parcel barcode; owner of HUB-1 or WMS-7) |
| C-4 | Arabic search that ignores hamza and alef forms, ta marbuta and tashkeel, and matches Arabic-Indic and Western digits alike | An Arabic-typing merchant finds the record whichever spelling was entered | proposal; no teardown reports Arabic search normalisation | Normalised search column per name field, built on write | WEB-1, new (SRCH-1) |
| C-5 | Phone entry accepts `05…`, `5…`, `966…` and `+966` forms, and Arabic-Indic digits typed on an Arabic keyboard; stored as E.164 | No retyping when a customer gives the number in another form | E.164 normalisation is already specified [FB ch.03 §1, ch.04 §1]; Arabic-Indic input is a proposal | Normaliser on write (specified); input mask in the client | DEL-2, DEL-4 (refines) |
| C-6 | Named saved views per list: filters, visible columns, column order, sort and page size; private or shared with a site | Triage is reused each shift without rebuilding filters | Shopify saved views keep filters, column choices, column order and sort order [W2, W3, S]; Square list tabs and filter chips on one list [M1] (tabs, not saved views) | `saved_views` table (account, user, site, JSON query, columns, sort); list endpoints accept the same allowlisted keys | new (§3 PREF-1) |
| C-7 | Status tabs with counts on the orders list | One click to "Active" and the number before the click | Square All, Active, Scheduled, Completed, Canceled tabs [M1] | Grouped count endpoint using the same filter parameters as the list | WEB-5 |
| C-8 | Filter chips that show each active filter, remove one at a time, and offer Clear all | The merchant sees why a list is short | Square filter chips and Clear all [M1]; Klaviyo "Change or remove applied filters" [M2] | None, UI only | WEB-5 |
| C-9 | An empty result says how many rows the filters hid, and the unfiltered total is one click away | The merchant knows the data exists before assuming it is missing | Klaviyo empty result with a 30-day window note [M2] (partial) | Response includes the unfiltered total or a cheap count | WEB-5 |
| C-10 | "Last updated" time on each list, and a refresh that keeps filters, selection and scroll | The merchant trusts the list is current | Square "Last updated" line [M1] | `updated_at` on list rows; refresh reuses the same query | WEB-5, FB ch.02 F19 (live twin) |
| C-11 | Sort on any visible column; the sort is kept in a saved view and the default is set by the merchant | Sort by COD amount or time window in one click | Square column sort arrow on All orders [M1] | Whitelisted sort keys with indexes | WEB-5 |
| C-12 | Column chooser: show, hide and reorder columns, kept per user | The list shows the columns the merchant's job needs | Shopify keeps column choices in views [W3, S]; a Display menu on incident.io's list [M5] | Stored with `saved_views` or user preferences | new (§3 PREF-1) |
| C-13 | Date presets (today, yesterday, this week, last 30 days) resolved in the account time zone and business day | "Today" means the Riyadh business day, not the UTC day | Square date range control on All orders [M1]; time zone and business date rules [FB ch.12 F21] | Preset resolved on the server from the account time zone | WEB-5, FB ch.12 F21 (refines) |
| C-14 | System triage views shipped with the product: needs a driver, failed today, COD not collected, on hold, pickup overdue | A new merchant sees useful lists on day one | Anchanto exception and missed-SLA alerts for delayed parcels [ANC §3.4]; Wasal "today's overview" of attempts and success rate [WSL §2.8] | Saved views with system presets; no table beyond C-6 | DEL-21 (proposal), WEB-7 |

### 1.2 Doing many at once (bulk, import, templates, duplicate)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-15 | Select all matching the filter, not only the visible page, with a banner that shows the count | Acts on 340 orders without paging | Calendly "Select all 5 contacts" banner over the selection bar [M8] | Bulk endpoint takes a filter snapshot and an expected count, and rejects when the count has moved | FB ch.01 §1.15 (refines the bulk row) |
| C-16 | Sticky selection bar with the count, the bulk actions and Deselect all | Actions stay in view while the list scrolls | incident.io "2 / 3 selected · Bulk action · Deselect all" [M5]; Calendly bar [M8] | None, UI only | FB ch.01 §1.15 (refines) |
| C-17 | Per-row result after a bulk action: "38 done, 2 failed", the reason for each failed row, and retry for those rows only | No guessing which of 40 orders changed | Feature book already proposes per-row results and no all-or-nothing [FB ch.01 §1.15]; Torod bulk ship and hide shows no result view [TOR §2 "Bulk and hide"] (partial) | Bulk endpoint returns a status per row; each row keeps its own version check | FB ch.01 §1.15 (refines) |
| C-18 | Bulk edit grid for a few fields across rows (price, weight, bin, tag), with paste from a spreadsheet and a preview of changes | Fixing 200 SKUs in one sitting | Square bulk edit grid [M7]; Salla bulk edit of products [W5, title only]; ShipHero bulk inventory CSV up to 3,000 lines [SHB §1.1] | Bulk endpoint with per-row results; stock changes only by adjustments, never by editing ledger rows [ADR-0011] | WMS-2, WEB-13 |
| C-19 | Bulk tag or label on the selection, with remove | Fifty orders marked "fragile" in one action | Delphi bulk Tags and Revoke on selected rows [M9]; Omniful tags by hand or by condition [OMN §2.1 "Order tags"] | Bulk tag endpoint over the tag table | FB ch.01 §1.10 (refines; tags are already a row) |
| C-20 | Bulk print for a selection: labels, packing slips and pick lists in one PDF, in a sort the merchant picks | One print job per shift instead of one per order | Torod bulk printing of labels [TOR §2 "Labels and printing"]; ShipHero bulk ship labels for up to 1,000 identical orders [SHB §1.4]; Fulfillor bulk label printing, Sep 2026 [FUL §2 "Labels"] | Print-job endpoint returning a signed PDF link (60-minute print URL per FB ch.10) | FB ch.01 §1.9 and §1.15 (refines); DEL-20 (proposal); new (§3 PRINT-1) |
| C-21 | Bulk ship identical orders as one pick run | Same SKU set, one tote, one label batch | ShipHero Bulk Ship [SHB §1.4]; Fulfillor automatic picklists by carrier, Nov 2025 [FUL §2 "Pick-list automation"] | Pick-run grouping by SKU set | WMS-6 (refines) |
| C-22 | Reusable picklist templates | The same morning pick sheet without rebuilding it | Fulfillor reusable picklist templates, Jul 2026 [FUL §2 "Pick-list automation"] | Picklist template table, account scoped and versioned | WMS-6 |
| C-23 | Import with a template download and a column mapper that auto-matches headers and shows what will be skipped | "10 of 11 columns will import" is visible before commit | Calendly "10 / 11 columns will be imported" [M19]; Unify "Automatically mapped 2 of 4 columns" [M17]; Square "Do Not Import" option per column [M18]; Wasal CSV template with a required address column [WSL §2.2]; Tookan bulk import from a CSV template with a team choice [W8, S] | Preview endpoint returns the detected mapping and unmapped columns without writing | DEL-3 (refines) |
| C-24 | Import dry run: errors listed by row before anything is written, and an error file to fix and re-upload | No retyping a 300-row sheet after one bad cell | Snowflake "4 errors" with Load disabled until fixed [M16]; Fulfillor checks SKU and stock at import [FUL §2 "Order intake"] | Import job with staged rows and per-row error codes | DEL-3 (refines) |
| C-25 | Import appends and never overwrites existing orders by default; the screen states the rule; overwrite is an explicit switch with a count | Re-uploading a sheet does not double or wipe orders | AirOps "will append new data … will not overwrite existing data" [M20] | External reference as import key; unique constraint per account and reference; mode flag | DEL-3 |
| C-26 | Saved import mappings, reused for the same sheet type and optionally scheduled to repeat | Next week's sheet maps itself | Onfleet scheduled import "Schedule Import to repeat", with a confirmation and error report to the creator [W6, S]; Onfleet task templates applied through an import column [W7, S] | `import_mapping` table; schedule through the outbox job runner | new (§3 TPL-1); DEL-3 amendment |
| C-27 | Order templates: a saved set of service, COD default, notes and window for a repeat sender | A regular client's orders set once | Wasal route templates that pre-fill a new route [WSL §2.1 "Route templates"]; Onfleet task templates [W7, S] | `order_template` table; no stock or money effect | new (§3 TPL-1) |
| C-28 | Duplicate an order: copy recipient, items, service and window; drop number, COD collected and proofs | Repeat customers in two clicks | Wasal drivers may duplicate stops [WSL §2.3 "Driver permissions"]; Wasal route copy endpoint [WSL §2.1 "Route copy"] | Duplicate endpoint copying an allowlist of fields, with a new number and an idempotency key | WEB-5, FB ch.01 §1.6 (refines) |
| C-29 | Address book per recipient phone: last addresses first, with the pin the driver confirmed | A repeat recipient is one tap | Logestechs address filled from a name or id [LGT §1.1 "Address resolution"]; Wasal address dictation and label scan in the driver app [WSL §2.3] | `address_book` keyed on account and normalised phone; retention per Q-37 and Q-38 | DEL-14 (pin), INT-2 |
| C-30 | Bulk assign or unassign a driver for selected orders, with the reason and a preview | The dispatcher moves a set of orders in one step | Wasal auto-distribute with a preview and confirm [WSL §2.1 "Auto-distribute"]; "preview then confirm" [PCM §2]; Tookan bulk accept or decline for a mission task set [W10, S] | None beyond DEL-6 offers and DEL-10 preview; the bulk form is new | DEL-6, DEL-10 |
| C-31 | Photo of a printed waybill or customer list read into a form (OCR), reviewed before save | A paper-based sender needs no retyping | Wasal address label scan in the driver app [WSL §2.3]; Shipsy barcode decoder for damaged labels [SHP §2.1 "Proof of delivery"] | OCR needs a provider through the outbox; no provider in the roadmap | new (owner ruling; INT-1 storage) |
### 1.3 Safety (undo, restore, confirmations, drafts)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-32 | Undo for a single reversible action (unassign, move a stop, clear a hold, change a tag) for a short window | A misclick is reversed without a support ticket | No undo button found in the Mobbin results; Base44 confirms restores with a toast [M24] (partial) | Reversal call within a window; ledger actions are reversed only by compensating entries [ADR-0007, ADR-0011] | WEB-5 (proposal) |
| C-33 | Restore window for deleted non-ledger records (catalogue items, zones, templates, saved views, driver profiles): 30 days with days left shown | An accidental delete is recoverable | Salla restores deleted products and orders within 30 days, including in bulk [W4, S]; Base44 move to trash and Recently deleted with "29 days left to restore" [M6, M24]; AirOps Trash, auto-purged after 30 days, with bulk Restore [M21] | `deleted_at` and a restore endpoint on non-ledger tables only; orders are cancelled, never deleted | WMS-2, PLAT-12 (refines) |
| C-34 | Typed confirmation for permanent deletes: the merchant types the record name or the count | Bulk misclicks cannot delete | Calendly delete with an "I understand" checkbox [M8]; Replit delete with the app name shown [M22] | None beyond the confirmation step; the server re-checks the role | WEB-1 (pattern); PLAT-10 |
| C-35 | Confirmation text names the side effect: "This will not notify the recipient", "This releases the stock reservation" | The merchant knows the consequence before pressing | incident.io merge dialog "Your workflows will not be triggered by this change" [M5] | Server returns the list of effects with the preview, so the text matches the real action | WEB-5, INT-3 (ADR-0041) |
| C-36 | Drafts kept on the device: unsaved create forms, import mappings and route plans come back after a reload, with a draft list | No lost work after a crash or a closed tab | Plane Drafts list with Delete draft and a "can't be undone" warning [M23] | Browser storage, excluded from recipient data; no server draft state for orders | WEB-5; DRV-2 pattern on mobile |
| C-37 | Stale-edit guard: a save on an order changed by someone else says who changed it and asks to reload | No silent overwrite between two staff | Feature book proposes a per-row version check [FB ch.01 §1.15]; no competitor source | Version column; writes carry the expected version; conflict returns the current state | DEL-2 (refines) |
| C-38 | Idempotent create from the web: a double click or a retry after a timeout creates one order | No duplicate orders on a slow network | Logestechs documents no idempotency key on create [LGT §3.4] (negative example); Fulfillor queues order creation through its API [FUL §1 point 5] | Idempotency-Key on create, with a key table and expiry | DEL-2, INT-9 |
| C-39 | Undo for a whole import batch within 24 hours, while no row has moved past "created" | A bad sheet is removed in one action | proposal; no competitor source | `import_batch_id` on rows; void only in pre-dispatch states; cancelled rows keep history | DEL-3 (proposal; owner ruling) |
| C-40 | A required reason for every cancel, fail or return, from a catalogue the merchant can edit | Reports stay comparable across months | Shipsy non-delivery reasons validated with the recipient [SHP §2.6 "Tracking and validation"]; ShipHero return reason codes and custom statuses [SHB §1.6] | Reason catalogue per account; reason code on the event | DEL-33 (proposal), DEL-18 |

### 1.4 Awareness (timelines, notifications, digests, alerts)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-41 | Account activity log for staff actions, filtered by person, action and order, with relative times and an exact time on hover | The owner sees what changed without asking | Square activity log with an "All events" filter and date groups [M26]; Plane activity with "24 minutes ago" and actor [M25] | Reads audit rows with filter parameters; export only through the audited path | PLAT-7 (list exists); DEL-21 (proposal) |
| C-42 | Order status stepper on the merchant order detail, with the time at each step | The order's life read in one glance | H&M order stepper: received, processed, shipped, delivered [M4]; ZARA steps (bought, sent, ready, delivered) [M3] | Derived from events; no new table | WEB-5 (view of FB ch.01 §1.17 timeline) |
| C-43 | Per-user alert settings: which events, in-app or email, and a daily digest instead of each event | Staff are not flooded | Fulfillor in-app alerts for new orders, ASNs, low stock and returns [FUL §2 "Low-stock thresholds"]; Safee sends alerts to email [SFE §3] | Preferences table per user; digest through the outbox | DEL-21 (proposal) |
| C-44 | Quiet hours for staff alerts in the account time zone, with an exemption for critical alerts | No 2 a.m. alert to a day-shift manager | Wasal restriction periods for recipient messages [WSL §2.5 "Channels"] | Per-user window; critical class exempt; account time zone | DEL-21 (proposal); FB ch.05 F6 (recipient quiet hours) |
| C-45 | Daily summary email at a set time: unassigned orders, failed deliveries, COD not yet collected, cash not handed over | The morning picture without a login | Safee scheduled reports to named recipients with CC [SFE §2.1 "Trip and driver reports"]; Anchanto reports scheduled to download [ANC §3.2]; Wasal today's overview [WSL §2.8] | Scheduled job; email through the messaging port; no SMS before wave 3 [ADR-0037] | RPT-1 (proposal), DEL-21 |
| C-46 | KPI tile whose number opens the list it counts, with the same filter | The number and the list always agree | Anchanto control tower KPI panel with week-on-week and month-on-month change [ANC §3.4]; drill-through is a proposal; Square home totals [M31] | KPI endpoint returns the count and the saved-view query used by the list | DEL-17, WEB-18 |
| C-47 | Change against the previous period beside each KPI (day on day, week on week) in the same business day | Trends are visible at a glance | Anchanto week-on-week and month-on-month change [ANC §3.4]; Square "vs Prior Monday" [M31]; KPI panels with week-on-week change [PCM §2] | Previous-period query in the KPI endpoint | DEL-17 |
| C-48 | "Needs you" counts on every staff page: on hold, failed, cash block, expired document | Nothing waits unseen | Shopify home quick tasks with counts: "Fulfill orders 4", "Capture payments 1" [M15]; Anchanto exception alerts [ANC §3.4] | Counts endpoint, the same as C-46 | DEL-21, WEB-7 |
| C-49 | Snooze an alert for a SKU, location or order for a set number of days, shown in the list while it lasts | A known short item stops nagging | proposal; no competitor source | Snooze table with expiry | WMS-5, FB ch.08 §17 (refines) |
| C-50 | Expiry and low-stock alerts as a daily digest listing lots by days left | Expiry is handled in one sitting | Fulfillor expiry alerts for lot-controlled stock [FUL §2 "Expiry"]; facility low-stock thresholds [FUL §2 "Low-stock thresholds"] | Scheduled job over lot expiry (FEFO) | FB ch.08 §8 and §17 (refines) |
| C-51 | Live shipping board: remaining work and hourly pace per picker or packer | A supervisor sees the floor without walking it | ShipHero Live Shipping Board and HeroBoard [SHB §1.9]; picker report as CSV or PDF [SHB §1.9] | Labour events per person; labour is not in the roadmap | new (owner ruling) |

### 1.5 Speed (keyboard, command palette, defaults remembered)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-52 | Shortcut overlay opened by `?` with the list of shortcuts | Shortcuts are learned without a manual | Shopify `?` opens the shortcut list and `esc` closes it [W1]; Mercury shortcut overlay [M12] | None, UI only | WEB-1 |
| C-53 | Keyboard list navigation: arrow or `j` and `k` move the row, Enter opens, a key selects, `/` focuses search | Dispatch and returns work without the mouse | Mercury grid keys and select-all-rows shortcut [M12] | None, UI only | WEB-1, WEB-5 |
| C-54 | Command palette (⌘K or Ctrl+K) with navigation and actions: create order, add driver, switch site | Any page or action in a few keystrokes | incident.io palette with Actions and Navigation groups [M10]; Replit palette with Settings and Tools [M13]; Base44 with favourites and recents [M11] | Action registry that checks each action against the user's permissions (PLAT-10); no separate backend | WEB-1 (shell); SRCH-1 for entity hits |
| C-55 | Recent and pinned items: the last records opened, and pins the merchant sets | Returns to a driver or order in one step | Base44 Favorite and Recent entries in the palette and sidebar [M11] | `user_preferences` with a capped list of ids; no personal data copied | new (§3 PREF-1) |
| C-56 | Save and continue on create: sender, site, service and window stay, the recipient clears | Ten orders from one shop entered in a row | proposal; no competitor source | None; defaults from C-92 | DEL-2, WEB-5 |
| C-57 | Enter moves to the next field and Ctrl+Enter saves on every form | Keyboard-only entry | proposal; no competitor source | None, UI only | WEB-1 |
| C-58 | After each save the cursor returns to the scan or search field | A scanner flow needs no mouse | ShipHero scan-the-tote-then-order packing flow [SHB §1.5 "Packing flow"] | None, UI only | WEB-15 |
| C-59 | Auto-advance after a pack step, with "add another package" when an order has more parcels | Packing does not stop at each parcel | ShipHero "Add Another Package" with automation pre-assigning the box [SHB §1.5]; Anchanto skips multi-step packing when set [ANC §3.3] | None, UI only; multi-package model exists [FB ch.10] | WMS-7, WEB-15 |

### 1.6 Data ownership (exports, scheduled reports, print)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-60 | Export the filtered view as CSV or Excel with the chosen columns, in the account time zone, and a file name with account, site and range | The accountant gets what is on screen | Safee export to Excel or PDF [SFE §2.1]; Square Export on All orders [M1] | Export job with a signed URL (ShipHero signed URLs last 24 hours [SHB §1.9]) | RPT-1 (proposal) |
| C-61 | Every export and report download is audit-logged: who, when, which filter, how many rows | Accountability for recipient data | Audit log with list and export [roadmap PLAT-7]; PDPL duties [FB ch.14] | Audit row per export; file kept only for the signed-URL window | PLAT-7, RPT-1 |
| C-62 | Scheduled export to a named mailbox, using a saved view as the query | A weekly report without a login | Safee saved reports on a schedule [SFE §2.1]; ShipHero FULL and DELTA exports, weekly full on the free tier [SHB §1.9] | Scheduled job; recipient list; outbox | RPT-1, DEL-17 (amendment in [PCM §4]) |
| C-63 | Delta export: only rows changed since the last export | A smaller weekly sync to the accountant's system | ShipHero DELTA exports every six hours on the free tier and `updated_from` filter [SHB §1.9, §1.3] | `updated_at` cursor on each exported table | RPT-1 |
| C-64 | Printable proof-of-delivery PDF with photo, signature, time and COD, sent to the merchant or the recipient on request | Disputes are settled in minutes | Wasal POD exported as PDF and emailed as a summary [WSL §2.4]; DEL-7 PDF export amendment [PCM §4] | PDF from proof rows; signed URL | DEL-7 (amendment in [PCM §4]) |
| C-65 | Printable driver run sheet: stops in order, window, COD due, proof required, and a signature line | A driver with no signal still works | Anchanto manifests and delivery slips generated automatically [ANC §3.3]; Shipsy driver task list is linear, never map-first [SHP §2.1 "Driver app, task list"] | PDF from run data; no new state | new (§3 PRINT-1) |
| C-66 | Reprint a label with a reprint count and a reason recorded on the order | A printer failure is visible, not hidden | Feature book notes reprints are not defined in any row [FB ch.01 §1.9]; the count is a proposal | Reprint event with audit | DEL-20 (proposal), INT-8 |
| C-67 | Cash-day statement export: COD lines with handover and difference, as a file | The accountant reconciles without the cash desk | Torod COD statement with search by name, number or tracking [TOR §2 "COD search"]; Wasal expected, collected and pending totals [WSL §2.4] | Statement file over the custody entries (read-only) | DEL-23 (proposal); refines FB ch.06 §6.12 |

### 1.7 First run and empty states

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-68 | Setup checklist on the home with progress ("3 of 6") and a link to the screen for each step; hides when complete | A new merchant knows the next step | Square "Complete your setup 80%" in the sidebar [M1]; Shopify home task cards "1 of 2 tasks completed" [M15] | Counts derived from zones, drivers, sites and the first order; no table | WEB-3, WEB-1 |
| C-69 | Empty state with one primary action and one template link: "No drivers yet. Add a driver or download the sheet" | No blank page without a path | Square coupons empty state with Create Coupon [M28]; Sweatpals "You haven't created any perks yet" [M29]; Klaviyo "Create an app block" [M30]; Plane "Visualize your data" with Add widget [M27] | None, UI only; the template comes from DEL-3 | WEB-3, WEB-5, WEB-6 |
| C-70 | A demo or sample order to try the flow, marked SAMPLE and removable in one action | The merchant practises before real orders | proposal; a Logestechs 45-day free trial after a demo appears in a search summary [LGT §4.2, S] | Sample flag; must not touch stock or cash; owner ruling | new (owner ruling; FB ch.12 F15) |
| C-71 | Help collections in Arabic and English bundled with the screens: getting started, stops, drivers, proof, tracking, analytics | Help where the merchant is, in their language | Wasal help centre with six collections and 19 articles in Arabic and English, bundled with the app [WSL §2.8] | Static content; none | WEB-3, WEB-1 |
| C-72 | A "learn more" link beside a field that opens its article in the merchant's language | Answers at the field | Wasal help bundled per screen [WSL §2.8]; Anchanto multilingual help [ANC §3.4] | Static content | WEB-1 |
| C-73 | Import drivers from a sheet during setup | Driver roster in minutes | Safee drivers added by hand or by Excel import [SFE §2.3]; Wasal invite by name, email and phone [WSL §2.3] | Uses the DEL-3 pipeline | DEL-4, DEL-3 |
| C-74 | A first test order routed to a test driver through the real flow, with no charge and no recipient message | Trust before go-live | proposal; sandbox accounts are planned for integrators [roadmap OPS-7] | Test site and test flag; owner ruling on whether merchants get a sandbox | OPS-7 (scope extension) |
| C-75 | Dashboard tiles with no data say what fills them: "Appears after your first delivery" | The merchant knows the tile is not broken | Plane "Visualize your data how you want to" with Add widget [M27] (partial) | None, UI only | RPT-1, WEB-18 |

### 1.8 Arabic and right-to-left comfort

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-76 | Hijri date beside the Gregorian date on order, cash and driver screens; display only, stored and filtered as Gregorian | Saudi staff who think in Hijri | None in the teardowns; the four Mobbin results for an Arabic query showed no Arabic UI; web search found no delivery product with Hijri display. **Conflicts with AGENTS.md: "Gregorian dates, Western digits."** | Conversion helper tested against a reference table; no stored field | WEB-1; owner ruling (§4) |
| C-77 | Arabic-first labels and slips: recipient name and address as the merchant typed them, bidi-isolated so mixed text prints in order | Printed slips read correctly for Saudi couriers | Fulfillor states its Arabic invoices and labels conflict between pages [FUL §1 point 7]; Logestechs status labels in both languages [LGT §4.1] | Print template with bidi isolation | INT-8, WMS-7 (ADR-0014) |
| C-78 | Bilingual names for services, parcel types, reasons and products, showing the chosen language and falling back to the other | The catalogue reads in both languages | Logestechs names match English or Arabic and follow the request language [LGT §4.1]; Fulfillor offers 17 languages with no RTL statement [FUL §2 "Languages"] (gap) | `name_ar` and `name_en` on catalogue, service and reason tables | WMS-2, DEL-2 (ADR-0016) |
| C-79 | Address entry accepts Arabic or English district and city names and resolves to the same zone | Typing the Arabic district finds the zone | Logestechs address by exact Arabic or English name; a shared village name needs a city id [LGT §1.1] | Arabic aliases for zones and cities; normalisation in the geocoder | INT-2, DEL-1 |
| C-80 | National Address short-code box, and a paste of a map share link to set the pin | One paste fills the address and pin | Logestechs cites Saudi National Address, What3Words and Google Maps [LGT §1.8] (claim) | Short-code lookup behind the geocoder port | INT-2 (exists) |
| C-81 | Mirrored table layout in RTL; numbers stay Western digits and left-to-right inside their cells; Arabic collation for name sorts | Arabic lists read naturally | proposal for table details; layout rules are already in ADR-0016 and WEB-1 | Collation choice on name sorts; not verified | WEB-1 |
| C-82 | Mixed Arabic and English text in one field stays in order (bidi) in lists and on the tracking page | No garbled names | proposal; no competitor source | None | WEB-1, DEL-8 |
| C-83 | Amounts in SAR with two decimals, right-aligned with tabular figures; three-decimal GCC currencies when enabled | Cash counts line up | Three-decimal currencies are a feature-book row [FB ch.12 F20] | None, UI only | WEB-1, ADR-A |

### 1.9 Mobile-web comfort (a merchant on a phone)

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-84 | Phone list layout: each order a card with number, status, recipient and COD; tap opens the detail | The merchant checks the day from a phone | No merchant web card layout in the Mobbin results; warehouse staff use a separate handheld app [OMN §2.6] (not web) | None, UI only | WEB-1, WEB-5 (proposal) |
| C-85 | Bottom action bar on a phone for bulk actions and the saved-view switcher | Actions reachable with one thumb | proposal; no competitor source | None | WEB-5 |
| C-86 | Click-to-call and click-to-message on order detail: tel link and WhatsApp link to the recipient | The merchant calls without copying the number | Shipsy masked calling through a proxy, with calls recorded [SHP §2.1 "Calls and messages"] (masking is a driver-side feature); Wasal tracking link sent by SMS, email or WhatsApp [WSL §2.5] | None for a plain tel link; masking needs DRV-10 | WEB-5; DRV-10 (masking) |
| C-87 | Offline banner on the merchant web: the last list is shown with its time, and writes are disabled until the connection returns | The merchant does not act on old data | Shipsy operator apps work offline and sync when connected [SHP §2.4 "Operator mobile apps"] | None, UI only; the write guard uses C-37 | WEB-1 |
| C-88 | Copy buttons next to order number, tracking link and phone, with a short "Copied" note | Paste into WhatsApp in one tap | ZARA order number with a copy icon and "Copied" note [M3] | None, UI only | WEB-5 |
| C-89 | Relative times ("12 min ago") with the exact Riyadh time on hover or tap | Timestamps scan quickly | Plane "24 minutes ago" [M25]; Base44 "1 day ago" [M24] | None; formatting in the client | WEB-1 |
| C-90 | Share one order's tracking link from the order detail through the merchant's own WhatsApp, with pre-filled text | A call-me request handled in one step | Wasal tracking link by WhatsApp [WSL §2.5]; automated messages stay on approved templates [ADR-0037, ADR-0041] | None for a click-to-chat link | DEL-8, WEB-8 (proposal) |

### 1.10 Trust, defaults and personal convenience

| Id | Convenience | What the merchant gets | Seen in | Backend need | Maps to |
|---|---|---|---|---|---|
| C-91 | Report a problem on every page; attaches the page name, record id and request id, with no free-text personal data | Faster support | Driver support bundle [FB ch.03 §18]; Support in the header of Klaviyo [M2] | Support bundle endpoint with the request id | PLAT-14 (merchant side of FB ch.03 §18) |
| C-92 | Account defaults the merchant sets once: default service, COD on or off, window, pickup site, minutes per stop | Less typing per order | Wasal depot defaults: minutes per stop (default 1), start and end time [WSL §2.1 "Depots"]; Torod carrier "auto" as the API sample default [TOR §3 "Homepage sample"]; Torod carriers all active by default [TOR §2 "Carriers named, toggles"] | Account settings columns | WEB-3, PLAT-12 |
| C-93 | Last-used site, list and saved view restored at sign-in | Starts where the merchant left | Base44 recents [M11] (partial); the saved-view part is a proposal | `user_preferences`: last site and last view | new (§3 PREF-1) |
| C-94 | Last driver and vehicle used for a site offered first in the assign box | Repeat dispatch takes one tap | Tookan Unassigned tab and Assign Agent button [W9, S] | User preference; no new state | DEL-6, WEB-7 (proposal) |
| C-95 | Page size and row density per user (comfortable or compact) | More rows on a laptop | Calendly items per page, default 25 [M8] | `user_preferences` | WEB-5 |
| C-96 | Copy or export the selection only, as CSV, for a colleague | Quick sharing without the full export | proposal; no competitor source | Export endpoint takes ids | RPT-1 |

---

## 2. Baseline checklist for every list or detail screen

Proposed as plan §2b in `docs/handbook/04-conventions.md`. Every list or detail screen answers these fifteen questions. Each question cites the catalogue rows that answer it; the rest are standard conventions.

1. **What am I looking at, and how many?** The count matches the filter (C-7, C-46).
2. **Which filters are active, and how do I clear them?** Chips, one-at-a-time removal, Clear all (C-8).
3. **Why is it empty?** Empty results say which filter hid rows and show the unfiltered total (C-9, C-69).
4. **How fresh is it?** Last-updated time and a refresh that keeps state (C-10, C-87).
5. **What is in effect?** Visible columns, sort and page size, and whether they are saved (C-6, C-11, C-12, C-95).
6. **What will this action change, and how many rows?** Selection count, Select all matching, and a preview (C-15, C-16, C-30).
7. **What happened to each row?** Per-row result with retry for failures (C-17).
8. **Can I undo it, or get it back?** An undo window or a restore window with days left (C-32, C-33).
9. **What will it tell the recipient or other people?** Side-effect text on every confirmation (C-35).
10. **Who changed it, and when?** Last changed by, in Riyadh time, with a link to the activity log (C-41, C-89).
11. **Where do I go next?** A link to the record and a way back to the same saved view (C-1, C-55).
12. **Can I get it out?** Export of this view, audited (C-60, C-61).
13. **Can I do it from the keyboard?** Focus order, `/` to search, `?` for shortcuts (C-52, C-53).
14. **Does it work on a phone?** Card layout at narrow widths and a bottom action bar (C-84, C-85).
15. **Is it right in both languages?** Arabic and English strings, right-to-left layout, Western digits, Gregorian dates, and a help link in the user's language (ADR-0016; AGENTS.md; C-72, C-81).

---

## 3. Proposed new roadmap rows

Only items that need their own backend order. Each row is a proposal for the lead; none is added to `docs/roadmap.md`.

| Id (proposal) | Delivers | Depends on |
|---|---|---|
| SRCH-1 Global search and command index | Account-scoped search over orders, recipients, drivers, stops, SKUs and sites, with number, phone and Arabic normalisation (C-1, C-2, C-4, C-5); the action registry behind the command palette (C-54). | PLAT-6 (tenancy guard), PLAT-10 (roles), WEB-1, DEL-2, WMS-2 |
| PREF-1 Saved views and user preferences | `saved_views` and `user_preferences` tables: named list queries with columns, sort and page size (C-6, C-12, C-95); recents, pins and last site (C-55, C-93); account defaults (C-92). | PLAT-10, PLAT-12, WEB-1, WEB-5 |
| BULK-1 Bulk action contract | One pattern for bulk changes: filter snapshot with an expected count, per-row results, per-row version check, idempotency key and retry of failed rows (C-15, C-17, C-37, C-38). | DEL-2, WEB-5, PLAT-8 (outbox) |
| TPL-1 Templates, address book and import mappings | Order templates (C-27), recipient address book (C-29), saved import mappings and scheduled repeat (C-26), and the import preview and undo contract (C-23, C-24, C-39). | DEL-3, DEL-2, DEL-14, PLAT-8 (scheduler) |
| PRINT-1 Print jobs and documents | One print-job door that produces signed PDFs for labels, slips, pick lists, run sheets and proof of delivery, with reprint counts and audit (C-20, C-64, C-65, C-66). | INT-1 (storage), PLAT-7 (audit), INT-8, WMS-7 |

Amendments to existing rows, not new rows: DEL-21 takes the per-user alert settings, digest and quiet hours (C-43, C-44, C-45). RPT-1 takes the export, schedule and delta contract (C-60, C-62, C-63). DEL-17 takes KPI drill-through and period change (C-46, C-47). DEL-7 takes the proof PDF (C-64).

---

## 4. Questions I could not answer

1. **Hijri display against the house rule.** AGENTS.md says "Gregorian dates, Western digits." Does the owner allow a display-only Hijri date beside the Gregorian date (C-76)? No teardown or Mobbin result shows a Saudi merchant product doing this.
2. **Arabic-Indic digits in input.** Does the Western-digit rule cover typing, or only display (C-5)?
3. **Undo window.** Which actions get undo, and for how long? Ledger actions can only be reversed by compensating entries; the window is the owner's decision (C-32).
4. **Restore window and retention.** Is 30 days right for deleted non-ledger records, given Q-37 and Q-38 (C-33)?
5. **Waybill OCR.** Is a photo-to-form provider acceptable under the data-protection and residency rules (C-31)?
6. **Staff quiet hours.** Which alert classes are exempt from quiet hours (C-44)?
7. **Labour board.** Is a live picker or packer board in scope; the roadmap has no labour order (C-51)?
8. **Demo data.** May a sample order or sample driver exist in a live account, and how is it kept off stock and cash (C-70)?
9. **Merchant sandbox.** Do merchants, not only integrators, get a test site before go-live (C-74)?
10. **Shopify shortcuts.** The fetched Shopify page confirms `?` and `A` then `P` only. A search summary also gives `S`, `F` and `GO`. Unsettled; check the live admin with an owner account.
11. **Shopify saved views.** Button labels differ by admin version, and a third-party guide says a 2026 redesign merged search, filters and views. Secondary source only; not settled.
12. **Salla order screens.** The Salla help searches returned product pages, not the order list's bulk actions or filters. Unsettled; a logged-in look at a Salla dashboard would settle C-18, C-33 and C-60.
13. **Onfleet and Tookan screens.** Only help-centre search summaries were read, with no live screens, and the Onfleet support page returned a TLS error when fetched. Whether one file can create recurring tasks is not stated (C-26).
14. **Arabic merchant screens.** None of the Mobbin results was an Arabic-language merchant screen. The Arabic items (C-4, C-76 to C-82) need a screenshot census of Salla, Zid or Logestechs in Arabic before any design order.

---

## Sources

**Repository notes** (read 2026-11-03; each note's own reads are dated 2026-11-02). Paths are under `docs/research/`: `teardown-torod-2026-11.md` [TOR], `teardown-shipsy-2026-11.md` [SHP], `teardown-omniful-2026-11.md` [OMN], `teardown-logestechs-2026-11.md` [LGT], `teardown-wasal-2026-11.md` [WSL], `teardown-safee-2026-11.md` [SFE], `teardown-anchanto-2026-11.md` [ANC], `teardown-fulfillor-2026-11.md` [FUL], `shiphero-teardown-2026-11.md` [SHB], `platform-comparison-2026-11.md` [PCM], `feature-coverage-2026-11.md`, `ksa-platform-census-2026-11.md`, `feature-book/00-index.md` and chapters 01 to 14 [FB chNN]. Also `docs/roadmap.md` §1 for order ids, and `AGENTS.md` for the house rule on dates and digits.

**Mobbin screens** (search_screens, standard mode, read 2026-11-03; each link is the screen's `mobbin_url`):
- [M1] Square, All orders: https://mobbin.com/screens/9b7f70e1-3194-4995-b0bd-a74a3861198f
- [M2] Klaviyo, Reviews orders with no results: https://mobbin.com/screens/50e067de-73e5-4a75-9d94-6a0b5a94cbc6
- [M3] ZARA, order detail: https://mobbin.com/screens/63466732-a1d1-44ce-ae1a-e8e073cfbc43
- [M4] H&M, order status: https://mobbin.com/screens/937562b2-1901-483a-96f4-653b7d340aad
- [M5] incident.io, bulk action bar and merge dialog: https://mobbin.com/screens/2511fe5a-7ac2-43ad-b0f9-a777f8f4f17f
- [M6] Base44, move to trash: https://mobbin.com/screens/38515bce-6b9d-4a0c-b60f-f455a449801b
- [M7] Square, bulk edit items: https://mobbin.com/screens/43d138cb-1bed-4cbb-b35a-0d6e613c4945
- [M8] Calendly, delete contacts with confirm and select-all banner: https://mobbin.com/screens/40804c9e-702d-41a4-8fbc-a1c7f070fc55
- [M9] Delphi, bulk tags: https://mobbin.com/screens/59b7add5-68fb-4cfe-b561-5d76cc45bacf
- [M10] incident.io, command palette: https://mobbin.com/screens/907900ee-1dca-4726-ae50-9e043eecfbe4
- [M11] Base44, search palette with favourites and recents: https://mobbin.com/screens/675ecfd2-b7fc-4e8d-9078-3eeeaddda7c7
- [M12] Mercury, keyboard shortcut overlay: https://mobbin.com/screens/2f9852a0-c8d6-48b3-95c5-43c044bac813
- [M13] Replit, command palette: https://mobbin.com/screens/9bfad190-392c-4ad0-ba1b-6475cd1bd0d8
- [M14] Shopify, live view with search: https://mobbin.com/screens/dfca7e4b-461b-49bc-9377-92575543a585
- [M15] Shopify, home with quick tasks: https://mobbin.com/screens/6d8dfdf6-e1ab-42be-bf96-491d3ecaf0be
- [M16] Snowflake, load data with error count: https://mobbin.com/screens/311a5418-1a4c-4ceb-9fe7-c302350be911
- [M17] Unify, CSV field mapping: https://mobbin.com/screens/f156278e-d1b1-4422-bb94-d087476de139
- [M18] Square, assign fields with Do Not Import: https://mobbin.com/screens/5b630bf4-06eb-4eb4-be45-ea7c3a250763
- [M19] Calendly, match columns: https://mobbin.com/screens/58ac3eb5-7c72-4b6e-b15b-762963f871d3
- [M20] AirOps, map CSV to grid: https://mobbin.com/screens/c4dce94c-1def-4b1e-8987-4230b25e26f0
- [M21] AirOps, trash: https://mobbin.com/screens/6783bce8-5a3b-45c9-919d-dda9bb6acb1b
- [M22] Replit, delete app with name confirm: https://mobbin.com/screens/864248ef-dd2f-461c-8e35-426c10472264
- [M23] Plane, delete draft: https://mobbin.com/screens/e65c98ae-dfe1-4f31-afeb-a452a24c2152
- [M24] Base44, recently deleted: https://mobbin.com/screens/16b4c24e-92fc-45c6-b12e-bb33a2b69f5f
- [M25] Plane, activity list: https://mobbin.com/screens/e7d1109a-c28d-4c7c-8e6c-3329fcdd6a2b
- [M26] Square, activity log: https://mobbin.com/screens/19fa49f6-7bb9-4b85-a43f-2251ba036b2f
- [M27] Plane, empty dashboard: https://mobbin.com/screens/e47c670d-2734-4823-b844-35f2341c2ba9
- [M28] Square, coupons empty state: https://mobbin.com/screens/b40bf6ba-24d3-4264-ac6a-fd18c203df40
- [M29] Sweatpals, empty perks: https://mobbin.com/screens/665f9f3d-e87b-4db3-83d7-9c904496d0f5
- [M30] Klaviyo, empty app blocks: https://mobbin.com/screens/16283d15-fe10-4277-a683-23faf7addaa4
- [M31] Square, home totals: https://mobbin.com/screens/8baf0e57-e849-4dba-86b5-5cd279881103

**Web pages** (read 2026-11-03):
- [W1] Shopify, keyboard shortcuts (fetched): https://help.shopify.com/en/manual/productivity-tools/keyboard-shortcuts
- [W2] Shopify, searching and viewing orders (fetched; confirms "save frequently used filter combinations" only): https://help.shopify.com/en/manual/orders/search-view-print-orders
- [W3] Saving filtered orders as a view, search summary, not fetched: https://supportshopcircle.helpscoutdocs.com/article/363-saving-your-filtered-orders-as-a-view
- [W4] Salla help, restore deleted orders and products, search summary: https://help.salla.sa/en/article/restore-deleted-orders-products/e5w31zy99nj0jnbz3l63hzng
- [W5] Salla help, bulk edit products, title only: https://help.salla.sa/en/article/bulk-edit-products-salla/lvyruhcokuwqbpr9p2phsmbf
- [W6] Onfleet, scheduled import, search summary: https://intercom.help/onfleet-4f83d83093ac/en/articles/15254811-scheduled-import
- [W7] Onfleet, task templates, search summary (support.onfleet.com returned a TLS error): https://intercom.help/onfleet-4f83d83093ac/en/articles/15254782-task-templates
- [W8] Tookan (Jungleworks), create task and bulk import, search summary: https://help.jungleworks.com/knowledge-base/create-task/
- [W9] Tookan, task assignment and the unassigned tab, search summary: https://help.jungleworks.com/knowledge-base/task-assignment-on-tookan/
- [W10] Tookan, bulk assignment in mission view, search summary: https://help.jungleworks.com/knowledge-base/bulk-assignment-in-mission-view-tookan-delivery-management-system/

Items marked [S] in §1 rest on [W3] to [W10] and on the search summary of the Logestechs trial [LGT §4.2]. Items marked "proposal" rest on no source.
