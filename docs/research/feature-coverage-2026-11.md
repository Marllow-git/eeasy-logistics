# Feature coverage of the roadmap · 2026-11-02

Written by the architecture lead from five module censuses read on 2026-11-02 (sources, dates and confidence marks are in each note): `features-orders-dispatch-hubs-2026-11.md`, `features-driver-fleet-alerts-2026-11.md`, `features-recipient-cash-returns-2026-11.md`, `features-wms-2026-11.md`, `features-platform-integrations-compliance-2026-11.md`. The question the owner asked: for a comprehensive last-mile and WMS platform for KSA and the GCC, what does the roadmap miss? Everything below is a proposal for the owner; nothing changes the roadmap until a ruling and an amendment row.

## 1. Where the roadmap stands

| Module group | Features mapped | Covered | Partial | Missing | Verdict |
|---|---|---|---|---|---|
| Orders, dispatch, routing | 64 | 26 | 19 | 18 (plus 1 excluded) | the order core and dispatch are complete; hubs and linehaul are a full gap |
| Driver app, fleet, alerts | see note | field loop covered | proof kinds, onboarding | compliance documents, staff alerts, languages, masked calls, partial delivery | the field loop matches the market; the workforce layer is thin |
| Recipient, cash, returns | see note | tracking, templates, custody | returns, ETA in wave 1 | claims, disputes, COD reversal, merchant statement, card at the door, branding, ratings | custody is stricter than the market; the merchant finance view is missing |
| WMS | see note | the spine (locations to packing, returns, publication) | counts, receiving | variants, FEFO, pick strategies, packing aids, low-stock alerts, transfers, B2B | the ledger is right; the operational conveniences every KSA merchant has in Salla or Zid are missing |
| Platform, integrations, compliance | 55 | 13 | 13 | 28 (plus 1 unknown) | billing and PDPL are absent; connectors stop at Salla and Zid |

Three internal inconsistencies to fix in the next roadmap amendment: INT-7 lists `cash_block_notice` as a recipient message while integrations §5.1 sends it to dispatchers; the wave 1 `order_out_for_delivery` template carries an ETA window that only INT-6 and DEL-9 (wave 2) can produce; `recipient_otp` is a proof kind (domain §3.10) with no template in integrations §5.1 and no capture step in DRV-4.

## 2. Decide now (they shape tables being written this month)

