# apps/driver

- Expo SDK 58 + Expo Router. Groups `app/(auth)`, `app/(setup)`, `app/(app)`; root `app/_layout.tsx`.
- Config: only `EXPO_PUBLIC_*` via `@eeasy-logistics/config/driver`; literal `process.env.EXPO_PUBLIC_X` reads are required for Metro inlining (bracket access is not inlined). Workspace package code is inlined (not under `node_modules`).
- API access only via `@eeasy-logistics/contracts` `/driver`, `/http`, `/unions` (rule `driver-contracts-surfaces`; no hooks, no MSW). Use `createFetcher({ webClient: false, requestId })` — Hermes has no `crypto.randomUUID`.
- Tests: Jest in `test/` (`i18n-wiring`, `public-config-wiring`, `contracts-wiring`), `test:architecture` cruises `app` and `test`; `expo-doctor` in CI lane `driver-test`.
- Binding ADRs for upcoming orders: 0008 offline outbox (SQLite lanes), 0028 location pings bypass server outbox, 0034 offline cash PIN device verifier, 0035 Maestro e2e in `ar`/`en`.
- Before editing: load `expo:expo-overview` and the skills it routes to; record SDK and doc date in plan §8.1.
