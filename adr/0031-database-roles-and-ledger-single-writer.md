# ADR-0031: Separate database roles by duty and keep ledger writes in the application's ledger services

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** data architecture (document 5) §3.2, §4.4; ADR-0011, ADR-0019, ADR-0020, ADR-0025, ADR-0026

## Context

Ledgers must never be updated or deleted and must be written only by their ledger services (AGENTS.md, ADR-0011, ADR-0020). Tenancy needs row-level security as defence in depth from the end of wave 1 (ADR-0025, document 4 §5), but platform staff, the outbox relay, projectors and retention jobs legitimately read across accounts. A trigger protects nothing if the role that hits it can disable it, which any table owner can. The ledger write must share one transaction with the business write: a pick moves stock and releases the reservation together (W-9); a handover writes custody and liability together (D-20).

## Decision

Four PostgreSQL roles, each used by one kind of process:

- `elx_owner` owns every object and is used only by the migration job and the audit-partition job; it is never in an API or worker connection pool.
- `elx_app` is the API and worker role for tenant work: DML on operational tables, only `SELECT, INSERT` on ledger tables, subject to the `tenant_isolation` RLS policy keyed on the transaction-local setting `elx.account_id`, which the unit of work sets with `set_config(…, true)` as the first statement of every transaction.
- `elx_platform` has the same grants and a `platform_access` policy that sees every account. A separate pool, constructed only in the platform module and the worker's system jobs, serves `@CrossTenant()` handlers and cross-tenant jobs (relay, projectors, retention, assertions).
- `elx_maintenance` serves only the per-account export and deletion tool. It may delete ledger rows, and the append-only trigger honours that only when `elx.purge_account` names the row's account.

Ledger writes stay in TypeScript ledger services in the caller's transaction. The single writer is enforced by the module boundary (ledger Drizzle files importable only from the ledger folder, checked by the ADR-0026 architecture test), by withholding `UPDATE`, `DELETE` and `TRUNCATE` from the runtime roles, and by the append-only triggers. No `SECURITY DEFINER` function writes a ledger.

## Consequences

A runtime credential cannot change or remove a ledger row or disable a trigger, even through a bug or an injection. Turning RLS on at the end of wave 1 is one migration, because policies and the session setting exist from wave 0. The platform cross-tenant path is visible in code (a separate pool) and in the database (a separate role). We must provision four roles and their secrets per environment, keep two pools in the API, and choose a managed PostgreSQL that allows role, trigger and policy creation without a superuser. Code outside a transaction has no tenancy context and, once RLS is on, reads nothing; the unit of work makes every database touch transactional.

## Alternatives considered

`SECURITY DEFINER` functions as the only ledger writers: the W-6 and D-20 logic moves into PL/pgSQL, away from the types and tests, and any holder of the runtime role can still call them. A separate role and connection per ledger service: breaks the single transaction that W-9 and D-20 require. One role with `BYPASSRLS` for everything: RLS becomes decoration. A per-request `SET` (not transaction-local) of the account: leaks one request's account into the next over a pooled connection.
