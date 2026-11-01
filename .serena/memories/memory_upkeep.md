# When to update these memories

Memories are tracked in git (`.serena/memories/`), so they travel with the PR that makes them true.

## Triggers (update in the same PR)
- A script in any `package.json`, `tools/*.sh`, or a CI lane in `.github/workflows` is added, renamed or changes meaning → `mem:suggested_commands`, `mem:task_completion`.
- A version pin that matters moves (Node, pnpm, TypeScript, Next, Expo SDK, NestJS, PostgreSQL) → `mem:tech_stack`.
- A new top-level directory, module, bounded context, package or entry point → `mem:core` source map and the module `mem:<module>/core`.
- A hard rule, lint rule or architecture test is added or changed → `mem:core` invariants, `mem:conventions`.
- A plan-file, branch, commit or PR convention changes (handbook 04) → `mem:conventions`.
- An executor discovers a non-obvious fact that cost real rediscovery (a bundler quirk, a test harness trap, a port or role name) → the relevant module memory; one bullet, dated only if it may expire.

## Not a memory
Order status, in-flight work, owner rulings → `docs/orders/README.md`. Decisions → `adr/`. Anything derivable from a file in under a minute.

## Who and when
- Executor: in the finishing step of a leg (plan §8), before the PR leaves draft.
- Lead: at the close step of every order, diff the merged PR against the trigger list above; `tools/pr-gate.sh` fails when a trigger path changed and neither `.serena/memories/` nor a `Memories: unchanged` line in the PR body is present.
- Anyone: run `serena memories check` from the repo root after deleting or renaming a memory.
