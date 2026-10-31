# ADR-0025: Isolate tenants by account_id on every operational row, enforced structurally

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** eeasynew TenantResolver port; ADR-0019

## Context

A multi-tenant product fails worst when one merchant sees another's orders. eeasynew enforced tenancy through a resolver port called by every query, which relied on discipline.

## Decision

Every operational table carries `account_id`. The request's account is resolved once from the token and set on the database session; a repository base class adds the predicate to every query; a schema test fails CI if an operational table lacks the column or an index on it. PostgreSQL row-level security policies are added as defence in depth once the schema is stable.

## Consequences

Cross-tenant queries (platform admin) are explicit and audited. The driver API resolves the account from the driver's token, never from a parameter.

## Alternatives considered

Schema or database per tenant: operational overhead for hundreds of small merchants. Discipline only: the failure mode we are avoiding.
