# Merchant webhook signing: Standard Webhooks and major providers vs ADR-0030

- **Question:** Lead, 2026-11-01. Q-43 in `docs/roadmap.md` §4: keep ADR-0030's signing format or adopt the Standard Webhooks spec.
- **Read date:** 2026-11-01 for all sources unless a row says otherwise. Local documents were read on the same day.
- **Labels:** [S] = stated by the source. [I] = inferred by the researcher from the sources. Source IDs (S1 to S20) are listed at the end with URLs.
- **Scope:** facts and trade-offs only. No architecture recommendation.

## Summary for the lead

1. Standard Webhooks (SW) core is ADR-0030 with different names: HMAC-SHA256 over `id.timestamp.body`, `whsec_` base64 secrets, space-separated signatures for rotation, and a 5-minute tolerance in every library read [S1, S4, S20].
2. Stripe matches ADR-0030 on what is signed (`timestamp.payload`, 300 s default); SW adds the message id to the signed string [S1, S8].
3. Cosmetic differences: header names (`webhook-*` vs `X-Eeasy-*`), `v1,<base64>` vs `v1=<hex>`, and body field names (`data` vs `payload`).
4. Substantive differences: SW signs the id (ADR-0030 signs only the body, which carries the same id); SW defines Ed25519 `v1a` and says to prefer asymmetric signatures when producer and consumer are not under one control, while ADR-0030 is silent; SW's endpoint-verification extension is a signed challenge-response, not a one-time token; SW recommends 410 disables and Retry-After handling, which ADR-0030 lacks.
5. No official library I found implements `v1a`; a repo-wide code search returned it only in the spec text [I, S21].
6. A TypeScript sender exists: `standardwebhooks` 1.1.1 exposes a public `Webhook.sign(msgId, timestamp, payload)` [S4]. Licence conflict: npm says MIT, the repo says Apache-2.0 [S3, S4].
7. Adopter claims are weak: only OpenAI and Supabase vendor docs confirm SW; the project README and website list many more without per-company proof; Twilio's own security page does not mention SW [S5, S6, S12, S16, S17].
8. Stripe, GitHub, Shopify, Twilio and Slack are the majors; only Stripe and Slack put a timestamp in the signed input; Twilio signs with SHA-1 [S8 to S12].
9. ADR-0030 is still `proposed` and nothing ships yet, so no installed base needs migrating [I, ADR status].

## 1. Standard Webhooks

### 1.1 Spec (S1, read 2026-11-01 from `main`, last commit 2026-10-30)

- Headers: `webhook-id`, `webhook-timestamp` (integer Unix seconds), `webhook-signature` (space-delimited list) [S1].
- Signed content: `msg_id.timestamp.payload`, where id and timestamp must not be user-controlled [S1].
- Symmetric: HMAC-SHA256, prefix `v1`, secret `whsec_` + base64 of 24 to 64 random bytes, one key per endpoint [S1].
- Asymmetric: Ed25519, prefix `v1a`, keys `whsk_` (secret) and `whpk_` (public). The spec says to prefer asymmetric signatures, and says: "If you do not control the security of both the producer and consumer, it is recommended you use an asymmetric signature instead" [S1].
- Rotation: several signatures in one header, verified until one matches. The spec gives no duration [S1]. The 24-hour overlap is not in the spec; it is our choice in ADR-0030.
- Tolerance: "some allowable tolerance"; no number given [S1].
- Idempotency: `webhook-id` as the key; the example says "save the IDs in redis for 5 minutes" [S1].
- Verification: constant-time comparison for symmetric; a "battle tested" library for asymmetric [S1].
- Retries: multi-day exponential backoff with jitter. The example schedule reaches a 24-hour step and runs to about 75 hours in total [S1]. 410 means disable; 3xx counts as failure; 429, 502 and 504 mean throttle; `Retry-After` is honoured [S1].
- Timeout: 15 to 30 seconds recommended [S1].
- Payload: fields `type`, `timestamp`, `data`; under 20 KB recommended [S1].
- SSRF: proxy outbound calls through a filter (the spec names Smokescreen) or run workers in a private subnet [S1].
- Migration: add the SW headers beside existing ones; secrets can be reused [S1].
- Version label: the spec file says "Version: 1.0.0". The latest GitHub tag is `v1.0.2`, dated 2026-02-18. I did not diff the tag against `main` [S3, I].
- Extension: endpoint verification (WEV), optional [S2]. A signed challenge (`webhook-challenge`) gets a response (`webhook-challenge-response`) computed from a key derived with HMAC over the label `wev-v1`. The spec says endpoints start paused and must not receive webhooks until the check passes [S2]. The spec also says echoing the challenge is weaker, because it proves neither key possession nor consent [S2].

