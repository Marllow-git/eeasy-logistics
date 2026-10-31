# WhatsApp provider facts, October 2026

Date of research: 2026-10-31. Purpose: facts for roadmap question Q-27 (WhatsApp provider) and integration document `docs/architecture/integrations.md` §2.4, §3.2, §5.2, §5.6 and §12.1. Public pages only (WebSearch and WebFetch), no logins, no sales contact. Citation discipline follows `docs/references/README.md`: every fact carries a URL and the date 2026-10-31, and anything a page did not state is written "not stated". Facts from search excerpts or third-party guides are labelled as such and are not treated as confirmed.

Pages that could not be read are listed in §10.

## 1. Summary of what could and could not be verified

- Meta's pricing page confirms that SAR is a billing currency (launched 2026-04-01) and that Saudi Arabia had rate changes on 2025-10-01 (utility and authentication, lower) and 2026-10-01 (marketing, increase). The per-message SAR amounts are in a linked rate card that could not be read. **Saudi per-message prices are not confirmed from a primary source.**
- Meta's template guidelines confirm review "can take up to 24 hours".
- Meta's webhook guide confirms the `X-Hub-Signature-256` header with a `sha256=` prefix, keyed by the App Secret.
- Twilio, 360dialog and Infobip each publish a webhook signing scheme. Bird and Unifonic signing schemes were not found on public pages read.
- Unifonic's developer documentation is behind a login for the pages fetched.

## 2. Meta WhatsApp Cloud API (direct)

| Topic | Public statement | Source (all read 2026-10-31) |
|---|---|---|
| Onboarding | Create a Meta app with the "Connect with customers through WhatsApp" use case; connect or create a Messaging account; add a phone number; send a test message with a temporary token; create a system user with a permanent token (`business_management`, `whatsapp_business_messaging`, `whatsapp_business_management`). Temporary tokens "expire quickly and are not suitable for development purposes." | https://developers.facebook.com/docs/whatsapp/cloud-api/get-started |
| Business verification | Not covered on the get-started page; no time estimate there. A third-party search excerpt says 1 to 5 business days after documents are accepted, and lists Saudi documents as commercial registration, VAT certificate and a live website matching the legal name. **Third-party estimate, not Meta's wording.** | Meta page: not stated. Search excerpt: https://www.aurorainbox.com/en/2026/05/14/what-is-meta-business-verification/ (not primary) |
| Template approval | "Review can take up to 24 hours." Review is automatic on create or edit. Templates are categorised as authentication, marketing or utility, and "template categories also factor into pricing." Template text is not translated by Meta: the sender supplies the text and example parameters per language. | https://developers.facebook.com/docs/whatsapp/message-templates/guidelines |
| Re-categorisation of a utility template | Not stated; the guidelines refer to a separate categorisation page for miscategorised templates (not read). | same as above |
| Price for Saudi Arabia, authentication | Market SA is listed; amount **not stated** on the pricing page. Saudi authentication and utility rates were lowered 2025-10-01 per the page. | https://developers.facebook.com/docs/whatsapp/pricing |
| Price for Saudi Arabia, utility | As above: rate lowered 2025-10-01; amount **not stated** on the pricing page. Volume tiers apply to utility and authentication. | same |
| Price for Saudi Arabia, marketing | Increase effective 2026-10-01; amount **not stated** on the pricing page. | same |
| Service messages | Service messages are charged after the free tier from 2026-10-01. The page states a free tier of 1,000 service messages per business phone number per month, resetting monthly with no roll-over. | same |
| Free windows | "Free entry point" window opened by a Click-to-WhatsApp ad on Android or iOS (not desktop or web); it "may remain open for up to 7 days"; messages of any category sent inside it are not charged. The 24-hour customer service window is not free. | same |
| Currency | SAR listed as launched 2026-04-01; billing currency fixed per account (third-party guides say USD accounts cannot switch later, not verified on Meta pages). | same; rate card linked, not read |
| Unverified third-party SAR figures | Search excerpts show marketing about SAR 0.1877 or 0.2159 per message and utility or authentication about SAR 0.0401, with one utility figure SAR 0.021 at high volume. The sources disagree and none is Meta's rate card. **Do not budget from these until the rate card is read.** | https://chatmaxima.com/whatsapp-api-pricing/saudi-arabia/ and https://whautomate.com/whatsapp-business-api-pricing-saudi-arabia (both search excerpts, not primary) |
| Rate limits and throughput | Business phone numbers send up to 80 messages per second by default, with upgrades. A phone number may send one message every 6 seconds to the same user; bursts of up to 45 in 6 seconds reduce future quota. Error 131056 on breach. | https://developers.facebook.com/docs/whatsapp/cloud-api/overview/ |
| Messaging tiers | Unique users per 24 hours are "set at the business portfolio level"; the page gives no numbers, and no tier names are stated on the overview page. The linked messaging-limits reference returned 404. | overview page; reference page not reachable |
| Webhook signing | Header `X-Hub-Signature-256`, value prefixed `sha256=`, computed from the payload with the App Secret. The page says "SHA256"; the phrase HMAC-SHA256 is not on that page (third-party and SDK docs use HMAC-SHA256). Meta: "You don't have to validate the payload, but you should." | https://developers.facebook.com/docs/graph-api/webhooks/getting-started |
| Retries | Getting-started page: retry immediately, then with decreasing frequency; "Unacknowledged responses will be dropped after 36 hours." Set-up-webhooks page: "for up to 7 days". **The two Meta pages conflict (36 hours vs 7 days).** Duplicates are possible; endpoints should dedupe. | https://developers.facebook.com/docs/graph-api/webhooks/getting-started and https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-webhooks |
| Status callbacks | The `messages` webhook carries status of messages a business sends (sent, delivered, read, failed are the states named in the integration document; the page confirms the webhook carries status). | set-up-webhooks page |
| Opt-out handling | Not stated on the pages read. | not stated |
| Sandbox | A test business phone number is provided in API Setup; no separate sandbox environment is described and the difference from production is not stated. | get-started page |
| SDK or REST | Calls are shown as Graph API HTTP requests. Official SDKs are not stated (sample-code page returned 404). | get-started page |
| Data residency | No hosting-region statement. Encryption only: Signal protocol for messages, TLS in transit, "industry standard encryption techniques" at rest. | overview page |

