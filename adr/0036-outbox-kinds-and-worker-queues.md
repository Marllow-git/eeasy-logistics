# ADR-0036: Run one worker queue per outbox kind and add a storage lifecycle kind

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** integration architecture (document 9) §4; ADR-0024; domain model (document 2) §2.7, §4.9, §6.2; platform blueprint §5, §6, §7

## Context

ADR-0024 routes every external effect through an outbox and queues by kind, and document 2 §2.7 lists six kinds. Three questions were left open: how kinds map to queues so one slow provider cannot starve another; how per-aggregate ordering is achieved on open-source BullMQ, which has no group feature; and how stored objects are deleted at the end of retention (platform §6), which is an irreversible external effect that today would run from a scheduled job outside the outbox. Platform §7 also pages on "any dead-lettered job", which would page on every failing merchant webhook endpoint.

## Decision

- One BullMQ queue per kind, `outbox.<kind>`, each with its own concurrency, provider rate limiter, attempt count and backoff (document 9 §4.2). A `rate_limited` failure reschedules without consuming an attempt; an `unauthorised` failure parks the connection's rows without consuming attempts.
- A seventh kind, `storage_lifecycle`, carries object deletions (retention and account closure) in batches of up to 1,000 keys; each executed batch writes an audit row. The `platform.yaml` kind enums gain the value.
- `channel_publish` is fed from both `wms_channel_publications` (stock, W-18) and `core_outbox` (other channel writes such as webhook registration).
- Per-aggregate ordering is enforced by the single-leader relay, which enqueues a row only when every earlier row of its ordering scope is `done` or `dead`, with consumer parking (document 2 §6.2) as the second line. BullMQ `jobId` equals the outbox row id; a sweeper re-enqueues rows left `enqueued` without a job.
- Dead rows of `internal_event`, OTP `message`, `carrier_call` and `storage_lifecycle` page individually; dead `webhook` and `channel_publish` rows, which merchants see and fix, alert by rate. Oldest-due-row thresholds are per kind (document 9 §4.5).

## Consequences

Every external effect, including deletions, is listed, retryable and audited. Queue tuning is per provider. The relay carries the ordering logic and must be tested for it. Alert noise from merchant endpoints is contained, at the cost of a rule that differs from platform §7's wording.

## Alternatives considered

One shared queue: a slow channel store delays OTPs. BullMQ Pro groups for ordering: a paid dependency for what the relay can do. Provider lifecycle rules for all deletions: cannot express per-account retention or write an audit row per deletion; still used for age-only prefixes (imports, exports, multipart uploads).