### 1.2 Verification and sender libraries (S3, S4, S20)

| Language | Path (`libraries/`) | Sign function | Tolerance | Read |
|---|---|---|---|---|
| TypeScript/JS | `javascript` (npm `standardwebhooks` 1.1.1) | public `sign(msgId, Date, payload)` | 5 min, both directions | source read |
| Python | `python` | `sign(msg_id, datetime, data)` | 5 min, both directions | source read |
| PHP | `php` | `sign` | 5 min, both directions, `hash_equals` | source read |
| Go | `go` | exported `Sign` | 5 min | source read |
| Rust | `rust` | `pub fn sign` | 5 min | source read |
| C# | `csharp` | `Sign` | 5 min | source read |
| Elixir | `elixir` | `sign/4` | 5 min | source read |
| Java (README: "Java/Kotlin") | `java` | not read | not read | file exists [I, Kotlin is in the Java package per README] |
| Ruby | `ruby` | not read | not read | file exists |

- The JS library accepts a `whsec_` secret, strips only a leading `whsec_`, base64-decodes the rest, and throws on an empty key. A `format: "raw"` option takes bytes [S4].
- The JS library's `verify` requires `webhook-id`, `webhook-signature` and `webhook-timestamp`, then compares the full `v1,...` string in constant time [S4].
- Community libraries listed by the project: C#, Haskell, Java, Swift [S5].

**Licence and maintenance (S3, S4, read 2026-11-01)**

- Repo: Apache-2.0; 1,785 stars; last push 2026-10-30; 68 open issues; last tag `v1.0.2` on 2026-02-18 [S3].
- npm `standardwebhooks`: `MIT` in `package.json` and npm metadata; `1.0.0` 2024-03-04, `1.1.0` and `1.1.1` both 2026-08-28; dependencies `@stablelib/base64` and `fast-sha256` [S4]. The package licence (MIT) differs from the repo licence (Apache-2.0) [S3, S4, stated].
- The census (`backend-library-census-2026-11.md` §6) lists 51.46M weekly npm downloads. Not rechecked here [census].

### 1.3 Who says they adopt it

- Project README, read 2026-11-01: "adopted by ... OpenAI, Anthropic, Google Gemini, Kong, Svix, Supabase, Vanta, Drata, Etsy, PagerDuty, Twilio, TaskRabbit and many others" [S5]. This is the project's own claim, not a per-company statement.
- Website, read 2026-11-01, undated: 36 "Compatible implementations", including Brex, Clerk.dev, Resend, Lob, Render, Lithic and others. It says only "Contact us to add your logo" and makes no per-company claim [S6].
- Vendor docs I read:
  - **OpenAI** confirms: "Webhooks are delivered to an HTTP endpoint you control, following the Standard Webhooks specification", with `webhook-id`, `webhook-timestamp`, `webhook-signature` [S16].
  - **Supabase** confirms for HTTP Auth Hooks: "HTTP Hooks in Supabase follow the Standard Webhooks Specification". Its secret format is shown as `v1,whsec_<base64>` [S17]. [I] A literal copy of that string into the JS constructor would fail, because the constructor strips only a leading `whsec_`.
  - **Svix** documents `svix-id`, `svix-timestamp`, `svix-signature`, signed as `id.timestamp.body` with HMAC-SHA256 and `whsec_`. Headers can switch to `webhook-` only on Basic, Professional and Enterprise plans. The page does not say Svix follows the spec [S9].
  - **Resend** names only the `svix-*` headers and does not mention SW [S10].
  - **Clerk** delivers through Svix, names `svix-id`, and does not mention SW [S11].
  - **Twilio's** webhook security page does not mention SW [S12]. Twilio is still listed in the README and a steering-committee member is from Twilio [S5].
- Not checked: Kong, Zapier, Lob, Etsy, PagerDuty, Vanta, Drata, TaskRabbit, Anthropic, Google Gemini, Benchling and the other website entries.

## 2. Major providers and security guidance

### 2.1 Provider schemes

