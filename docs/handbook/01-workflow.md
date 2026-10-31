# 01 · Workflow

How a piece of work moves from idea to merged, and who does what at each step.

## Roles

| Role | Who | Does |
|---|---|---|
| Owner | the product owner | Rules on scope and decisions, answers plan-file questions, merges every PR, authorises production actions. |
| Architecture lead | the lead agent session | Writes ADRs and architecture documents, registers orders, writes plan files, briefs executors, relays results, never merges. |
| Executor | an Opus agent per order, in its own worktree | Builds one order from its plan file, runs the targeted tests, opens the PR, never merges. |
| Adversary | a read-only security reviewer | Reviews a PR's diff once when it touches auth, tokens, authorization, visibility, cash or stock ledgers, or private data. |
| Census | Playwright suites in Arabic and English | Verifies every UI change on an isolated stack. |

## The order lifecycle

1. **Proposal.** Someone states the need in a few lines. The architecture lead checks it against open orders and in-flight PRs (a request may already be registered).
2. **Discussion.** The lead states what changes, where, and the risk; the owner says go, or changes the shape.
3. **Plan file.** `docs/orders/<ORDER-ID>/plan.md`: goal, binding rules and ADRs, decisions with defaults, build list, commit plan, exit criteria, what is not in the order, owner questions. Committed first on the order branch.
4. **Issue.** One GitHub issue per order, linking the plan file, carrying the module label and a status label.
5. **Build.** An executor works the plan in its own git worktree, one commit per build-list item, targeted tests after each.
6. **Review gate.** Adversary review when the trigger list applies; one pass per PR, repeated only if the first pass found critical or high.
7. **PR.** Description per the template below. CI green on every check.
8. **Owner merges.** Nobody else. After merge the worktree is removed and the issue closed.

## PR description template

```
## What
One paragraph. Which plan-file items this delivers; which ADRs it relies on.

## How verified
Exact commands and counts: unit N green, integration M green, census EN+AR K/K on isolated stack, typecheck and lint pass. Red-then-green for behaviour changes.

## Merge danger
Two-way door | one-way door (why). Blast radius: who notices if it is wrong.

## Skipped / not checked
One or two lines. Risk the reviewer must know.
```

## Worktrees

Every executor runs in its own worktree (`../eeasy-logistics-<order>`), never in the main checkout. A worktree is removed after its PR merges, never before the owner says so if the PR is still open.

## Stopping

A finished subagent is stopped immediately. An order that the owner halts is recorded as halted in its issue and plan file the same day.
