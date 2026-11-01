# ADR-0041: Send WhatsApp messages through the Eeasy WhatsApp engine, one deployment per product

- **Status:** proposed (owner to accept; the four defaults below are provisional until ruled)
- **Date:** 2026-11-01
- **Deciders:** owner (ruling of 2026-11-01: "we will be using this for sending all kinds of WhatsApp messages; an admin links a WhatsApp number for platform and OTP messages; a merchant who wants to message his customers links his own WhatsApp"), architecture lead
- **Source:** `docs/research/whatsapp-engine-2026-11.md`; amends A-22 (Q-27) and ADR-0037; changes `docs/architecture/integrations.md` §2.4, §5.2, §5.5 and `data.md` §10 wording

## Context

The foundation documents assumed a WhatsApp Business provider on the Meta Cloud API: approved templates per category, a verified business, per-product credentials. eeasynew's `services/whatsapp-engine` is something else: a Node service on Baileys (the WhatsApp Web multi-device protocol) that links a number by QR or pairing code, sends free text and PDF documents, paces sends per number, deduplicates by idempotency key, orders per recipient lane, holds and expires by message type, signs durable callbacks, dead-letters, and purges content after seven days. It has one hard-coded caller identity, one command and callback secret pair, one callback base URL, and eeasynew's integer account and store ids as tenant keys. eeasynew already runs the owner's model on it: an admin-linked platform number for OTPs and merchant-linked numbers for merchant messages. There is no Meta approval, and there is a ban risk per linked number.

## Decision

- **Transport.** `MessageSender`'s WhatsApp adapter is `EngineMessageSender`: the engine's signed internal API (`X-Eeasy-*` headers, nonce, body hash, HMAC v1) with `message.send.verification` for OTP and `message.send.text` for everything else, the outbox row id as the engine `eeasy_message_id` and idempotency key, our integer-mapped account id as `eeasy_account_id`, and the engine's `message.status` as the resend check. Delivery states arrive on a signed callback door that implements the engine's envelope and answers `200 {"ok":true}`.
- **Deployment (default 1).** This product runs its own engine deployment with its own service identity, secret pair and callback base URL, on the host OPS-1 provisions, never sharing eeasynew's instance. The engine stays an isolated service with its own PostgreSQL and Redis.
- **Numbers (default 2).** One admin-linked platform instance carries OTP and platform messages. Merchant messages go through the merchant's own linked instance, provisioned per account by a later order with the platform door and audit rows of ADR-0006; a merchant's ban never touches OTP.
- **Templates (default 3).** ADR-0037's "templates only" stays as a product rule: every message is a bilingual template from `packages/i18n` rendered by the kernel before the send; the engine receives text. Meta approval and template categories no longer apply. Opt-out words are the union of ours and the engine's (`STOP`, `إيقاف`, `الغاء`, `START`, `اشتراك`, `تشغيل`); the engine's `suppression.changed` callback feeds our per-account opt-out list.
- **Policy stays ours.** Quiet hours, per-order and per-phone caps, the monthly budget, staleness at send time, the breaker and the stub stay in the kernel; the engine's pacing, lanes, dedupe, hold and expiry, retries and dead letters are used, not duplicated.
- **OTP retention (default 4).** We ask eeasynew for a per-message purge option so verification bodies leave the engine within the hour; until then the engine keeps the OTP text up to seven days sealed in its store, while our outbox row holds it encrypted and deletes it after one hour as data §10 says.

## Consequences

- PLAT-9 builds `EngineMessageSender`, the callback door and the account-id mapping instead of a Cloud API adapter; the stub stays for local and CI.
- OPS-1 deploys and operates the engine for this product (host, secrets, callback URL, network path: the engine binds loopback and requires HTTPS off-loopback).
- A new order provisions merchant-linked numbers (instance create, QR or pairing code, status, relink, logout) behind the platform door, with audit rows; `core_accounts` gains an integer engine account id.
- Ban exposure of the platform number is an operational risk: a disconnected or banned sender expires OTPs within ten minutes and there is no fallback (ADR-0037 keeps SMS out before wave 3); alerts on `connection.event` `needs_relink` and `banned` are PLAT-14's alert file entries.
- Meta's terms position on unofficial automation is the owner's accepted risk.

## Alternatives considered

- Meta Cloud API with approved templates (the foundation's assumption): verified business and approval wait, per-message cost, no merchant-linked personal numbers; rejected by the owner's ruling.
- Sharing eeasynew's engine deployment: one caller identity, one secret pair, one callback URL and eeasynew's integer ids make product isolation impossible without engine changes; a second deployment is cheaper and safer.
- A BSP provider: superseded by the ruling.