| Provider | Header(s) | Signed input | Algorithm and encoding | Timestamp in signed input | Tolerance | Rotation | Source |
|---|---|---|---|---|---|---|---|
| Stripe | `Stripe-Signature: t=<unix>,v1=<hex>` (more `v1=` values during rotation) | `"<t>.<payload>"` [S8] | HMAC-SHA256, hex | yes | 300 s default in stripe-node, checks age [S8] | up to 24 h; one `v1` per active secret [S7] | S7, S8 |
| GitHub | `X-Hub-Signature-256: sha256=<hex>` (legacy SHA-1 header also sent) | body only [S13] | HMAC-SHA256, hex | no | none stated | not stated | S13 |
| Shopify | `X-Shopify-Hmac-Sha256` | raw body only [S14] | HMAC-SHA256, base64 | no | none stated | new secret can take up to an hour to apply [S14] | S14 |
| Slack | `X-Slack-Signature: v0=<hex>` plus `X-Slack-Request-Timestamp` | `"v0:<ts>:<body>"` [S15] | HMAC-SHA256, hex | yes | 5 min [S15] | not read | S15 |
| Twilio | `X-Twilio-Signature` | full URL plus sorted POST parameters; for JSON, a `bodySHA256` parameter [S12] | HMAC-SHA1, keyed with the auth token | no | none | not stated | S12 |
| Svix (reference) | `svix-id`, `svix-timestamp`, `svix-signature` | `id.timestamp.body` [S9] | HMAC-SHA256, base64 | yes | "within your tolerance", no number [S9] | not read | S9 |
| Salla (inbound to apps, from our earlier research) | `X-Salla-Signature` | body only | HMAC-SHA256 | no | none | none | provider-facts-2026-10 §1 (read 2026-10-31) |
| Zid (from our earlier research) | HTTP Basic auth with username and password set at registration | none | n/a | n/a | n/a | n/a | provider-facts-2026-10 §3 (read 2026-10-31) |

Stated: GitHub's page says "Never use a plain `==` operator" and recommends constant-time comparison; it describes no replay protection [S13].

### 2.2 Security guidance

**OWASP Webhook Security Cheat Sheet** (S18). Read through a summarising fetch, so quotes are paraphrases [I]. Stated in the summary:
- Put a Unix timestamp in the signed material and send it with the signature. Generate a fresh timestamp and signature for every retry [S18].
- Use a distinct secret per registered webhook; 32 bytes as default; store in a secrets manager; redact from logs [S18].
- Compare in constant time; never use `==` [S18].
- Rotation: sign with every active secret; on suspected compromise revoke the old secret immediately and return 401 for deliveries signed only with it [S18].
- Cache authenticated event IDs for at least twice the tolerance, which is 10 minutes for a 5-minute window [S18].
- Mutual TLS for high-assurance pipelines; IP allowlisting only as an extra layer; OAuth client credentials as an option [S18].
- Logging: do not log full bodies, secrets or signature headers; return 401 for signature failures with a generic body [S18].
- Accept only the signature version you expect, to block downgrades [S18].

**OWASP SSRF Prevention Cheat Sheet** (S19), read 2026-11-01:
- Validate the IP that is actually connected, not an earlier lookup; re-resolving does not close DNS rebinding [S19].
- Disable redirects [S19].
- Deny-lists are "bypass-prone. Prefer allow-lists"; if a deny-list is unavoidable, block at least loopback, RFC 1918, `fc00::/7`, `fe80::/10`, multicast, `0.0.0.0/8` and the metadata address [S19].
- Webhooks are the guide's example of an unknown-destination case. The guide's fix is a random token the caller must return [S19].

### 2.3 Asymmetric and mTLS

- SW prefers asymmetric signatures when producer and consumer are not under one control [S1].
- OWASP mentions mTLS for high-assurance pipelines, and IP allowlisting only as an extra layer [S18].
- ADR-0030 rejects mTLS as "too heavy for most Saudi merchant stacks", but gives no source for that claim. It does not discuss Ed25519 at all [ADR-0030, read 2026-11-01].

## 3. Point-by-point: ADR-0030 vs Standard Webhooks vs Stripe

"Kind" marks each difference: **C** cosmetic (naming or encoding, no change to what is verified); **S** substantive (what is signed, rotation, replay, verification or delivery behaviour); **-** no difference.

