# Feature census: platform, tenancy and billing; integrations and network; analytics; compliance and security (2026-11)

- **Date of research:** 2026-11-02. Every source was read on 2026-11-02 unless a row says otherwise.
- **Question:** which features and obligations a last-mile and WMS platform for Saudi merchants is expected to have, and where `docs/roadmap.md` §1 covers them, partly covers them or does not.
- **Method:** roadmap §1 (Delivers column), §4 (Q-10 to Q-14, Q-33, Q-37, Q-38), §6 (deferred), the architecture documents 2 to 9, and the repository notes listed in the sources. Public pages were read with WebFetch and WebSearch. Where a source could not be read, the row says so.
- **Labels:** [S] = a source read says it (key in the Sources section). [I] = my inference from [S] facts. [unverified] = a secondary snippet or vendor claim not confirmed on a primary page. "Not found" = a search or fetch did not settle it.
- **Access limits on 2026-11-02:** sdaia.gov.sa and the SDAIA PDPL PDF returned "Request Rejected"; iso.org returned 403; developer.bringg.com does not resolve; the Bringg pricing page returned 404; the Tamm site failed its TLS check; the ZATCA roll-out wave table is an image. Rows that depend on these say so.
- **Not legal advice.** Regulatory rows describe what the sources say and flag what needs counsel.

## Summary for the lead

- Of 55 feature rows: 13 covered by a roadmap order (tenancy, roles, audit, rollout flags, timezones, public API, webhooks, Salla and Zid intake, Hudhud geocoding, SLA and scorecards, cash reports), 13 partial, 28 missing, 1 unknown (the certification named in the brief).
- Largest gap: billing. No plan catalogue, subscriptions, merchant invoices, VAT, ZATCA e-invoicing or gateway is in the roadmap. `PaymentPort` is unimplemented until the owner unlocks ADR-0017 (roadmap §6). A BILL track before wave 2 pricing (Q-33) is proposed.
- ZATCA phase 2 applies to Eeasy's own invoices once Eeasy is in a wave [S1, I]. ZATCA notifies a wave at least six months ahead [S1]. The wave table is an image; vendor guides disagree on wave 24 and wave 25 dates [unverified].
- PDPL: the official text could not be read on 2026-11-02. Secondary sources give a 72-hour breach notice to SDAIA under Article 24 [unverified]. Draft amendments (published 6 October 2026, consultation to 5 November 2026) would drop the harm threshold for SDAIA notice, add an in-Kingdom storage duty (draft Art. 23(2)) and a 30-day deemed-rejection rule for data subject requests (Art. 3), and require registration for transfers abroad (Art. 34) [S3, S4].
- The roadmap has no records of processing, data subject request workflow, breach runbook, transfer register or penetration test. A PDPL order is proposed before the pilot holds real recipient data.
- NCA CCC-2:2024 applies to cloud providers and tenants; its data-localisation subcontrols were moved to NDMO [S2, read 2026-11-02]. No Saudi certification called "Cybersecurity Essentials" was found [Not found].
- Integrations: Salla access tokens last 14 days [S6]. Zid logistics apps must be public and reviewed [S7]. Shopify, WooCommerce, noon, Amazon.sa, Magento and ERP connectors are not in the roadmap.
- Carrier aggregation (Torod, OTO) is not in the roadmap. It conflicts with the "own fleets only" rule (AGENTS.md) and ADR-0001 and ADR-0014. The owner must rule before any order is written.
- Global benchmarks: Onfleet bills per completed task with SAML SSO only on Enterprise [S14]. Bringg and FarEye show no public pricing tiers on the pages read [S16, S17]. ShipHero's API has credit and request-rate limits [S15].

## 1. Platform, tenancy and billing

