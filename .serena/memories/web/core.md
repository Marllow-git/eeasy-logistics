# apps/web

- Next.js 16 App Router. Route groups `src/app/(auth)`, `(merchant)`, `(recipient)/track/[token]`; `src/root-html.tsx` sets `lang`/`dir` from `src/locale.ts`. No platform route: the console is `apps/admin` (ADR-0038, WEB-19) → `mem:admin/core`; `GET /platform` is 404.
- Locale: `ar` default, RTL; `@eeasy-logistics/i18n` `t(locale, key)`; logical CSS only.
- Config: only `NEXT_PUBLIC_*` via `@eeasy-logistics/config/web` (`publicConfig()`); dependency-cruiser forbids any other config import; server-side vars come with the order that adds server fetches.
- API access only via `@eeasy-logistics/contracts` (`/staff`, `/recipient`, `/http`, `/unions`; rule `web-contracts-surfaces`). Generated calls take `{ fetcher: createFetcher({ baseUrl, locale, headers }) }` per call; `baseUrl` is the origin (paths carry `/v1/<surface>`). `next build` typechecks, so contracts must be built first (Turbo `^build`; Dockerfile builds `@eeasy-logistics/web...`).
- `typecheck` runs `next typegen` first (typed routes). Playwright smoke in `tests/` runs in both locales against a built API + web; CI lane `web-build-census`.
- Before editing: load `vercel:knowledge-update` + `vercel:nextjs` and record the doc date in plan §8.1.
