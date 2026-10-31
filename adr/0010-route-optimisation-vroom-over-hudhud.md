# ADR-0010: Optimise routes with VROOM over a Hudhud distance matrix behind a RouteOptimizer port

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner ruling 2026-09-20 (eeasynew LM-2)

## Context

The owner ruled on 2026-09-20: VROOM over the Hudhud matrix, OSRM and nearest-neighbour as fallbacks, Google adapters optional, OR-Tools dropped. OTO's engine is unobservable; copy its simulate, optimise, create, assign UX, not its stack.

## Decision

A `RouteOptimizer` port with a VROOM adapter (container beside the API) consuming a distance matrix from a `DistanceMatrix` port whose first adapter is Hudhud (KSA road data). Fallbacks: OSRM matrix, then nearest-neighbour. Three rungs, each its own order: driver stop sequence, dispatcher planner, route automation.

## Consequences

A Hudhud B2B key is a prerequisite for rung 1. Matrix results are cached per day and per site. Rung 1 needs no planner UI, only an ordered stop list in the driver app.

## Alternatives considered

OR-Tools: a solver service to write and host. Google Directions only: per-merchant keys and cost; kept as an optional adapter.