| Feature or obligation | What it is | Who offers or requires it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Multi-tenant account provisioning | A platform admin creates an account, sites and the owner invite, with an audit row per step | Onfleet Enterprise offers multi-brand and multi-region tiers [S14]; identity doc §6 [S28] | high: the product is sold per merchant | covered: PLAT-13 | 0 |
| Self-serve signup with approval | A merchant creates its own account, then a platform user approves it | Torod's free tier needs no sales contact [S12] | medium: SME merchants onboard themselves | missing (identity §6 says the platform admin creates accounts) | 2 with BILL-1 |
| Roles and permissions | System roles, a permission catalogue, site scoping | Market norm, not sourced here; WooCommerce keys inherit a user's role [S19] | high | covered: PLAT-10; custom account roles deferred (roadmap §6) | 0 |
| Enterprise SSO (SAML 2.0) for merchant staff | Merchant staff sign in with the merchant's identity provider | Onfleet SAML SSO on Enterprise only [S14]; Bringg SSO and SOC 2 claimed by a third-party listing, low confidence [unverified] | medium: needed by larger merchants, not by SMEs [I] | missing: ADR-0023 own identity; "Eeasy sign-in link" not scheduled (roadmap §6) | 4 or later |
| Audit log with export | Append-only, partitioned log of admin and ledger-adjacent actions | Internal rule (doc 4 §7); no external source read | high | covered: PLAT-7 | 0 |
| Feature flags and rollout modes | Modules hidden until a platform user enables them per account | Internal rule ADR-0006 | high | covered: PLAT-13 | 0 |
| Support access to an account | Read-only access for support, one hour, banner, reason recorded | Q-9 default (roadmap §4); identity doc §10 question 3 [S28] | high: needed to support merchants under audit | partial: WEB-4 (banner, X-Support-Reason) and PLAT-13 (cross-tenant reads); the read-only, time-boxed rule is provisional (Q-9); write fixes are DEL-15 | 0 (WEB-4), 2 (DEL-15) |
| Subscription plans and usage metering | Plans with limits, periods and counters for orders, drivers, sites and API keys | Torod: 0, 199 and 399 SAR a month, annual discounts [S12]; Onfleet: billed per completed task, overage per task [S14]; Zid: subscription apps with monthly or yearly plans [S7]; Shopify: recurring and usage charges [S18] | high: SAR plans are the expected unit in KSA [I] | partial: PLAT-12 usage counters (`core_usage_counters`) and limits [S28]; missing plan catalogue, subscription lifecycle and dunning; pricing is Q-33 | 2 (BILL-1) |
| Merchant invoices and receipts | Eeasy's own invoices to merchants for subscription and usage | Requirement follows the VAT and ZATCA rows below | high if Eeasy invoices merchants | missing | 2 (BILL-2) |
| Payment gateways for merchant charges (mada, cards, Apple Pay, STC Pay) | Card and wallet charges, tokens, recurring charges, webhooks | Moyasar: mada, Visa, Mastercard, UnionPay, Apple Pay on web; STC Pay and Google Pay listed; Payments, Invoices and Payouts APIs; sandbox [S8]. HyperPay: COPYandPAY, server-to-server, subscriptions and registration tokens, webhooks; currencies not stated [S9]. Tap: recurring payments guide, invoices, payouts, destinations, merchant onboarding; STC Pay and Apple Pay; settlement not stated [S10]. PayTabs: hosted payment, invoices, PayLinks, managed and own form, APMs; recurring not on the overview page [S11] | high: gateway choice drives merchant onboarding [I] | missing: `PaymentPort` is unimplemented until ADR-0017 is unlocked (roadmap §6) | 2 or 3 (BILL-3), owner unlock first |
| Split settlement and payouts to third parties | Marketplace-style split between Eeasy and merchants or drivers | Tap destinations and payouts [S10]; PayTabs split API not found [Not found] | medium: needed only if Eeasy collects and forwards merchant funds [I] | missing; COD cash custody (DEL-11) is a different flow | owner decision |
| ZATCA phase 2 e-invoicing | UBL 2.1 XML, hash chain, cryptographic stamp, QR code; standard invoices cleared, simplified invoices reported within 24 hours (vendor) | ZATCA roll-out page: phase 2 enforceable from 1 January 2023 in waves; ZATCA notifies six months ahead [S1]. Vendor guides: wave 24 deadline 30 June 2026 and wave 25 deadline 1 February 2027, which conflict [unverified, S23] | high once Eeasy is in a wave; applicability to Eeasy is unknown [I] | missing | 2 (BILL-2), before the first merchant invoice |
| VAT handling | Tax rate per line, tax number on invoices, six-year archive | Standard VAT rate 15% and six-year archive [unverified, S23]; Saudi books must be kept in KSA (income tax implementing rules) [unverified, search 2026-11-02] | high | missing: money is `bigint` halalas with `currency` fixed to SAR and no tax field [S28, data §1] | 2 (BILL-1) |
| Multi-country and multi-currency | Accounts in other GCC states, other currencies and their decimals | KWD, BHD and OMR have three minor units; SAR, AED and QAR have two [S20] | medium: GCC rollout is not in the roadmap; the owner has not ruled on it [I] | partial: `country` is CHECK 'SA' and `currency` CHECK 'SAR' in data.md; adding GCC changes the money model, a one-way door | 4 or later (ADR needed) |
| Timezones and business dates | Business date in Asia/Riyadh for cash blocks and reports | D-11 uses Asia/Riyadh [S28, domain model]; `core_accounts.timezone` exists [S28, data.md] | high | covered: PLAT-12 and DEL-11 | 0 and 2 |

