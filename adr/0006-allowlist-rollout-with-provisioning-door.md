# ADR-0006: Roll out features by allowlist with a staff provisioning door from day one

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** eeasynew DELIVERY-ACCESS-1 (PR #1425) lesson

## Context

In eeasynew the Delivery module auto-provisioned an account for any merchant who opened the section once the platform switch was on. Before the first pilot, a whole order (DELIVERY-ACCESS-1) was needed to add a rollout mode, a staff-granted stamp and a per-account flag. The adversary review found that self-enrolled accounts slipped into the allowlist.

## Decision

Every module and every risky feature has a rollout mode `off | allowlist | all`, default `allowlist`, writable only by a platform super admin. Under `allowlist`, only accounts a platform admin provisioned and enabled see the feature; nothing is created on first use. The admin provisioning door, the per-account flag and the audit entry exist in wave 0, before the first feature.

## Consequences

A pilot with one merchant needs no code. Admin screens show the rollout mode and the enabled count. The cost is one flags table and one middleware in the shared kernel.

## Alternatives considered

A platform switch alone: proven insufficient. Per-feature environment variables: not auditable and not per account.
