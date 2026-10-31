# ADR-0012: Track products by mode none, lot or serial, in a location tree with totes

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** WMS architecture 2026-10-29; Bolesa cross-check

## Context

Earlier WMS drafts created unit rows for every item. The architecture page replaced that with a per-product tracking mode and cut separate hub and shelf tables in favour of a coordinate-bearing location tree. Bolesa's WMS adds movable totes.

## Decision

`products.tracking_mode ∈ {none, lot, serial}`; lot and serial rows exist only where the mode requires. Locations form one tree (site → zone → aisle → rack → shelf → bin) with a generated path and optional coordinates; `tote` is a movable location type with a parent that changes as it moves.

## Consequences

Picking tasks address locations, not shelves or hubs. Serial-tracked goods pay the per-unit cost; everything else does not.

## Alternatives considered

Unit rows for everything: write amplification on every receipt. Fixed hub and shelf tables: cannot express totes or a fourth level.
