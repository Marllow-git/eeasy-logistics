# ADR-0017: Gate digital COD on owner approval; use tap-to-phone, never Bluetooth POS

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** eeasynew alignment doc 31 (2026-10-29)

## Context

Card payment at the door needs a payment provider contract. Bluetooth POS devices add hardware, pairing and support cost. Tap-to-phone (Nearpay, Geidea) works on the driver's own phone.

## Decision

Digital COD at the door is not scheduled. When the owner approves it, the implementation is tap-to-phone through a payment port; no Bluetooth terminal support is built. Until then, card and wallet payments are recorded as collected elsewhere with custody `not held` (ADR-0007).

## Consequences

Wave 2 cash work ignores card acceptance. The payment port is named in the domain model but has no adapter.

## Alternatives considered

Build card acceptance in wave 2: needs a merchant-of-record decision the owner has not made.
