# ADR-0007: Model driver cash custody after Logestechs

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner-accepted gap-fill research 2026-09-21; eeasynew LM-5

## Context

Logestechs has the complete driver-cash model among the references: a per-parcel COD chain, a settlement batch ("Mass COD report"), an append-only deficit ledger, receiving cash without releasing custody, and blocking drivers who hold previous days' cash. Shipox has the cleanest custody chain. OTO Flex has no driver-cash model. eeasynew once counted card and wallet payments as cash in the van, a defect found by that research.

## Decision

Each COD collection records amount, method and custody. Custody moves `collected → with cashier → with bank`; the receiver confirms a handover, never the driver. Deficits and surpluses are append-only liability entries per driver. A driver holding unsettled cash from a previous day cannot accept new orders until a supervisor clears it. Card, mada and wallet payments are recorded with custody `not held` and never enter the cash ledger.

## Consequences

Cash reports reconcile by construction. Settlement needs a cashier role at a site. The driver app shows "cash in hand" from the ledger, not from a counter.

## Alternatives considered

A single COD-collected flag per order: cannot express custody or deficits. Driver-confirmed handover: lets the party at risk attest their own handover.