## 3. Twilio

| Topic | Public statement | Source |
|---|---|---|
| Pricing | Table of Meta fee and Twilio fee per message, currency USD, "Pricing current as of September 2026". Twilio fee shown as $0.005 per message for every category. Meta fee shown as $0.0034 for authentication and for utility outside the service window; utility inside the window is free; marketing shown as no charge (Meta fee). Table is generic, **not Saudi-specific**; Saudi rates "not stated" on the page, which points to a downloadable CSV and country rate card (not read). | https://www.twilio.com/en-us/whatsapp/pricing |
| Pass-through | Twilio "passes through" Meta's per-template fee; prices "may change from time to time without notice." | same |
| Webhook signing | Header `X-Twilio-Signature`; HMAC-SHA1 using the account auth token as key. Twilio recommends its SDK validators (`validateRequest`, `RequestValidator.validate`, and `validateRequestWithBody` for JSON bodies, with a `bodySHA256` query value). Reverse proxies and TLS termination can cause validation failure. | https://www.twilio.com/docs/usage/webhooks/webhooks-security |
| Templates, approval time | Not stated; the WhatsApp tutorial page returned 404. | not reachable |
| Messaging limits and tiers | Not stated; the messaging-limits page returned 404. | not reachable |
| Status callbacks | Not confirmed on any page read. | not stated |
| Opt-out | Not stated on pages read. | not stated |
| Sandbox | Not stated on pages read. | not stated |
| SDK or REST | Validators ship in Twilio SDKs (Node, Python, Java, C#, Go are named in search results). REST API implied. | https://www.twilio.com/docs/usage/webhooks/webhooks-security (search result list) |
| Data residency | Not stated. | not stated |

## 4. 360dialog

| Topic | Public statement | Source |
|---|---|---|
| Pricing | Public list prices per number per month in EUR (USD toggle exists, only EUR amounts visible): Regular EUR 49, Premium EUR 99, Scale EUR 500 (assessment via calendar). Partner Platform tiers from EUR 250 per month plus per-channel fees. "Zero message markup" on Partner Platform. Per-message Meta fees: "vary by country and conversation type", amounts **not stated**. Saudi-specific pricing: not stated. | https://www.360dialog.com/pricing |
| Webhook signing | Header `x-360dialog-signature`; HMAC-SHA256 over the event body; secret is the partner platform secret; comparison should be constant-time. Page calls the check "optional" but recommends it. Step 3 text: missing header is rejected with 401; failed check with 403. The code sample raises 401 for both cases (inconsistent with the text). | https://docs.360dialog.com/partner/onboarding/webhook-events-and-setup/signature-validation |
| Business verification | A partner-led verification guide exists (search excerpt); its content not read. | https://docs.360dialog.com/partner/partner-hub/meta-business-verification/partner-led-business-verification (search result only) |
| Template approval, time | Not stated (not read). | not stated |
| Status callbacks, retries | The webhook reference page returned 404. Not confirmed. | not reachable |
| Sandbox, SDK, residency, opt-out | Not stated on pages read. | not stated |

## 5. Infobip

| Topic | Public statement | Source |
|---|---|---|
| Setup | Before sending: authenticate, configure sender behaviour and inbound routing, set a global webhook URL or override per message with `notifyURL`. | https://www.infobip.com/docs/whatsapp/whatsapp-over-api |
| Business verification, template approval, time | Not stated on the WhatsApp over-API page. | same |
| Languages | Arabic variants listed include `ar_EG`, `ar_AE`, `ar_LB`, `ar_MA`, `ar_QA`. **No `ar_SA` code appears in the page text.** | same |
| Pricing, Saudi | Not stated. Search excerpt (secondary) says Infobip charges per message by type, with no clear plan tiers. | not stated on primary page |
| Webhook signing | When HMAC authentication is set on a notification profile, requests are signed; the verification method is HMAC-SHA256 over the raw body (from the subscription documentation as excerpted in search). The **header name is not fixed** and depends on account configuration. | https://www.infobip.com/docs/subscriptions/subscription-components (search excerpt; primary page not read in full) |
| Status callbacks | WhatsApp delivery reports via `notifyURL`; events named DELIVERY and SEEN in the webhook subscription docs. | https://www.infobip.com/docs/subscriptions/available-events (search excerpt) |
| Sandbox, SDK, residency | Not stated. | not stated |

## 6. Unifonic (Saudi-based provider)

| Topic | Public statement | Source |
|---|---|---|
| Access to docs | `docs.unifonic.com` WhatsApp pages fetched returned a login screen. Facts below come from a search excerpt only. | https://docs.unifonic.com/docs/whatsapp-template-messages (login page); search excerpt |
| Templates | Created in the Unifonic console under Channels > WhatsApp; can be submitted through the Unifonic account or directly on the Meta platform; usable after Meta approval. Approval time, Arabic or English support: not stated. | search excerpt |
| APIs and webhooks | Template Management API; incoming-messages webhook; outbound message delivery status webhook; account-management webhook for number and template quality. | search excerpt, https://docs.unifonic.com/docs/whatsapp-apis |
| Webhook signing | Not stated (not found in search or readable pages). | not stated |
| Pricing, Saudi | Not stated. | not stated |
| Sandbox, residency, SDK | Not stated. | not stated |

## 7. Bird (formerly MessageBird)

| Topic | Public statement | Source |
|---|---|---|
| Pricing | Saudi page lists Meta pass-through costs plus Bird fees or plan usage. Domestic pricing for Authentication messages is "available upon approval from Meta". Figures were not read. | https://bird.com/products/whatsapp/pricing/sa (search result; page not read in full) |
| Billing basis | Charged when sent, whether or not delivered; price depends on destination country and template category. | https://bird.com/en-ca/docs/guides/whatsapp/overview (search excerpt) |
| Webhook signing, templates, sandbox, residency | Not found in search results. | not stated |

## 8. Side-by-side (what the pages read show)

| Provider | SA per-message price on primary page | Webhook signing | Status callbacks | Template approval time | Sandbox | Notes |
|---|---|---|---|---|---|---|
| Meta direct | Not stated (rate card not read) | `X-Hub-Signature-256` | Yes (`messages` webhook) | up to 24 h | Test number; no sandbox described | Free tier 1,000 service messages per month |
| Twilio | Not stated (generic USD table only) | `X-Twilio-Signature`, HMAC-SHA1 | Not stated | Not stated | Not stated | SDK validators |
| 360dialog | Not stated (EUR platform fees public) | `x-360dialog-signature`, HMAC-SHA256 | Not stated (page 404) | Not stated | Not stated | Zero message markup on Partner Platform |
| Infobip | Not stated | HMAC-SHA256 if configured; header not fixed | DELIVERY and SEEN events | Not stated | Not stated | No `ar_SA` in language list |
| Unifonic | Not stated | Not stated | Outbound delivery status webhook (excerpt) | Not stated | Not stated | Docs behind login |
| Bird | Not stated (figures not read) | Not stated | Not stated | Not stated | Not stated | Domestic authentication pricing needs Meta approval |

## 9. Data residency

- Meta pages read give encryption statements only; no Saudi or regional hosting statement was found.
- Search excerpts on the Saudi PDPL disagree on whether localisation applies to all data, to some categories, or only with permission, and on the effective date (September 2023 in some sources, September 2024 in others). These are vendor guides, not the statute. Legal reading is needed before the owner relies on any provider for residency.
- One vendor (go4whatsup, a Meta business partner, search excerpt) offers a dedicated Saudi region on an enterprise tier. Not verified against its own page.

## 10. Pages not reachable on 2026-10-31

| URL | Result |
|---|---|
| https://developers.facebook.com/docs/whatsapp/pricing/rate-cards | 404 (rate card) |
| https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messaging-limits | 404 |
| https://developers.facebook.com/docs/whatsapp/cloud-api/reference/sample-code/ | 404 |
| https://developers.facebook.com/docs/whatsapp/cloud-api/get-started-for-coexistence/ | 404 |
| https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notifications-messages-templates | 404 |
| https://www.twilio.com/docs/whatsapp/api/messaging-limits | 404 |
| https://docs.360dialog.com/whatsapp-api/whatsapp-api/webhooks | 404 |
| https://www.infobip.com/docs/whatsapp (rate card and sandbox pages) | not fetched |
| https://docs.unifonic.com/docs/whatsapp-template-messages | login page |
| https://docs.unifonic.com/docs/whatsapp-apis | login page |

## 11. Facts the owner needs for Q-27

Q-27 asks which provider to use. This section lists only what the public pages establish against the integration document's needs. It does not recommend a provider. The needs are taken from `docs/architecture/integrations.md` §2.4 and §5.1: Arabic and English templates, signed inbound webhooks (§3.2), status callbacks, and a sandbox for tests (`whatsapp-stub` exists for CI, §2.4).

| Need | Meta direct | Twilio | 360dialog | Infobip | Unifonic | Bird |
|---|---|---|---|---|---|---|
| Arabic and English templates | Per-language templates, text supplied by sender; Arabic code not enumerated on pages read | Not stated | Not stated | Arabic variants listed, no `ar_SA` | Not stated (console submission) | Not stated |
| Signed webhooks | Yes, `X-Hub-Signature-256` | Yes, `X-Twilio-Signature` | Yes, `x-360dialog-signature` (optional per page) | Configurable HMAC; header not fixed | Not stated | Not stated |
| Status callbacks | Yes | Not stated on pages read | Not stated | Yes (DELIVERY, SEEN) | Yes (excerpt) | Not stated |
| Sandbox | Test number only | Not stated | Not stated | Not stated | Not stated | Not stated |
| Saudi per-message price | Not stated (rate card unread) | Not stated | Not stated | Not stated | Not stated | Not stated |

Open items the owner must settle before Q-27 can close:

1. Read Meta's SAR rate card (linked from the pricing page) and record the Saudi authentication, utility and marketing amounts with the date.
2. Resolve the 36-hour versus 7-day webhook retry conflict on Meta's own pages with a test endpoint or written confirmation.
3. Get the Unifonic and Bird developer documentation (login or sales contact) for signing, status callbacks, templates and sandbox.
4. Confirm the Arabic template locale code used for Saudi Arabia on Meta and each provider.
5. Confirm data residency in writing from each provider, and take a legal reading of the PDPL localisation question.
6. Ask each provider for its Saudi per-message price and any markup in writing; the pricing pages read did not state them.
7. Confirm whether opt-out (STOP and START) is handled by the provider or by our kernel (integrations §5.5), since no page read states it.
