# apps/admin

- Platform console (ADR-0038, WEB-19): Next.js 16.4 App Router, same pins, tsconfig, ESLint and `turbo.json` (`^build`) as `apps/web`. Own standalone image (`apps/admin/Dockerfile`, port 3000 in the image) and hostname (`PUBLIC_ADMIN_URL`, local `http://localhost:3002`).
- Route groups `src/app/(auth)` (`/sign-in`, `/sign-in/totp`) and `(platform)` at `/` (no `/platform` segment); each its own root layout. `src/root-html.tsx` and `src/locale.ts` are copies of the web's (WEB-1 moves both into `packages/ui`).
- Strings: `placeholder.admin`, `placeholder.admin_sign_in` in `packages/i18n` `common`; the `platform` namespace is WEB-4's and belongs to this app only.
- Config: public values via `@eeasy-logistics/config/web` (`publicConfig()`, same `NEXT_PUBLIC_*` set as web). Contracts: `/platform`, `/http`, `/unions` only (`admin-contracts-surfaces`); `/platform/mocks` from `tests/` only (`admin-contracts-mocks-in-tests-only`).
- Ports: dev/start 3002; CI lane `admin-build-census` (API 3000, admin 3002); `main.yml` image `ghcr.io/marllow-git/eeasy-logistics/admin`, probed with `GET /`.
- Not built yet: `proxy.ts`, CSP (WEB-1), sessions and TOTP (WEB-2), screens (WEB-4), per-host edge 404 (OPS-1).
