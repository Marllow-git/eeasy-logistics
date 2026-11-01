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
| 2026-11-01 | Two web applications: `apps/web` (merchant, recipient) and `apps/admin` (platform console) on separate hostnames (ADR-0038, order WEB-19). |

## In flight

| Order | Issue | Branch | Worktree | Executor | Stage | Stack | Notes |
|---|---|---|---|---|---|---|---|
| WEB-19 | #43 | `feat/WEB-19-admin-console-scaffold` | `.claude/worktrees/agent-a52dedd898c533aa7` | executor-web (general-purpose Opus run) | review done, final head on CI | none | two-way door; adversary no; owns `PUBLIC_ADMIN_URL` (PLAT-6 leg 2 consumes it) |

## Next unblocked (roadmap §1.1)

PLAT-5 (PR #33) and PLAT-15 (PR #36) are merged. WEB-1 (web shell) is unblocked after WEB-19 and touches disjoint paths from PLAT-6. OPS-1 (depends on PLAT-3, Q-10, Q-12) waits on the owner's go as a one-way door.

CHORE-1 closed 2026-11-01: Node 24 (#52, A-14), `util.parseEnv` instead of `dotenv` (#53), SWC builder (#54); trust-policy fix #55. PLAT-7 is unblocked from the chores side.

Next: PLAT-7, PLAT-8 and PLAT-10, which follow PLAT-6. PLAT-15 already meets A-17 (strict param, query, header and body schemas with coercion; test-only `mocks` entry points for every surface, the driver included); PLAT-6 item I only adds the `ContractPipe` and the dependency-cruiser rules.

