# ADR-0000: Record architecture decisions as ADRs

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** architecture lead
- **Source:** architecture lead

## Context

The product inherits two months of rulings from the eeasynew Delivery module and the WMS architecture work. Those rulings lived in memory files, plan documents and chat. A new repository needs them in one place, each with its reason, so that a reviewer can tell whether a pull request obeys them and so that a future change is a visible supersession, not a quiet drift.

## Decision

Every decision that constrains more than one pull request is written as an ADR in `adr/`, following `adr/template.md`, numbered in arrival order, and listed in `adr/README.md`. Status is `proposed` until the owner accepts it in the PR that lands it or in a later PR that flips the status. A decision is changed only by a new ADR that supersedes the old one; the old file stays and points forward.

## Consequences

Reviewers cite ADR numbers in review comments. Plan files for orders list the ADRs they rely on. The cost is one short file per decision.

## Alternatives considered

A single architecture document: drifts, cannot be cited by line, and hides which parts the owner actually ruled on.
