# AGENTS.md — eeasy-logistics

Standalone last-mile delivery and WMS product for merchants with their own drivers and stock. Monorepo: Next.js web (`apps/web`), NestJS API (`apps/api`), Expo driver app (`apps/driver`), shared packages. **Phase: architecture — docs only until the owner approves the foundation package (`docs/README.md`).**

Long form: `docs/handbook/`. Decisions: `adr/`. Only remote: `github.com/Marllow-git/eeasy-logistics`, default branch `main`.

## Workflow

1. **Discuss first, then build.** For anything non-trivial, state what changes, where, and the risk in a few lines; get the owner's OK before editing. Trivial fixes: do them and report.
2. **Branch + PR.** `docs/…`, `feat/…`, `fix/…`, `chore/…`. Never commit to `main`. The PR says what changed, how it was verified, and one line of **merge danger**: two-way door (a revert undoes it) or one-way door (migration, data rewrite, money, external registration), plus blast radius. The owner merges.
3. **One task, one PR.** No bundling.
4. **Verify before reporting done.** Done means tested, not written. Never claim a test ran if it did not.
5. **Report briefly** in English: what changed, what was verified, what is left or risky. Code, commits, docs in English. Release notes in Arabic.
6. **Release note with every visible change**: `docs/release-notes/YYYY-MM-DD-<slug>.md`, Arabic, business language. Purely technical PRs ship none.
7. **Cite ADRs.** A plan file or PR that touches an area an ADR governs names the ADR. Changing a decision means a new ADR that supersedes the old one, never a quiet drift.

## Testing (once code exists)

- API: unit tests plus integration tests against a real PostgreSQL in Compose; behaviour changes ship with a test that fails without the fix.
- Web and driver app: typecheck, lint, unit tests, and a Playwright census in Arabic and English for every UI change, run against an isolated stack.
- CI runs all of it on every PR push; a PR merges only when every check is green. Executors run the tests of their own change locally and leave the full lanes to CI.
- Never delete or weaken an existing test to make something pass.

## Hard rules

- **Ledgers are append-only.** Stock movements, cash custody and driver liability entries are never updated or deleted; projections are rebuilt from them. No query-builder writes to ledger tables outside the ledger services.
- **Tenancy is structural.** Every operational row carries `account_id`; the account comes from the token, never from a request parameter.
- **Side effects go through the outbox.** No controller or service calls an external system directly.
- **Allowlist by default.** New modules and risky features ship behind a rollout mode, default `allowlist`, with the admin provisioning door.
- **Own fleets only.** Nothing is built on the executor-fleet seam.
- **Arabic and English** for every string; Gregorian dates, Western digits.
- **Secrets never in code or commits.** Configuration through the config module, never raw environment reads outside it.
- **No production actions** (deploy, data change, live credentials) without explicit owner instruction.
- Clean up after yourself: stop servers and browsers you started, remove scratch dirs, stop finished subagents.

## Sizing a change

Read the code the task touches, list every caller, test, fixture, config and i18n key it reaches; that is the scope. Take the first rung that fully solves it: does it need to exist; is it already in the codebase; is it a platform feature; is it an installed dependency; can it be one line; otherwise the minimum that works plus the required test. No abstraction, wrapper, flag or DTO nobody asked for. Never cut validation at trust boundaries, error handling, security, ledger invariants, accessibility, or anything the owner asked for. End every report with what you skipped or did not check and the risk the reviewer must know.
