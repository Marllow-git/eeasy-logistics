# ADR-0018: Model branches and warehouses as one sites concept

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner (merged PR #1, 2026-10-31)
- **Source:** foundation plan §4 (2026-10-31)

## Context

In eeasynew, branches (`App\Branches`) and warehouses (`warehouses`) were separate frozen tables because carrier shipping, pricing and channel sync depended on warehouses. Delivery linked to branches, WMS to warehouses. That split has no reason to exist in a new product.

## Decision

One `sites` table with `kind ∈ {branch, warehouse, both}`, address and National Address short code, opening hours, staff assignments and geographic point. Delivery coverage, dispatch, cash custody, inbound and stock locations all reference a site. A site may be both a dark store and a dispatch point.

## Consequences

One screen to manage locations. Zone coverage, cashier roles and stock locations hang off the same row.

## Alternatives considered

Keep two tables: duplicates address handling and forces a join whenever a warehouse dispatches its own orders.
