# ADR-0032: Serve the API to the browser on the web origin and refresh staff sessions in web middleware

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** web app architecture (foundation document 7, §2.2 and §3); document 4 §4 (cookies, rotation, reuse detection); document 6 §8 (edge, CSP)

## Context

Staff and platform sessions are httpOnly SameSite=Lax cookies with a 15-minute access token and a rotating refresh token whose reuse revokes the whole family (document 4 §4). The web app renders on the server, which needs the same cookies, and in the browser, which calls the API for mutations and streams. If the API lives on another hostname, cookies need a shared parent domain, every call needs CORS with credentials, and the CSP needs the API origin. A proxy route handler in Next.js would avoid CORS but put a Node hop in front of every request and every SSE connection. Refresh must happen somewhere before server components render, and in the browser for pages left open past 15 minutes, without one browser presenting a refresh token twice.

## Decision

- The edge proxy routes `/v1/staff/*`, `/v1/platform/*` and `/v1/recipient/*` on the web hostnames to the `api` container; the browser calls the API same-origin. Session cookies are host-only on the web hostname, `Secure`, `Path=/`. No CORS is enabled on these three surfaces. The driver and public surfaces stay on the API hostname with bearer credentials.
- Server components call the API over the internal network through the generated client, forwarding only their group's cookie.
- Refresh happens in two places only: the web middleware for document navigations (refresh when the access token is missing or expires within 60 s, rewrite the forwarded `Cookie` header, copy `Set-Cookie` to the response), and the generated client's fetch wrapper for in-page `401 token_expired`, single-flight across tabs through the Web Locks API. No server actions and no proxy route handlers for business calls.
- Every non-`GET` staff or platform call carries `X-EL-Client: web`; the API rejects writes without it or with a foreign `Origin` as `403 forbidden` (CSRF defence on top of SameSite=Lax).
- Proposed to the API (owner question 5 of document 7): a refresh-token reuse within 10 seconds of its rotation, from the same family and user agent, returns the already-issued pair instead of revoking the family.

## Consequences

- `connect-src 'self'` covers API calls and streams; the CSP of document 6 §8 stays short.
- SSE connections go from the browser to the API through the edge only, never through a Node process of the web container.
- The edge and the local Compose stack need path routing for `/v1/*` on the web hostname; the census's isolated stack does the same.
- The API owes the `X-EL-Client` and `Origin` check in the wave 0 auth order; the contracts should document it as a required header on staff and platform writes.
- Without the reuse grace, two tabs navigating at the same moment after an idle period can force a sign-in; with it, document 4 §4 gains one sentence.

## Alternatives considered

- API on its own hostname with a parent-domain cookie and credentialed CORS: wider cookie scope, preflight on every write, and a CSP origin to maintain.
- A Next.js route handler proxying every API call (backend for frontend): an extra hop on every request and long-lived SSE connections held by the web container, with no security gain over same-origin routing.
- Refresh only in middleware: in-page calls after a long idle would fail. Refresh only in the browser: server components would render with an expired token on the first navigation after idle.
