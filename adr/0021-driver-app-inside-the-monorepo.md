# ADR-0021: Keep the driver app inside the monorepo as apps/driver

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** foundation plan D3; ADR-0003, ADR-0004

## Context

The driver app consumes the driver API whose contract is typed in `packages/contracts`. A separate repository would need the contract published and versioned.

## Decision

`apps/driver` in the monorepo: Expo with Expo Router, EAS Build and Update, sharing `packages/contracts` and `packages/i18n`. A driver-API change and its app change ship in one pull request.

## Consequences

The monorepo's CI runs Expo typecheck and tests. Store submissions are still manual EAS steps, documented in the handbook.

## Alternatives considered

Its own repository like eeasy-app: the contract drift that produced eeasy-app PR #3's conflicts.