| # | Aspect | ADR-0030 (`ADR`, `webhooks.md`) | Standard Webhooks (SW) | Stripe | ADR vs SW | Kind |
|---|---|---|---|---|---|---|
| 1 | Timestamp header | `X-Eeasy-Timestamp` | `webhook-timestamp` | inside `Stripe-Signature` as `t=` | name | C |
| 2 | Signature header | `X-Eeasy-Signature` | `webhook-signature` | `Stripe-Signature` | name | C |
| 3 | Event id header | `X-Eeasy-Event-Id` (copy, not signed, logging only) | `webhook-id` (signed via the signed string) | none; id only in body | ADR's header copy is outside the MAC; the signed body carries the same id | S (low impact, inferred) |
| 4 | Signed string | `"<ts>.<raw body>"` | `"<id>.<ts>.<body>"` | `"<t>.<payload>"` | SW adds id; ADR = Stripe | S |
| 5 | Signature encoding | `v1=<hex>` | `v1,<base64>` | `v1=<hex>` | encoding and prefix differ; SW's parser splits on spaces and expects `v1,` [S4]; off-the-shelf verifiers reject ADR format [I] | C for crypto; breaks interop |
| 6 | Multiple signatures | comma-separated `v1=` values | space-separated `v1,` values | comma-separated `v1=` pairs | same idea, different separators | C |
| 7 | Algorithm | HMAC-SHA256 only | HMAC-SHA256 (`v1`) and Ed25519 (`v1a`) | HMAC-SHA256 | ADR has no asymmetric option and gives no reason | S (decision not recorded) |
| 8 | Secret format | 32 random bytes; encoding and HMAC key bytes not stated | `whsec_` + base64 of 24–64 bytes; key = decoded bytes in the JS library [S4] | `whsec_` | ADR's format is unstated; key derivation must match or verification fails [I] | C if prefix only; S if key bytes differ |
| 9 | Keys per endpoint | yes | yes | yes | none | - |
| 10 | Tolerance | ±300 s | "some tolerance"; ±5 min in every library read | 300 s, checks age | same in practice | - |
| 11 | Rotation | two values for 24 h | several signatures, no duration | up to 24 h, one per secret | same mechanism; duration is our choice | - |
| 12 | Replay and dedupe | timestamp signed; dedupe on envelope id; retention not stated | timestamp signed; dedupe on `webhook-id`; example retention 5 min | timestamp signed; dedupe on event id (docs, S7) | retention gap; OWASP says at least 2× tolerance [S18] | S (minor) |
| 13 | Endpoint verification | one-time token sent in a signed request, returned via our authenticated API, hashed, 24 h | optional WEV: signed challenge-response per key, endpoint paused until it passes [S2] | not checked | different proof: ADR shows URL control and the merchant's API key; WEV shows the endpoint holds the key | S |
| 14 | Retry schedule | 30 s, 2 min, 10, 30 min, 1, 2, 4 h, then every 4 h to 24 h; jitter | multi-day exponential with jitter; example reaches about 75 h [S1] | up to 3 days [S7] | ADR ends at 24 h; SW recommends multi-day (a recommendation) | S (ops) |
| 15 | Response codes | 2xx acknowledges; other results retry | 2xx success; 3xx failure; 410 disable; 429, 502, 504 throttle; `Retry-After` | 3xx is failure [S7] | ADR does not mention 410 or `Retry-After` | S (ops) |
| 16 | Timeout | 10 s | 15 to 30 s recommended [S1] | "return quickly" (no number on the page read) | value differs | S (ops, recommendation) |
| 17 | Redirects | not followed | 3xx is failure | redirect is failure [S7] | none | - |
| 18 | Ordering | per aggregate, in `sequence` order | silent | not checked | ADR adds this | - |
| 19 | Body envelope | `id`, `type`, `version`, `occurred_at`, ..., `payload` | `type`, `timestamp`, `data` (recommended) | `id`, `type`, `data`, `created` (not read) | field names | C |
| 20 | Event type names | dotted, lowercase | dotted, `[a-zA-Z0-9_]` recommended | dotted | consistent | - |
| 21 | Subscription API | yes | recommended | yes | none | - |
| 22 | Delivery log and redelivery | yes | recommended | yes (Workbench) [S7] | none | - |
| 23 | Static source IPs | none | optional [S1] | published list [S7] | ADR silent | - |
| 24 | SSRF | in-process: resolve once, deny list, connect to the checked address, no redirects | proxy or private subnet [S1] | not read | ADR meets the OWASP points [S19]; deny-list rather than allow-list | - |
| 25 | IPv6 transition ranges | "private" and "link-local"; NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) not named | not in spec | not read | inferred gap: check the implementation's list [I] | S (verify) |
| 26 | Transport | `https`, port 443 only | HTTPS recommended [S1] | TLS 1.2+ in live mode [S7] | ADR is stricter on port | - |
| 27 | Payload size | not stated | under 20 KB recommended [S1] | not read | not stated in ADR | - |

