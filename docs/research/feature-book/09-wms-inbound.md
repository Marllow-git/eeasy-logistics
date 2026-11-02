# Feature book 09: WMS inbound

Date: 2026-11-02. Status: research input for the lead; no decision taken; the roadmap, contracts and ADRs do not change. Scope: suppliers and purchase orders, advance shipping notices, receiving by scan with lots, serials and expiry, over-receipt approval, quality hold and inspection, put-away, cross-dock, receipt documents and supplier returns, inbound labels, inbound appointments and dock scheduling, receiving KPIs. Counting belongs to chapter 08 (WMS-5 and WMS-14); this chapter only hands over receiving discrepancies to it.

Repo facts were read at `origin/main` 6ca087e on 2026-11-02. Remote research was read with `git show` from `origin/docs/feature-coverage` and `origin/docs/platform-teardowns` on 2026-11-02. Regulatory text was read on 2026-11-02 (tags R1 to R3, section 0).

## Summary for the lead

1. The receiving spine is specified for wave 3: suppliers, purchase orders, receipts with scan lines, over-receipt approval, put-away and close (WMS-4, WEB-14; domain 4.3 and 4.11; `staff-wms.yaml` purchasing and receiving operations). Nothing is built, and no WMS order is in flight in `docs/orders/README.md`.
2. The covered spine names a tolerance it never stores: W-15 and `approval_required` refer to "the account tolerance", but no table, column, setting or default holds it, and the unit is undefined.
3. The receipt and lot records miss what SFDA GSDP asks for pharma and cosmetic receipts (R2): manufacture date, invoice number and date, carrier. Lots carry expiry and received date only.
4. Retention conflicts: R2 keeps temperature and incoming records for shelf life plus one year (pharma) or one year (cosmetics), while the closed-account rule deletes a closed account's rows after 90 days (Q-38, provisional, data.md section 10).
5. SASO (R1, primary, effective 2026-10-01): ten listed technical regulations require the supplier name (importer or local manufacturer) and CR number on the product. The supplier record has no CR field. This binds only if a pilot product is one of the ten (Q-U6).
6. ZATCA (R3, v3 May 2026): input tax needs a valid tax invoice, which may be simplified only below SAR 1,000 (sections 4.3.1, 9.1); Arabic prevails on tax invoices (4.2.1). A secondary search summary said simplified invoices never support deduction; the official text does not say so, and it is not adopted. No supplier invoice number is stored anywhere, so a supplier credit note cannot cite the invoice it corrects.
7. Missing or proposed only: ASN (post-4), quality hold (WMS-12 proposal), cross-dock (post-4), receipt labels, dock appointments, receiving KPIs, supplier returns. No roadmap row names dock appointments or supplier returns.
8. Proposed shapes that differ from the roadmap rows, none decided: a hold as a movement to a non-pickable quarantine location (not a status); a locked put-away draft list (ShipHero Putaway V2); a supplier return as a movement to the existing SUPPLIER system location plus a credit-note reference; receipt timestamps for dock-to-stock; CR number, manufacture date and invoice reference on the supplier, lot and receipt records.
9. Dock-to-stock cannot be measured from the schema: receipts keep only `created_at` and `updated_at`, and `updated_at` is overwritten. Movement times may derive it; this is unconfirmed.
10. Fifteen owner questions (index and the owner questions list). The three that block wave 3 design are Q-I1 (tolerance value, unit and approver), Q-I2 (manufacture and expiry capture) and Q-I3 (whether SFDA-regulated products are in the pilot).

## Conventions

- **Chosen (repo)** means what domain 4.x, data.md, `staff-wms.yaml`, an ADR or the roadmap fixes today. Where they fix nothing, the aspect says "none chosen".
- **Market** cites teardown or census IDs (source list). Vendor claims are marked "claimed". Search-only facts are marked [S].
- **Proposed shape** names borrow, adapt or own, the reason, and the ADR that would govern it. Nothing here is decided.
- Repo tags: DM = `docs/architecture/domain-model.md`; DA = `docs/architecture/data.md`; OAPI = `docs/contracts/openapi/staff-wms.yaml`; COMP = `components.yaml`; ERR = `docs/contracts/errors.md`; WH = `docs/contracts/webhooks.md`; ROLES and PERM = `roles.yaml`, `permissions.yaml`; RM = `docs/roadmap.md`; WEBD = `docs/architecture/web.md`.
- Research tags: FC-WMS = `features-wms-2026-11.md` with its source ids; FCN = `feature-coverage-2026-11.md`; PC = `platform-comparison-2026-11.md`; SH, FF, AN, OM = the ShipHero, Fulfillor, Anchanto and Omniful teardowns with their registry ids.

## 0. Regulatory facts used in this chapter

| Tag | Fact (as read) | Read | Source |
|---|---|---|---|
| R1 | SASO circular to SABER beneficiaries. Technical regulations require the supplier's name (importer or local manufacturer) and CR number on the product; effective 01/10/2026. Ten regulations listed: LPG tankers, watercraft, tanks, trailers and semi-trailers, self-balancing scooters, simple pressure vessels, child restraint systems and strollers, hydraulic links, solar PV systems, electric lifts. SASO checks SABER data. | 2026-11-02 | https://saber.sa/Assets/Home/Circular_Supplier_Name_and_CR_on_Product.pdf (primary, Arabic and English) |
| R2 | SFDA Guideline of Good Storage and Distribution Practices (GSDP), pharmaceuticals and cosmetics; food is not in its scope. Pharma receiving: inspect each shipment on receipt (external appearance, packaging, labels); do not receive expired or close-to-expiry products expected to expire before patient use; receiving records carry date, sender, quantities, trade and scientific name, concentration, form, manufacture date, expiry date, batch, carrier and signature; records must support trace and recall. Cosmetic warehouses keep incoming records with brand, quantity, invoice number and date, batch, manufacture and expiry dates, and supplier name, for at least one year. Temperature records: shelf life plus one year. Rejected, recalled or returned stock is separated, secured, labelled and recorded. Receiving entrance and receiving area are separate from storage. | 2026-11-02 | https://sfda.gov.sa/sites/default/files/2025-05/GSDP-E.pdf. The cover reads Version 1.2 (issued 13 Aug 2014); the version table lists 2.1 (4 Feb 2024). Confirm which is current. |
| R3 | ZATCA VAT Guideline for Tax Invoicing and Records, Version 3, May 2026. Input tax needs a valid tax invoice, which may be simplified (9.1; FAQ 5). Simplified invoices are for supplies under SAR 1,000 or to persons not subject to VAT (4.3.1). Supplier VAT registration number is mandatory (4.2). Arabic prevails in case of conflict (4.2.1). Credit notes correct the original tax invoice when goods are returned to the supplier (section 7). Self-billing needs ZATCA approval (5.1). | 2026-11-02 | https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Tax-Invoicing-and-Records-under-VAT-Provisions.pdf (English is guidance; Arabic prevails) |

