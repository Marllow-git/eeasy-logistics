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
| 2026-11-01 | Two web applications: `apps/web` (merchant, recipient) and `apps/admin` (platform console) on separate hostnames (ADR-0038, order WEB-19). |

## In flight

| Order | Issue | Branch | Worktree | Executor | Stage | Stack | Notes |
|---|---|---|---|---|---|---|---|
| PLAT-6 | #39 | `feat/PLAT-6-request-context-tenancy-guard` | `.claude/worktrees/agent-a8c101e16af461eec` | executor-api (general-purpose Opus run; project agents not loaded in this session) | leg 1 (A–E) built, review round 1 fixed; leg 2 (F–I) built on main `a2f911f`, draft PR #41, awaiting lead review | native, scratch databases | one-way door (migration); adversary required |
| WEB-19 | #43 | `feat/WEB-19-admin-console-scaffold` | `.claude/worktrees/agent-a52dedd898c533aa7` | executor-web (general-purpose Opus run) | review done, final head on CI | none | two-way door; adversary no; owns `PUBLIC_ADMIN_URL` (PLAT-6 leg 2 consumes it) |

## Next unblocked (roadmap §1.1)

PLAT-5 (PR #33) and PLAT-15 (PR #36) are merged. WEB-1 (web shell) is unblocked after WEB-19 and touches disjoint paths from PLAT-6. OPS-1 (depends on PLAT-3, Q-10, Q-12) waits on the owner's go as a one-way door.

**Queued chores, briefed the moment PLAT-6 merges and before PLAT-7 is briefed** (owner OK 2026-11-01). One `executor-api` run, three two-way-door PRs in this order, because each touches paths PLAT-6 holds (`apps/api`, `packages/config`, `packages/db`) and every later wave 0 API order holds them again:
1. `chore/node-24` — roadmap A-14 (due before wave 1 exit): `.nvmrc`, `engines`, `@types/node` 24 in every workspace, both Dockerfiles, CI default Node 24 and the advisory `node-24` job removed.
2. `chore/drop-dotenv` — `packages/config/src/node.ts` parses the env file with Node's `util.parseEnv`; `dotenv` removed.
3. `chore/nest-swc` — `apps/api/nest-cli.json` `"builder": "swc"` with `@swc/cli` and `@swc/core` pinned; `tsc --noEmit` stays the type check.

Then PLAT-7, PLAT-8 and PLAT-10, which follow PLAT-6. PLAT-15 already meets A-17 (strict param, query, header and body schemas with coercion; test-only `mocks` entry points for every surface, the driver included); PLAT-6 item I only adds the `ContractPipe` and the dependency-cruiser rules.

