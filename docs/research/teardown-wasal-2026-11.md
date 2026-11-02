# Wasal teardown, 2026-11

Date: 2026-11-02 (every read on this date unless marked). Branch `docs/teardown-wasal` from `origin/main` at `1e0c184`. Author: researcher agent for the lead. Scope: product anatomy of Wasal (وصال, wasal.sa; web app app.wasal.sa; API host api.wasal.sa) for the owner's question on features, mechanics, build and what to borrow. No account was created, no store listing was verified, and no Wasal staff were contacted.

Evidence grades used below: **[F]** page read through WebFetch on 2026-11-02; WebFetch returns a model-written summary, so quoted phrases are as returned, not byte-checked. **[H]** raw HTML read with curl on 2026-11-02. **[B]** text read from Wasal's public JavaScript bundles (app index and 27 lazy page chunks, downloaded with curl on 2026-11-02; 27 of about 148 chunk names sampled). **[L]** live unauthenticated HTTP probe on 2026-11-02. **[S]** search-result summary only, page not opened. **[I]** my inference from a stated fact. Source IDs (S1 to S20) are in section 8.

## 1. Summary for the lead

1. **What it is.** Wasal is a Saudi delivery-management SaaS for merchants and fleets that run their own drivers: route optimisation, dispatch, a driver app, proof of delivery (POD), recipient tracking, COD fields, a public REST API and outbound webhooks. Marketing site is Arabic-only RTL; the web app is bilingual (AR default, EN strings present) [F S1][H S1][B S4 S5].
2. **Who it serves in KSA.** The homepage shows three restaurant and café testimonials, unnamed by city. Claims of "more than 200 delivery companies" and 1,248 orders are marketing, unverified [F S1]. The in-app onboarding asks for food delivery, package delivery, sales or services [B S5].
3. **Pricing, two models that disagree.** Homepage (SAR, excl. 15% VAT): Beginner 469/month for 500 orders; Advanced 750/month or 0.75 per order (1,000 orders); Expert custom with custom API [F S1]. In-app: Starter, Premium, Expert billed at USD 125, 200, 1,000, shown as SAR 469, 750, 3,750 when the Al Rajhi gateway is active; base stops 1,000, 2,000, 12,000; pay-per-use above base [B S5 S6].
4. **Plan shape.** Monthly base of stops counted when a stop is added to a route, whatever the outcome; unlimited drivers and dashboard members; 14-day trial that turns read-only; tiers gate data history (30 days, 1 year, 5 years), custom stop properties (1, 3, 10), POD photo counts, branded tracking, and payment-on-delivery and proof of custody (top tier only) [B S5].
5. **Borrow 1: auto-distribution as preview, then confirm** (select drivers, preview, confirm). Maps to DEL-10 with DEL-16's simulate-then-commit contract [B S5].
6. **Borrow 2: POD requirement as a workspace policy with a per-stop override** (signature, photo, both, optional; PDF export). Maps to DEL-7 [B S7].
7. **Borrow 3: tracking modes and event notices** (ETA only, or ETA plus queue position "You are #3"; events for scheduled, next in queue, delivered, failed). Maps to DEL-8 and INT-3, within ADR-0037 [B S5][B S7].
8. **Where our design is stronger.** (a) Webhook signing: ours is Standard Webhooks v1 with a signed timestamp and id, a 300 s window and constant-time compare (contracts/webhooks.md §2); Wasal signs the raw body only and its doc sample compares with `!==` [B S5][S13]. (b) Cash custody is a ledger with PIN and append-only entries (DEL-11); Wasal shows COD as a fee field and payment-on-delivery only on its top tier [B S5]. (c) AR and EN everywhere with RTL and logical CSS (AGENTS.md); Wasal's marketing site has no English version [F S2].
9. **Gaps we have.** No route templates or route copy; no service levels with cutoffs; no plan or counter model (Q-33 still provisional); no read surface for routes or driver assignment in the public API (INT-9 is orders and tracking only); no navigation hand-off in the driver rows.
10. **Caveats.** No verified store listing for Wasal's driver app (iOS and Android claimed on its FAQ, not confirmed) [S S10]. Its privacy page returns the landing page [F S3]. The docs say `api.wasal.sa/v1`, but the live host returns 404 for every `/v1` path it was probed on and 401 for `/route-stops` without the prefix [L S11]. Company facts are thin (section 7).

## 2. Product map

Rows are the features the owner asked about. "Where" lists the surface: dashboard (web app), driver app, API, marketing site.

