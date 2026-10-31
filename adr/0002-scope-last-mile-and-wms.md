# ADR-0002: Scope the product as last-mile delivery and WMS together

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner, 2026-10-31

## Context

The owner's answer to the scope question was "last-mile + WMS". The PRD for the Delivery module and the WMS architecture page (eeasynew, 2026-10-29) describe the two capabilities; both target the same merchant: one who runs their own drivers and holds their own stock.

## Decision

Two operational modules on one tenant model: Delivery (orders, zones, drivers, dispatch, field loop, COD custody, recipient pages, routing) and WMS (locations, catalog, inbound, stock ledger, picking, packing, returns, counting, channel sync). A merchant may use either or both; the platform admin enables each per account.

## Consequences

One shared kernel (accounts, users, sites, audit, outbox, flags) serves both. The WMS hands packed packages to Delivery for own-fleet orders and to the Eeasy shipping API for carriers (ADR-0014). Build order puts Delivery first (waves 1 and 2) and WMS third, because the first pilot merchant runs drivers today.

## Alternatives considered

Delivery only: leaves the WMS plan with no home. WMS as a later separate product: duplicates the tenant model and the sites concept.
