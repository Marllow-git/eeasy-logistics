# PLAT-14 · Observability, leg 2 — design references

Found with the Mobbin MCP on 2026-11-01 (platform `web`, query "dashboard error page with retry button and support reference id"). Scope: the error boundaries of web §10.4 (`global-error.tsx`, `error.tsx` per group) in `apps/web` and `apps/admin`, in Arabic and English, inside the WEB-1 shell. Screens are left-to-right; the pages mirror for Arabic (ADR-0016).

| Reference | App | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/65c49391-4093-4c49-af40-df6108727fb0 | Shopify, 500 inside the shell | the error state renders inside the app shell with the sidebar intact, so navigation survives a page failure; one heading, two lines of help text, a link to the status page in place of our support reference | the illustration card |
| https://mobbin.com/screens/e00ca642-dcfd-4797-aec7-9ae0d780ec3d | Notion, in-place "Something went wrong" | a segment-level boundary: the failed panel shows a short message and a "Try again" control while the rest of the page stays usable (our per-group and per-module `error.tsx`) | none |
| https://mobbin.com/screens/0cb8a748-4514-4f27-b102-194649e40112 | Mercor, full-page error | the `global-error` shape: centred heading, one explanatory line, a primary "Go to home" and a secondary "Contact support"; our version shows the `request_id` as copyable text next to the support action | the "team has been notified" claim (we show the request id instead) |

Saved as the Mobbin collection "eeasy-logistics · PLAT-14".