R1 to R3 are primary texts. The PDFs were read through local text extraction; R2 was read as a cover and sections, not in full.

## 1. Suppliers and purchase orders

1. **Definition and user goal.** Purchasing staff keep a supplier list and raise a purchase order (PO) for goods expected at a site, so receipts can be checked against what was ordered [DM 4.3].
2. **Workflow.** PO states are `draft`, `sent`, `partially_received`, `received`, `closed`, `cancelled` [DM 4.3; COMP PurchaseOrder]. The contract writes one arrow, `draft → sent` on `sendPurchaseOrder`; close and cancel answer 409 `invalid_transition` outside their states. Operations: `createSupplier`, `updateSupplier`, `listSuppliers`; `createPurchaseOrder`, `updatePurchaseOrder` (draft only), `sendPurchaseOrder`, `closePurchaseOrder`, `cancelPurchaseOrder`, `listPurchaseOrders`, `getPurchaseOrder` [OAPI]. Happy path: supplier, draft PO with lines (product, quantity, unit cost), send, receive against it (section 3), close. Exceptions: short, over and wrong deliveries arrive as receipt lines, not as PO edits. Not specified: which receipt events move the PO to `partially_received` or `received`; who may close a PO with open lines. `send` only sets a state; no channel is defined. ADR-0037 limits messages to templates and ADR-0041 routes them through the eeasy WhatsApp engine, so a PO sent by message is a new template kind.
3. **Business rules and edge cases.** Supplier fields are `name`, `contact`, `vat_number`; `name` is unique per account [DA 2.3]. The supplier `name` is one text column, while AGENTS.md and ADR-0016 require Arabic and English for every string. R1: a pilot product in one of the ten regulations must carry the supplier name and CR number on the product; the record has no CR field, so the receiving check cannot be matched. R3: a buyer's input tax rests on the supplier's invoice, which must show the supplier's VAT number; this product stores the VAT number but no invoice. Money is halalas with `currency` fixed to SAR [DA 1.3], so a PO currency other than SAR cannot be stored.
4. **Data.** `wms_suppliers`: `name`, `contact`, `vat_number`; unique `(account_id, name)` [DA 2.3]. `wms_purchase_orders`: `number` (PO-, per-account sequence), `supplier_id`, `site_id`, `status` CHECK, `currency`, `version`; unique `(account_id, number)` [DA 2.3, 7]. `wms_purchase_order_lines`: `product_id`, `quantity > 0`, `unit_cost bigint`, `received integer` [DA 2.3]. No rejected quantity (ShipHero keeps one, SH D15) and no tolerance. Retention: supplier contact for the life of the account [DA 10]; PO retention not stated.
5. **Surfaces.** WMS web: `/wms/purchase-orders` and detail, wave 3 [WEBD row 346]. API: the operations in section 2. Webhooks: none for POs; the receiving event is `wms.inbound_receipt.received`, sent at close [WH; DM 6.3]. Handheld: none. Supplier documents: none stored.
6. **Permissions, roles, audit.** Read `wms.purchase_orders.read` and manage `wms.purchase_orders.manage`; supplier write `wms.suppliers.manage` [PERM]. Owner and admin hold all three. `warehouse_staff` (site-scoped) reads POs but cannot manage them [ROLES]. No approval step on a PO, so no separation of duties. Audit: generic `core_audit_log` [DA 10]; the contract names no PO audit actions.
7. **Dependencies and integrations.** No ERP, no EDI (see section 2), no supplier portal. Send channel: none chosen (see 2). ZATCA e-invoicing is not on the roadmap; OPS-8 is a proposed research order [PC 4].
8. **Metrics and reporting.** None defined in DM or RM. Proposed by us, no source: PO lines fully received on time; days from send to first receipt; per-supplier short-delivery rate (received over expected).
9. **Market and chosen shape.** Market: Zoho purchase orders with suppliers (FC-WMS S17, read); ShipHero PO lines with `quantity_received` and `quantity_rejected`, plus a PO Update webhook (SH D15, D6). Chosen (repo): supplier and PO aggregates with the states above [DM 4.3]. Proposed shape: adapt ShipHero's rejected quantity on the PO line; our own for the CR number and the bilingual supplier name, because R1 and ADR-0016 require them.
10. **Roadmap mapping.** Covered: WMS-4 (suppliers, POs) and WEB-14 (screens), wave 3; purchasing operations are `x-wave: 3` [RM; OAPI]. Partial: CR number, bilingual supplier name, invoice reference, rejected quantity, PO status derivation. Owner questions: Q-I4, Q-I5, Q-I6.

## 2. Advance shipping notices and matching