1. **Country, currency and timezone per account and site** (ADR). Today `country = 'SA'` is a CHECK, money is two-decimal halalas with `currency` fixed to SAR, Asia/Riyadh is hard-coded, the driver app offers `+966`, the geocoder chain is SPL and Sayyar. Kuwait, Bahrain and Oman use three-decimal currencies. The ADR keeps wave 1 KSA-only but stops new migrations from baking it in (minor-unit exponent per currency, country on the account, timezone on the site, geocoder chain per country).
2. **Driver app languages** (ADR superseding the Arabic-and-English rule for the driver app only). Urdu, Hindi, Bengali and Tagalog cover most of the GCC driver workforce; the catalogue structure must allow them before DRV-4 ships screens.
3. **Billing track** (BILL-1 plans and metering, BILL-2 ZATCA phase 2 invoices, BILL-3 gateway behind the ADR-0017 unlock). Q-33 says pricing before wave 2; no order builds it. Needs the owner's VAT position and the ZATCA wave.
4. **PDPL-1 before real recipient data** (wave 1 exit): records of processing, a data subject request workflow with the 30-day clock, retention jobs for Q-37 and Q-38, a transfer register, a breach runbook in OPS-2. The draft amendments' consultation closed 5 November 2026 and would add an in-Kingdom storage duty; counsel should read the official text (the census relied on secondary sources).
5. **Scope rulings** that block whole orders: an own hub network (transfers, manifests, linehaul, sorting); hybrid fleets and carrier aggregation against ADR-0005 and ADR-0014; dangerous goods and cold chain; partial delivery (changes the state machine and D-7); SMS before wave 3 (ADR-0037); 3PL multi-client stock (ADR-0005's own-stock rule).

## 3. Proposed additions by wave

Ids continue the existing series; "amend" means an existing order's row changes, not a new order.

**Wave 1 amendments (no new orders)**
- INT-3, DEL-7, DRV-4: the recipient OTP template and the driver's capture step; the wave 1 out-for-delivery message sends a slot-less estimate or none until INT-6 (owner question).
- INT-7 row: `cash_block_notice` moves to the staff-alert order below.
- PDPL-1 (new, wave 1 exit): as §2 item 4.

**Wave 2**
- DEL-19 Intake hardening: COD eligibility per account (cart value, weight, excluded items), address prompts for missing parts and district, delivery instructions and access notes on the order and recipient. After DEL-2, INT-2, DEL-14.
- DEL-20 Labels and bulk actions: printable own-fleet order labels and bulk select actions on the orders list. After DEL-2, WEB-5, INT-1.
- DEL-21 Staff notification centre and dispatcher alerts: in-app and mail first, severity, per-user channel settings; failed orders, cash blocks, proof pending 24 h, stale tracking, budget thresholds; escalation after no acknowledgement; WhatsApp staff alerts once ADR-0041's number question is ruled. After PLAT-10, PLAT-9, DEL-7, DEL-11, DEL-5.
- DEL-22 Driver and vehicle compliance documents: ID or Iqama, licence, registration, insurance with expiry, driver upload from the app, expiry reminders, an offer gate by ruling. After DEL-4, WEB-6; needs the PDPL retention basis for identity scans.
- DEL-23 Merchant cash view: COD reversal custody entry on return or cancellation after collection, a merchant COD statement, per-order reconciliation, finance exports (CSV and Excel). After DEL-11, DEL-12, DEL-18 for the return path.
- BILL-1, BILL-2, BILL-3 as §2 item 3.
- RPT-1 Exports and dashboard tiles: order and cash exports, today's operations tiles on the board; scheduled mail reports in wave 4. After DEL-12, WEB-7.
- DEL-24 Batching and ability matching: batch nearby orders into one run, vehicle kind and ability tags, an escalation rule for orders no driver accepts. After DEL-10, DEL-4.
- DEL-25 Time windows in the route plan and a per-stop delay alert; and the pull-forward of the stop-change re-solve from DEL-16 (owner decision). After INT-6, DEL-9, Q-18.
- DRV-8 Proof capture for recipient OTP, ID check and barcode-at-drop with the matching proof policy. After DRV-4, DEL-7, INT-3.
- DRV-9 Pre-shift vehicle check and onboarding checklist. After DRV-3; the owner decides whether it gates offers.
- DEL-26 Arrival and drop warning outside the geocoded point's geofence, advisory first. After INT-2, DRV-3, DRV-4.

**Wave 3 (WMS extensions, each extends an existing row)**
- WMS-9 Product variants (options as child SKUs with stock and alerts per option). Before WEB-13; needs Q-U1.
- WMS-10 Pick strategies: wave release, batch and zone picking, expiry-first (FEFO) allocation. After WMS-6, WMS-3.
- WMS-11 Packing aids: box catalogue and suggestion, item-scan verification at pack, packing slip, partial shipment of available lines. After WMS-7, WEB-15.
- WMS-12 Receiving holds and put-away rules. After WMS-4, WMS-1.
- WMS-13 Low-stock alerts per product and option through the outbox (the cheapest KSA expectation to miss: Salla has it natively). After WMS-3, PLAT-8, DEL-21.
- WMS-14 Scheduled and threshold-triggered cycle counts. After WMS-5, Q-17.
- WMS-15 Inter-site stock transfers with approval and destination confirmation, printable location and tote labels. After WMS-1, WMS-3; wave 3 if the pilot is multi-site.
- DEL-27 Claims and disputes: a claim entity (damage, loss, wrong item) with evidence, status, outcome, and a link to driver liability where ruled; customer disputes linked to proofs. After DEL-7, DEL-11, DEL-18.
- SEC-1 Security programme: an NCA CCC gap assessment early, a penetration test as a gate before INT-9, a status page and incident communication. After OPS-1, OPS-2.

**Wave 4 and later**
- HUB-1 Transfer state for orders between sites with an arrival scan; HUB-2 outbound and inbound manifests and linehaul trips; HUB-3 hub capacity and sort-by-destination. All after the hub-network ruling; HUB-1 after DEL-6, DEL-7, DRV-4.
- DEL-28 Recipient return request (pulls part of DEL-18 forward: a return purpose on the tracking token, reasons, approval, pickup booking). After DEL-8, DEL-18, INT-3.
- DEL-29 Ratings and feedback after delivery with consent handling. After DEL-8, INT-3; needs the PDPL survey ruling.
- WEB-20 Branded tracking (merchant logo and colours on the page and templates) if ruled in. After WEB-8, Q-21.
- DEL-30 Partial delivery with per-item outcomes (needs an ADR). After DEL-7, DEL-18.
- DRV-10 Masked calls and chat through a telephony provider. After PLAT-8 and a provider choice.
- DRV-11 Driver app languages beyond Arabic and English (after the ADR of §2 item 2; the catalogue work can start earlier).
- CONN-1 Shopify and WooCommerce connectors on the INT-11 pattern; CONN-2 noon and Amazon.sa marketplace connectors; ERP connectors (Odoo, Zoho, SAP Business One) unresearched.
- CARR-1 Carrier aggregation adapter behind the carrier port, only after the own-fleets ruling.
- INT-13 Channel allocation and replenishment (safety stock per channel and warehouse, min and max to purchase order or transfer). After INT-12, WMS-4, WMS-15.
- WMS-16 B2B fulfilment (wholesale order type, case and pallet units, unit-of-measure conversion); WMS-17 ASN matching and cross-dock. Only for a 3PL or wholesale client.
- Card and mada at the door (SoftPOS or payment links) once ADR-0017 is unlocked and a provider is chosen (Geidea, Nearpay, a bank SoftPOS); pay-later providers only on demand.

## 4. Owner questions the censuses open (the top ten)

1. Is an own hub network (transfers, manifests, linehaul, sorting) in scope, and when?
2. Is GCC expansion in scope before wave 4? It decides the money and country model now (§2 item 1).
3. Driver app languages: supersede the Arabic-and-English rule for the driver app?
4. Eeasy's VAT position and ZATCA wave; which gateway (Moyasar, HyperPay, Tap, PayTabs); unlock ADR-0017 for merchant billing?
5. PDPL: controller or processor for recipient data; accept the secondary reading of the 72-hour breach notice until counsel reads the text; do the draft amendments shape the design now?
6. Carrier aggregation and hybrid fleets against ADR-0005 and ADR-0014: still excluded?
7. Partial delivery, recipient OTP and ID check: which merchants need them, and in which wave?
8. Should an expired driver document block offers or only warn, and what is the retention basis for identity scans?
9. Who receives failed-delivery, cash-block and SLA alerts, over which channel, and after how long does an alert escalate?
10. COD rules: who sets limits and fees (Salla uses SAR 20 minimum and SAR 1,000 maximum), who records refunds and reversals, and are damage costs charged to drivers?

The full lists (twelve to sixteen questions per note) are in each note's "Unanswered" section.

## 5. Limits of this research

Regional vendors publish little (Torod, SMSA, Naqel, Aramex, Careem, HungerStation, Flow and Stockwise gave thin or no feature pages); several rows rest on search summaries and are marked so in the notes. The SDAIA and ZATCA pages were partly unreadable on 2026-11-02, so the compliance rows need counsel. No pricing, SLA or contract terms were researched. Everything here is a map of what the market offers against what the roadmap builds, not a sizing.
