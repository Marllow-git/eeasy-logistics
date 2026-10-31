# ADR-0026: Split the API into three bounded contexts with enforced module boundaries

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** foundation plan §4; domain model (document 2) §1; ADR-0003, ADR-0024

## Context

One NestJS application and one PostgreSQL database hold delivery, warehouse and shared platform data (ADR-0003, ADR-0019). Without a boundary, a WMS service will soon update an order row directly and a Delivery query will join stock tables, which couples their release cadence and their failure modes. The foundation plan named three contexts but not how the separation is enforced.

## Decision

Three contexts: Shared kernel (`apps/api/src/modules/kernel/`, tables prefixed `core_`), Delivery (`apps/api/src/modules/delivery/`, `del_`) and WMS (`apps/api/src/modules/wms/`, `wms_`). A context imports another only from that context's `public/` folder (ports, event payload types, DTOs); the kernel imports no context. No business code joins across prefixes, and no foreign key runs between `del_` and `wms_`. A context changes another context's state only by consuming a domain event delivered through the outbox (ADR-0024, ADR-0027), except through a synchronous command port named in the domain model; the only one today is `OwnFleetOrderPort.createFromPackage` (WMS → Delivery, same transaction, ADR-0014). An architecture test in the `api-test` CI check (a dependency-cruiser rule set, or an equivalent lint rule) fails the build on any import that breaks these rules.

## Consequences

Each context can be reasoned about, tested and later extracted on its own. Cross-context reads cost a port method instead of a join; reporting across contexts moves to read-only views defined in the data architecture. A new synchronous command port needs an amendment to the domain model and a reviewer's sign-off.

## Alternatives considered

Separate services per context: network calls, distributed transactions and three deployments for a team that ships one product. PostgreSQL schemas per context instead of table prefixes: equally valid, but it adds search-path handling to every migration and query for no extra isolation within one application role. Folders without an enforced test: the boundary erodes at the first deadline.