**Counts:** cosmetic or encoding only: rows 1, 2, 5, 6, 19, and row 8 for the prefix. Substantive: rows 3, 4, 7, 12, 13, 14, 15, 16 and 25 (25 to verify), plus row 8 if the key bytes differ. Row 3 has low impact because the id is also in the signed body [I].

**Compared with OWASP** (S18, S19): ADR-0030 matches the timestamp in the signed material, a fresh signature per attempt, per-subscription 32-byte secrets, constant-time comparison, 24-hour overlap, and resolve-once with no redirects. It does not state: dedupe retention; a 401 for signature failures; ignoring unknown signature versions; an immediate revoke path for a compromised secret (neither ADR-0030 nor `webhooks.md` describes one; rotation only overlaps) [I, from text read].

## 4. Cost of adopting the spec

### 4.1 Sender (TypeScript)

- `standardwebhooks` 1.1.1 exports `Webhook`; `sign(msgId, timestamp: Date, payload)` returns `v1,<base64>`, floors the timestamp to seconds, and signs `msgId.<ts>.<payload>` with HMAC-SHA256 [S4].
- The library is not a sender. We still build the headers, retries, and outbox [I].
- Changes needed for ADR-0030 to conform: header names to `webhook-*`; signed string to include the envelope `id`; signature to `v1,<base64>`; secret to `whsec_` + base64 (24 to 64 bytes); signature list separated by spaces [S1].
- Our 32-byte secret fits the SW range [S1].
- Verifier availability for merchant code: JS, Python, PHP, Go, Rust, C#, Elixir; Java and Ruby exist but were not read [S20].

### 4.2 Conflicts with other ADR-0030 parts

| ADR-0030 part | Conflict with SW core? | Notes |
|---|---|---|
| Verification token | No | SW core has no verification; the token sits outside the spec. WEV is an optional alternative [S2]. |
| WEV as replacement | Would conflict with ADR's rejection of synchronous echo | WEV requires a synchronous response from the endpoint. ADR rejected synchronous echo because receivers behind queues cannot answer in time [I, S2, ADR-0030]. |
| Retry schedule | No protocol conflict; ADR's 24 h is shorter than SW's multi-day recommendation | 410 disable and `Retry-After` can be added with no wire change [S1]. |
| Timeout | No protocol conflict; value differs | SW recommends 15 to 30 s; ADR uses 10 s [S1]. |
| Delivery log, subscriptions, redelivery | No conflict | SW recommends them [S1]. |
| Ordering per aggregate | No conflict | SW is silent [S1]. |
| Dedupe | No conflict if `webhook-id` = envelope `id` | Retention must be decided. |
| Symmetric-only design | Consistent with v1; SW's own guidance points to v1a for third-party consumers | No library found implements v1a [S21, I]. |
| Migration | No installed base to migrate | ADR-0030 is `proposed` [I]. If sent during a migration, SW allows both header sets side by side [S1]. |
| Svix as delivery engine (only if bought) | Svix uses `svix-*` by default | Tier-gated switch to `webhook-*` [S9]. |

## Unanswered

1. Does the spec tag `v1.0.2` differ from the `main` text that says 1.0.0? Not diffed.
2. Does any library implement `v1a`? The repo-wide code search returned only spec text [S21]. Java, Ruby, C# and Elixir were not read in full. Needs a read of each before any v1a decision.
3. Stripe's own signing page (`docs.stripe.com/webhooks/signature`) did not load. Stripe's format and tolerance come from stripe-node v23.1.0 source [S8], not the docs page.
4. The OWASP cheat-sheet quotes came through a summarising fetch. Verify wording before citing.
5. Which listed adopters really use SW: only OpenAI and Supabase confirmed on vendor docs. Kong, Zapier, Lob, Etsy, PagerDuty and the others are unverified; Twilio's page does not mention it.
6. Does ADR-0030 need an immediate revoke path for a compromised secret? Not in the ADR or `webhooks.md`.
7. Does the implementation's private-range check cover NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`)? Not in the ADR text.
8. Which secret encoding and HMAC key bytes does ADR-0030 use? Not stated.
9. Dedupe retention on the receiver side: none stated in ADR; OWASP suggests at least 2× tolerance [S18].
10. Asymmetric: whether the owner wants `v1a` or symmetric only. ADR-0030 does not record a reason for rejecting it.
11. Endpoint verification: whether to keep the one-time token or adopt WEV. Only the owner can decide; the synchronous-response trade-off above is the main fact.
12. The Gulf platforms' own webhook schemes (Salla: body HMAC, no timestamp; Zid: Basic auth) are from our earlier note; not rechecked today. Their relevance to our outbound signing is a judgement the lead must make.
13. Retry duration: SW recommends multi-day, ADR-0030 uses 24 hours. Whether to change ADR-0030 is a decision, not a research fact.
14. Whether Stripe's endpoint-verification equivalent exists. Not checked.

