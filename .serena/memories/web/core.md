# apps/web

- Next.js 16 App Router. Route groups `src/app/(auth)`, `(merchant)`, `(platform)/platform`, `(recipient)/track/[token]`; `src/root-html.tsx` sets `lang`/`dir` from `src/locale.ts`.
- Locale: `ar` default, RTL; `@eeasy-logistics/i18n` `t(locale, key)`; logical CSS only.
- Config: only `NEXT_PUBLIC_*` via `@eeasy-logistics/config/web` (`publicConfig()`); dependency-cruiser forbids any other config import; server-side vars come with the order that adds server fetches.
- `typecheck` runs `next typegen` first (typed routes). Playwright smoke in `tests/` runs in both locales against a built API + web; CI lane `web-build-census`.
- Owner direction (2026-11-01, not yet an ADR): platform/admin area to move to a separate `apps/admin` on its own hostname so the merchant bundle never contains admin routes.
- Before editing: load `vercel:knowledge-update` + `vercel:nextjs` and record the doc date in plan §8.1.
