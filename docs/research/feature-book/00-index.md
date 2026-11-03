# Feature book · index and cross-chapter decisions · 2026-11-02

Fourteen chapters, each examining every feature of one module from the same ten aspects: definition and user goal; workflow and states; business rules and KSA and GCC specifics; data and invariants; surfaces; permissions and audit; dependencies; metrics; how the market builds it (cited to the teardowns and censuses) and the chosen shape for us; roadmap mapping with open owner questions. Written by fourteen researchers on 2026-11-02 from the architecture documents, contracts, plans and ADRs plus `feature-coverage-2026-11.md` and `platform-comparison-2026-11.md`; consolidated by the architecture lead. Every shape in the chapters is a proposal until the owner rules; nothing changes the roadmap, the contracts or an ADR without an amendment row.

| Chapter | Module | Lines | Features |
|---|---|---|---|
| 01 | Orders and intake | 322 | holds, approval states, tags, service levels, labels, bulk actions, parcel count, intake rules |
| 02 | Zones, coverage, routing and dispatch | 382 | zones and coverage, offers and assignment, auto-dispatch with preview, slots, routing rungs, re-solve, batching, templates, streams |
| 03 | Driver app and field loop | 571 | sign-in and devices, outbox, run and offers, proof kinds and gating, attempts, COD at the door, navigation, tracking profiles, languages, SOS |
| 04 | Fleet and workforce | 300 | drivers, vehicles, devices, shifts and auto-close, positions and trails, compliance documents, groups, scorecards and pay |
| 05 | Recipient experience and messaging | 342 | tracking and modes, templates and approval, quiet hours and caps, opt-out, budget, reschedule and pin, OTP, ratings, returns request, branding |
| 06 | Cash and COD finance | 376 | COD rules and capture, PIN, custody and block, handovers, deposits, reports, reversal, merchant statement, carrier settlement, card at the door |
| 07 | Returns, exchange and claims | 352 | return pickup, exchange with two money fields, check-in, dispositions, recipient requests, claims and disputes, refunds, void |
| 08 | WMS setup and inventory | 388 | locations and totes, catalog and variants, lots and FEFO, ledger and summaries, adjustments, counts, low-stock alerts, transfers |
| 09 | WMS inbound | 257 | suppliers and purchase orders, ASN, receiving with regulatory fields, over-receipt, quality hold, put-away, supplier returns |
| 10 | WMS outbound | 349 | allocation rules, holds, partial fulfilment, pick strategies, packing aids, handoff, pack-time carrier rules, B2B |
| 11 | Hubs, linehaul and transfers | 332 | the hub as a site kind, scans and sort, manifests, trips, order and stock transfers, capacity |
| 12 | Platform, tenancy and billing | 413 | provisioning and signup, flags, roles, support access, audit, limits, plans and trial, invoices and ZATCA, gateways, country and currency |
| 13 | Integrations, API and network | 493 | public API and keys, webhooks and health, Salla and Zid, other connectors, carriers and choice rules, maps and geocoding, WhatsApp engine |
| 14 | Analytics, alerts, compliance and security | 517 | dashboards and reports, notification centre and dispatcher alerts, PDPL duties, hosting, security programme, status page |

## 1. Decisions that span chapters (for the owner, in the order they block work)

1. **Hosting region and the PDPL draft** (chapters 12, 14): the draft in-Kingdom storage duty may exclude a Bahraini host; Q-10 needs reopening before OPS-1. Counsel reads the official SDAIA text; the chapters rest on secondary sources.
2. **Country, currency and timezone ADR** (chapters 06, 12): three-decimal GCC currencies are a one-way door on money tables; decide before the next money migration.
3. **Billing ADR and track** (chapter 12): plans, trial with a read-only state distinct from suspension, metering, invoices with VAT, ZATCA wave 25 confirmed on the official page (SAR 187,500 threshold, integrate by 2027-02-01), a gateway; separate from ADR-0017 which covers digital COD at the door only.
4. **Order holds and approval states ADR** (chapters 01, 10): holds as audited flags that block offers and allocation change the state machine of §3.13; the contract's `awaiting_review` is set by nothing today.
5. **Custody reversal superseding ADR-0007's forward-only rule** (chapters 06, 07): a reversing entry for COD on return or cancellation after collection; the contract's deposit-reversal path moves custody backward and breaks a database check (defect).
6. **Hub as a site kind** (chapter 11): an ADR superseding ADR-0018's three kinds, after the scope ruling; stock transfers (WMS-15) have the strongest evidence and need no hub.
7. **Warehouse handheld app** (chapters 08, 09, 10): native offline app on the DRV-2 pattern under an ADR beside ADR-0021, or a scanner-first web bench; five of nine platforms run the floor on handhelds.
8. **Driver app languages** (chapter 03): supersede ADR-0016's rule for the driver app only (Urdu, Hindi, Bengali, Tagalog).
9. **Messaging model** (chapters 05, 13): ADR-0041 sends template text through the engine without Meta approval while INT-3's plan, integrations §2.4 and §5 and the wave exit criteria still assume approval; the quiet-hours window has no regulatory source; inbound opt-out callbacks have no owner.
10. **Scope rulings** that gate whole chapters: multi-client 3PL (chapters 08, 12), carrier aggregation (chapter 13, with the ADR-0005 citation corrected to the executor fleet), partial delivery (chapter 03), dangerous goods and cold chain (chapter 01), own hub network (chapter 11).

