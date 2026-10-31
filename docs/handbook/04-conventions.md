# 04 · Conventions

## Branches and commits

- `docs/<topic>`, `feat/<order-id>-<slug>`, `fix/<slug>`, `chore/<slug>`.
- One commit per build-list item where practical; imperative subject under 72 characters; body says why.
- Commits end with the co-author line the tooling supplies. Git identity: the repository's configured identity, never a personal default.

## Orders and plan files

- Order ids: `<MODULE>-<N>` (for example `DEL-3`, `WMS-2`, `PLAT-1`), unique across the repository.
- `docs/orders/<ORDER-ID>/plan.md` sections, in order: 0 Goal · 1 Binding rules and ADRs · 2 Decisions (with defaults) · 3 Build list · 4 Commit plan · 5 Exit criteria · 6 Not in this order · 7 Owner questions.
- The plan file is the first commit on the order branch and is linked from the order's issue.

## Issues and labels

- One issue per order. Labels: `module:delivery`, `module:wms`, `module:platform`, `module:driver-app`, `module:web`; `status:planned`, `status:in-progress`, `status:in-review`, `status:halted`; priority `P0` to `P3`.
- Closing an issue states the reason (`completed`, `not planned`) and links the PR.

## Release notes

- `docs/release-notes/YYYY-MM-DD-<slug>.md`, Arabic, written for merchants and staff: what they will see, where, and what to do differently. No code, no table names.
- Required for any PR that changes what a user sees. Not required for technical PRs.

## Internationalisation

- Keys live in `packages/i18n/<locale>/<namespace>.json`, both `ar` and `en` in the same PR.
- Dates: Gregorian, Western digits, Asia/Riyadh. Currency: SAR with the riyal symbol component.
- Arabic is the primary layout; screenshots in reviews are Arabic first.

## API naming

- Resource nouns in plural, kebab-case paths, `snake_case` JSON fields, ISO 8601 timestamps with offset, money as integer halalas plus currency code.
- Typed error model: `{ code, message, details? }` with stable `code` strings documented in the contracts.
- Idempotency through an `Idempotency-Key` header on every write that a client may retry.

## Architecture decision records

- `adr/NNNN-<slug>.md` from `adr/template.md`; status `proposed` until the owner accepts.
- Supersede, never edit a decision: a new ADR points back, the old one points forward.
- Plan files and PRs cite ADRs by number.

## Reference material

- Teardowns and censuses live in `docs/references/<product>/`. Facts carry their date and source; findings that need a login say so.
