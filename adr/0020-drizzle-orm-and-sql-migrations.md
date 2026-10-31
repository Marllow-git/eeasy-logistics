# ADR-0020: Use Drizzle ORM with SQL migrations

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** foundation plan D2

## Context

The schema needs PostGIS geometry columns, append-only ledgers enforced by triggers, generated path columns and partial indexes. The ORM must not fight those.

## Decision

Drizzle ORM for typed queries and schema declaration, drizzle-kit for migration generation, with hand-written SQL migrations where triggers, PostGIS or generated columns are involved. No query builder writes to ledger tables except through the ledger service.

## Consequences

Queries read like SQL and are reviewable. Migrations are committed SQL files, reviewed like code.

## Alternatives considered

Prisma: mature, but geometry is an unsupported type and triggers live outside its model. TypeORM and MikroORM: heavier abstractions with less transparent SQL.
