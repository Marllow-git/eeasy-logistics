# ARCH-1 · Complete the foundation package

- **Status:** done pending owner review
- **Date:** 2026-10-31
- **Owner ruling:** "create goal for these and complete the docs; skip the login-gated censuses currently" (2026-10-31)
- **Lead:** architecture lead (Fable). **Executors:** Opus, one per document, each in its own worktree. **Research:** Haiku.

## 0. Goal

Every document in `docs/README.md` exists and is in review or approved, so that wave 0 (scaffold) can be planned. After this order the foundation index has no row marked `not started` except the login-gated censuses, which are explicitly deferred.

## 1. Binding rules and ADRs

- `AGENTS.md` hard rules; handbook 01 (workflow), 02 (definition of done, "Documentation change"), 04 (conventions: API naming, ADR rules).
- ADR-0001 to ADR-0025 (accepted) and the proposed ADR-0026 to ADR-0028 from PR #5. A document that needs a new decision proposes a new ADR; it never edits an existing one.
- The domain model (document 2, PR #5) is the vocabulary: aggregate names, state machines, invariants K-/D-/W-, the event catalogue and envelope. Contracts and later documents cite it; they do not redefine it.
- Identity and tenancy (document 4) and the platform blueprint (document 6) are approved; later documents reference them and do not repeat them.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Contract format | OpenAPI 3.1 YAML, one file per surface: `staff` (web app), `driver`, `public` (integrators), `recipient` (token pages), `platform` (admin). Shared components in `components.yaml`. Webhooks in `webhooks.md` derived from the domain event catalogue. |
| 2.2 | Contract depth | Every resource and operation named, with request and response schemas for the wave 0 to 2 surfaces (Delivery) in full and WMS (wave 3) at resource and operation level with schemas for the aggregates the domain model defines. |
| 2.3 | Versioning | Path prefix `/v1`; additive changes do not bump; breaking changes add `/v2` beside `/v1` for one wave (mirrors ADR-0027). |
| 2.4 | Error model | `{ code, message, details? }` (handbook 04), with the code list in `docs/contracts/errors.md`. |
| 2.5 | Data architecture | Drizzle schema conventions, table list per context with prefixes from ADR-0026, ledger triggers, projections, RLS plan, PII inventory, retention, migration workflow (expand and contract), reporting views. No DDL beyond illustrative snippets. |
| 2.6 | Web app architecture | Next.js App Router, route groups per surface, server components by default, data access through `packages/contracts` clients, SSE hook, i18n with `ar` default and RTL, design system in `packages/ui`, census strategy. |
| 2.7 | Driver app architecture | Expo Router, SQLite outbox (ADR-0008), background location task (ADR-0009, ADR-0028), push, secure token storage, sync screen, proof upload queue, offline-first screens per the field loop. |
| 2.8 | Integration architecture | One port and adapter per external system from the domain model's port table: Eeasy shipping, Salla, Zid, Hudhud, VROOM, OSRM fallback, WhatsApp, Expo push, object storage; inbound webhook verification; outbox kinds and worker queues; sandbox and stub strategy per environment. |
| 2.9 | Roadmap | Waves 0 to 4 from the foundation plan, expanded into orders with ids (`PLAT-n`, `DEL-n`, `WMS-n`, `DRV-n`, `WEB-n`), dependencies, exit criteria and the owner decisions each wave needs. |
| 2.10 | Index updates | Each document PR updates its own row in `docs/README.md` (handbook 02). PRs are stacked; the lead resolves the adjacent-line conflicts when stacking. |

## 3. Build list

| Item | Document | Executor | Depends on |
|---|---|---|---|
| A | Plan file (this), issue | lead | – |
| B | 3 · API contracts: `docs/contracts/` | Opus | PR #5 |
| C | 5 · Data architecture: `docs/architecture/data.md` | Opus | B |
| D | 7 · Web app architecture: `docs/architecture/web.md` | Opus | B |
| E | 8 · Driver app architecture: `docs/architecture/driver-app.md` | Opus | B |
| F | 9 · Integration architecture: `docs/architecture/integrations.md` | Opus | B |
| G | 12 · Roadmap: `docs/roadmap.md`; close this plan | Opus | C, D, E, F |

C to F run in parallel from B's branch. The lead reviews every document before its PR opens.

## 4. Commit plan

One branch and one PR per item, stacked on the previous: `docs/arch-1-contracts` → `docs/arch-1-data`, `docs/arch-1-web`, `docs/arch-1-driver-app`, `docs/arch-1-integrations` → `docs/arch-1-roadmap`. Each PR: the document, any new ADR with its index row, the document's row in `docs/README.md`.

## 5. Exit criteria

- `docs/README.md` rows 3, 5, 7, 8, 9 and 12 are `in review (PR #n)` or `approved`.
- Every new ADR is `proposed` with an index row.
- Every document cites the ADRs it relies on and the domain model by section.
- No document redefines an aggregate, state or invariant from the domain model.

## 6. Not in this order

- Login-gated censuses: Logestechs admin portal, OTO Flex screens, Bolesa 2 re-audit (owner ruling 2026-10-31: skipped for now; remain listed as owed in `docs/references/README.md`).
- Any application code, scaffold or CI configuration (wave 0).
- Acceptance of proposed ADRs (the owner rules on merge or in review).

## 7. Owner questions

1. Public API shape: Logestechs-style static `X-API-Key` (plan section 9) is the default; OTO's one-hour bearer tokens are the alternative. Default stands unless you object.
2. Should the public API expose WMS resources in `/v1` from wave 4, or only Delivery until the WMS has a pilot? Default: Delivery only in the first public release; WMS paths marked `x-wave: 4`.

## 8. Outcome

| Item | Document | PR |
|---|---|---|
| A | Plan file (this), issue | – |
| B | 3 · API contracts: `docs/contracts/` | PR #12 |
| C | 5 · Data architecture: `docs/architecture/data.md` | PR #11 |
| D | 7 · Web app architecture: `docs/architecture/web.md` | PR #10 |
| E | 8 · Driver app architecture: `docs/architecture/driver-app.md` | PR #8 |
| F | 9 · Integration architecture: `docs/architecture/integrations.md` | PR #9 |
| G | 12 · Roadmap: `docs/roadmap.md`; this plan closed | PR #13 |

Proposed ADRs from this order: 0029 and 0030 (B), 0031 (C), 0032 and 0033 (D), 0034 and 0035 (E), 0036 and 0037 (F). The owner questions of section 7, and every open question of the foundation documents, are consolidated in the roadmap's decision register (`docs/roadmap.md` §4; section 7 is Q-13 and Q-14).
