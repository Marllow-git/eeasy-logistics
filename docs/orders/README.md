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
| 2026-11-01 | Two web applications: `apps/web` (merchant, recipient) and `apps/admin` (platform console) on separate hostnames (ADR-0038, order WEB-19). |

## In flight

| Order | Issue | Branch | Worktree | Executor | Stage | Stack | Notes |
|---|---|---|---|---|---|---|---|
| PLAT-7 | #58 | `feat/PLAT-7-audit-log` | `.claude/worktrees/agent-a34090733becbfb52` | executor-api (Opus) | review | none | one-way door; adversary required; one leg (A–E), draft PR #61 |
| PLAT-8 | #59 | `feat/PLAT-8-outbox-relay-queues` | – | – | plan; brief after PLAT-7 closes | none | one-way door; adversary required; three legs |

## Next unblocked (roadmap §1.1)

PLAT-5 (PR #33) and PLAT-15 (PR #36) are merged. WEB-19 closed (PR #45); WEB-1 in flight; WEB-2 follows WEB-1 and PLAT-11 and touches disjoint paths from PLAT-6. OPS-1 (depends on PLAT-3, Q-10, Q-12) waits on the owner's go as a one-way door.

CHORE-1 closed 2026-11-01: Node 24 (#52, A-14), `util.parseEnv` instead of `dotenv` (#53), SWC builder (#54); trust-policy fix #55. PLAT-7 is unblocked from the chores side.

Next: PLAT-7, PLAT-8 and PLAT-10, which follow PLAT-6. PLAT-15 already meets A-17 (strict param, query, header and body schemas with coercion; test-only `mocks` entry points for every surface, the driver included); PLAT-6 item I only adds the `ContractPipe` and the dependency-cruiser rules.

