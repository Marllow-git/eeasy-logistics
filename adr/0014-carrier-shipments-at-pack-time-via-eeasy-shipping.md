# ADR-0014: Create carrier shipments at pack time through the Eeasy shipping API; own fleet is a card beside carriers

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** WMS architecture 2026-10-29; OWN-FLEET-CARRIER-1; ADR-0001

## Context

A shipment priced before packing has a guessed weight. The WMS architecture ruled shipment creation at pack time with measured weight. This product does not price or integrate carriers itself (ADR-0001); Eeasy shipping does.

## Decision

When a package is packed, the merchant picks a fulfilment method from one list: the own fleet (creates a Delivery order in this product) or a carrier (calls the Eeasy shipping public API to create the shipment with the measured weight and dimensions, stores the AWB and label, and subscribes to its tracking webhooks). The own-fleet card is a peer of the carrier cards, not a special path.

## Consequences

The Eeasy shipping API (eeasynew issue #885) must offer API keys, create, label, track and webhooks before wave 3. Carrier pricing, coverage and AWB logic are not re-implemented here.

## Alternatives considered

Integrate carriers directly: duplicates eeasynew's work and splits credentials. Create shipments at order time: wrong weights, re-pricing.
