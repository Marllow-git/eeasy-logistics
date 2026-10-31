# ADR-0003: Use one monorepo holding the Next.js web app and the NestJS API

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner, 2026-10-31

## Context

The owner chose a new GitHub repository under Marllow-git as a monorepo with the Next.js web app and the NestJS API. The team already runs pnpm and Turborepo for the eeasynew dashboard.

## Decision

`Marllow-git/eeasy-logistics` is a pnpm workspace with Turborepo. Layout: `apps/web` (Next.js, App Router), `apps/api` (NestJS), `apps/driver` (see ADR-0021), `packages/contracts` (shared schemas and generated API types), `packages/ui`, `packages/i18n`, `packages/config`. One pull request may change API, web and app together; the contract package is the typed seam between them.

## Consequences

One CI pipeline with per-app tasks and Turborepo caching. Versioning is by the repository, not per package. The architecture phase keeps the repository docs-only; the scaffold lands in wave 0.

## Alternatives considered

Separate repositories per app: typed contracts would need publishing, and a driver-API change would take three PRs.
