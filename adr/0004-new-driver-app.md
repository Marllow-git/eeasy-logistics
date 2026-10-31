# ADR-0004: Build a new driver app instead of continuing the eeasy-app driver work

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner, 2026-10-31

## Context

The eeasynew driver experience lived in the `sajjadjaved01/eeasy-app` merchant app as a role-based mode. Its LM-3 branch (PR #3) has been conflicting since 2026-09-22 while nine merchant-app PRs merged under it. The owner answered "new driver app".

## Decision

A new driver app, designed from `docs/delivery/23-driver-app-ux.md` and `25-driver-app-reference-comparison.md` in eeasynew and from the Logestechs and OTO Flex driver apps, built with Expo and Expo Router. Its API contract is defined in this repository and typed from `packages/contracts`. Where it lives is ADR-0021.

## Consequences

No dependency on the merchant app's release cycle. The driver app can be offline-first from its first screen (ADR-0008). eeasy-app PR #3 is abandoned, not rebased.

## Alternatives considered

Rebase PR #3 and keep driver mode in the merchant app: carries the conflict debt and ties the driver loop to a consumer app's store review cadence.
