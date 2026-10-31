# ADR-0028: Write driver location pings to a bounded ring and fan out by Redis, not through the outbox

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** domain model (document 2) §7; ADR-0009, ADR-0024

## Context

Drivers on shift post their position every 10 to 15 seconds (ADR-0009). At the first-customer profile of fifteen drivers that is up to 6,000 points an hour per account, and it grows with every merchant. ADR-0024 routes every cross-system side effect through an outbox; applied to pings it would write and relay a row per point for an effect nobody needs to retry. Positions are telemetry: a lost point leaves a gap on a map and changes no business state.

## Decision

`POST /driver/locations` accepts a batch with `202`, only for the token's driver during an active or paused shift. Points are written by upsert into `del_driver_locations`, a fixed ring of the last 240 points per driver, and the newest point per driver goes to Redis with a short TTL. A worker appends ring points every five minutes to `del_driver_trails`, one simplified line per driver per business day, kept 90 days. Each accepted point is published on a Redis pub/sub channel per account, which the SSE streams for dispatcher maps and recipient pages subscribe to; polling reads the same Redis key. No outbox row and no domain event is written for a ping.

## Consequences

Ping storage is bounded by the number of drivers, not by time. A Redis restart loses at most the live fan-out until the next ping; the ring in PostgreSQL survives. This does not violate ADR-0024: a ping causes no external effect and is not a side effect of a business transaction. Anything derived from positions that is a side effect (an "arriving soon" message to a recipient, a geofence alert) is a business decision that writes an outbox row like any other.

## Alternatives considered

Outbox per ping: thousands of rows an hour relayed for no retry value. Unbounded positions table: grows without limit and needs partition management from day one. Redis only: loses the recent trail on restart and gives dispute review nothing to read.
