# ADR-0037: Send messages as approved WhatsApp templates only, with no SMS fallback before wave 3

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** integration architecture (document 9) §5; foundation plan §3 and §5; ADR-0016, ADR-0023, ADR-0024

## Context

Driver OTP (ADR-0023) and recipient messages go through a `MessageSender` port with a WhatsApp adapter first (foundation plan §3). Business-initiated WhatsApp messages must use pre-approved templates, are charged per message, and can be blocked or reported by recipients. A second channel (SMS) doubles template management, provider contracts and cost before there is evidence it is needed. Recipients must be able to stop messages, and one merchant's volume must not create unbounded cost.

## Decision

- Every outbound message is a platform-level template in Arabic and English, keyed in `packages/i18n`, with parameters from domain data only; no free-text messages to recipients.
- No SMS adapter in waves 0 to 2. The port keeps a second adapter slot; a number without WhatsApp receives nothing and the order flow is unaffected.
- Recipient messages respect quiet hours (22:00 to 08:00 Asia/Riyadh) for messages not tied to a delivery in progress, per-order and per-phone daily caps, a staleness check at send time, and a per-account opt-out list. OTP is never delayed, capped by the merchant budget, or blocked by opt-out.
- Each account has a `messages_per_month` limit with a usage counter; at 100 % recipient messages are skipped with a visible reason.

## Consequences

One provider contract and one template set to approve per wave. Recipients without WhatsApp get no notifications until SMS is scheduled; the undelivered rate must be measured to decide that. Message cost becomes an input to the pricing decision (foundation plan D6).

## Alternatives considered

SMS fallback from wave 1: a second provider and template set for a minority of recipients, before data shows the need. Free-text messages from dispatchers: not allowed outside the 24-hour customer window and a spam risk. No per-account budget: one merchant's campaign-like usage becomes platform cost.