Tail: 15 rows. Covered 5, partial 3, missing 7.

## 2. Integrations and network

| Feature or obligation | What it is | Who offers or requires it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Public API and API keys | Keys created, rotated and revoked by an owner or admin; per-key usage; sandbox keys | ShipHero: GraphQL with token and refresh, 28-day access token, 4,004 credits restored at 60 a second, 7,000 requests in five minutes, then 429 [S15]; OTO: sandbox has its own account and token [S13]; Torod: REST `POST /v1/shipments` [S12] | high: integrators are a stated target [I] | covered: INT-9; key shape Q-13 (static `X-API-Key`, provisional) | 4 |
| Merchant webhooks | Signed event delivery with retries, redelivery and a delivery log | OTO: HMAC-SHA256, registered once, not per order [S13]; ShipHero webhooks [S15]; Standard Webhooks adopted by ADR-0040 (Q-43, ruled 2026-11-01) | high | covered: INT-10 | 4 |
| Salla connector | Partner app, OAuth, scopes set in the partner portal, webhook events, token refresh | Salla: access token 14 days, refresh within one month, scopes set in the Partners Portal, rate limits, partner account needed [S6]. Webhook signature not on that page [S6] | high: Saudi store platform named in the brief; store share not sourced [I] | covered: INT-11 (Q-30 new partner apps, Q-34 write-back) | 4 |
| Zid connector | Partner app (public or private), install and OAuth, webhooks per store, payouts | Zid: public apps reviewed before listing; logistics apps must be public; private apps need a Professional or Enterprise plan or API access [S7] | high | covered: INT-11 | 4 |
| Shopify connector | App install, OAuth, webhooks, app billing | Shopify App Pricing is the default for public apps, recurring and usage charges, Shopify collects the charge and pays a revenue share [S18]; OAuth and webhook details not read | medium: not a Saudi-first platform in the brief [I] | missing | 4 or 5 (CONN-1) |
| WooCommerce connector | REST keys per user; Basic auth over HTTPS; OAuth 1.0a over HTTP; key generation at /wc-auth/v1/authorize for apps | WooCommerce REST API documentation [S19]; webhook signature header not read | low to medium [I] | missing | 4 or 5 (CONN-1) |
| Magento connector | Store connector | Not researched | unknown | missing | unanswered |
| noon marketplace | Partner fulfilment (FBPI) APIs with an API user; commission 4 to 27 percent by category (third party); UAE sellers can sell into KSA via Global Selling [unverified, S26] | noon partner support pages: not reached; endpoints unverified | medium: a KSA marketplace [I] | missing | 5 (CONN-2), owner ruling |
| Amazon.sa | Selling Partner API; restricted operations (shipping labels, packing slips) need a restricted data token valid one hour; SP-API regions listed as NA, EU and FE, Amazon.sa not confirmed [S25] | Amazon developer docs [S25] | medium [I] | missing | 5 (CONN-2), owner ruling |
| Carrier aggregation (one API to many carriers) | Create shipments through one API, print labels, receive tracking webhooks, collect COD and remit it | Torod: claims 240+ carriers, auto-select, labels, webhooks, COD transfers; Aramex, SMSA, J&T, Naqel and others named [S12]. OTO: claims 460+ carrier integrations and 15+ on OTO rates, HMAC webhooks [S13] | high for SME shipping in KSA [I] | partial: INT-8 covers Eeasy shipping's own carrier network behind an allowlist, go or no-go 2027-01-15 (Q-29). An external aggregator is missing and conflicts with AGENTS.md "own fleets only", ADR-0001 and ADR-0014 | owner ruling, then 3 or 4 (CARR-1) |
| Direct carrier APIs (Aramex, SMSA, Naqel, J&T) | One adapter per carrier | Named as carriers on Torod [S12]; carrier docs not read | medium [I] | missing by design: ADR-0014 and ADR-0001 keep carrier pricing and coverage in Eeasy shipping (integrations §7) | owner ruling |
| Maps and geocoding in KSA (Hudhud, National Address short codes) | Forward and reverse geocoding, short-code lookup, cache, confidence | Hudhud and the National Address short code [repo: docs/research/hudhud-geocoding-2026-11.md] | high | covered: INT-2 (Hudhud and short codes); the matrix is INT-5 and tiles Q-19, both deferred (A-24) | 1 (INT-2, merged) |
| Google and HERE as fallback geocoders | Second provider when Hudhud is down or does not match | Not read in this census; the geocoding research note covers the fallback question [repo] | low to medium [I] | missing (not planned) | owner ruling |
| ERP connectors (Odoo, Zoho, SAP Business One, other KSA ERPs) | Two-way sync of orders, stock and invoices | Not researched | medium [I] | missing | unanswered |

