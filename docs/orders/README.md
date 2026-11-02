# Orders · in-flight ledger

The lead's task ledger (handbook 01). One row per order between **Register** and **Close**. Updated in the same commit as the plan file when an order starts, and removed in the close step. A new lead session reads this file before anything else.

Rules recorded here are owner rulings the pipeline depends on and that the code cannot show.

## Standing rulings

| Date | Ruling |
|---|---|
| 2026-10-31 | Merging is delegated to the lead for wave 0 two-way doors; one-way doors wait for the owner. Lead runs `tools/pr-gate.sh` before every merge. |
| 2026-10-31 | No container runtime on the owner's machine; local verification on the native stack (`tools/native-stack.sh`), Compose only in CI. |
| 2026-10-31 | Haiku researches, Opus builds, Fable reviews (handbook 05). |
| 2026-11-01 | Owner, on the PLAT-5 gate report: "continue, you are the lead" — read as delegation to merge one-way doors after `tools/pr-gate.sh` passes, with the SHA reported; the lead still stops for a question that changes a register default or supersedes an ADR. |
| 2026-11-01 | Adversary re-check runs only when the first pass found a critical or high; mediums and lows are fixed and ruled by the lead without a second run (handbook 01 stage 6). |
| 2026-11-01 | `main.yml` no longer re-runs the seven PR checks on push to `main`; it builds, scans and pushes the images only. The gate's green-on-exact-head rule and path-disjoint in-flight orders cover the window. |
| 2026-11-01 | Mobbin MCP is the design-reference source: every UI order gets `docs/references/design/<ORDER>.md` with Mobbin links before its brief (handbook 04 "Design references"); web, driver executors and the researcher carry the `mcp__mobbin__*` tools. |
| 2026-11-01 | VROOM, Valkey and the other routing and map infrastructure are set up last (roadmap A-24): no Valkey switch in PLAT-8, INT-5 and INT-6 at the end of their waves, Q-19 and Q-45 ruled last. |
| 2026-11-01 | While GitHub Actions is blocked by the organisation's billing, the owner allows a merge on a full local gate (typecheck, lint, unit, format, audit, integration in both RLS lanes) recorded in the plan §9; applied to PLAT-8 (PR #63). |
| 2026-11-01 | The repository is public from 2026-11-01 so GitHub Actions minutes are unlimited after the Free plan's 2,000 private minutes ran out in one day; the owner returns it to private in a few days. Consequences: GHCR packages stay private; nothing in the history holds a secret (gitleaks full-history scan on every PR); pull requests from forks get read-only tokens. The local-gate waiver above applies only while Actions is blocked. |
| 2026-11-01 | Two web applications: `apps/web` (merchant, recipient) and `apps/admin` (platform console) on separate hostnames (ADR-0038, order WEB-19). |
| 2026-11-02 | Owner, on "if it doesn't depend on PLAT-12 we can execute PLAT-13 or any other next PLAT": a third executor may run beside the two of handbook 01 when its order depends on nothing in flight and its build list shares no file with the in-flight orders (file-level disjointness inside `apps/api` is accepted for it; `packages/contracts` and `packages/db` stay one-at-a-time seams). Applied to INT-4 beside PLAT-12 and WEB-2. PLAT-13 waits for PLAT-12 (it writes PLAT-12's tables). |
| 2026-11-02 | Owner: the adversary pass runs on Opus for every PR (token cost); the lead review stays on Fable, so every change still gets one Fable read. `.claude/agents/adversary.md` and handbook 05 updated. |

## In flight

| Order | Issue | Branch | Worktree | Executor | Stage | Stack | Notes |
|---|---|---|---|---|---|---|---|
| WEB-4 | #121 | `feat/WEB-4-platform-console` | executor worktree | executor-web (Opus) | build, leg 1 (A–C) | native stack with the API on a scratch port (PLAT-13 doors), the worker, Mailpit, `seed:census` | two-way door; adversary required (Opus); two legs; plan `docs/orders/WEB-4/plan.md` (PR #119); design references `docs/references/design/WEB-4.md` (PR #118); registered 2026-11-02 after PLAT-13 (#104) and WEB-3 (#109) merged |
| DEL-2 | #134 | `feat/DEL-2-orders-intake` | executor worktree | executor-api (Opus) | build, leg 1 (A–C) | native, scratch databases (PostGIS), Redis, the geocoder stub | one-way door (one migration: `del_orders`, `del_order_items`, `del_order_events`, `core_sequences`); adversary required (Opus); two legs; second executor beside WEB-4 and DRV-1 (files disjoint: `apps/api` delivery orders and the kernel sequences against `apps/admin` and `apps/driver`); plan `docs/orders/DEL-2/plan.md` (PR #133); registered 2026-11-02 |
| DRV-1 | #130 | `feat/DRV-1-app-shell-sign-in` | executor worktree | executor-driver (Opus) | build, leg 1 (A–C) | native stack with the API on a scratch port (DEL-4 doors), the WhatsApp stub, Mailpit; the iOS simulator and the Android emulator through the device tools | two-way door; adversary required (Opus); two legs; third executor under the ruling of 2026-11-02 (files disjoint from WEB-4 and DEL-1: `apps/driver`, the `driver` i18n namespace); plan `docs/orders/DRV-1/plan.md` (PR #127); design references `docs/references/design/DRV-1.md` (PR #128); registered 2026-11-02 |

## Next unblocked (roadmap §1.1)

WEB-5 and WEB-6 after WEB-3 (merged) and their DEL orders; DEL-5 after DEL-4 (merged, PR #114) and Q-5; DRV-5 after DRV-4 (INT-4 merged, PR #93); OPS-1 waits on the owner\'s go (Q-10, Q-12).

Proposed chores awaiting the owner's go (2026-11-02): gate flakes (`redact.test.ts` timing, the admin census analytics event and single-flight count); a scratch-stack helper (`tools/native-stack.sh scratch <name>`); idle-in-transaction and statement timeouts on the pools (raised by the PLAT-13 and DEL-4 adversary runs); the global error document importing the whole i18n catalogue (WEB-3 8.3 #2); the chain-deadline timer race in `chain-geocoder.test.ts` (INT-2 §9 addendum: stop the chain when the deadline fires); a weekly digest of open owner questions.
