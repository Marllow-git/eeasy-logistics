# 05 · Roles and agents

Who does what, on which model, with which inputs and outputs. The pipeline these roles run is handbook 01. Agent definitions live in `.claude/agents/` at the repository root and override any same-named global agent; the owner's global `~/.claude/agents/` files belong to another product and are not used here.

## The model rule

Owner rule of 2026-10-31: **Haiku researches, Opus builds, Fable reviews.** The agent files below pin a default; the lead may pass a model override at spawn time only in the cases the recommendation column names.

| Role | Agent file | Default model | Recommended override | Writes | Never |
|---|---|---|---|---|---|
| Owner | – (a person) | – | – | rulings, merges | – |
| Lead | the main session | Fable | – | plan files, ADRs, ledger, PR review rulings, reports | merges without delegation; edits an executor's worktree; builds an order itself |
| Researcher | `researcher` | Haiku | Sonnet for a census or teardown that needs judgement about what matters (reference products, provider comparisons); Haiku for lookups and fact checks | `docs/research/*.md` only | touches code or plan files |
| Executor, API | `executor-api` | Opus | none; API orders carry tenancy, ledger and auth risk | its order branch, in its worktree | merges; edits `main`; answers owner questions; touches the shared dev database |
| Executor, web | `executor-web` | Opus | Sonnet for an order whose roadmap row says `Adv. no`, whose plan has no open §7 question and whose items are screens over existing contracts | same | same |
| Executor, driver app | `executor-driver` | Opus | same rule as web | same | same |
| Adversary | `adversary` | Fable | none | nothing; returns a verdict | fixes code |
| Code review | `/code-review` subagent | Fable | Opus at `medium` for docs-only or chore PRs | findings | – |
| Sweeps | `Explore` agent | Haiku | – | nothing | – |
| Census | Playwright in CI, `ar` and `en` | – | – | – | – |

Why these: review needs the strongest judgement and runs on small inputs, so Fable is cheap there. Execution on the API touches every hard rule, so it stays on Opus without exception. Well-specified UI legs and research lookups are high-volume and low-ambiguity, where Sonnet and Haiku cost less and lose nothing measurable; the plan quality, not the model, decides those. The lead records every override in the ledger row.

## The lead

Reads `docs/orders/README.md` and the roadmap at session start, then runs the pipeline of handbook 01. It writes every plan file itself because the plan is where decisions are fixed; it does not write code or long documents, which go to an executor. It keeps the ledger current before and after every delegation. It reviews with `/code-review` and reads plan §8 against the diff before accepting a build.

## The executor brief

The lead's brief to an executor is the only context the executor has, so every brief carries the same list:

1. Order id, plan path, branch name, the leg (which build items) and the instruction to `git fetch` and check out the order branch inside its worktree (a harness worktree starts from `main`). A second or later leg says: read §8.0 first, continue from the first item without a row.
2. The ADRs and document sections the plan's §1 cites, by path and heading; the executor reads those sections and nothing more of the foundation package.
3. The stack it may use: native stack per `tools/native-stack.sh` and the database name or port pair assigned; CI is the authority for Compose.
4. Skills to load first and the rule to record versions and dates consulted in §8.1.
5. The Serena rule: activate the project and prefer symbol tools for code reading and edits.
6. What to return: a §8.0 progress row committed with every item, §8.1 to §8.3 filled at the end of the leg, a draft PR from the template (first leg) or a pushed branch (later legs), and a report of at most ten lines (shipped, verification counts, deviations, not checked). Nothing else.
7. What stops it: an owner question it cannot build around (record in §8.3 and stop), or a gate it fails twice.

## The adversary brief

Branch, PR number, plan path, and the trigger that applied (auth, tokens, authorization or visibility, cash or stock ledgers, payments, private data). The adversary reads the diff and the code paths it touches, uses the project's hard rules as criteria (tenancy from the token, append-only ledgers, outbox for side effects, allowlist rollout, config module only, AR and EN strings), and returns findings by severity with a concrete abuse scenario and a fix, then **PASS** or **CHANGES REQUIRED**. The lead copies the table into plan §9 and the executor fixes critical and high before the re-check, which runs only when the pass found one. Medium and low are fixed or ruled by the lead with the reason in §9 and get no second adversary run.

## The researcher brief

The question, the documents already consulted, where to write (`docs/research/<slug>.md`), and the rule that the note opens with a ten-line "Summary for the lead", that every fact carries a date and a source URL, and that unanswered parts are listed at the end. A researcher never opens a PR; the lead folds the note into its own docs branch.

## Isolation

- One worktree per executor, created by the harness under `.claude/worktrees/`; the lead records the path in the ledger. Nobody but that executor writes there.
- Databases: each executor gets its own database name on the native stack, or its own stack pair in CI; nobody migrates the shared development database.
- Researchers run without a worktree and without write tools outside `docs/research/`.
- `.serena/memories/` is tracked in git so every worktree carries the same project notes; executors add to it when they learn something a later order needs.
- No deploy, live credential or production data action without the owner's explicit instruction, for every role.

## Reporting to the owner

English, outcome first, under ten lines: what changed, what was verified with counts, deviations from the plan, risk, what is left. Arabic only in release notes.