## Sources (read 2026-11-01 unless noted)

- S1. Standard Webhooks spec, `spec/standard-webhooks.md`, `main` (last commit 2026-10-30): https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
- S2. Endpoint verification extension: https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/extensions/endpoint-verification.md
- S3. Repo metadata via `gh api repos/standard-webhooks/standard-webhooks`, releases, commits: https://github.com/standard-webhooks/standard-webhooks
- S4. JS library source and `package.json` (`libraries/javascript`), npm `standardwebhooks` metadata (`npm view`): https://www.npmjs.com/package/standardwebhooks
- S5. Repo README (libraries, community implementations, adopters, steering committee): https://github.com/standard-webhooks/standard-webhooks#readme
- S6. Standard Webhooks website, "Compatible implementations" (undated): https://www.standardwebhooks.com/
- S7. Stripe, Manage webhook endpoints (signature errors, rolling secrets, redirects, retries): https://docs.stripe.com/events/manage-webhook-endpoints
- S8. stripe-node `src/Webhooks.ts`, v23.1.0 (2026-10-29): https://github.com/stripe/stripe-node/blob/master/src/Webhooks.ts
- S9. Svix, Verifying payloads manually: https://docs.svix.com/receiving/verifying-payloads/how-manual
- S10. Resend, Verify webhook requests: https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests
- S11. Clerk, Webhooks overview: https://clerk.com/docs/guides/development/webhooks/overview
- S12. Twilio, Webhook security: https://www.twilio.com/docs/usage/webhooks/webhooks-security
- S13. GitHub, Validating webhook deliveries: https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- S14. Shopify, HTTPS webhooks: https://shopify.dev/docs/apps/build/webhooks/subscribe/https
- S15. Slack, Verifying requests: https://docs.slack.dev/authentication/verifying-requests-from-slack
- S16. OpenAI, Webhooks guide: https://developers.openai.com/api/docs/guides/webhooks
- S17. Supabase, Auth Hooks: https://supabase.com/docs/guides/auth/auth-hooks.md
- S18. OWASP, Webhook Security Cheat Sheet (summarised fetch): https://cheatsheetseries.owasp.org/cheatsheets/Webhook_Security_Cheat_Sheet.html
- S19. OWASP, SSRF Prevention Cheat Sheet (summarised fetch): https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- S20. Library sign and tolerance lines: `libraries/python/standardwebhooks/webhooks.py` (sign line 97, tolerance line 146), `libraries/php/src/Webhook.php` (TOLERANCE line 8), `libraries/go/webhook.go` (tolerance line 29, `Sign` line 120), `libraries/rust/src/lib.rs` (tolerance line 60, `sign` line 117), `libraries/csharp/StandardWebhooks/Webhook.cs` (tolerance line 17, `Sign` line 90), `libraries/elixir/lib/standard_webhooks.ex` (tolerance line 10, `sign/4`), all via `gh api` at `main`.
- S21. Repo code search for `v1a` and `ed25519` (`gh search code --repo standard-webhooks/standard-webhooks`), 2026-11-01: hits only `spec/standard-webhooks.md` and `spec/extensions/endpoint-verification.md` for `ed25519`; `v1a` hits only the two spec files. The search index may be incomplete.
- Local: `adr/0030-merchant-webhook-signing-and-delivery.md` (status proposed, 2026-10-31); `docs/contracts/webhooks.md` §2 to §4; `docs/roadmap.md` §4 Q-43; `docs/research/backend-library-census-2026-11.md` §6; `docs/research/provider-facts-2026-10.md` §1 and §3 (read 2026-10-31 by the earlier researcher).
