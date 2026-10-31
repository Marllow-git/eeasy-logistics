# ADR-0015: Provision object storage and own-fleet coverage before the first driver signs in

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** UAT-1 findings F1 and F2 (eeasynew, 2026-09-13)

## Context

UAT-1 blocked twice on deployment, not code: proof uploads failed because the S3 disk was never provisioned (F2), and every own-fleet shipment was refused because the fleet had no explicit lane coverage rows (F1).

## Decision

Wave 0 provisions an S3-compatible bucket with signed upload and expiring read URLs, and the API refuses to start in production without it. Own-fleet coverage (which sites serve which zones) is explicit data created with the account by the provisioning door; an order outside coverage is refused with a typed reason, never silently unassignable.

## Consequences

Account provisioning takes a coverage step. Environments without storage cannot pretend to be production.

## Alternatives considered

Infer coverage from zones: hides the gap until the first order fails. Local disk for proofs: lost on redeploy.
