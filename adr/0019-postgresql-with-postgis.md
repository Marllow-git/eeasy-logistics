# ADR-0019: Use PostgreSQL 16 with PostGIS

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner (merged PR #1, 2026-10-31)
- **Source:** foundation plan D1; Bolesa runs PostgreSQL

## Context

Zones with official boundary polygons, driver positions, site points, coverage checks and distance-matrix caching are geospatial from the first wave. eeasynew runs MariaDB 10.11 and its ledger relies on triggers; the team knows both engines. Bolesa, the closest architectural precedent, runs PostgreSQL.

## Decision

PostgreSQL 16 with PostGIS for all contexts. Geometry columns with GiST indexes for zones and positions; triggers for ledger immutability (ADR-0011); row-level security available for tenancy defence in depth (ADR-0025).

## Consequences

Managed PostgreSQL is available from every host considered in ADR-0022. Engineers coming from MariaDB learn PostgreSQL idioms (schemas, `RETURNING`, partial indexes).

## Alternatives considered

MariaDB 10.11: what production runs today; spatial support exists but is thinner, no row-level security, and PostGIS-grade containment queries need workarounds.
