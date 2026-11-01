# WEB-1 · Web shell, design system and i18n

- **Status:** planned
- **Date:** 2026-11-01
- **Wave:** 0 (roadmap §1.1). **Depends on:** PLAT-1 (merged), PLAT-15 (merged, PR #36), Q-21 (applied as its provisional default: "Eeasy Logistics" and a working Arabic name, one key).
- **Lead:** architecture lead. **Executor:** `executor-web` (Opus: the plan carries a §7 question), own worktree. **Adversary:** no (roadmap row; no auth or data path).
- **Issue:** #46. **Merge danger:** two-way door. **Legs:** two. Leg 1 items A–E (packages and `apps/web`); leg 2 items F–H (`apps/admin`, budgets, release note).
- **Paths:** `packages/ui`, `packages/i18n`, `packages/config-eslint` (one rule), `apps/web`, `apps/admin` (leg 2), `.github/workflows` (leg 2, the budget step), `docs/release-notes`, `.serena/memories`. Disjoint from PLAT-6 (`apps/api`, `packages/db`, `packages/config`).

## 0. Goal

Both web applications render inside one design system that is right-to-left first: Radix behaviour, Tailwind styling with logical utilities enforced by lint, tokens as CSS custom properties, IBM Plex Sans Arabic self-hosted, next-intl with Arabic as the default locale, one formatting module for dates, numbers and money shared with the driver app, and a Playwright census harness in `ar` and `en` with the locale, RTL, accessibility and security assertions of the web document, so that every later screen order adds pages and specs into a frame that already enforces ADR-0016.

## 1. Binding rules and ADRs

- ADR-0016 "Decision" (Arabic and English everywhere; Gregorian dates, Western digits). ADR-0033 "Decision" (Radix primitives, Tailwind logical utilities with a lint rule, tokens as custom properties, component source in the repository; the map is WEB-7/WEB-8's). ADR-0038 "Decision" bullet 5 (shared code in packages; both apps import the same shell).
- `docs/architecture/web.md` §1 "Scope and surfaces" and §1.2 "Isolation between the groups" (separate root layouts; `DirectionProvider` per layout), §5 "Internationalisation and right-to-left" (every bullet), §6.1 "Base", §6.2 "Tokens", §6.3 "Components that matter beyond the basics" (the rows this order ships are listed in 2.6; the rest are later orders'), §10.1 "Build, images and fonts" (fonts), §10.2 "Budgets and Core Web Vitals" (the first-load budget check), §11 "Testing" (every row).
- `docs/handbook/02-definition-of-done.md` "UI change" rules; `docs/handbook/03-testing.md` "Census" row and "Isolated stack"; `docs/handbook/04-conventions.md` "Internationalisation".
- PLAT-15 item E and §8.2 (surface entry points, `apps/web` and `apps/admin` rules); WEB-19 decision 2.2 (the duplicated `root-html.tsx` and `locale.ts` move into a package here) and 2.10 (the smoke specs this harness replaces).
- Owner rule: Vercel skills first. The lead loaded `vercel:knowledge-update` (2026-09-18) and `vercel:nextjs` (plugin 0.50.0) on 2026-11-01; the executor loads `vercel:nextjs`, `vercel:react-best-practices` and `vercel:shadcn` and records versions and dates in §8.1.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Styling stack | Tailwind CSS 4 (latest stable, pinned exactly, three-day release-age rule respected) with the CSS-first `@theme` configuration reading `packages/ui/src/tokens.css`; Radix primitives (`radix-ui` umbrella package or the individual `@radix-ui/react-*` packages, whichever the shadcn skill recommends for Tailwind 4; recorded in §8.1); components in `packages/ui/src/components/<name>/<name>.tsx` with a `cn()` helper (`clsx` + `tailwind-merge`); no shadcn CLI registry fetches at build time (sources are committed) |
| 2.2 | Tokens | `packages/ui/src/tokens.css`: colour (semantic: background, foreground, muted, border, primary, danger, warning, success; plus one token per state of the order, offer, attempt and custody state machines of document 2 §3.13 to §3.16, named `--status-<machine>-<state>`), spacing scale, radius, typography scale with separate Arabic and Latin line heights (`--leading-ar-*`, `--leading-en-*`), elevation, motion; light theme only; WCAG 2.2 AA contrast verified by a unit test over the token file (foreground on background pairs ≥ 4.5:1) |
| 2.3 | Logical CSS lint | A rule `eeasy/no-physical-direction-utilities` in `packages/config-eslint` that scans string literals and template literals inside `className`, `class`, `cn(`, `cva(` and `tv(` calls for the physical utilities listed in web §5 (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`, `rounded-l-`, `rounded-r-`, `border-l-`, `border-r-`, `inset-x` variants that imply a side, `float-left`, `float-right`), with their logical replacements in the message; applied to `packages/ui`, `apps/web`, `apps/admin`; a fixture proves red then green |
| 2.4 | i18n library | next-intl (latest stable, pinned) in non-routing mode: no locale segment; the request locale from `el_locale`, else `ar` (the user and account chain joins in WEB-2); `packages/i18n` keeps the catalogues (`<locale>/<namespace>.json`) and gains namespaces `common`, `nav`, `auth`, `errors` (one key per `errors.md` code, both locales, with a test that the key set equals the generated `ErrorCode` union), `recipient`, `platform` (shell strings only); a TypeScript type generated from the `ar` catalogue (next-intl's `AppConfig` augmentation) so a missing key fails typecheck; the parity test stays; the existing `t()` helper is kept for the driver app and the server layouts, implemented over the same catalogues |
| 2.5 | Formatting module | `packages/i18n/src/format.ts`: `formatDateTime`, `formatDate` (business dates `YYYY-MM-DD` as calendar dates, never shifted), `formatNumber`, `formatMoney` (integer halalas, SAR), `formatPhone` (E.164 display with `\u200e` wrapping), using `Intl` with `ar-SA-u-ca-gregory-nu-latn` / `en-SA-u-nu-latn` and `timeZone: 'Asia/Riyadh'`; unit tests assert Gregorian output, Western digits and the Riyadh offset; no `date-fns` or `dayjs` |
| 2.6 | Components in this order | `Button`, `Input`, `Label`, `Select`, `Dialog`, `DropdownMenu`, `Tooltip`, `Toast`, `Tabs`, `Badge`, `Skeleton`, `Card`, `PageHeader`, `AppShell` (sidebar navigation that mirrors in RTL, top bar with the locale switch and a user slot), `DirectionProvider` wrapper, `Money` (riyal sign as an SVG component), `DateTime`, `Phone`, `OrderNumber` (`<bdi dir="ltr">`), `BilingualText` (locale display with fallback marked by `lang` and `dir`), `BilingualInput`, `StatusChip` (icon, colour token and text per state; the state lists come from the generated contracts enums), `UpdatedAgo`; `DataTable`, `Board`, `Form`, `FileUpload`, `ConflictNotice`, `SupportBanner` and the map are later orders'; every component has a Vitest + Testing Library test rendered in both directions (`dir="rtl"` and `"ltr"`) |
| 2.7 | Fonts | IBM Plex Sans Arabic (OFL) weights 400 and 600, subset to Arabic and Basic Latin with `pyftsubset` or `glyphhanger` at build-prep time once, the resulting `.woff2` files committed under `packages/ui/fonts/` with the licence file; loaded by each root layout with `next/font/local`, `display: 'swap'`, exposed as the `--font-sans` token; the family name is one token so Q-21's brand font is a one-file change |
| 2.8 | Shell package | `packages/ui/src/shell/`: `RootHtml` (lang, dir, font class, `DirectionProvider`, next-intl provider with the request messages), `requestLocale()`, the `el_locale` cookie helpers and the locale switch action; `apps/web` and `apps/admin` delete their copies and import these; the app layouts stay per group (web §1.2) |
| 2.9 | Census harness | `apps/web/tests/census.config.ts` (Playwright: projects `ar` and `en`; `ar` at 1440 and 390 px, `en` at 1440; base URL fixed per app as in PLAT-3) and `apps/web/tests/census/helpers.ts`: `expectLocale` (`<html lang dir>`), `expectNoArabicIndicDigits` (`[٠-٩]` in rendered text), `expectNoRawKeys` (no `namespace.key` strings on screen), `expectNoHorizontalOverflow` at 390 px, `expectAxeClean` (`@axe-core/playwright`, no serious or critical), `expectSecurityHeaders` (CSP and frame headers per group are WEB-2's; this order asserts only `X-Content-Type-Options` and the absence of a staff cookie on recipient requests), and `toHaveScreenshot` baselines committed per project; `census-shell.spec.ts` covers the four existing placeholder routes of `apps/web` and replaces `smoke-locale.spec.ts`; the CI lane `web-build-census` runs `test:census` instead of `test:smoke`; the same harness is copied into `apps/admin/tests` in leg 2 (a shared Playwright helpers package is deferred until a third consumer exists) |
| 2.10 | First-load budget | A script `apps/web/scripts/check-budget.ts` reads `.next/app-build-manifest.json` and the build output sizes and fails when a route's first-load JavaScript exceeds the web §10.2 class budget (recipient 90 KB gzip, merchant and platform 180 KB); runs in `web-build-census` and `admin-build-census` after the build (leg 2) |
| 2.11 | Release note | The shell is visible (fonts, layout, locale switch), so an Arabic release note `docs/release-notes/2026-11-0X-web-shell.md` ships with leg 2 |

## 3. Build list

### Leg 1 (packages and `apps/web`)

| Item | Delivers | Verify |
|---|---|---|
| A | `packages/i18n`: next-intl wiring, namespaces per 2.4, typed keys, `errors` namespace with the `ErrorCode` parity test, formatting module per 2.5 | parity test green; a removed `en` key red; the `ErrorCode` set test red when a code is missing; formatting tests: Gregorian, Western digits, Riyadh offset, `SAR 150.00` from 15000 halalas in both locales |
| B | `packages/ui` base per 2.1, tokens per 2.2 with the contrast test, lint rule per 2.3 with fixture, fonts per 2.7 | contrast test green; lint fixture red then green; fonts subset sizes recorded in §8.0 |
| C | Components per 2.6 with two-direction tests | component tests with counts; the Arabic render of `AppShell` reviewed as a Playwright screenshot in §8.0 |
| D | Shell package per 2.8; `apps/web` layouts adopt it; placeholder pages restyled inside `AppShell` (merchant, auth, recipient groups) | `pnpm --filter web build` green; `apps/web` no longer contains `root-html.tsx` or `locale.ts`; architecture test green |
| E | Census harness per 2.9 for `apps/web`; CI lane switched to `test:census`; screenshot baselines; plan §8 for the leg; memories | census `ar` and `en` green with counts; a planted Arabic-Indic digit and a planted `ml-4` each shown red; `web-build-census` green on the PR |

### Leg 2 (`apps/admin`, budgets, release note)

| Item | Delivers | Verify |
|---|---|---|
| F | `apps/admin` adopts the shell package and `AppShell`; its census harness and baselines; `admin-build-census` on `test:census` | census 6/6 per project; Arabic screenshot reviewed |
| G | Budget check per 2.10 in both lanes | a planted oversized import shown red in the script; both lanes green |
| H | Release note per 2.11 (Arabic); README "Design system" section; plan §8 complete; memories | gate passes |

## 4. Commit plan

One commit per item `WEB-1: <letter> <title>` with its §8.0 row; leg 1 ends with the draft PR; leg 2 is a fresh executor on the same branch.

## 5. Exit criteria

- Both apps render through `packages/ui`'s shell with IBM Plex Sans Arabic, Arabic default, mirrored navigation; no physical-direction utility passes lint.
- The formatting module is the only date, number and money formatter in the repository; its tests prove Gregorian and Western digits.
- The census harness runs in CI for both apps in `ar` and `en` with screenshot baselines, axe and the locale assertions; the first-load budgets are enforced.
- The Arabic release note exists.

## 6. Not in this order

Sessions, sign-in forms, CSP and `proxy.ts` (WEB-2); `DataTable`, `Board`, `Form`, `FileUpload`, `ConflictNotice`, `SupportBanner` (the screen orders that first need them); the map (WEB-7, WEB-8); dark mode; Sentry and PostHog wiring (PLAT-14); the driver app's adoption of the formatting module (DRV-1); a shared Playwright helpers package.

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Brand name and Arabic name (Q-21) | "Eeasy Logistics" / "إيزي لوجستكس" in one key `app.name` per locale; one token set; a change is one PR |
| 2 | Brand font (web §12.1) | IBM Plex Sans Arabic; the family is one token |

## 8. Executor notes (filled by the executor)

### 8.0 Progress

| Item | Commit | Tests (counts) | Interpretation |
|---|---|---|---|
| A | (this commit) | `packages/i18n` Vitest 5 files, 48/48 green; `tsc` clean; ESLint clean; architecture 27 modules clean; `turbo run typecheck test` for `driver` and `i18n` 7/7 tasks green. Red then green: `en/nav.json` without `home` → parity test red (2 failures) and `tsc` red (`messages.ts` TS2741); `ar/errors.json` without `slot_full` → `ErrorCode` set test red for `ar` plus parity red; restored → 48/48. Formatting tests in both locales: calendar `gregory` and digits `latn` resolved, no Arabic-Indic digit, 21:30Z shown as 12:30 on the next day (Riyadh), business date `2026-03-01` stays on day 1, `SAR 150.00` from 15000 halalas (exact in `en`; `ar` contains `SAR` and `150.00`) | Namespaces `common`, `nav`, `auth`, `errors` (70 codes, equal to the generated `ErrorCode` union), `recipient`, `platform`; `Messages` typed from the `ar` catalogue; the next-intl `AppConfig` augmentation lives in `packages/ui` (item D) so `packages/i18n` and the driver app need no next-intl (8.2 #1); ICU plurals take a pre-formatted `{value}`, not `#` (8.2 #2); `formatMoneyAmount` added for `<Money>` (8.2 #3) |
| B | (this commit) | `packages/ui` Vitest `tokens.test.ts` 49/49 green (16 text pairs ≥ 4.5:1, 6 control-boundary pairs ≥ 3:1, 24 status tokens ≥ 4.5:1 on background, surface and muted, Arabic line heights one step above Latin); `tsc` clean; ESLint clean; architecture 412 modules clean. `packages/config-eslint` `node --test` 3/3 green: red fixture `test/fixtures/physical.tsx` gives exactly 11 reports with their logical replacements, green fixture `logical.tsx` gives 0. Red then green: `--color-muted-foreground: #94a3b8` → 3 contrast failures, restored → 49/49; `cancelled` removed from the order list in `src/status.ts` → `tsc` red (`{ missing: "cancelled" }`), restored → clean. `apps/web` and `apps/admin` lint green with the rule on. Fonts: IBM Plex Sans Arabic 400 = 38,888 bytes, 600 = 42,144 bytes woff2 (795 code points each: Basic Latin, Arabic blocks and presentation forms, general punctuation), `pyftsubset` (fontTools 4.60.1, brotli 1.1.0) from the google/fonts TTFs, OFL licence beside them | Tailwind 4.3.3 CSS-first: `src/tokens.css` is a Tailwind `@theme` block (semantic colours, font, text, `--leading-ar-*`/`--leading-en-*`, spacing, radius, shadow, motion) plus a `:root` block with the 24 `--status-<machine>-<state>` tokens; `src/styles.css` imports Tailwind and the tokens and sets per-`lang` line height; state lists in `src/status.ts` are checked both ways against the generated contract unions (8.2 #4); the rule is exported as `logicalCss` from `@eeasy-logistics/config-eslint` (8.2 #5) |
| C | (this commit) | `packages/ui` Vitest 5 files, 93/93 green (44 component tests: 22 per direction, each file `describe.each` over `ar`/`rtl` and `en`/`ltr`, plus 49 token tests); `tsc` clean; ESLint clean with the logical-CSS rule; architecture 465 modules clean. Direction proofs: Tabs move forward with `ArrowLeft` in `rtl` and `ArrowRight` in `ltr` (red then green: the swapped arrows fail both directions, 2 failures, three tabs so a loop cannot pass by chance); Toast `data-swipe-direction` is `left` in Arabic and `right` in English; DropdownMenu and Select content carry `dir`; AppShell sheet opens from `start-0`; StatusChip renders all 24 states with icon, `text-(--status-<machine>-<state>)` and the catalogue label in both locales; Money `150.00` + riyal SVG + `ريال سعودي`/`Saudi riyal` in a `bdi dir="ltr"`; UpdatedAgo Arabic plural forms (`دقيقتين`, `3 ساعات`) with Western digits. The Arabic `AppShell` screenshot is reviewed at item D, the first point where it renders with the compiled styles and font | 23 components under `src/components/<name>/<name>.tsx`, exported as `@eeasy-logistics/ui/components/<name>`; `radix-ui` 1.8.1 umbrella package (the shadcn skill's current recommendation), `class-variance-authority` 0.7.1, `lucide-react` 1.64.0, `next-intl` 4.14.9; the next-intl `AppConfig` augmentation is `src/intl.ts`, imported by every component that translates (8.2 #1); Toast swipe direction derived from the Radix direction (8.2 #6); Dialog centred with `inset-0 m-auto` (no physical translate); `jsdom` pinned to 26.1.0, already in the lock, because 30.x pulls packages under three days old (8.2 #7) |

### 8.1 Skills, documents and versions consulted

### 8.2 Interpretations the lead should check

### 8.3 Not done here

## 9. Lead review and adversary

Adversary: not required (roadmap). Lead review rulings are recorded here after `/code-review`.
