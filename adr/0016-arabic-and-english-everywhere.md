# ADR-0016: Ship every string in Arabic and English with Gregorian dates and Western digits

- **Status:** accepted
- **Date:** 2026-10-31
- **Deciders:** owner
- **Source:** eeasynew M-3 numerals ruling; census convention

## Context

The product is Arabic-first for Saudi merchants and drivers, with English for staff and integrators. eeasynew ruled Gregorian dates with Western digits in both languages (M-3) and verifies right-to-left layout with a Playwright census per UI PR.

## Decision

Every user-visible string exists in `ar` and `en` from the PR that introduces it; CI fails on a missing key. Dates render Gregorian with Western digits in both languages, Asia/Riyadh timezone. Every UI PR runs a Playwright census in both locales against an isolated stack. Right-to-left is the primary layout reviewed in screenshots.

## Consequences

Design tokens and components are built mirrored from the start. Release notes are written in Arabic for merchants and staff.

## Alternatives considered

Arabic later: retrofitting RTL is the most expensive front-end change there is.
