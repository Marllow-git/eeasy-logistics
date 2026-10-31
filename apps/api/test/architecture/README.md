# Architecture test fixtures

`pnpm --filter api test:architecture` runs dependency-cruiser (`apps/api/.dependency-cruiser.cjs`) over `src/` and this folder. `fixture/modules/` mirrors `src/modules/` with permitted imports only, so the rules are exercised on every run. To see a rule fail, add a file under `fixture/modules/<context>/` that imports another context outside its `public/` folder, or a kernel file that imports any context; then delete it.

Environment reads (PLAT-4): the rule `no-environment-outside-config` forbids importing the `process` module outside `packages/config`; a global `process.env` read is not an import, so the shared ESLint rule `no-restricted-properties` (in `packages/config-eslint`) catches it in `pnpm lint` for every workspace. To see both fail, add a file under `src/` with `process.env.X` (lint) or `import { env } from 'node:process'` (this test and lint); then delete it.