Tail: 14 rows. Covered 5, partial 1, missing 8.

## 3. Analytics and reporting

| Feature or obligation | What it is | Who offers or requires it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Operations dashboard (KPIs and live board) | Live board of routes and drivers, with KPI tiles for the day | Onfleet dashboards keep 90 days (Launch) to lifetime (Enterprise) [S14] | high | partial: WEB-7 live board; no KPI tiles order | 2 (add to WEB-9 or RPT-1) |
| SLA and on-time report | Share of orders delivered within the promised window | Onfleet analytics by tier [S14]; on-time definition not sourced | high: merchants and carriers use on-time as a contract term [I] | covered: DEL-17, with WEB-18 screens; read-only over ledgers (Q-32) | 4 |
| Driver scorecards | Per-driver on-time, attempts and cash handling | ShipHero and Onfleet not read for scorecards [Not found] | medium [I] | covered: DEL-17 and WEB-18 (Q-32) | 4 |
| Cash and COD reports | Cash report per site and business date, deposits, deficits | Internal (ADR-0007) | high | covered: DEL-12 and WEB-10 | 2 |
| Exports (CSV and spreadsheet) | Download of orders, events, cash and audit rows | Audit export: PLAT-7; import: DEL-3; storage keeps `exports/` for 7 days [S28, integrations storage]; no order-level export named | high: operators work in spreadsheets [I] | partial: PLAT-7 audit export and DEL-3 import; no report export order | 2 (RPT-1) |
| Scheduled reports (email, recurring) | A report sent to a list on a schedule | Mail adapter exists for invitations and resets (PLAT-9); WhatsApp is templates only (ADR-0037) | medium | missing | 4 (RPT-1) |
| BI connectors (warehouse or read API) | Read access for Power BI or similar | Not researched; public API (INT-9) covers orders and tracking only | low to medium [I] | missing | later (RPT-1) |
| Merchant usage view | The merchant sees its own counters against plan limits | `core_usage_counters` (PLAT-12) [S28] | medium | partial: counters exist; no merchant view or plan limit screen | 2 (BILL-1) |