### 2.1 Routes, optimisation and distribution

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Route lifecycle | Route has a name (optional), date, driver, start and end points; status draft, active, completed; drivers start and end a trip. | Dashboard `/dashboard/routes/:id`, `/routes-and-stops`; API `/route-groups` | [B S5 routes and routesPage strings] |
| Route optimisation | Goals: Minimize Distance (shortest km), Minimize Time (fastest completion), Respect Time Windows (recommended). Results in seconds; numbered line on the map; ETA and drive time per stop; Re-optimize after manual drag-and-drop. "Real-world traffic" claimed. | Dashboard | [B S7 help article optimize-route] [F S1] |
| Optimisation flags | Route flag `is_optimized`; "This route hasn't been optimized yet" banner; stop `estimated_arrival` set by the optimiser. | Dashboard, API | [B S5 models, routesPage] |
| Route templates | Save a route's settings and stops as a template; a new route is pre-filled from it. | Dashboard `/route-templates`; API copy endpoint | [B S5 route-templates] |
| Route copy | `POST /route-groups/copy`. | API | [B S5 api-page] |
| Auto-distribute | Distribution page: select drivers, preview, confirm distribution; route for distributor role at `/dist`. Unassigned stops are assigned by area and priority (homepage: "automatically or manually by area and priority"). | Dashboard | [B S5 distribution, distributor-layout] [F S1] |
| Unassigned pool | Stops created without a route sit in an unassigned pool, then `POST /unassigned-stops/assign` moves them into a route. Batch create up to a limit (not published). | Dashboard, API | [B S5 api-page] |
| Depots | Unlimited depots; each has start location, start and end time (HH:MM), default minutes per stop (default 1), max stops per route, vehicle type, and a main-depot flag. | Dashboard `/depots`; API `/depots` | [B S5 models, onboarding-plan] |
| Per-driver overrides | `max_stops_override`, `start_address_override`; per-stop `allowed_driver_ids` restricts which drivers may take a stop during optimisation. | API, Dashboard | [B S5 models] |

### 2.2 Stops and order intake

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Manual add | Type to search and add a stop; "Add Stops" for several. | Dashboard | [B S5 stopsPage] |
| CSV and spreadsheet import | Download a template; required columns include `address`; upload CSV or Excel; per-route "Route spreadsheet upload" on all tiers. | Dashboard `/stops`, `/routes-and-stops` | [B S7 import-stops] [B S5 matrix] |
| Store and POS import | Foodics: enter API details in settings; delivery orders import and status updates flow back. Shopify: connect store; import stops. Zapier: connect as a no-code route. | Dashboard `/integrations`; API | [F S1 FAQ] [B S5 integrations] |
| Batch API import | Stop batch import endpoint; unassigned batch create. | API | [B S5 api-page] |
| Stop fields | Recipient name and phone, address, lat and lng, `order_index`, barcodes, package count and weight, time window (earliest and latest, ISO 8601), duration (default 1 min), notes, stop colour, `shipment_info` JSON, custom values. | API, Dashboard | [B S5 models] |
| Custom stop properties | 1 (Beginner or Starter), 3 (Premium), 10 (Expert). | Dashboard, API | [B S5 matrix] |
| Service offerings | Named service with identifier, price per stop, SLA days, cutoff time, service days, per-depot availability, stop-type limit; 1, 3 or unlimited by tier. Items past cutoff move to the next available day. | Dashboard `/services` | [B S5 services-page; matrix] |
| Custom delivery zones | Coloured zones, named and editable, on all tiers. | Dashboard `/delivery-zones` | [B S5 delivery-zones; matrix] |

### 2.3 Drivers and driver app

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Driver roster | Invite a driver (name, email, phone); status Available, On delivery, Offline; current route; stops completed; last active; removal warns it cannot be undone. Drivers are workspace members. | Dashboard `/drivers`; API `/members` | [B S5 driversPage, api-page] |
| Driver permissions | Per workspace: drivers may create routes, edit dispatcher routes, add, duplicate and delete stops, and update or re-optimise; route info (name, day, start and end time and place); side of road; estimated time at stop; Google Maps as internal map type. | Dashboard `/driver-permissions` | [B S5 driver-permissions] |
| Driver app, claimed | iOS and Android; drivers receive orders, navigate to addresses, confirm delivery with photos and signature. | Driver app | [F S1 FAQ] (store listing not verified, see 7) |
| Driver app features (tier matrix) | Start and end trip, create routes, capture POD, barcode scan, address label scan, address dictation, add stops mid-route, driver notes, loading checks, turn-by-turn navigation, embedded Google Maps navigation. Stop actions: navigate, call, message, WhatsApp. Stop statuses: pending, delivered, failed, no answer, needs redelivery; failure reason; notes. | Driver app | [B S5 matrix, stopsPage, routesPage] |
| Live location | Drivers shown on an interactive map in real time. | Dashboard `/drivers-map` | [F S1] [B S5] |

### 2.4 Proof of delivery and cash

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| POD policy | Workspace-level: require POD on or off; evidence set to signature, photo, both, or optional. Per stop override in the stop panel ("POD Requirements"). | Dashboard `/controls/proof-of-delivery`; driver app | [B S7 setting-up-proof-of-delivery] [B S5 pod-config-editor] |
| POD evidence | Signature image; photo (5 per stop on Starter, 10 on Premium and Expert); geotag and timestamp; "Strict control" (Premium and Expert). | Driver app; stop detail | [B S5 matrix, pod-page] [B S7] |
| POD export and sharing | POD record exportable as PDF; a POD summary email to the recipient if notifications are on. | Dashboard | [B S7] |
| POD API | `POST /route-stops/:id/proof`; `signature_url`, `proof_photos` on the stop. | API | [B S5 api-page, models] |
| COD | Stop field `payment_amount` (expected COD) and `payment_collected`; dashboard "Total COD expected / Collected / Pending" totals. "Payment on delivery" and "Proof of custody" appear only in the top tier. Homepage says COD is supported and every transaction is recorded automatically. | Driver app; dashboard | [B S5 models, routes strings, matrix] [F S1] |

