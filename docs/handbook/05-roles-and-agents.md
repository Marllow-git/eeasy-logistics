# 05 · Roles and agents

How agent work is organised, carried over from eeasynew and adjusted for this repository.

## Lead session

Acts as architecture lead. Discusses first, registers orders, writes plan files, briefs executors, relays results to the owner, records decisions as ADRs. Does not merge. Keeps a memory of in-flight orders and checks every proposal against it.

## Executors

One Opus agent per order, briefed with the plan file, the ADRs it cites and the worktree path. It builds, tests its own change, opens the PR, and reports: what shipped, exact verification counts, deviations from the plan, what was not checked. It never merges and never touches the shared development database. It is stopped as soon as it reports.

## Adversary

A read-only security reviewer run once per PR that touches authentication, tokens, authorization or visibility rules, cash or stock ledgers, payments, or exposure of private data. Reports findings by severity with a fix recommendation. The lead rules on medium and low findings and records the ruling in the PR; critical and high are fixed before the PR is presented.

## Census

Playwright in Arabic and English on an isolated stack for every UI PR. The executor adds or extends the census spec in the same PR and fixes what the census finds there.

## Isolation rules

- Each executor has its own worktree and, when it needs a database, its own clone; port pairs are assigned per worktree so two executors can run stacks at once.
- Nobody migrates the shared development database.
- Nobody deploys, changes live credentials or touches production data without the owner's explicit instruction.

## Reporting to the owner

English, brief, outcome first: what changed, what was verified with counts, deviations, risk, what is left. Arabic only in release notes.