Tail: 8 rows. Covered 3, partial 3, missing 2.

## 4. Compliance and security

| Feature or obligation | What it is | Who offers or requires it (sources) | KSA/GCC relevance | Roadmap coverage | Suggested wave |
|---|---|---|---|---|---|
| Records of processing (PDPL) | A register of processing activities: purpose, data, recipients, retention, transfers | PDPL obligation per secondary sources [unverified, S5]; the draft removes the minimum list of contents (article not stated) [S3] | high: applies to every merchant and recipient record [I] | partial: data.md §10 personal-data inventory and retention table; no processing register | 1 (PDPL-1) |
| Data subject requests (access, correction, deletion, copy) | A request workflow with a response clock | PDPL rights per secondary sources [unverified, S5]; 30 days, extendable once by 30 days, and deemed rejected under the draft Art. 3 [S3, S4] | high: recipients and drivers can ask [I] | missing | 1 (PDPL-1), before pilot real data |
| Retention and deletion | Set periods and jobs that delete or anonymise personal data | data.md §10: proofs two years after terminal, trails 90 days, webhook delivery log 30 days, raw inbound payloads 30 days [S28]; Q-37 recipient data kept for account life; Q-38 closed accounts 90 days then deleted (provisional) [roadmap §4] | high | partial: retention jobs per order (storage lifecycle, PLAT-8); Q-37 and Q-38 are provisional; no request-driven deletion | 1 (PDPL-1) |
| Breach notification (SDAIA and data subjects) | Notify SDAIA within 72 hours of awareness; tell affected people without undue delay | Current Art. 24 per secondary sources [unverified, S5]; draft removes the harm threshold for SDAIA notice (Art. 24) and keeps the damage test for data subjects; consultation closes 5 November 2026 [S3, S4] | high | missing: OPS-2 runbook list has no breach runbook (platform.md runbook list [S28]); PLAT-14 alerts only | 1 (PDPL-1 plus OPS-2 addition) |
| Cross-border transfer | Transfers outside KSA allowed under conditions; draft Art. 34 registration with SDAIA for transfers abroad | Transfer regulation per secondary sources [unverified, S5]; draft Art. 34 [S3, S4] | high: Sentry, PostHog, Cloudflare, Expo push and WhatsApp via eeasynew are processors [I, from roadmap] | partial: PLAT-14 sends ids only to PostHog; INT-4 push payloads carry ids only; no transfer register or assessment | 1 (PDPL-1) |
| Data residency and hosting in KSA | Personal data stored in KSA; government data stays in KSA | Q-10 default: Saudi or Bahraini region with managed PostgreSQL (provisional) [roadmap §4]; NCA CCC-2:2024 moved localisation to NDMO [S2]; draft Art. 23(2) adds an express storage duty [S3, S4]; CST rules say public-sector data must not leave KSA, in force 10 October 2023 [unverified, search 2026-11-02] | high | partial: Q-10 default; OPS-1 waits for the owner's go | 0 (OPS-1) |
| Government-data classification (NDMO) | Classification of data that sets the hosting rule | NDMO classification policy referenced by NCA CCC-2 [S2]; no NDMO page read [Not found] | medium: relevant only for government buyers [I] | missing | unanswered |
| Driver and vehicle documents with expiry | Licence, vehicle registration, insurance and operating card per vehicle, with expiry and block rule | Transport General Authority warns delivery apps that use unlicensed carriers [S21, Zawya, date not shown]; Naql portal issues operating cards per vehicle [unverified, consultancy snippets 2026-11-02] | high: operating without documents is a legal risk [I] | partial: DEL-4 driver and vehicle entities (plate, kind, capacity) [S28, data §3]; no document upload, expiry or block | 2 (DOC-1), before pilot drivers if the owner agrees |
| Absher, Tamm and Naql integration | Government data lookups or filings through their APIs | No company API found; Tamm site failed its TLS check [Not found]; Absher and Tamm described as personal channels in job posts [unverified] | medium [I] | missing | unanswered |
| Delivery licence for the platform itself | Licensing of delivery activity and apps | TGA executive rules require a licence for delivery services [unverified, Okaz 2026-11-02, via search] | high [I] | missing; not a roadmap item | unanswered (counsel) |
| SOC 2 Type I and Type II | Independent report on controls; Type II covers an observation window | Vendor estimates: Type I eight to 22 weeks; Type II window three to 12 months, nine to 12 common; audit fees in a wide range [unverified, S24] | medium: a buyer ask, not Saudi-specific [I] | missing | 4 or later (SEC-1), owner choice |
| ISO/IEC 27001 | Certified information security management system | Named as a mapped standard in NCA CCC-2 [S2]; iso.org not readable [Not found]; vendor says it is the portable evidence for third-party audits [unverified] | medium to high [I] | missing | 4 (SEC-1) |
| NCA cloud controls (CCC-2:2024) | Minimum cybersecurity controls for cloud providers and tenants | CCC-2:2024 applies to CSPs and CSTs; CSP has 4 domains, 37 main controls, 94 subcontrols; CST has 18 main controls and 26 subcontrols [S2]. Whether Eeasy is a CSP under the definition is [I] | high if Eeasy counts as a CSP [I] | missing: no NCA gap assessment in the roadmap | 1 (SEC-1 gap assessment) |
| "Cybersecurity Essentials" certification | The certification named in the brief | No Saudi certification of this name found; GIAC GSEC is a different course [Not found] | unknown | unknown | unanswered |
| Buyer-side supplier cyber certificates (Aramco CCC, SABIC CyberTrust) | Certificates that suppliers to those companies must hold | Aramco requires a Cybersecurity Compliance Certificate for IT vendors [S27, search 2026-11-02]; SABIC CyberTrust for suppliers with its data [S27] | low to medium: only if those companies buy [I] | missing | unanswered |
| Penetration testing | Independent test of the public surface before launch | No roadmap order; no source read for frequency [Not found] | high before INT-9 opens to integrators [I] | missing | 4, gate before INT-9 (SEC-1) |
| Status page and incident communication | Public status of services and incident notes to merchants | Not in roadmap; alerts in PLAT-14 [S28] | medium [I] | missing | 2 (OPS-2 addition) |
| Encryption of stored secrets | AES-256-GCM with a key id for credentials and secrets | Internal rule (data §10, platform §3) | high | partial: PLAT-4 covers credentials; proof files rely on the storage provider | 0 and 1 |