## 2. Design facts to confirm before the next builds (found in the repository, not in the market)

- Stock summary is keyed by account and product: multi-site merchants cannot see or publish available quantity per site; `on_hand` counts totes, docks and transit, so available rises after a pick against domain §4.10; the reservation guard is account-wide while allocation is per site; pick lines carry no fulfilment-line id (chapters 08, 10). Confirm before WMS-3 and WMS-6.
- Tote per order is unsupported (one `target_tote_id` per pick task); partial shipment has no state; COD sits on the fulfilment order, not the package; the own-fleet label is undefined though the packer needs it; channel orders have no site (chapter 10).
- The cash block from a PIN replay has no clearing door until wave 2; Q-15 and the DEL-4 plan still cite a 120-second window and DEL-8 (chapter 06).
- `planShift` is wave 1 in DEL-5 but wave 2 in the contract, DEL-10 and WEB-9; site roles hold no driver or location permission while DEL-5 site-scopes the position doors (chapter 04).
- Orders carry no scannable parcel identifier beyond `number` and `source_ref` (chapter 11).
- Over-receipt tolerance (W-15) is stored nowhere; the approver sits on the line in data.md and on the receipt in the contract; receipts lack the timestamps dock-to-stock needs (chapter 09).
- `moveTote` requires `wms.locations.manage`, which warehouse staff do not hold; ADR-0031 is still "proposed" while WMS-3 is bound by it; ADR-0033 reads "proposed" (chapters 08, WEB-6 note).
- The 48-hour purpose tokens cannot cover a 7-day return window (chapter 07); `delivery_return` is missing from the WMS `createReturn` enum; WMS-8 cites W-7 instead of W-17.
- Documentation drift: driver-app §5.3, §7.1 and §12.4 predate the account picker and the live-refusal path; integrations §2.4 and §5 describe the Meta model; roadmap DEL-2 says "auto-override" for auto-accept; INT-7 files the cash-block notice as a recipient message; the recipient OTP proof kind has no template or capture step; ADR-0007 cites a Logestechs COD chain no public source shows; ADR-0011 says Logestechs has no WMS.
- Regulatory fields for receiving: SFDA GSDP manufacture date, invoice reference and carrier; SASO supplier CR number from 2026-10-01; GSDP retention (shelf life plus one year) conflicts with Q-38's 90-day deletion; tax records must survive closed-account deletion (chapters 09, 12).

## 3. Proposal registry (one id per proposal; replaces the colliding ids in the chapters and research notes)

