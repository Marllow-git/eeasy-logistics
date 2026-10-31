# @eeasy-logistics/contracts

The typed seam between the API, the web app and the driver app (ADR-0003). The OpenAPI source of truth stays in `docs/contracts/openapi/`; this package lints it today (`pnpm --filter contracts lint`, using `docs/contracts/redocly.yaml`). Bundling, generated clients, hooks, schemas and contract tests are PLAT-15's.
