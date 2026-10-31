# ADR-0011: Record stock as a double-entry, append-only movements ledger with projections

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** WMS architecture 2026-10-29 (owner reviewed)

## Context

The WMS architecture page ruled stock as movements, not mutable quantities, so that every quantity on every shelf can be rebuilt and audited. Bolesa's WMS claims nothing on this; Logestechs has no WMS.

## Decision

`stock_movements` is append-only: each row moves a quantity of one product (and lot or serial where tracked) from one location to another, with system locations `SUPPLIER`, `CUSTOMER` and `ADJUSTMENT` closing the double entry. `stock_levels` and `stock_summary` are projections rebuilt from the ledger by a cursor; a nightly assertion compares projections to the ledger and alerts on drift. Database triggers forbid update and delete on the ledger.

## Consequences

Counting and adjustments are movements too. Every stock report is reproducible at any point in time. Writes cost two rows per move; reads come from projections.

## Alternatives considered

Mutable quantity columns with a history table: drifts and cannot prove a balance.
