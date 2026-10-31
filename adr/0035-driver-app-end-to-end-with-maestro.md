# ADR-0035: Run the driver app's end-to-end flows and census with Maestro

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** driver app architecture (document 8) §12.2; AGENTS.md testing; handbook 03; ADR-0016, ADR-0021

## Context

AGENTS.md asks for a Playwright census in Arabic and English for every UI change, and handbook 03 lists the driver app "end-to-end where feasible". Playwright drives browsers and cannot drive a native iOS or Android app. The driver app's riskiest behaviour (offline delivery, replay, proof upload, the sync screen) only shows end to end on a device, and it is an Expo-managed app that should not carry native test scaffolding through every SDK upgrade.

## Decision

`apps/driver` uses Maestro for end-to-end flows and its census. Flows are YAML under `apps/driver/e2e/`, run against a `preview`-profile build pointed at the isolated stack of handbook 03, in `ar` and `en`, with screenshots kept as artifacts, Arabic first. Network loss is produced by a Toxiproxy between the app and the API so offline cases behave the same on both platforms. Android flows run on pull requests that touch `apps/driver` or `driver.yaml`; iOS flows run nightly and before every store submission. Typecheck and unit tests stay in the `driver-test` lane.

## Consequences

The census rule has a native equivalent; the field loop is exercised offline on both platforms. Flows are black-box and survive SDK upgrades without test-side changes. Maestro steps are slower than Detox's and wait by polling the UI, so flows need explicit waits on visible state rather than timing. iOS on pull requests is deferred to save macOS runner time, so an iOS-only regression may surface a night later.

## Alternatives considered

Detox: faster and synchronised with the JS thread, but needs per-platform native build configuration and a Jest harness that tracks React Native internals, the maintenance an Expo-managed app avoids. Playwright on Expo's web target: tests a platform the app does not ship on and misses camera, location, SQLite and background behaviour. Manual UAT only: no regression net for the outbox.