Tail: 18 rows. Covered 0, partial 6, missing 11, unknown 1. The roadmap has no order that covers a compliance row in full.

## Sources

Read on 2026-11-02 unless noted.

- [S1] ZATCA, roll-out phases: https://zatca.gov.sa/en/E-Invoicing/Introduction/Pages/Roll-out-phases.aspx (wave table is an image, not read).
- [S2] NCA, Cloud Cybersecurity Controls CCC-2:2024 (PDF, text extracted locally): https://cdn.nca.gov.sa/api/files/public/upload/6d5408a3-d8e6-4e96-963b-2c7198e5b7c2_CCC-2-2024-EN-.pdf
- [S3] Clyde & Co, SDAIA draft amendments to the PDPL Implementing Regulations (October 2026): https://www.clydeco.com/en/insights/2026/10/sdaia-publishes-draft-amendments-to-the-pdpl
- [S4] Reed Smith, SDAIA consultation on Implementing Regulation amendments: https://www.reedsmith.com/our-insights/blogs/viewpoints/102o5at/sdaia-consults-on-extensive-amendments-to-the-saudi-pdpl-implementing-regulation/
- [S5] Secondary PDPL summaries (search snippets only): https://www.opsintel.io/blog/saudi-arabia-proposes-in-kingdom-data-storage-and-a-72-hour-breach-rule/ and https://www.sgc.consulting/sdaia-saudi-personal-data-protection-law-pdpl-compliance-guide/. The SDAIA site itself was rejected on the same day.
- [S6] Salla developer docs, Get Started: https://docs.salla.dev/
- [S7] Zid developer docs, Overview: https://docs.zid.sa/
- [S8] Moyasar developer docs overview: https://docs.moyasar.com/
- [S9] HyperPay developer portal, Get Started: https://hyperpay.docs.oppwa.com/
- [S10] Tap Payments developer docs: https://developers.tap.company/
- [S11] PayTabs technical portal: https://docs.paytabs.com/
- [S12] Torod home page (Arabic; read in English summary): https://www.torod.co/
- [S13] OTO public documentation census, read 2026-10-31: /Users/sajjad/Documents/eeasy-logistics/docs/references/oto/public-docs.md
- [S14] Onfleet pricing: https://www.onfleet.com/pricing
- [S15] ShipHero API, Getting Started: https://developer.shiphero.com/getting-started/ and ShipHero pricing (quote only): https://shiphero.com/pricing/
- [S16] Bringg home page: https://www.bringg.com/ (pricing page returned 404; developer portal did not resolve)
- [S17] FarEye home page: https://fareye.com/
- [S18] Shopify, About billing for your app: https://shopify.dev/docs/apps/launch/billing
- [S19] WooCommerce REST API documentation: https://woocommerce.github.io/woocommerce-rest-api-docs/
- [S20] ISO 4217 table, via Wikipedia (ISO site returned 403): https://en.wikipedia.org/wiki/ISO_4217
- [S21] Zawya, TGA warning on delivery apps and unlicensed carriers (date not shown; search 2026-11-02): https://www.zawya.com/en/world/middle-east/saudi-tga-warns-of-penalizing-delivery-apps-that-ship-their-products-through-unlicensed-carriers-i8eo2zsq ; Okaz on the delivery licence (search 2026-11-02): https://www.okaz.com.sa/news/local/2214907
- [S22] Naql and operating cards: consultancy snippets from search 2026-11-02; no stable URL retained. Treat as [unverified].
- [S23] ClearTax, KSA e-invoicing clearance and reporting (search 2026-11-02): https://cleartax.com/sa/e-invoicing-clearance-reporting-ksa and vendor guides from the same search. Treat as [unverified].
- [S24] SOC 2 Type I and II cost and timeline (vendor): https://blog.getagency.com/articles/soc-2-type-i-vs-type-ii-cost-timeline-comparison (search 2026-11-02).
- [S25] Amazon SP-API, Tokens API: https://developer-docs.amazon.com/sp-api/docs/tokens-api (search 2026-11-02).
- [S26] noon marketplace guide (third party): https://support.channelengine.com/hc/en-us/articles/16319074295197-noon-marketplace-guide (search 2026-11-02).
- [S27] Aramco cybersecurity compliance certificate: https://aramco.com/en/workingwithus/suppliers/resources/cybersecurity-compliance-certificate-program ; SABIC CyberTrust: https://supplier.sabic.com/CyberTrustProgram.aspx (search 2026-11-02).
- [S28] Repository: docs/roadmap.md (§1, §4, §6), docs/architecture/data.md (§1 to §3, §10), docs/architecture/identity-and-tenancy.md (§2, §6, §10), docs/architecture/integrations.md (§7, §8), docs/architecture/platform.md (§3, §6, §9), docs/research/hudhud-geocoding-2026-11.md.

