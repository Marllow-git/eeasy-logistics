# 01 · Workflow

How an order moves from the roadmap to `main`, and which gate stands between each step. Roles, models and briefs are in handbook 05; this document is the pipeline.

## The pattern in one paragraph

Each order is a **fixed sequential pipeline**: register, plan, build, review, gate, merge, close. The stages never reorder and every stage ends at a gate that a later stage cannot skip. Across orders the lead runs **orchestrator-worker**: it picks the next unblocked orders from the roadmap graph, briefs one executor per order in its own worktree, and owns the plan file, the PR and the report. Review is a **maker-checker loop with a round cap**: executor drafts, the lead and the adversary check against written criteria, the executor fixes, and after the cap the owner decides. Nothing else is used: no supervisors between lead and executors, no agent-to-agent handoff of an order, no open discussion rounds.

## Stages and gates

| # | Stage | Who | Gate to the next stage | Gate enforced by |
|---|---|---|---|---|
| 1 | **Register** | lead | The order is a roadmap row; every `Depends on` order is merged; no in-flight order conflicts with it (section "Running orders in parallel"); a GitHub issue exists with the module and `status:planned` labels. | lead, against `docs/orders/README.md` |
| 2 | **Research** (only when the plan needs a fact the documents do not hold) | researcher | A dated, sourced note under `docs/research/`; questions it could not answer listed. | lead reads it before planning |
| 3 | **Plan** | lead | `docs/orders/<ID>/plan.md` with sections 0 to 7 (handbook 04) as the first commit on `feat/<ID>-<slug>`, pushed; every open owner question is a row with a provisional default; the owner has said go if the order is a one-way door or changes a register default. | lead; owner for one-way doors |
| 4 | **Build** | executor | Every build-list item is a commit and a row in the §8.0 progress table, committed with it; §8.1 to §8.3 filled; targeted tests green locally with counts; red-then-green shown for behaviour changes; PR opened as draft with the template filled. A leg (handbook 04) ends when its items are in the table; the next leg is a fresh executor on the same branch. | executor report; lead checks §8 against the diff |
| 5 | **Lead review** | lead | `/code-review` on the diff, findings fixed by the executor, at most **two rounds**. | lead |
| 6 | **Adversary** (only when the roadmap row says `Adv. yes`) | adversary | Verdict recorded in plan §9: no critical or high open, medium and low fixed or ruled with a reason. **One pass, one re-check** of the fixes, no more. | adversary verdict; lead records |
| 7 | **PR gate** | script | `tools/pr-gate.sh <PR>` passes: head has implementation commits beyond the plan, CI green on every check, §8 and §9 present when required, release note present when user-visible paths changed, PR body sections present. | `tools/pr-gate.sh` |
| 8 | **Merge** | owner, or the lead when the owner has delegated merging in writing | Gate 7 passed on the exact head SHA that is merged. | owner or lead |
| 9 | **Close** | lead | Issue closed with reason and PR link; worktree removed; ledger row removed; `.serena/memories/` checked against the merged diff (`memory_upkeep` triggers); the next unblocked order registered. | lead |

A stage that fails its gate goes back one stage, never forward. If a stage fails its gate twice, the lead reports to the owner instead of trying a third time.

## Running orders in parallel

Parallelism is **across** orders, never inside one. Two orders may be in flight at the same time when all three hold:

1. Neither is an ancestor of the other in the roadmap graph (`docs/roadmap.md` mermaid blocks).
2. Their build lists touch disjoint top-level paths (`apps/<name>`, `packages/<name>`, `tools`, `.github`). `packages/contracts` and `packages/db` are shared seams: two orders that both change them run one after the other.
3. A stack pair (`stack-a`, `stack-b` ports from PLAT-2, or the two native-stack database names) is free for each.

Hard cap: **two executors in flight**, plus any number of researchers, which only write under `docs/research/`. The lead records every in-flight order in `docs/orders/README.md` before briefing and removes it at close. That file, not session memory, is the task ledger; a new lead session reads it first.

While an executor builds, the lead does not wait. It registers and plans the next unblocked order, reviews a finished one, or writes an owed ADR. It never edits an executor's worktree.

## Round caps and escalation

- Lead review: two rounds. Adversary: one pass and one re-check.
- An executor that cannot finish an item records the blocker in plan §8.3 and stops. The lead either re-briefs a fresh executor with that §8 or asks the owner. The lead does not finish the item itself.
- Anything that would change a register default (roadmap §4), supersede an ADR, or open a one-way door stops at the lead and goes to the owner as a question with a recommendation. Executors never answer owner questions; they record an interpretation in §8.2 and build on the default.

## Context

The repository is the context store. Every agent reads a named slice of it and writes its result back to it; chat carries verdicts and ten-line reports, nothing else.

- **Checkpoint per item.** The executor commits the §8.0 progress row with each build item. A replacement executor resumes from the branch and the plan with no chat history.
- **Legs.** An executor run covers at most five build items. The lead splits larger orders into legs at plan time; each leg is a fresh agent, same branch, same PR.
- **Sections, not documents.** Plan §1 names file and heading; executors read only those, through `Read` with an offset or Serena symbol tools. Documentation is fetched per item when the item needs it, after the surface's skill is loaded once at the start.
- **The lead reads tables, not diffs.** Gate output, PR body, §8, §9 and the adversary table. Code review runs in a fresh subagent (`/code-review` or `adversary`), never a fork, so the diff and tool output stay out of the lead's window.
- **Summary first.** Research notes open with "Summary for the lead", ten lines at most. Adversary output is the table, then the verdict.
- **Quiet output.** Executors run tests with a summary reporter and record counts; they do not stream full logs into their window.
- **Session start.** The lead reads `docs/orders/README.md`, the open PR list and the roadmap rows of in-flight orders, then nothing else until a task needs it. After a context compaction the lead re-reads the ledger instead of trusting the summary. Memory files hold owner rulings only.
- **Shared project knowledge.** `.serena/memories/` is tracked so every worktree starts with the same codebase notes. Memories are updated **in the PR that makes them true**, never later: the trigger list is the memory `memory_upkeep` (scripts, CI lanes, version pins, new modules or packages, lint or architecture rules, plan-file conventions, a rediscovery that cost real time). The executor updates them in the finishing step of a leg; the lead checks at close. `tools/pr-gate.sh` fails when a trigger path changed and the PR neither touches `.serena/memories/` nor says `Memories: unchanged` in its body. Order state and owner rulings are never memories; they live in `docs/orders/README.md`.

## Merging

The owner merges. The owner may delegate merging to the lead in writing (chat ruling recorded in the ledger file); the delegation covers two-way doors only unless it says otherwise. Whoever merges runs `tools/pr-gate.sh` on the PR first and merges the SHA it reported. After merge: `git worktree remove` for the order's worktree, `git worktree prune`, close the issue, update the ledger.

## PR description

The template is `.github/pull_request_template.md`; the gate script checks that its headings are present. Two body lines carry waivers the gate script reads: `Memories: unchanged` (no memory trigger applies) and `Release note: none <reason>` (app source changed but nothing is user-visible). The four sections: **What** (plan items delivered, ADRs relied on), **How verified** (exact commands and counts, red-then-green), **Merge danger** (two-way or one-way door, blast radius), **Skipped / not checked**.

## Stopping

A finished subagent is stopped as soon as its report is read. An order the owner halts gets `status:halted` on its issue and a status line in its plan file the same day; its worktree stays until the owner says otherwise.
