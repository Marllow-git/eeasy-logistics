# ADR-0005: Serve merchants' own fleets only; keep the executor-fleet seam dormant

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner ruling 2026-09-21 (eeasynew LM-8 paused)

## Context

Two fleet models exist: a merchant's own drivers managed inside the product, and an Eeasy-operated fleet that delivers merchants' orders as a carrier. The owner ruled on 2026-09-21 that only the first is built; the second (LM-8, executor fleet) is paused for focus.

## Decision

Every order has an owner account. A nullable `executor_account_id` is reserved on orders and nothing is built on it. No platform-owned driver pool, no executor pricing, no executor settlement.

## Consequences

Dispatch, capacity and cash custody are always within one account. The seam costs one nullable column and keeps the paused model possible without a rewrite.

## Alternatives considered

Remove the seam entirely: cheap now, expensive if the owner un-pauses. Build both: rejected by the owner.