Not fetched: Tamm, Absher, Naql official pages; Bringg and FarEye pricing or security pages; SDAIA PDPL text and transfer regulation; ZATCA technical specifications and the wave table image; ERP vendors; Magento.

## Proposed orders

1. **PDPL-1 (privacy and records):** processing register, data subject request workflow with a 30-day clock, retention jobs tied to Q-37 and Q-38, transfer register, breach runbook added to OPS-2. Depends on PLAT-7, PLAT-8, data §10, Q-37, Q-38, Q-10. Wave 1 exit, before real recipient data.
2. **SEC-1 (security programme):** NCA CCC gap assessment, penetration test as a gate before INT-9, status page and incident communication. Depends on OPS-1, OPS-2, INT-9. Wave 4 gate, gap assessment earlier.
3. **BILL-1 (plans and metering):** plan catalogue, subscriptions, usage counters into invoices and limits, VAT fields on money. Depends on PLAT-12, Q-33, and the money decision (SAR only for now). Wave 2.
4. **BILL-2 (ZATCA invoices):** phase 2 generation and reporting or clearance for Eeasy's invoices, once the owner confirms applicability and wave. Depends on BILL-1 and the owner's VAT position. Wave 2, before the first merchant invoice.
5. **BILL-3 (gateway):** one gateway adapter for merchant charges behind a port, after the ADR-0017 decision. Depends on BILL-1 and the owner unlock. Wave 2 or 3.
6. **DOC-1 (driver and vehicle documents):** document upload, expiry dates and a block rule for expired licence or registration. Depends on DEL-4. Wave 2.
7. **RPT-1 (exports and scheduled reports):** order and cash exports, scheduled email reports, KPI tiles on the dashboard. Depends on DEL-17, DEL-12, PLAT-9 mail adapter. Wave 2 for exports, wave 4 for scheduled reports.
8. **CONN-1 (Shopify and WooCommerce):** connectors on the INT-11 pattern, using the INT-9 and INT-10 surfaces. Depends on INT-9, INT-10, INT-11. Wave 4 or 5, after an owner ruling on priority.
9. **CONN-2 (noon and Amazon.sa):** marketplace connectors with restricted-data tokens and channel fees. Depends on INT-11, INT-12, the owner's ruling. Wave 5 or later.
10. **CARR-1 (carrier aggregation):** an aggregator adapter behind the carrier port, only after the owner decides on own-fleets against carriers. Depends on INT-8, Q-29, ADR-0001 and ADR-0014 review. Wave 3 or 4, owner ruling first.