1. **Definition and user goal.** A supplier sends notice of goods in transit (lines, quantities, lots, expiry, cartons or pallets). Receiving matches the notice to the PO before the goods arrive, so the expected lines are pre-filled and differences show at the dock.
2. **Workflow.** None in the repo. A receipt is created `expected` from a PO or blind [OAPI `createReceipt`; DM 4.11]. An ASN would enter before the first scan. Market: ShipHero's `inbound_shipment_create_from_asn` is experimental; inbound shipments have statuses `QC_ON_HOLD` and `REJECTED` (changelog 2026-09-25) and a Shipment ASN webhook [SH D8, D19, D6]. Shipsy matches ASNs and takes e-signatures on receipt [FC-WMS S8, read]. Fulfillor lists ASN as a glossary term with no workflow [FF F19].
3. **Business rules and edge cases.** None in the repo. Matching key candidates (ours, inference): product and supplier reference to PO line. KSA and GCC: no rule read. The EDI shapes that carry ASNs (850 in, 856 out) are named by ShipHero for retail trading partners [SH section 1.7, S]; no KSA trading partner was checked.
4. **Data.** None. Needed: supplier notice header and lines, status, link to a receipt. The only expectation field today is `expected` on a receipt line [DA 2.3]. Retention: none defined.
5. **Surfaces.** None in `staff-wms.yaml`. No ASN event in DM 6.3 or WH. `integrations.md` names no EDI or file intake.
6. **Permissions.** None defined. Inference: matching would reuse `wms.receipts.write`.
7. **Dependencies.** Supplier EDI or file exchange (none chosen). A 3PL model would bring ASNs from many clients (ADR-0005 and Q-U2 keep stock to the merchant's own).
8. **Metrics.** None defined. Proposed by us: ASN match rate; lines differing from the notice.
9. **Market and chosen shape.** Market as in 2. Chosen (repo): none. Proposed shape: adapt. ASN lines pre-fill `expected` on the receipt instead of creating a separate inbound-shipment aggregate, because the receipt already holds expected lines (inference). Governing ADR: none exists; a new intake surface would need one under ADR-0024 and ADR-0026.
10. **Roadmap mapping.** Missing. FCN proposes WMS-17 (ASN matching and cross-dock), post-4, "only for a 3PL or wholesale client". FC-WMS P10 names the same item WMS-4b. Owner question: Q-I7.

## 3. Receiving by scan with lots, serials and expiry

1. **Definition and user goal.** Warehouse staff scan each unit or lot at the receiving location and record the received and damaged quantities against the expected lines. The first scan starts the receipt; each scan writes the stock into the receiving location.
2. **Workflow.** `createReceipt` (site, receiving location, optional PO and lines) → `expected`. `receiveReceiptLine` (`StockRef` plus `line_id`, `damaged`) on the first scan → `receiving`, and each scan writes a SUPPLIER → receiving movement (W-15) [OAPI]. `closeReceipt` → `received`, emitting `wms.inbound_receipt.received` [OAPI; WH]. `cancelReceipt` only while `expected` [DM 4.11]. Errors: 409 `invalid_transition`; 422 `tracking_mode_mismatch`; 422 `approval_required`; 422 `idempotency_key_reused` [ERR]. Exceptions: a wrong scan has no undo or reversal operation; a correction would be an adjustment under wms-5 with approval [OAPI; ERR].
3. **Business rules and edge cases.** Tracking mode per product is `none`, `lot` or `serial` and cannot change after the first movement (W-3). A lot needs `lot_id` or `lot_code`; a serial needs quantity 1 (W-4; `tracking_mode_mismatch`). Serial numbers are unique per product [DA 2.3]; `staff-wms.yaml` lists no error code for a duplicate serial on receive, so the response is unspecified. A lot code is unique per product; no rule covers reuse of a code with a different expiry. R2: refuse expired or close-to-expiry pharma stock that will expire before patient use; the repo has no threshold and no check. R2: incoming records need manufacture date, batch, invoice number and date, and supplier name; the lot holds expiry and `received_at` only, and receipt lines hold `lot_code` and `serial_number` only [DA 2.3]. R2 requires inspection on receipt (feature 5). Product identity: `wms_product_barcodes` lists barcodes, but GS1 parsing is not defined (Q-U5, open).
4. **Data.** `wms_inbound_receipt_lines`: `receipt_id`, `product_id`, `lot_code`, `serial_number`, `expected`, `received`, `damaged` (each `>= 0`), `over_receipt_approved_by` [DA 2.3]. `wms_lots`: `product_id`, `lot_code`, `expiry_date`, `received_at`; unique `(account_id, product_id, lot_code)`. `wms_serials`: `serial_number` unique per product. `wms_stock_movements`: append-only (W-5), `quantity > 0`, `from ≠ to`, lot and serial per mode (W-4), `recorded_by`, `ref` to the receipt. Retention: ledger and lots for the life of the account. Conflict: R2 retention (section 0) against the 90-day closed-account rule (DA 13.2, Q-38 provisional).
5. **Surfaces.** WMS web receipt detail with a scan focus and receive actions [WEBD row 347; WEBD section 8 says pick and pack screens are scanner-first, receipts not named]. API: `listReceipts`, `createReceipt`, `getReceipt`, `receiveReceiptLine`, `closeReceipt`, `cancelReceipt`. Webhook: `wms.inbound_receipt.received` at close only, with `expected`, `received` and `damaged` per line [WH]. Handheld: undecided (PC section 5, question 1); five of nine platforms run the receiving floor on handhelds (PC section 2). Supplier documents: none at receipt.
6. **Permissions, roles, audit.** `wms.receipts.write` and `wms.receipts.read`. Owner, admin and `warehouse_staff` (site-scoped) hold write [ROLES]. Movements carry `recorded_by` [DA 2.3]. No audit action names in the contract.
7. **Dependencies and integrations.** Scanner hardware (undecided). Product barcodes (WMS-2). Label printers for lot labels (feature 9). No ERP.
8. **Metrics and reporting.** Not defined in any document. Proposed by us: receipt accuracy (lines with `received = expected` over lines); damaged rate (`damaged` over `received`); first scan to close (needs timestamps, feature 11).
9. **Market and chosen shape.** Market: ShipHero receives a PO by scanning a receiving location, splits lines across locations and flags over- and under-received lines (SH H18, read). Fulfillor adds 2D and QR receiving tags (Jan and Jun 2026; FF F16, F6). Anchanto runs receiving on an Android handheld with camera scanning (AN A2, A18; S3). Omniful lists goods receipt notes (OM O3, O4). Chosen (repo): per-line scan against expected lines, one ledger movement per scan (DM 4.11; ADR-0011). Proposed shape: own for the per-scan movement; adapt ShipHero's split across locations only if the pilot has several receiving locations per receipt, which the schema does not allow (one `receiving_location_id`).
10. **Roadmap mapping.** Covered: WMS-2 (lots, serials), WMS-4 (receive), W-3, W-4, W-15, WEB-14; wave 3. Partial: manufacture date, supplier invoice reference, receive-time expiry rule, duplicate-serial error, scan input for web or handheld. Owner questions: Q-I2, Q-I3, Q-I15.

## 4. Over-receipt tolerance and approval

1. **Definition and user goal.** Receiving more than the PO line allows needs a second person's approval before the surplus is written into stock, so an over-shipment is a decision on record.
2. **Workflow.** `receiveReceiptLine` answers 422 `approval_required` when receiving passes the PO line plus tolerance. `approveOverReceipt` (POST, `reason_code`, optional `note`) needs `wms.receipts.approve`; the approver differing from the counter is enforced by 403 `separation_of_duties` [OAPI; ERR; W-15]. The receipt stays `receiving` while approval is pending (inference from DM 4.11). Blind receipts (no PO) have no PO line to exceed; the contract says nothing about them. Short receipts have no approval state; `closeReceipt` answers 409 only for an invalid transition [OAPI].
3. **Business rules and edge cases.** W-15 says receiving above "the PO line plus the account tolerance" needs an approver [DM 4.16]. No table, column, setting or default holds the tolerance; the unit (units or percent) and the scope (per line or per account) are undefined in DM, DA, OAPI and RM; FC-WMS lists the default as open (Q-U11). Granularity conflicts: DA 2.3 puts `over_receipt_approved_by` on the line, while OAPI approves the whole receipt. Separation: DA 2.3 has a CHECK that the approver differs from the requester on adjustments only; the receipt path has none. R1 and R2 say nothing about over-receipt.
4. **Data.** `over_receipt_approved_by` on the receipt line [DA 2.3]; PO line `quantity` [DA 2.3]. No tolerance field, no approval timestamp, no stored `reason_code` (the request carries it; storage is not in DA). Invariant W-15.
5. **Surfaces.** WMS web receipt detail, approval panel [WEBD row 347]. API `approveOverReceipt`. Webhooks: none for approval; over-receipt is visible at close as `expected ≠ received` in `wms.inbound_receipt.received` [WH].
6. **Permissions, roles, audit.** `wms.receipts.approve` is held by owner and admin only; `warehouse_staff` cannot approve [ROLES]. Owner and admin can receive and approve the same receipt, so the separation rule is the only control. `reason_code` is required; `note` is optional, up to 1000 characters [OAPI WmsReasonRequest].
7. **Dependencies.** PO lines (feature 1). None external.
8. **Metrics.** Proposed by us: over-receipt rate (receipt lines with `received > expected` over lines received); approvals pending, with age; approvals refused by separation. None defined in a source.
9. **Market and chosen shape.** Market: ShipHero flags over-received lines (SH H18); no teardown read describes a tolerance approval step; FC-WMS notes no product page named one. Chosen (repo): approval gate with separation of duties (W-15; OAPI). Proposed: own, because no market shape was read; the tolerance itself needs a per-account setting, following the pattern of the adjustment threshold Q-17 (inference).
10. **Roadmap mapping.** Partial: WMS-4 names over-receipt approval; W-15 and the endpoints exist; the tolerance is in no row. Owner question: Q-I1 (= Q-U11).

## 5. Quality hold and inspection

1. **Definition and user goal.** Received stock that has not passed inspection, or has failed, stays out of available stock until a named person releases it or sends it back.
2. **Workflow.** None in the repo. Receipt states are `expected`, `receiving`, `received`, `put_away`, `cancelled` [DM 4.11]. The only inspection output is the `damaged` count on a receive line [OAPI]. The `quarantine` location type exists [DM 4.1] and is used as a return disposition (W-17). Market: ShipHero marks inbound shipments `QC_ON_HOLD` (SH D8, D19); Anchanto lists quality checks on POs and inbound stock (AN A2, A4); Shipsy has QC workflows (FC-WMS S8). Proposed, not decided: `received → held → released to put-away`, or `held → rejected → supplier return` (feature 8).
3. **Business rules and edge cases.** R2 (pharma): inspect each shipment (appearance, packaging, labels); separate rejected, recalled or returned products, store them securely and labelled, keep records (sections "Receiving and Disbursing" and transport). R2 (cosmetics): separate areas for damaged or expired products and for recalled products. Food: not in R2; no food rule was read (Unanswered). Release authority: none defined.
4. **Data.** No hold entity or status. The repo can express a hold by location: `wms_locations` has `type` (quarantine) and `pickable` [DA 2.3]. Available stock counts only pickable locations [DM 4.10], so a non-pickable quarantine location already sits outside available. A release or rejection is a movement (W-5). An inspection record would be new. Retention: the R2 records (section 0) are not covered by DA 10.
5. **Surfaces.** WMS web: WEB-14 names receipts, stock and movements but no hold screen [RM WEB-14]. API: none. Webhooks: a move into quarantine changes `available` and fires `wms.stock.available_changed` (DM 5.3, 6.3). Handheld: undecided.
6. **Permissions, roles, audit.** None defined. Inference: release by `wms.receipts.approve`, releaser differing from the receiver, as in feature 4.
7. **Dependencies.** Laboratory or certificate records: none found in R2 text read. None external.
8. **Metrics.** Proposed by us: held quantity and age; rejection rate per supplier and per lot. None defined.
9. **Market and chosen shape.** Market: Shipsy QC and ShipHero `QC_ON_HOLD` as above; Fulfillor shows no receiving hold in the pages read (FF section 2). Chosen (repo): none as a status; `quarantine` location and movements exist (DM 4.1; ADR-0011). Proposed shape: adapt. Hold by movement to a non-pickable quarantine location, release or reject by movement, and an additive inspection record. Reason: W-8 and the availability rule already exclude non-pickable stock, so a status would duplicate that rule. This differs from FC-WMS P4, which proposes a hold status. A status route would need an ADR amendment of ADR-0011.
10. **Roadmap mapping.** Partial: quarantine location (WMS-1), damaged count (WMS-4). Missing: hold and inspection. WMS-12 (receiving holds and put-away rules, proposed in FCN, wave 3). Owner questions: Q-I8, Q-I3.

## 6. Put-away lists and rules

1. **Definition and user goal.** Received goods move from the receiving location to storage. A put-away list is the planned set of moves; rules choose the storage location instead of a person.
2. **Workflow.** `putAwayReceipt` (`moves` with `StockRef` and `to_location_id`, at least one) writes the moves and sets the receipt to `put_away` when every line is moved [OAPI; DM 4.11]. Errors: 409 `invalid_transition`, 409 `insufficient_stock`, 422 `tracking_mode_mismatch` [OAPI]. Idempotency-Key required. No draft list, no lock. Market: ShipHero Putaway V2 builds a draft list by scanning, locks it with "Start Putaway", and logs each move live (SH H19). Fulfillor's rules exist only in a blog guide (FF F19).
3. **Business rules and edge cases.** None in the repo. Rule inputs named by the market: capacity, storage need, accessibility (Odoo, FC-WMS S16); directed put-away (Extensiv S19, NetSuite S21); velocity slotting (Shipsy S8); "intelligent" recommendations (Anchanto AN A2, claimed). ShipHero deprecated its dynamic slotting query on 2026-10-13 and no velocity slotting was found (SH D8). R2: controlled-temperature stock needs storage and monitoring by location (temperature devices linked to the approved temperature mapping); the location tree has no temperature class [R2; DA 2.3]. Rules on capacity or storage class need attributes that `wms_locations` lacks (`coordinates`, `pickable`, `active` only).
4. **Data.** Moves are `wms_stock_movements` from receiving to storage, with lot and serial per mode (W-4) and `reason` per DM 4.4. `wms_stock_levels` rows exist per non-system location; `on_hand >= 0` is the only capacity check (W-6). No capacity field. Retention: ledger, life of the account.
5. **Surfaces.** WMS web: put-away on the receipt detail [WEBD row 347]. API: `putAwayReceipt`. Webhook: none beyond `wms.stock.available_changed` when available changes [DM 6.3]. Handheld: undecided; ShipHero and Anchanto put-away run on a handheld (SH section 1.2; AN A2).
6. **Permissions, roles, audit.** `wms.receipts.write` (owner, admin, `warehouse_staff`) [ROLES]. No separation.
7. **Dependencies.** Bin barcodes (feature 9). Temperature monitoring by location, if pharma is in the pilot (R2).
8. **Metrics.** Put-away lead time (feature 11); moves per receipt; manual location overrides against a rule (none exists yet). Proposed by us.
9. **Market and chosen shape.** Market as in 5 and 6: locked draft list with live partial moves (SH H19), rule-based storage (FC-WMS S16, S19, S8). Chosen (repo): storage location chosen per move by the operator, as the contract is written. Proposed shape: adapt the locked draft list (lock before the first move, one movement per move, idempotent per move, which the existing contract already supports). Own rules after the location attributes exist. An attribute for capacity or storage class amends DM 4.1 and DA 2.3 under ADR-0012; no ADR exists for it yet.
10. **Roadmap mapping.** Partial: WMS-4 names put-away; W-14 steps. Missing: lists, rules, location attributes. WMS-12 proposes rules (wave 3). Owner question: Q-I9.

## 7. Cross-dock

1. **Definition and user goal.** Goods received for an open fulfilment order go straight to outbound without storage, saving a put-away and a pick.
2. **Workflow.** None. The receipt path is `expected → receiving → received → put_away`; there is no edge to a dock or to a fulfilment order [DM 4.11]. Reservations attach only to available stock, which exists after put-away [DM 4.10; W-8].
3. **Business rules and edge cases.** None in the repo. FCN places cross-dock in wave 4 or later, "only for a 3PL or wholesale client". ADR-0005 keeps stock to the merchant's own; ADR-0002 scopes the product to last-mile and WMS. R2 requires separate receiving and delivery areas; it does not regulate cross-dock timing (R2 premises).
4. **Data.** None. A link from receipt line to fulfilment order line would be new. The `dock` location type holds packed goods awaiting pickup, not received goods [DM 4.1; W-14].
5. **Surfaces.** None.
6. **Permissions.** None.
7. **Dependencies.** A 3PL client model (Q-U2; ADR-0005).
8. **Metrics.** Proposed by us: share of received units shipped without put-away. No source defines it.
9. **Market and chosen shape.** Market: Shipsy (FC-WMS S8), Omniful (S11), Odoo (S16), Deposco (S20, S). FCN rates it low for a single-site merchant and medium for a 3PL (inference, not sourced). Chosen (repo): none. Proposed shape, if ruled in: own, via reservation on a receipt line, which needs the 3PL ruling first.
10. **Roadmap mapping.** Missing. Proposed WMS-17 (FCN section 3), post-4, with ASN. Owner question: Q-I10 (= Q-U2).

## 8. Receipt documents and supplier returns

1. **Definition and user goal.** Two things. (a) A receipt document: the record printed or sent for a delivery, with the supplier's documents kept against it. (b) A supplier return: goods sent back to the supplier, with the credit note that corrects the supplier's invoice.
2. **Workflow.** (a) The receipt number (`GR-`) comes from the sequence rule [DA 7]; no print or export operation exists in OAPI; the close event carries the lines [WH]. (b) None. `wms_returns` covers customer returns only (source `delivery_return`, `carrier_return`, `walk_in`) [DA 2.3; DM 4.8; RM WMS-8]. Proposed, not decided: a supplier return as a movement from storage to the SUPPLIER system location (defined in ADR-0011; W-5 allows one system side) with a return record that cites the receipt and PO lines.
3. **Business rules and edge cases.** R3 section 7: a supplier issues a credit note for goods returned in full or in part, and the credit note corrects the original tax invoice; a return therefore needs the invoice number and date. The receipt stores neither [DA 2.3]. R2 (cosmetics) also keeps the invoice number and date on incoming records. Numbering conflict: DA 7 gives receipts a `GR-` display, while the webhook example in `webhooks.md` shows `R-000041`. Arabic: ADR-0016 applies to the receipt document; R3 4.2.1 requires Arabic on tax invoices, and the roadmap has no tax-invoice output for this product.
4. **Data.** No supplier-document table. Object storage exists for proofs (`del_proofs.storage_key`) and labels (`label_storage_key`) [DA 2.2, 2.3]. Retention for supplier documents: not in DA 10. R2 retention would apply for pharma and cosmetics.
5. **Surfaces.** Receipt document: none. Supplier documents: none. Supplier return: none. Webhook: `wms.inbound_receipt.received` (the number-prefix conflict is above).
6. **Permissions, roles, audit.** None for documents. Proposed by us: supplier return under `wms.receipts.write`, with approval for value (owner decision).
7. **Dependencies.** Object storage (exists); printers (undecided); the supplier's credit note (no integration; no supplier channel).
8. **Metrics.** Proposed by us: supplier return rate by units and by value; days from return to credit note. None defined.
9. **Market and chosen shape.** Market: Odoo and Shipsy route customer returns to restock, quarantine, or scrap (FC-WMS S16, S8). No product page read names a supplier return (FC-WMS Q-U14 open). Chosen (repo): none for supplier returns. Proposed shape: own, using the SUPPLIER system location that ADR-0011 already defines, plus two fields (supplier invoice number and date). No new ledger. The credit-note handling itself belongs to the supplier's and merchant's tax records; ZATCA scope is unresearched (OPS-8).
10. **Roadmap mapping.** Partial: receipt number and close event (WMS-4). Missing: receipt documents, supplier documents, supplier returns (WMS-8 covers customer returns). Owner question: Q-I13.

## 9. Inbound labels

1. **Definition and user goal.** Printed labels for inbound goods: carton or pallet labels, lot labels, license-plate (LPN) labels, and bin or tote labels for put-away.
2. **Workflow.** None for receipts. Location and tote labels are a proposed WMS-1 extension (FC-WMS P7, FCN WMS-15, wave 3). Outbound package labels exist (`label_storage_key`; INT-8). No printer integration exists in the repo.
3. **Business rules and edge cases.** R1: the supplier name and CR number are printed by the importer or manufacturer on the product; the receiving check can read the label, but cannot match it to a supplier record without a CR field. R2 (pharma): incoming records need batch and expiry, which a lot label can carry. GS1 DataMatrix for drugs is in S26 [S], not verified against SFDA text. ADR-0016: label text is Arabic and English (inference for templates).
4. **Data.** `wms_product_barcodes` (barcode per product) [DA 2.3]. `wms_locations.code` is a human code with no barcode field. No LPN table (ShipHero uses license-plate numbers, SH H18). No label log.
5. **Surfaces.** Web print: none defined. Handheld: undecided. Printers: none chosen. No webhook.
6. **Permissions.** None defined. Inference: printing under `wms.locations.manage` (locations) or `wms.receipts.write` (receipts).
7. **Dependencies.** Label printers (ShipHero recommends Zebra for mobile printing and Mettler Toledo scales, SH section 1.10, read). GS1 company prefix (Q-U5; ShipHero builds GS1 labels from a retailer's prefix, SH section 1.7, [S]).
8. **Metrics.** Proposed by us: label reprints per receipt; scan failures by label type.
9. **Market and chosen shape.** Market: ShipHero GS1 and LPN labels (SH section 1.7, H18); Fulfillor QR receiving tags replacing barcodes (FF F6, Jun 2026); Logestechs barcoded locations (FC-WMS S5, read); Zoho barcode generation (FC-WMS S17). Chosen (repo): location codes and product barcodes only. Proposed shape: adapt location and tote labels first (FC-WMS P7); LPN labels only if the handheld is chosen (feature 3), because LPNs carry stock through put-away in the ShipHero model.
10. **Roadmap mapping.** Partial: location codes (WMS-1), product barcodes (WMS-2). Missing: receipt and lot labels; location labels are proposed (P7). Owner questions: Q-I11, Q-U5.

## 10. Inbound appointments and dock scheduling

1. **Definition and user goal.** A carrier or supplier books an arrival window and a dock door; the site plans receiving labour and doors against the bookings.
2. **Workflow.** None in the repo. Generic flow in the vendor sources: booking through a portal, check-in on arrival, door assignment, receiving preparation (R4, R5; vendor and glossary, secondary). Omniful names "gate entry" in its inbound flow without detail (OM O3, O4).
3. **Business rules and edge cases.** None in the repo. The `dock` location type is for outbound packed goods (DM 4.1). Delivery slots (DEL-9, DM 3.9) belong to the delivery context, and DA 1.1 forbids foreign keys between `del_` and `wms_`; reuse needs a port under ADR-0026. R2 requires a designated receiving entrance (R2 premises); no timing rule was read.
4. **Data.** None. Needed: appointment, carrier or supplier, window, door (a dock location; no receiving-dock type exists), status.
5. **Surfaces.** None; WEBD section 8 names no appointment screen.
6. **Permissions.** None.
7. **Dependencies.** Carrier and supplier contact: WhatsApp messages are template-only (ADR-0037). Gate or yard systems: none.
8. **Metrics.** Proposed by us: appointment adherence; door utilisation. Dock-to-stock (feature 11). The vendor sources name detention fees and truck waiting time as drivers (R4, claimed).
9. **Market and chosen shape.** Market: vendor glossary and blog describe booking, door scheduling and WMS staffing from bookings (R4, R5; vendor framing, not independent). Chosen (repo): none. Proposed shape: defer. The pilot has no volume data for carrier appointments and no KSA practice was read; an order would need its own ADR if the pilot needs it.
10. **Roadmap mapping.** Missing. Not in RM, FCN, FC-WMS or an ADR. Owner question: Q-I12.

## 11. Receiving KPIs

1. **Definition and user goal.** Inbound performance measures for the site manager and the owner: dock-to-stock time, receipt accuracy, over-receipt rate, damaged rate, supplier short-delivery rate, put-away lead time, approvals pending.
2. **Workflow.** Not a workflow. Reporting objects in the repo: `rpt_stock_position` and `rpt_site_day` serve stock and delivery [DA 9]; `rpt_daily_kpis` is the only KPI table, filled nightly at 02:00 Asia/Riyadh for closed days [DA 9]. No receiving view exists.
3. **Business rules and edge cases.** Dock-to-stock is the time from first scan to the last put-away move. Receipts carry `created_at` and `updated_at` only [DA 1.3]; `updated_at` is overwritten on each change, so state times are lost. Movements can give the times if they carry `created_at` (DA 1.3 applies the column rule to every table unless the catalogue says otherwise; inference, to confirm). Our definitions; no source defines them.
4. **Data.** No receiving columns in `rpt_daily_kpis`. Proposed additive fields: `received_at` and `put_away_at` on `wms_inbound_receipts` (inference). Retention of KPI history: a real table, retention not stated (DA 9).
5. **Surfaces.** WMS web: no tile or report named in WEBD. FCN proposes RPT-1 (exports and dashboard tiles, wave 2) for delivery. API: none.
6. **Permissions.** No WMS reporting permission exists in `permissions.yaml` (checked; only `delivery.cash.close_report`). Owner question on who reads inbound KPIs.
7. **Dependencies.** The ledger (WMS-3), receipts (WMS-4), the nightly job (DA 9).
8. **Metrics.** Definitions proposed by us: dock-to-stock (minutes, median and 90th percentile, per site and per day); receipt accuracy (lines with `received = expected`, per supplier); over-receipt rate; damaged rate (`damaged` over `received`); supplier short-delivery rate; put-away lead time; approvals pending and their age.
9. **Market and chosen shape.** Market: Logestechs reports SKU movements, low stock and inbound and outbound (FC-WMS S5, read); Anchanto's KPI panels cover delivery and outbound, not receiving (AN A7); ShipHero offers data exports (SH D9). No read source defines a receiving KPI. Chosen (repo): none. Proposed shape: own definitions above, reported through `rpt_daily_kpis` rather than live queries (DA 9 rule against materialised views).
10. **Roadmap mapping.** Missing. WMS-3 reporting is partial (DA 9 views; FC-WMS Module 4 row). No order names receiving KPIs. Owner question: Q-I14.

## 12. Hand-off to chapter 08 (counting)

- Receiving discrepancies that stay unexplained go to count sessions (WMS-5, chapter 08), not into this chapter's receipt. Stock losses found there post as adjustments under W-16. This chapter takes no position on count design.

## Feature index

| Feature | Status | Order | Wave | Owner question |
|---|---|---|---|---|
| 1 Suppliers and purchase orders | Partial | WMS-4 | 3 | Q-I4, Q-I5, Q-I6 |
| 2 Advance shipping notices and matching | Missing | WMS-17 (proposed, FCN) | post-4 | Q-I7 |
| 3 Receiving by scan with lots, serials, expiry | Partial | WMS-4, WMS-2 | 3 | Q-I2, Q-I3, Q-I15 |
| 4 Over-receipt tolerance and approval | Partial | WMS-4 | 3 | Q-I1 |
| 5 Quality hold and inspection | Missing | WMS-12 (proposed, FCN) | 3 | Q-I8, Q-I3 |
| 6 Put-away lists and rules | Partial | WMS-4; WMS-12 (rules) | 3 | Q-I9 |
| 7 Cross-dock | Missing | WMS-17 (proposed, FCN) | post-4 | Q-I10 |
| 8 Receipt documents and supplier returns | Partial (documents), Missing (supplier returns) | WMS-4; none for supplier returns | 3; none | Q-I13 |
| 9 Inbound labels | Missing (location labels partial) | WMS-1 extension (P7, proposed) | 3 (proposed) | Q-I11 |
| 10 Inbound appointments and dock scheduling | Missing | none | none | Q-I12 |
| 11 Receiving KPIs | Missing | none; WMS-3 reporting partial | none | Q-I14 |

## Owner questions (this chapter)

- **Q-I1** Over-receipt tolerance: value, unit (units or percent), scope (per line or per account), default, and who may approve (= Q-U11). Blocks wave 3 receiving.
- **Q-I2** Manufacture date, batch and expiry capture at receipt for pilot products, and a close-to-expiry threshold for receiving.
- **Q-I3** Are SFDA-regulated products (R2) or SASO-listed products (R1) in the pilot? Food is not covered by R2 and no food rule was read. The answer decides holds, batch retention and CR printing.
- **Q-I4** Retention: receipts, lots and supplier records under R2 against the 90-day closed-account rule (Q-38, provisional).
- **Q-I5** Supplier record: CR number and bilingual name required for the pilot?
- **Q-I6** PO send channel: none, PDF, e-mail, or a WhatsApp template (ADR-0037, ADR-0041).
- **Q-I7** ASN or EDI: needed for any pilot supplier (also Q-U2).
- **Q-I8** Hold release authority and whether an inspection record is required.
- **Q-I9** Put-away rules in wave 3, and which location attributes (capacity, storage class, temperature) come first.
- **Q-I10** Cross-dock and 3PL: stays out under ADR-0005 (= Q-U2)?
- **Q-I11** Receipt and lot labels: needed for the pilot; GS1 membership (Q-U5); printers with the handheld decision.
- **Q-I12** Dock appointments: does the pilot receive from carriers at a volume that needs them?
- **Q-I13** Supplier returns in scope (Q-U14), and must the supplier invoice number and date be stored on receipts?
- **Q-I14** Receiving KPIs: which ones for the pilot, and may `received_at` and `put_away_at` be added to receipts (additive schema change)?
- **Q-I15** Handheld or web scanner-first for receiving (PC section 5, question 1; SH section 7, question 11).

## Unanswered

- SFDA rules for food receiving (outside R2 scope); the SFDA GSDP version in force (cover 1.2, table 2.1); whether R2's drug GS1 DataMatrix rule applies (S26 [S] only).
- Whether movements carry `created_at` for dock-to-stock (DA 1.3 inference).
- The duplicate-serial response, and the receipt-level versus line-level approver.
- Whether the PO status moves from receipts automatically, and who closes a short PO.
- Whether the simplified-invoice threshold (SAR 1,000) and the buyer VAT-number rule apply to the pilot's purchases; ZATCA e-invoice clearance rules for purchase documents were not read.
- Blind-receipt over-receipt rule.

## Source list

All sources were read on 2026-11-02.

Repo (read at origin/main 6ca087e):
- DM `docs/architecture/domain-model.md` sections 3.9, 4.1, 4.3, 4.4, 4.8, 4.10, 4.11, 4.16, 5.3, 6.3
- DA `docs/architecture/data.md` sections 1.1, 1.3, 2.2, 2.3, 7, 9, 10, 13
- OAPI `docs/contracts/openapi/staff-wms.yaml` (purchasing and receiving operations; `CreateReceiptRequest`, `ReceiveLineRequest`, `PutAwayRequest`, `StockRef`, `WmsReasonRequest`); COMP `docs/contracts/openapi/components.yaml` (Supplier, PurchaseOrder, InboundReceipt)
- ERR `docs/contracts/errors.md`; WH `docs/contracts/webhooks.md`; ROLES `docs/contracts/roles.yaml`; PERM `docs/contracts/permissions.yaml`
- RM `docs/roadmap.md` sections 1.4, 1.5, 4 (Q-2, Q-17, Q-36, Q-38)
- WEBD `docs/architecture/web.md` section 8 (row 346 to 348)
- ADR-0002 (`adr/0002-scope-last-mile-and-wms.md`), ADR-0005 (`adr/0005-own-fleets-only.md`), ADR-0011 (`adr/0011-stock-as-double-entry-ledger.md`), ADR-0012 (`adr/0012-tracking-mode-and-location-tree.md`), ADR-0016 (`adr/0016-arabic-and-english-everywhere.md`), ADR-0018, ADR-0024, ADR-0026, ADR-0037, ADR-0041
- AGENTS.md (Arabic and English for every string; own fleets only)

Remote research (`git show`, read 2026-11-02):
- FC-WMS `origin/docs/feature-coverage:docs/research/features-wms-2026-11.md` (source ids S5, S8, S11, S16, S17, S19, S20, S21, S26 as listed there)
- FCN `origin/docs/feature-coverage:docs/research/feature-coverage-2026-11.md` section 3 and section 5
- PC `origin/docs/platform-teardowns:docs/research/platform-comparison-2026-11.md` sections 2, 5, 6
- SH `origin/docs/platform-teardowns:docs/research/shiphero-teardown-2026-11.md` (ids H18, H19, D6, D8, D9, D15, D19, H22; sections 1.2, 1.7, 1.10, 7)
- FF `origin/docs/platform-teardowns:docs/research/teardown-fulfillor-2026-11.md` (F6, F11, F16, F19)
- AN `origin/docs/platform-teardowns:docs/research/teardown-anchanto-2026-11.md` (A2, A4, A7, A18; S3)
- OM `origin/docs/platform-teardowns:docs/research/teardown-omniful-2026-11.md` (O3, O4)

External (read 2026-11-02):
- R1 https://saber.sa/Assets/Home/Circular_Supplier_Name_and_CR_on_Product.pdf (SASO circular; text extracted locally)
- R2 https://sfda.gov.sa/sites/default/files/2025-05/GSDP-E.pdf (SFDA GSDP; text extracted locally; sections read: Premises and Storage, Receiving and Disbursing, Records and Auditing, cosmetic warehouses)
- R3 https://zatca.gov.sa/en/HelpCenter/guidelines/Documents/Guideline-for-Tax-Invoicing-and-Records-under-VAT-Provisions.pdf (ZATCA guideline v3, May 2026; text extracted locally; sections 4.2, 4.2.1, 4.3, 5.1, 7, 9.1; FAQ 5)
- R4 https://www.infios.com/en/knowledge-center/glossary/wms-dock-appointment-scheduling (vendor glossary; secondary)
- R5 https://racklify.com/encyclopedia/what-is-a-receiving-appointment-definition-purpose-and-how-it-works/ (vendor encyclopedia; secondary)
- Secondary and not adopted: a search summary on ZATCA input tax that said simplified invoices never support deduction (contradicted by R3 9.1 and FAQ 5); a regulatory brief that limited the SASO rule to certificates of conformity issued on or after 1 October 2026 (R1 has no such limit).
