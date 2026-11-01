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
| 2026-11-01 | Two web applications: `apps/web` (merchant, recipient) and `apps/admin` (platform console) on separate hostnames (ADR-0038, order WEB-19). |

## In flight

| Order | Issue | Branch | Worktree | Executor | Stage | Stack | Notes |
|---|---|---|---|---|---|---|---|
| PLAT-8 | #59 | `feat/PLAT-8-outbox-relay-queues` | `.claude/worktrees/agent-ad40d4c687630541a` | executor-api (Opus) | build, leg 1 (A–C) | native, scratch databases, scratch Redis db index | one-way door (migration 0007); adversary required; three legs |

## Next unblocked (roadmap §1.1)

PLAT-10 (roles) follows PLAT-8 on the API side; WEB-2 follows PLAT-11; OPS-1 waits on the owner's go (one-way door; Q-10, Q-12).
