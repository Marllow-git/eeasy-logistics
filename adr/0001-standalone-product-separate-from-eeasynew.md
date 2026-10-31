# ADR-0001: Build eeasy-logistics as a standalone product, separate from eeasynew

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner, 2026-10-31

## Context

Last-mile delivery was being built as a module inside the eeasynew Laravel monolith (the Delivery module, GROUND-1 to LM-6, 39 migrations) with a WMS module planned beside it. On 2026-10-31 the owner halted that work: nothing from wave A merges, and the delivery issues in eeasynew are closed as not planned.

## Decision

eeasy-logistics is its own product with its own accounts, database, API, web app and driver app. It does not share identity, wallet, ledger or database with eeasynew. The only eeasynew capability it uses is the Eeasy shipping public API, as an external integration (ADR-0014).

## Consequences

Freedom to pick the stack and the domain model without the monolith's frozen tables (branches versus warehouses, `acc_*` ledger, carrier pricing). The eeasynew Delivery module becomes reference material that is read, not ported. Merchants who use both products have two accounts until a sign-in link is built (ADR-0023). The eeasynew public API (issue #885, X-1) is on this product's critical path.

## Alternatives considered

Continue inside eeasynew: rejected by the owner for focus and stack reasons. A shared database with eeasynew: couples release cycles and reintroduces the frozen-table constraints.