### 2.5 Recipient tracking and notifications

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Tracking link | Each stop gets a `tracking_token`; link sent by SMS, email or WhatsApp; public page with a live map and progress. Standard page on all tiers; branded page on Premium and above. | Public `/track/:token`; dashboard | [B S7 how-customers-track] [B S5 models, matrix] |
| Tracking mode | ETA only, or ETA plus position in queue ("You are #3 in queue", "The driver is out for delivery", "Driver is nearby"). | Dashboard `/tracking-notifications` | [B S5 tracking-notifications] |
| Event notices | Delivery: scheduled, next in queue, successful, failed; pickup: scheduled, next in queue, successful, failed. | Dashboard | [B S5 tracking-notifications] |
| Channels | SMS, email and WhatsApp. Email included on all tiers; SMS billed per message at a regional rate; custom SMS sender name on Premium and above; notification restriction periods (quiet hours) on Premium and above; custom notification sender ID. | Dashboard | [B S5 matrix, onboarding-plan FAQ] [B S7] |

### 2.6 Team, roles and the client portal

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Roles | Layouts exist for admin, dispatcher and distributor (and driver in the app). Role names beyond these are not published. | Dashboard | [B S5 layouts and routes] |
| Team | Unlimited dashboard members; team settings; personal profile; team members page. | Dashboard `/settings`, `/team-members` | [B S5 settings strings, matrix] |
| Client portal ("Wasal Connect") | Clients of the operator upload stops and submit them to the operator's dashboard, see live tracking, and see past deliveries. Portal pages for orders, history and tracking (route `/portal` and its children, per the bundle). Order import by CSV in the portal. | Client portal; `/spoke-connect` | [B S5 spoke-connect, portal-orders, controls-hub] |

### 2.7 Plans, billing and trial

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Tiers and prices | See section 4.2. | Marketing site; in-app plan page | [F S1] [B S5] |
| Trial | 14 days, no card. After it ends the account is read-only (no new routes or stops) until a payment method is added; after 30 days without one, the user is asked to choose a plan. | In app | [F S1] [B S5 onboarding-plan FAQ] |
| Checkout and invoices | Hosted checkout and billing portal sessions; invoice list with amounts in SAR or USD by currency; gateway shown as Al Rajhi (primary, SAR) or Stripe (USD). | `/plan-and-billing` | [B S5 plan-billing] |
| Change plan | Upgrade or downgrade at any time; cancel with no extra fees; no long-term contracts. | Marketing site, FAQ | [F S1] |
| Enterprise | Sales contact by mailto; SLAs and enterprise plans via sales. | In app | [B S5 plan-billing] |

### 2.8 Analytics, help and onboarding

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Analytics | Today's overview (attempts, success rate); reports: total deliveries, success rate, failure reasons, driver performance; "performance analytics" on Premium and above. | Dashboard `/reports`, `/analytics` | [B S5 reports, routesPage, matrix] [F S1] |
| Help centre | Six collections (Getting Started, Stops and Routes, Drivers, Proof of Delivery, Tracking and Notifications, Analytics); 19 articles in AR and EN, bundled with the app. | Dashboard `/help` | [B S5 help-center-data] [B S7] |

### 2.9 Public API, webhooks and developer docs

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Public REST API | 32 endpoints in six groups: stops (`/route-stops`), routes (`/route-groups`), unassigned stops, members, depots, plus authentication. Stop status update and POD upload are endpoints. | `api.wasal.sa` (docs say `/v1`) | [B S5 api-page] [L S11] |
| Webhooks | Seven event types (section 3.4). HTTPS POST to a configured URL; one request per stop; a test event from the dashboard. | Dashboard `/webhooks`; outbound | [B S5 webhooks-*] |
| Developer docs | Intro, getting started, events, API reference, examples, models, versioning, changelog. Public or sign-in gated: not checked. | App SPA routes `/developer`, `/api`, `/models`, `/versioning`, `/changelog` | [B S5 developer-layout, versioning-page] |

### 2.10 Marketing site

| Feature | How it works | Where it lives | Evidence |
|---|---|---|---|
| Site | Arabic only, RTL, Tailwind via CDN, lucide icons; sections features, how it works, pricing, testimonials, FAQ; login, demo, blog and legal links are `#` placeholders; footer says "منصة سعودية 100%". Contact block: a WhatsApp link and phone that read as placeholders [I]. | wasal.sa | [H S1] [F S1] |

## 3. API and integration anatomy

### 3.1 Surfaces observed

