# ADR-0022: Run production as containers on a Gulf-region host, with Compose for development

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner (merged PR #1, 2026-10-31)
- **Source:** foundation plan D4

## Context

Saudi merchants expect their operational data in region. The stack has six long-running pieces (web, API, worker, PostgreSQL, Redis, VROOM) that must also run on a developer's machine.

## Decision

One Compose file defines the full stack for development and the test stack in CI. Production runs the same images as containers on a host in Saudi Arabia or Bahrain, with managed or self-run PostgreSQL and daily off-host backups. Web may also be deployed to an edge platform later without changing the API.

## Consequences

Parity between development, CI and production. The ops runbook is one document. The host choice (provider, managed database or not) is a wave 0 task once this ADR is accepted.

## Alternatives considered

Vercel for web plus a managed API platform: faster to start, data residency unclear, two deployment models to document.
