# Architecture test fixtures

`pnpm --filter api test:architecture` runs dependency-cruiser (`apps/api/.dependency-cruiser.cjs`) over `src/` and this folder. `fixture/modules/` mirrors `src/modules/` with permitted imports only, so the rules are exercised on every run. To see a rule fail, add a file under `fixture/modules/<context>/` that imports another context outside its `public/` folder, or a kernel file that imports any context; then delete it.