| Surface | Host and path | State on 2026-11-02 | Evidence |
|---|---|---|---|
| Web app (SPA) | `app.wasal.sa`, Vite build, React, CSP header | Serves index; `Last-Modified` 2026-07-14 | [H S4] [B S5] |
| Marketing site | `wasal.sa`, Cloudflare | `Last-Modified` 2026-10-13 | [H S1] |
| Public API, documented | `https://api.wasal.sa/v1` (examples) | `GET /v1/`, `/v1/members`, `/v1/depots`, `/v1/route-groups`, `/v1/route-stops` each return 404 `Cannot GET /v1/...` | [B S5 api-examples] [L S11] |
| Public API, live path | `https://api.wasal.sa/route-stops` (no `/v1`) | 401 JSON "Authentication required. Please sign in." | [L S11] |
| Sister domain | `wasal.app` (named as sales mailbox) | Connection refused on fetch | [F S12] |

### 3.2 Authentication

- Bearer token in `Authorization`; keys created and revoked under Settings, Integrations, API Keys; a missing or bad key returns 401. No scopes, rate limits or key types are documented in the pages read [B S5 api-page]. Live 401 text reads like a session prompt, so the API may share a session check with the web app [L S11][I].

### 3.3 Resource model (from the reference models)

- **Stop**: recipient name and phone, address, lat and lng, `order_index`, barcodes, `package_count`, `package_weight`, time window, duration, `allowed_driver_ids`, `payment_amount`, `payment_collected`, `proof_photos`, `signature_url`, `estimated_arrival`, `delivered_at`, `tracking_token`, `shipment_info`, `custom_values`, `stop_color` [B S5 models].
- **Route**: name, date, `driver_id`, start and end points, `total_distance_km`, `estimated_duration_min`, `is_optimized`, `started_at`, `estimated_end_at`, `stops_count`; statuses draft, active, completed [B S5].
- **Driver** (workspace member): name, email, phone, user id, depot, availability, stop override, start override. **Depot**: name, primary flag, start location, start and end time, minutes per stop, max stops, vehicle type. **Unassigned stop**: stop fields plus `recipient_external_id` (the merchant's own id) [B S5 models].
- Public field names use snake_case and ISO 8601 times; ids are opaque strings (example `clx9abc123`) [B S5].

### 3.4 Webhook anatomy and versioning

- Envelope: `type`, `version` (sample `v0.2b`), `created` (epoch ms), `data` [B S5 webhooks-events].
- Events: `stop.allocated` (stop added to a route by dispatcher, CSV or API); `route.started` (driver taps start, one request per pending stop); `stop.out_for_delivery`; `stop.attempted_delivery` (any outcome); `stop.completed` (delivered); `route.completed` (summary of delivered and failed); `test.send_event` (dashboard test) [B S5].
- Signing: header `X-Wasal-Signature`; HMAC-SHA256 over the raw body; the signed string is the body only, with no timestamp or id in it [B S5 getting-started, intro].
- Versioning: current `v0.2b`, legacy `v0.1b`; breaking and non-breaking rules and a deprecation window are published; resource shape matches between REST and webhooks for one version [B S5 versioning].
- Doc sample verifies with `expected !== signature` (plain string compare) and rejects with 401 [B S5]. [I] Constant-time compare is not shown, and the absence of a timestamp in the signed string means the docs define no replay window.
- Delivery: "10 seconds" to answer with 2xx; retry and backoff are not published in the pages read [B S5 getting-started].
- Secret: masked in the dashboard; "Generate new key" rotates it [B S5 integrations]. Per-workspace scope is [I].

## 4. Operational model

### 4.1 Tenancy and roles

- One workspace holds depots, members, drivers, routes, stops, and integrations; members can be many and are unlimited on every tier [B S5 matrix].
- [I] Wasal looks like a single-tenant-per-merchant SaaS. The bundles do not show account-level isolation details.

### 4.2 Billing

| Tier (homepage name / in-app name) | Price, excl. 15% VAT | Base stops | Included (in-app matrix) |
|---|---|---|---|
| Beginner / Starter | 469 SAR per month (USD 125 in app) | 500 orders on homepage; 1,000 base stops in app | Unlimited drivers and members; live tracking; POD; email support |
| Advanced / Premium | 750 SAR per month, or 0.75 SAR per order (USD 200 in app) | 1,000 orders on homepage; 2,000 base stops in app | Route optimisation; Foodics; analytics; Apple Pay and mada (homepage); branded tracking; custom notifications |
| Expert / Expert | Custom on homepage; 3,750 SAR in app (USD 1,000) | Unlimited on homepage; 12,000 base stops in app | Custom API (homepage); payment on delivery; proof of custody; personalised onboarding; geofencing; dedicated manager |

Sources: homepage [F S1]; in-app [B S5 onboarding-plan, plan-billing].

- Base is counted at stop creation on a route, whatever the outcome [B S5 FAQ].
- Overage: pay-per-use beyond base; price not shown [B S5].
- SMS billed per message at a regional rate; email free [B S5].
- Gateways: Al Rajhi (SAR, primary) and Stripe (USD); checkout and portal sessions run server-side [B S5 plan-billing].
- Trial: 14 days; read-only after; 30 days to choose a plan [B S5][F S1].

### 4.3 Automation and exceptions

- Optimise on demand (Optimize, Re-optimize) with goals [B S7]; auto-distribution with preview and confirm [B S5]; event notices on status changes; one webhook per stop on route start [B S5].
- Statuses: failed with reason, no answer, needs redelivery [B S5 stopsPage]. Reschedule and address-pin flows are not documented [B S5]; our DEL-14 covers them.
- Not seen in pages read: merchant-side scheduled jobs, rules engine, or SLA breach alerts (weak evidence: absence in a sample).

### 4.4 Reliability and security observations

- Live probe shows JSON errors with `message`, `error`, `statusCode` (the NestJS default shape); framework not confirmed [L S11][I]. App CSP is `default-src 'self'` with Tailwind CDN and Google Fonts allowed; marketing site on Cloudflare with HSTS [H S4][H S1].
- `/privacy` returns the landing page; no PDPL or data-residency statement in the pages read; driver location is shown in real time with no retention or consent statement [F S3][H S1].
- Uptime and SLA: no figure published. The plan page routes SLA questions to sales; the homepage footer SLA link is a placeholder [B S5][F S1][H S1].

### 4.5 Stack hints

- Web app: React with React Router v6 (future-flag warnings), TanStack Query (useQuery and useMutation names), axios, lucide icons, Leaflet-style map components (Marker, Polyline, TileLayer), Google Maps in the driver flow [B S5][I for library names]. Build: Vite [B S4].
- No Sentry, PostHog, Twilio, Unifonic, Taqnyat or SendGrid strings in the bundles sampled [B S5]. Job posts and engineering blog: not found [S S18].

## 5. Mapping: Feature | Wasal | eeasy-logistics today | Borrow?

Borrow verdict: **yes** (borrow the shape), **adapt** (borrow the idea, change the shape to fit our rules), **no** (reason and ADR or rule given). Roadmap ids are from `docs/roadmap.md` §1.2 to §1.5.

| Feature | Wasal | eeasy-logistics today (order id or gap) | Borrow? |
|---|---|---|---|
| Route optimisation with explicit goals | Min distance, min time, respect windows; ETA per stop | DEL-16 and INT-6 (VROOM, ADR-0010); no goal selector row | Yes, shape: a goal parameter on the VROOM call; the engine stays VROOM (ADR-0010) |
| Route templates and route copy | Templates; copy endpoint | Gap | Adapt: proposal P6 |
| Auto-distribute with preview | Select drivers, preview, confirm | DEL-10 (auto-dispatch); DEL-16 simulate and commit | Yes, shape: amend DEL-10 to require preview (P4) |
| Dispatch basics: manual assign, depots, zones | Manual assign; unlimited depots; custom zones; per-depot defaults | DEL-6, WEB-7 board; PLAT-12 sites; DEL-1 zones | Covered; no |
| Service offerings with cutoff and SLA days | Per-depot service with price per stop, cutoff, SLA days, service days | Gap; DEL-17 SLA reports only | Adapt: proposal P5 (pricing waits on Q-33) |
| Time windows on stops | Earliest and latest, duration | Gap in roadmap rows (domain-model may hold it; not checked) | Adapt: owner question Unanswered 18 |
| Custom stop properties | 1, 3 or 10 by tier | Gap (not in roadmap rows) | Owner question Unanswered 18 |
| Stop statuses (no answer, needs redelivery) | Named statuses | DEL-6, DEL-7 attempts with `max_attempts`; DEL-14 reschedule | Covered; no |
| CSV and spreadsheet import | Template, CSV or Excel | DEL-3 CSV import (202, progress) | Covered; add Excel only if owner asks |
| Store and POS imports (Foodics, Shopify, Zapier) | Foodics pull; Shopify connect; Zapier | INT-11 Salla and Zid (ADR-0013); no Foodics, Shopify or Zapier row | No for now: channel scope is set (ADR-0013); owner question Unanswered 22 |
| Barcode scan at pickup | Barcode and label scan | DRV-4 pickup by scan (expo-camera; driver-app.md) | Covered; yes for label scan later |
| Address dictation and label OCR | Driver can dictate or scan an address label | Gap | No: adds a speech and OCR vendor with no ADR; revisit |
| Navigation hand-off | Turn-by-turn and embedded Google Maps | Gap in DRV rows | Adapt: hand off to the device map app; owner question Unanswered 19 |
| Driver route permissions | Drivers may create or edit routes; per-stop time; side of road | Gap; DEL-6 dispatch assumes dispatcher control | Adapt later: owner question Unanswered 20 |
| POD requirement policy | Site policy, per-stop override, signature or photo | DEL-7 proofs by signed upload; no policy row | Yes, shape: amend DEL-7 (P2) |
| POD export as PDF | Yes | Gap | Adapt: add to DEL-7 or WEB-5 detail (in P2) |
| POD summary to recipient | Email | INT-3 templates; ADR-0037 (WhatsApp templates; no SMS before wave 3) | Adapt within ADR-0037 |
| Recipient tracking page | Standard and branded; ETA or queue position | DEL-8; WEB-8 (fails closed until embedding is ruled) | Yes, shape: tracking modes (P3) |
| Tracking notices per event | Scheduled, next in queue, delivered, failed | INT-3 (order_assigned, out_for_delivery, attempted, delivered); INT-7 | Adapt: add queue-position notice as a template candidate (P3); ADR-0037 governs |
| Custom SMS sender name | Premium and above | ADR-0037: no SMS before wave 3 | No: out of our wave order; revisit with ADR-0037 |
| Live driver location; quiet hours | Real-time map; restriction periods | DEL-5, WEB-6; INT-7 quiet hours; ADR-0039 own tracker | Covered; no |
| Analytics and failure reasons | Reports on success, failure reasons, driver performance | DEL-17 SLA and scorecards; DEL-12 reports | Adapt: add failure-reason and driver breakdowns to DEL-17 (no new order) |
| Data history by tier (30 days, 1 year, 5 years) | Tiered | Q-5 trails 90 days; Q-38 closed-account retention 90 days; data.md §10 | No: a privacy decision, not a feature to copy; owner question Unanswered 21 |
| Public REST API, read and write | Routes, stops, members, depots, proofs; keys | INT-9 orders and tracking only; sandbox keys | Adapt: proposal P1 (read first) |
| Outbound webhooks | Seven events; HMAC body only; retry not published | INT-10 Standard Webhooks v1 with timestamp and id, 300 s window (contracts/webhooks.md §2; ADR-0040) | No, keep ours: stronger signing; borrow only the event-type naming style and the test-send button (already in INT-10 samples and test) |
| Client portal (clients upload and track) | Wasal Connect | Gap; no client-of-merchant concept; own-fleet rule (AGENTS.md hard rules) | No: merchants own their fleets and customers; the rule is "Own fleets only" in AGENTS.md. Revisit only if the owner opens a 3PL-for-clients line |
| Roles (admin, dispatcher, distributor) | Layouts per role | PLAT-10 roles and permissions | Covered; check whether "distributor" needs a role (Unanswered 23) |
| Geofenced deliveries | Expert only | Gap; DRV-3 parked geofence is for driver tracking | Owner question Unanswered 21 |
| Plan limits, base stops, trial read-only | Base stops, overage, read-only trial | Q-33 (limits and counters from day one; pricing before wave 2); no billing row | Adapt: proposal P7; the count rule needs an owner decision |
| Payment gateways (Al Rajhi, Stripe) | Subscription billing in SAR and USD | ADR-0017 payment port gated; no digital COD | No for now: ADR-0017 holds it; billing gateway is an owner question |
| Cash custody and driver pay | Payment on delivery (top tier), no ledger shown | DEL-11, DEL-12, DEL-13 (ledger, PIN, statements) | No, keep ours: ledger and PIN are stronger; Wasal shows no custody model |
| Help centre | 19 articles, AR and EN, 6 collections | Gap | Adapt later: low priority; keep the collection structure for docs |
| Bilingual UI | Arabic site only; app AR default with EN strings | Every string AR and EN (AGENTS.md); PLAT-1, WEB-1 | No (ours stronger) |

## 6. Proposed order amendments and new orders

Each item states the order it touches, the change, the Wasal evidence, and the rule it must respect. The lead decides. Nothing below is an architecture recommendation.

1. **P1. INT-9 amendment: read surface for routes and stop status first.** Add read-only `GET` for routes (with status and driver) and stops (with status and POD metadata) under the account's key. Writes (stop status, POD upload) wait for an owner ruling because a merchant write can change money and proof. Evidence: [B S5 api-page] lists 32 endpoints, mostly routes and stops. Rules: tenancy from the key (AGENTS.md), audit, ADR-0040 for any delivery of changes.
2. **P2. DEL-7 amendment: POD requirement policy and PDF export.** Workspace-level policy (signature, photo, both, optional) with a per-stop override; PDF export of a completed stop's POD record. Evidence: [B S7][B S5 pod-config-editor]. Rules: validation at the driver's event endpoint is not relaxed; the server enforces the policy when it accepts the driver event.
3. **P3. DEL-8 amendment: tracking display modes and queue-position notice.** Two display modes (ETA only, ETA plus queue position) and a "next in queue" notice as an INT-3 template candidate. Evidence: [B S5 tracking-notifications]. Rules: ADR-0037 (templates only, WhatsApp on our number, no SMS before wave 3); WEB-8 stays fail-closed for embedding.
4. **P4. DEL-10 amendment: preview before commit.** Auto-dispatch returns a preview (who gets what, with the planner's ETAs) and commits only on confirm, reusing DEL-16's simulate contract. Evidence: [B S5 distribution]. Rules: offers still go through the D-12 and D-13 rules in the roadmap row.
5. **P5. New order DEL-19: service levels.** A named service per site: cutoff time, SLA days, service days, and an availability by site; items past cutoff roll to the next service day. Price per stop is a field only after Q-33. Evidence: [B S5 services-page]. Feeds DEL-2 intake and DEL-17 reports. Rules: pricing is an owner decision, not a default.
6. **P6. New order DEL-20: route templates and route copy.** Save a route's settings and stops as a template; copy a route into a new date. Evidence: [B S5 route-templates, api-page `/route-groups/copy`]. Depends on DEL-6. Rules: copies keep account and site scope; no stop carries a proof or status over.
7. **P7. New order BIL-1: plan limits, counters and the read-only trial.** Account counters for stops added to a route (base and overage) and a trial state that turns read-only at day 14 and asks for a plan at day 30. Evidence: [B S5 onboarding-plan FAQ][F S1]. Answers the "limits and counters from day one" part of Q-33. Rules: the counting rule (count at add, regardless of outcome) is an owner decision; no price is hard-coded; no gateway chosen here (ADR-0017 holds payments).
8. **P8. DRV-4 amendment: navigation hand-off.** Open the next stop in the device's map app from the stop card, with no in-app turn-by-turn. Evidence: [B S5 matrix: turn-by-turn and embedded Google Maps]. Rules: the map app's own consent and location use are outside our tracker (ADR-0039); no new SDK.

## 7. Unanswered

1. **Which price model is live.** Homepage (per-order, Expert "custom") and in-app (per-base-stop, Expert 3,750 SAR) disagree. A dated invoice or a trial account would settle it. Owner or Wasal sales needed.
2. **Driver app store listing.** No verified App Store or Google Play listing for Wasal's driver app; the candidate "Wasl Driver" (id 6747889201) is a different developer, "SDRD Driver" [F S8]. Languages, permissions, privacy labels and review themes are unknown. Needs Wasal's listing URL or a trial login.
3. **API base path.** Docs say `https://api.wasal.sa/v1`; live `/v1` paths return 404 and `/route-stops` returns 401 without the prefix [L S11]. Needs an authenticated call with a key.
4. **API access by tier.** The in-app matrix lists Read/write API and Webhook API as included on all tiers; the homepage lists "custom API" on Expert only [B S5][F S1].
5. **Webhook retries and delivery log.** Retry count, backoff and the delivery log are not published in the pages read [B S5].
6. **Foodics.** The in-app integration exists [B S5]; no Foodics Marketplace listing for Wasal was found [S S9]. Owner question: is Foodics a live partnership or a sync option.
7. **Shopify app.** The integration page links to a Wasal listing on the Shopify App Store; the app named "Wasal Delivery" in search is a Kuwait product [S S17]. Needs the listing URL.
8. **Company facts.** Legal entity, founders, founding date, funding and headcount: not found. The name "Wasel Lee" (2017, Saudi delivery, search summary) is a different entity as far as search shows [S S16]. Needs Saudi company register or Wasal's own statement.
9. **Privacy, PDPL and data location.** `/privacy` returns the landing page; no PDPL or residency statement; driver location retention unknown [F S3]. Needs the policy text.
10. **Regulation of delivery platforms.** Search summaries mention a CST-run platform for registered delivery apps; the page was not opened, and the 2019 Al-Watan article fetched is about the Transport General Authority and restaurant apps only [S S19][F S20]. Whether it applies to a SaaS is unknown.
11. **Customer claims.** 1,248 orders, 34 drivers, 98% delivery rate, "200+ delivery companies", and three named testimonials are unverified; some names and phone numbers look like placeholders [F S1][I]. Needs references or case studies.
12. **Spoke name.** Route names include "spoke-connect" for the client portal [B S5]. Whether it reflects a third-party route planner (Spoke) is not verified.
13. **COD gateway.** Al Rajhi and Stripe appear for subscription billing only [B S5]. Whether a merchant's COD or card on delivery runs through the same gateway is not shown.
14. **SMS price.** Per-message regional SMS price is "in billing settings after signup" [B S5]. Needs an account.
15. **Backend stack.** NestJS-style error body and Cloudflare suggest a Node API; not confirmed [L S11][I].
16. **Roles beyond admin, dispatcher and distributor.** Not confirmed; the "distributor" role's permissions are unknown [B S5].
17. **Lazy chunks not read.** about 120 of the roughly 148 chunk names were not downloaded, including portal-dashboard, depot-detail, route-detail, custom-properties and the help article body pages [B S5].
18. **Time windows and custom stop properties.** Whether stop time windows and custom stop fields belong in the order model (DEL-2) now or in a later order. The roadmap rows do not decide it. Owner decision.
19. **Navigation hand-off.** Whether drivers may open a stop in the device map app. The map app's own location use sits outside our tracker's consent (ADR-0039). Owner decision.
20. **Driver route permissions.** Whether drivers may create or edit routes, which Wasal allows per workspace. DEL-6 assumes dispatcher control. Owner decision.
21. **Geofenced delivery and tiered data history.** Whether a delivery may be restricted to a geofence, and whether retention should vary by plan. Both are product and privacy decisions; Q-5 and Q-38 apply.
22. **Channel scope.** Whether Foodics, Shopify or Zapier join INT-11, which is Salla and Zid only today (ADR-0013).
23. **Distributor role.** What Wasal's distributor layout can do (not documented) and whether we need that role under PLAT-10.

## 8. Source registry

Method: WebFetch on 2026-11-02 for the marketing and help pages (model-summarised); curl on 2026-11-02 for raw HTML, the app index bundle and 27 lazy chunks under `https://app.wasal.sa/assets/`; live unauthenticated GETs on 2026-11-02 for api.wasal.sa. No login, no key, no account. Search summaries are marked [S].

| ID | Source | Read on | Grade | Used for |
|---|---|---|---|---|
| S1 | https://wasal.sa/ar (Arabic homepage; WebFetch and curl) | 2026-11-02 | F, H | features, pricing, FAQ, testimonials, contact, stack |
| S2 | https://wasal.sa/en | 2026-11-02 | F | no English version |
| S3 | https://wasal.sa/privacy | 2026-11-02 | F | returns landing page |
| S4 | https://app.wasal.sa/ (index HTML, headers, `/assets/index-BVBNIOr7.js`) | 2026-11-02 | H, B | SPA shell, CSP, bundle |
| S5 | https://app.wasal.sa/assets/ chunks: api-page-DdcsP_Px.js, api-examples-page-DsoCI4pC.js, models-page-DOuhs8vN.js, versioning-page-bK_hcJUm.js, webhooks-intro-page-BWm8mzcb.js, webhooks-getting-started-page-CR7eUBxK.js, webhooks-events-page-lvh5duOx.js, integrations-page-Bfk0zMAc.js, plan-billing-page-Bu78wTti.js, onboarding-plan-page-CDI3ydaL.js, help-center-data-Ce9wrhcq.js, spoke-connect-page-js79h9qx.js, driver-permissions-page-ANsMw2I6.js, tracking-notifications-page-CiJo-W3l.js, services-page-BXD9CKU2.js, route-groups-XZpcYdj2.js, route-templates-page-BgtO_Kpy.js, pod-config-editor-B9G9WEHH.js, delivery-zones-page-rjPEXwRR.js, portal-orders-page-D21fY4k7.js, controls-hub-page-CBRcAhPc.js, customer-service-page-DxeH_U03.js, distribution-page-J830VQVK.js, login-page-07pZEbp5.js, developer-home-page-Cc2bZPHV.js, pod-page-D5eXTB1y.js (where stated) | 2026-11-02 | B | in-app features, models, API, webhooks, plans, help |
| S6 | in-app plan figures (usd and sar map in plan-billing chunk) | 2026-11-02 | B | SAR 469, 750, 3,750 under Al Rajhi |
| S7 | Help article bodies (optimize-route, setting-up-proof-of-delivery, how-customers-track-their-delivery, import-stops) in help-center-data chunk | 2026-11-02 | B | optimisation goals, POD policy, tracking link, CSV |
| S8 | https://apps.apple.com/pg/app/wasl-driver/id6747889201 (developer and metadata) | 2026-11-02 | F | identified as "SDRD Driver", not Wasal |
| S9 | Foodics Marketplace and Foodics help search results | 2026-11-02 | S | no Wasal listing found |
| S10 | Driver app store search (App Store, Google Play) | 2026-11-02 | S | no verified Wasal driver listing |
| S11 | https://api.wasal.sa/route-stops, /v1/, /v1/members, /v1/depots, /v1/route-groups, /v1/route-stops, / (GET, no credentials) | 2026-11-02 | L | live status codes and error shapes |
| S12 | https://wasal.app (fetch) | 2026-11-02 | F | connection refused |
| S13 | Repo: docs/contracts/webhooks.md §2 (Standard Webhooks v1) and docs/architecture/integrations.md §2.10, §3, §5.3 | 2026-11-02 (branch base 1e0c184) | repo | our webhook and messaging design |
| S14 | Repo: docs/roadmap.md §1.2 to §1.5 (rows DEL-1 to DEL-18, INT-1 to INT-12, WMS-1 to WMS-8, DRV-1 to DRV-7, WEB-1 to WEB-18); Q-5, Q-33, Q-38; ADR-0037 row | 2026-11-02 | repo | mapping |
| S15 | Repo: AGENTS.md hard rules (own fleets only; allowlist; AR and EN; tenancy) | 2026-11-02 | repo | borrow verdicts |
| S16 | Search summary: Wasel Lee, 2017 Saudi delivery, $133,000 Series A (startupbahrain, tradearabia) | 2026-11-02 | S | disambiguation only |
| S17 | Search summary: apps.shopify.com/wasal-delivery (Kuwait) | 2026-11-02 | S | not confirmed as Wasal |
| S18 | Search summaries for job posts and team (none found) | 2026-11-02 | S | no stack hint from jobs |
| S19 | Search summary: CST-run platform for registered delivery apps (alwatan, aleqt) | 2026-11-02 | S | regulation, unverified |
| S20 | https://www.alwatan.com.sa/article/1021163 (Al-Watan, 2019-09-02) | 2026-11-02 | F | about Transport General Authority and restaurant apps; not the CST rule |

Unanswered items for the owner are in section 7. Nothing here was recommended as architecture; the verdicts in section 5 name the rule or ADR that decides each.
