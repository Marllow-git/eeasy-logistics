# ADR-0023: Run our own identity; an Eeasy sign-in link is an option, not a dependency

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** owner, 2026-10-31 (standalone); foundation plan D5 for the optional link

## Context

The owner chose a standalone product. eeasynew identity is Sanctum tokens over Laravel users with Spatie roles; reusing it would couple releases and leak the monolith's role model.

## Decision

Accounts, users, roles and tokens live in this product. Merchant staff sign in with email and password, optional phone OTP. Drivers sign in with phone OTP over WhatsApp and a device-bound refresh token; cash actions require a PIN. A "sign in with Eeasy" door may be added in wave 4 as an identity provider, never as the only path.

## Consequences

Merchants with both products have two accounts until that door exists. Token lifecycle, scopes and device binding are specified in the identity and tenancy document.

## Alternatives considered

Shared identity with eeasynew from day one: contradicts the standalone decision and blocks on monolith changes.
