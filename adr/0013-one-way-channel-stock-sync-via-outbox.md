# ADR-0013: Publish stock to channels one way, WMS to channel, through an outbox

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** WMS architecture 2026-10-29

## Context

Channel drivers in eeasynew (Salla, Zid) only read products; no quantity push exists. Two-way sync produces fights over who owns the number.

## Decision

The WMS is the source of truth for available quantity. Changes are published to channels through `channel_publications`, an outbox with supersede (a newer publication for the same product replaces an unsent older one), exponential backoff, and a nightly reconcile that re-reads channel quantities and republishes drift. Channel-originated quantity changes are ignored and logged.

## Consequences

A channel outage never blocks a warehouse operation. Merchants editing stock in a channel see it overwritten; the UI says so.

## Alternatives considered

Two-way sync: ownership conflicts. Synchronous push on every movement: couples warehouse throughput to channel latency.
