# Orders · in-flight ledger

The lead's task ledger (handbook 01). One row per order between **Register** and **Close**. Updated in the same commit as the plan file when an order starts, and removed in the close step. A new lead session reads this file before anything else.

Rules recorded here are owner rulings the pipeline depends on and that the code cannot show.

## Standing rulings

| Date | Ruling |
|---|---|
| 2026-10-31 | Merging is delegated to the lead for wave 0 two-way doors; one-way doors wait for the owner. Lead runs `tools/pr-gate.sh` before every merge. |
| 2026-10-31 | No container runtime on the owner's machine; local verification on the native stack (`tools/native-stack.sh`), Compose only in CI. |
| 2026-10-31 | Haiku researches, Opus builds, Fable reviews (handbook 05). |
| 2026-11-01 | Two web applications: `apps/web` (merchant, recipient) and `apps/admin` (platform console) on separate hostnames (ADR-0038, order WEB-19). |

## In flight

| Order | Issue | Branch | Worktree | Executor | Stage | Stack | Notes |
|---|---|---|---|---|---|---|---|
| PLAT-5 | #27 | `feat/PLAT-5-database-roles-migrations` | `.claude/worktrees/agent-a3cd22022c9f22ac5` | executor-api (general-purpose Opus run, pre-redesign) | review | native, default db | one-way door; adversary required |
| PLAT-15 | #32 | `feat/PLAT-15-contracts-generation` | – | executor-api | plan | none (leg 1) | two-way door; adversary no; leg 2 (.github) after PLAT-5 merges |

## Next unblocked (roadmap §1.1)

PLAT-6 after PLAT-5. OPS-1 is unblocked (depends on PLAT-3, Q-10, Q-12) and waits on the owner's go as a one-way door; it is the next candidate once PLAT-5 or PLAT-15 closes.