## Unanswered

1. Is Eeasy a VAT-registered taxpayer that invoices merchants, and in which ZATCA phase 2 wave is it? The wave table could not be read.
2. Which VAT position applies to Eeasy's fees and to delivery charges: is Eeasy the seller of record for the merchant's deliveries?
3. Is there a Saudi certification called "Cybersecurity Essentials"? If not, which buyer requirement is meant: NCA CCC, ISO 27001, SOC 2, or a named buyer's form?
4. Which PDPL duties apply now: will the owner accept the vendor and secondary reading of Article 24 (72 hours) until the official text is checked by counsel?
5. Should the draft amendments (no harm threshold, in-Kingdom storage, deemed rejection) shape the design now, given the consultation closes 5 November 2026?
6. Does Eeasy act as a processor or a controller for merchant recipient data, and does Q-37 (keep recipient data for account life) fit the PDPL retention duty?
7. Will the owner rule on carrier aggregation (Torod or OTO style) against the "own fleets only" rule and ADR-0014?
8. Is self-serve signup wanted, or does every merchant stay approval-only?
9. Which merchants need SAML SSO, and at which plan tier?
10. Which gateway is preferred (Moyasar, HyperPay, Tap, PayTabs), and is ADR-0017 to be unlocked for merchant billing?
11. Is GCC expansion in scope before wave 4? It decides whether the money model changes now (three-decimal currencies).
12. Which ERPs matter first (Odoo, Zoho, SAP Business One)? Not researched.
13. Are Magento, noon and Amazon.sa wanted, and in which wave? Not researched beyond the summary here.
14. Does the owner want Absher, Tamm or Naql integration, or manual document upload? No company API was found.
15. Is the Google or HERE fallback geocoder wanted beside Hudhud?
16. Which status page and incident-communication rules apply to merchants?