| Id | Proposal | Chapter | Wave |
|---|---|---|---|
| ADR-A | Country, currency and timezone per account and site | 12, 06 | now |
| ADR-B | Driver app languages beyond Arabic and English | 03 | now |
| ADR-C | Order holds and approval states (§3.13 change) | 01, 10 | 1 exit |
| ADR-D | Custody reversal entry (supersedes part of ADR-0007) | 06, 07 | 2 |
| ADR-E | Hub as a site kind (supersedes ADR-0018 kinds) | 11 | ruling |
| ADR-F | Warehouse handheld app (beside ADR-0021) | 08, 10 | 3 |
| ADR-G | Merchant billing and payments (beside ADR-0017) | 12 | 2 |
| PDPL-1 | Records of processing, data subject requests, retention, breach runbook, transfer register | 14 | 1 exit |
| SEC-1 | NCA CCC gap assessment, pen test before INT-9, status page | 14 | 3 gate |
| BILL-1, BILL-2, BILL-3 | Plans and metering; ZATCA invoices (after OPS-8); gateway | 12 | 2 |
| OPS-8 | ZATCA scope research | 12 | before BILL |
| RES-1 | Wasl and CST applicability to own-fleet couriers | 04 | before DRV-3 |
| DEL-19 | Intake hardening: COD rules, address prompts, instructions | 01 | 2 |
| DEL-20 | Own-fleet labels and bulk actions | 01 | 2 |
| DEL-21 | Staff notification centre and dispatcher alerts, escalation | 14, 04 | 2 |
| DEL-22 | Driver and vehicle compliance documents with expiry and gating | 04 | 2 |
| DEL-23 | Merchant cash view: COD reversal, statement, reconciliation, exports | 06 | 2 |
| DEL-24 | Batching and ability matching | 02 | 2 |
| DEL-25 | Time windows in the plan, delay alert, re-solve pull-forward | 02 | 2 |
| DEL-26 | Geofenced arrival and drop warning | 03 | 2 |
| DEL-27 | Claims and disputes | 07 | 3 |
| DEL-28 | Recipient return request by token | 07, 05 | 2 or 4 |
| DEL-29 | Ratings and feedback | 05 | 3 |
| DEL-30 | Partial delivery (needs an ADR) | 03 | 4 |
| DEL-31 | Order holds and tags | 01 | 2 |
| DEL-32 | Service levels and route templates | 02, 01 | 2 |
| DEL-33 | Exception and NDR rules | 02 | 2 or 4 |
| DEL-34 | Exchange with two money fields; exchange allocation gate | 07 | 4 |
| DRV-8 | Proof capture: recipient OTP, ID check, scan | 03 | 1 or 2 |
| DRV-9 | Pre-shift check and onboarding checklist | 03 | 2 |
| DRV-10 | Masked calls and chat (provider) | 03 | 4 |
| DRV-11 | Driver app languages (after ADR-B) | 03 | 2 |
| DRV-12 | Driver SOS | 03 | 2 |
| VEH-1 | Vehicle service tasks | 04 | owner's choice |
| WMS-9 to WMS-17 | Variants; pick strategies and FEFO; packing aids; receiving holds and put-away rules; low-stock alerts; count schedules; inter-site stock transfers; B2B fulfilment; ASN and cross-dock | 08, 09, 10 | 3 and later |
| WMS-18 | Warehouse handheld app (after ADR-F) | 08, 10 | 3 |
| WMS-19 | Per-site stock summary and reservations (design fix) | 08, 10 | before WMS-3 |
| HUB-1, HUB-2, HUB-3 | Order transfers and arrival scans; manifests and trips; capacity and sorting | 11 | ruling, then 4 |
| INT-13 | Channel allocation and replenishment | 08 | after 4 |
| INT-14 | Shopify, WooCommerce connectors; INT-15 noon and Amazon.sa | 13 | 4 or 5 |
| INT-16 | Pack-time carrier and label rules | 10, 13 | 3 |
| INT-17 | Carrier COD settlement reconciliation | 06 | 4 |
| INT-18 | Webhook health, reconciliation read, connector mapping gate, channel buffers | 13 | with INT-10 to INT-12 |
| RPT-1 | Exports and dashboard tiles; scheduled reports later | 14 | 2 and 4 |
| WEB-20 | Branded tracking | 05 | ruling |
| CARR-1 | Carrier aggregation (after the scope ruling) | 13 | ruling |

## 4. Owner questions (the fifteen that unblock the most; each chapter holds its full list)

1. Controller or processor for recipient data, and the hosting region against the PDPL draft.
2. GCC expansion timing (decides ADR-A now).
3. Driver app languages (ADR-B).
4. Eeasy's VAT position, the ZATCA wave, the gateway, and whether invoices to merchants' customers are in scope.
5. Holds and approval: who sets them and what they block (ADR-C).
6. Custody reversal shape and who records refunds (ADR-D); VAT on COD amounts.
7. Hub network in scope, and when (ADR-E).
8. Handheld app or web scanner bench (ADR-F); pilot site count (decides transfers' wave).
9. Multi-client 3PL in scope.
10. Carrier aggregation and hybrid fleets.
11. Partial delivery and the exchange money fields (Q-4).
12. Proof kinds required per merchant; recipient OTP wave.
13. Alert recipients, channels and escalation timing; the staff WhatsApp number.
14. Driver document gating and the retention basis for identity scans.
15. Cutoffs, weekend and Ramadan service days; the quiet-hours window and the 24-hour stop (counsel).

## 5. Limits

The chapters rest on the repository's documents and the prior research; web reads were limited to specific gaps. The PDPL, CST and some SFDA items are secondary-source only and marked so. Several chapters compressed the ten aspects into numbered paragraphs to stay within the line caps; the content is complete, the headings vary. The proposal ids in the chapters still carry the research notes' colliding numbers; this index is the authority until the roadmap amendment assigns final ids.
