# Auth libraries and cookie facts for PLAT-11 (staff and platform authentication)

- **Question:** Lead, 2026-11-01. Five questions for PLAT-11 (`docs/roadmap.md` row PLAT-11; identity doc §3.1, §3.3, §4). Argon2id hashing, TOTP, breached-password list, refresh-token reuse grace, and cookie names for `apps/web` and `apps/admin` (ADR-0038).
- **Read date:** 2026-11-01 for every source unless a row says otherwise. npm facts come from the registry metadata read that day.
- **Labels:** [S] = stated by the source. [I] = inferred by the researcher. [M] = measured by the researcher in a scratch run, outside the repo, now deleted.
- **Scope:** facts and the trade-offs the sources name. No architecture decision.

## Summary for the lead

1. Node 24.22.2 ships `crypto.argon2` and `argon2Sync` (added in v24.7.0, which the root `engines` range `>=24.11.0` covers). It matches the RFC 9106 §5.3 Argon2id vector on Node 24.22.2 [M], so a hash needs no new dependency. It returns a raw key, so the encoding and the verify path are ours. Alpine (musl) was not tested because Docker is not run locally.
2. If a library is wanted instead: `@node-rs/argon2` 2.2.2 (published 2026-10-06) has no runtime dependencies, no install script, and musl and glibc optional packages for x64 and arm64. `argon2` 0.45.1 (2026-07-21) ships prebuilds for the same targets but adds four runtime dependencies and an install script that pnpm 10 skips here. `hash-wasm` 4.12.0 was last published 2024-11-19.
3. OWASP's minimum Argon2id set is m=19456 KiB (19 MiB), t=2, p=1. Memory per hash equals m. On Node 24.22.2 on a Mac (not a container) one hash took 7 to 16 ms [M].
4. TOTP in-house on `node:crypto` is reasonable. RFC 6238 Appendix B gives SHA-1, SHA-256 and SHA-512 vectors (table in §2). Google Authenticator ignores `algorithm` and `period`, so use SHA1, 6 digits, 30 s everywhere.
5. The breached-password list is available only as a mirror: the NCSC URL returned 404, and SecLists (MIT repo) carries the file. Its 99,839 unique SHA-1 digests take 1.99 MB as sorted binary. The NCSC data licence is not verified.
6. The identity doc's term "k-anonymity list" is wrong for an offline check: an exact local match needs no k-anonymity. The HIBP range API is excluded by AGENTS.md.
7. Grace conflict: Q-23 says 30 s and returns the same pair; ADR-0032 says 10 s and returns the already-issued pair; Auth0 issues a new pair inside its window. The lead must pick one.
8. `__Host-` cannot carry a refresh cookie scoped to `Path=/v1/staff/auth`. Path scoping also stops the web middleware from seeing the refresh cookie on page navigations, which ADR-0032 relies on. This needs a decision before names are fixed.

## 1. Argon2id password hashing

### 1.1 Candidates (registry metadata, read 2026-11-01)

| Package | Latest | Published | Runtime deps | Install script | Prebuilds / native | Last activity (GitHub `pushed_at`) |
|---|---|---|---|---|---|---|
| `crypto` built-in (`crypto.argon2`, Node 24.7.0+) | Node 24.22.2 | Node 24.7.0 added it [S1] | none | none | none | Node release line |
| `@node-rs/argon2` | 2.2.2 | 2026-10-06 [S2] | none (checked in installed 2.2.2) | none | N-API via per-platform optional packages: linux x64/arm64, gnu and musl, plus darwin, win32, freebsd, android [S2, S3] | 2026-11-01 (`napi-rs/node-rs`) [S4] |
| `argon2` (node-argon2) | 0.45.1 | 2026-07-21 [S5] | `@phc/format`, `cross-env`, `node-addon-api`, `node-gyp-build` [S5] | `cross-env ZERO_AR_DATE=1 node-gyp-build` [S5] | prebuilds inside the tarball: linux x64/arm64 glibc and musl, darwin, freebsd, win32, linux-arm [S6] | 2026-10-26 (`ranisalt/node-argon2`) [S4] |
| `hash-wasm` | 4.12.0 | 2024-11-19 [S5] | none | none | WebAssembly, unpacked 1.8 MB [S5] | 2024-11-19 (`Daninet/hash-wasm`); GitHub licence field `NOASSERTION`, npm says MIT [S4, S5] |

- [S] `argon2`, `@node-rs/argon2`, `otpauth` and `@noble/hashes` publish SLSA provenance attestations; `hash-wasm` 4.12.0 has none (npm attestations endpoint). Whether an earlier `hash-wasm` release had provenance was not checked.

### 1.2 Native build and the Dockerfile base

- `apps/api/Dockerfile` uses `node:24.22.2-alpine@sha256:…` for every stage [S7]. The runtime is **Alpine, which is musl**, not Debian or glibc.
- `argon2` 0.45.1 ships `prebuilds/linux-x64/argon2.musl.node` and `prebuilds/linux-arm64/argon2.armv8.musl.node` [S6]. Its install script is `node-gyp-build`, which only compiles when no prebuild matches [S5]. So `pnpm install` on the Alpine base needs no compiler for these targets [I, node-gyp-build selects a prebuild by libc; the selection code was not read].
- `@node-rs/argon2` musl packages declare `"libc": ["musl"]` for x64 and arm64 [S3]. No compiler is needed.
- Built-in `crypto.argon2`: no package, so no compiler and no libc question at the package level. Whether the Alpine Node binary carries Argon2 support was not tested [unverified].
- `pnpm-workspace.yaml` has `onlyBuiltDependencies: [esbuild]` and an `ignoredBuiltDependencies` list that does not name `argon2`; there is no `allowBuilds` key [S8]. `argon2` would not run its install script under pnpm 10 defaults [I]. The Dockerfile's `prod-deps` stage uses `--ignore-scripts`, so the script never runs in the image either way [S7]. Adding `argon2` to `onlyBuiltDependencies` is not needed for runtime, since `node-gyp-build` loads the prebuild at require time [S5, I].
- `@node-rs/argon2` has no install script, so it needs no pnpm entry [S3].

### 1.3 Node 24 compatibility

- `argon2` 0.45.1 and `@node-rs/argon2` 2.2.2 both loaded and hashed on Node 24.22.2 on darwin-arm64 [M]. This does not prove the Linux prebuilds load; that needs a Linux run.
- `argon2` builds its binding with `napi_versions: [8]` [S6]. Node-API versions are additive from 8 upward, and Node-API 10 is available from v22.14.0 and v23.6.0 on [S9]. So a Node-API 8 binary loads on Node 24.22.2 [I].
- `@node-rs/argon2` Node-API version: not read.

### 1.4 Built-in `crypto.argon2` (Node 24.7.0+)

- [S1] Signature `crypto.argon2(algorithm, parameters, callback)` and `crypto.argon2Sync(algorithm, parameters)`. `algorithm` is `argon2d`, `argon2i` or `argon2id`. Parameters: `message` (password), `nonce` (salt, at least 8 bytes, the docs recommend 16 random), `parallelism` (1 to 2^24-1), `tagLength` (at least 4), `memory` (KiB, at least 8 × parallelism, rounded down to a multiple of 4 × parallelism), `passes` (at least 1), and optional `secret` (pepper) and `associatedData`. The callback yields `derivedKey` as a Buffer.
- [S1] The output is the raw derived key, not an encoded PHC string. Encoding the parameters, salt and hash, and the constant-time compare, are the caller's job (`crypto.timingSafeEqual`).
- [S1] The docs page carries no stability marker in the fetched text. Stability was not checked against the changelog [unverified].
- [M] RFC 9106 §5.3 vector (memory 32 KiB, 3 passes, 4 lanes, tag 32 bytes, inputs 0x01 ×32, 0x02 ×16, 0x03 ×8, 0x04 ×12) gives tag `0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659` on Node 24.22.2. This matches [S10].
- [M] Cross-check: `argon2` verifies a `@node-rs/argon2` PHC hash, and `@node-rs/argon2` verifies its own output. The two libraries agree on the `$argon2id$v=19$m=…,t=…,p=…$salt$hash` PHC format.

### 1.5 OWASP parameters and cost

- [S11] OWASP Password Storage Cheat Sheet (page carries no date; read 2026-11-01): "use one of the following minimum configurations": m=47104 (46 MiB), t=1, p=1; m=19456 (19 MiB), t=2, p=1; m=12288 (12 MiB), t=3, p=1; m=9216 (9 MiB), t=4, p=1; m=7168 (7 MiB), t=5, p=1. The page says the options give "an equal level of defense" and differ only in CPU against RAM.
- [S10] RFC 9106 §4 recommendations: first, t=1, p=4, m=2^21 KiB (2 GiB); second, t=3, p=4, m=2^16 KiB (64 MiB).
- [S6] The `argon2` package defaults are m=65536, t=3, p=4 (the RFC 9106 second recommendation). `@node-rs/argon2` defaults are m=19456, t=2, p=1 (the OWASP minimum).
- [S3] `@node-rs/argon2` documents memory as "a pool of 19 MiB per thread".
- [S12] Node's libuv threadpool default is 4 threads ("its current default value"). Argon2 hashes run there [I, for the native libraries; for `crypto.argon2` not read].
- Memory arithmetic [I]: one OWASP hash costs about 19 MiB. At most four run at once, so roughly 76 MiB of working memory above the heap. The `argon2` defaults cost 64 MiB per hash, so roughly 256 MiB at four concurrent hashes. That is significant on a small container with a 512 MiB limit.
- Timing [M], Node 24.22.2 on a Mac, not a container, mean of 8 runs for OWASP and 4 for defaults:

| Implementation | Parameters | Time per hash |
|---|---|---|
| `@node-rs/argon2` | m=19456, t=2, p=1 | 7.2 ms |
| `crypto.argon2Sync` | m=19456, t=2, p=1 | 11.7 ms |
| `crypto.argon2` async | m=19456, t=2, p=1 | 11.6 ms |
| `argon2` | m=19456, t=2, p=1 | 15.7 ms |
| `argon2` | defaults (m=65536, t=3, p=4) | 36.2 ms |
| `crypto.argon2` | 8 concurrent | 36 ms wall |

- [I] Container CPU will differ from a Mac. These figures bound the order of magnitude only.

## 2. TOTP (RFC 6238)

### 2.1 In-house or library

- [S13] RFC 6238 is an Informational RFC from May 2011. Section 1.2: TOTP is HOTP with a time-based counter, and "MAY use HMAC-SHA-256 or HMAC-SHA-512". Section 5.2: "We RECOMMEND that at most one time step is allowed as the network delay", "We RECOMMEND a default time-step size of 30 seconds", and "The verifier MUST NOT accept the second attempt of the OTP after the successful validation has been issued for the first OTP". Section 6: the verifier should set a limit on time-step drift in each direction.
- [I] An in-house `node:crypto` implementation (`createHmac('sha1')`, 8-byte big-endian counter, RFC 4226 dynamic truncation) is about 30 lines. The RFC vectors pin it. It needs no new dependency, which matches the supply-chain rule.
- `otpauth` 9.5.2 (published 2026-09-03 [S5]): MIT, unpacked 997 KB, depends on `@noble/hashes` 2.4.0 (published 2026-08-27 [S5]), and ships an npm provenance attestation [S5]. Its default algorithm, digits and period were not read.
- [I] Replay protection is the verifier's job under §5.2: store the last accepted time-step counter per user and reject any counter at or below it, in the same transaction that completes the second factor.

### 2.2 RFC 6238 Appendix B test vectors

- [S13] The table uses the ASCII secret `12345678901234567890` (20 bytes) for SHA-1 and reference-code seeds of 32 bytes (SHA-256) and 64 bytes (SHA-512), with 8-digit output and time step X=30, T0=0.
- Six 8-digit SHA-1 values from the table, plus the 6-digit form [I, the last six digits of the 8-digit value, which is how RFC 4226 truncation reduces digits]:

| Time (s) | T (hex) | SHA-1 8-digit | SHA-1 6-digit (derived) | SHA-256 8-digit | SHA-512 8-digit |
|---|---|---|---|---|---|
| 59 | 0000000000000001 | 94287082 | 287082 | 46119246 | 90693936 |
| 1111111109 | 00000000023523EC | 07081804 | 081804 | 68084774 | 25091201 |
| 1111111111 | 00000000023523ED | 14050471 | 050471 | 67062674 | 99943326 |
| 1234567890 | 000000000273EF07 | 89005924 | 005924 | 91819424 | 93441116 |
| 2000000000 | 0000000003F940AA | 69279037 | 279037 | 90698825 | 38618901 |
| 20000000000 | 0000000027BC86AA | 65353130 | 353130 | 77737706 | 47863826 |

- [S13] Reference-code seed lengths: 20, 32 and 64 bytes (seed contents not checked byte by byte).

### 2.3 otpauth URI for Google Authenticator and Apple Passwords

- [S14] Google Key URI format: `otpauth://totp/<label>?secret=<BASE32>&issuer=<Issuer>&algorithm=SHA1&digits=6&period=30`. Label is `Issuer:account`, with the colon or `%3A` and optional `%20` before the account. Recommended to use both the label prefix and the `issuer` parameter, and they should match. `secret` is required. `algorithm` default SHA1; "currently, the algorithm parameter is ignored by the Google Authenticator implementations". `digits` 6 or 8. `period` default 30, "ignored by the Google Authenticator implementations".
- [I] Example: `otpauth://totp/Eeasy%20Logistics:admin%40example.test?secret=…&issuer=Eeasy%20Logistics&algorithm=SHA1&digits=6&period=30`.
- [S15] Apple's support page for setup codes in Passwords (read 2026-11-01) describes only a manual flow: "Choose the option to manually use a setup key", "Click Edit, then click Set Up Code", "Paste the setup key into Setup Key", "Click Use Setup Key". It does not mention QR codes, `otpauth`, algorithm, digits or period. Whether Passwords accepts an `otpauth://` URI, and whether it honours non-default values, is [unverified].
- [I] Keep SHA1, 6 digits, 30 s on every URI. Show the base32 secret for manual entry and the URI for QR, both with the same parameters.

## 3. Breached-password list

### 3.1 Candidates

- **NCSC "PwnedPasswordsTop100k.txt".** The NCSC URL `https://www.ncsc.gov.uk/static-assets/documents/PwnedPasswordTop100k.txt` returned HTTP 404 on 2026-11-01. The spelling `PwnedPasswordsTop100k.txt` also returned 404. NCSC's own licence text was not found.
- [S16] SecLists, `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`, 835,538 bytes, 99,840 lines, one blank line, 99,839 non-empty unique passwords. The repository carries an MIT licence, "Copyright (c) 2018 Daniel Miessler" [S16, S17]. The SecLists licence covers the repository, not the data inside it [I].
- [S18] Bitwarden's NCSC list page names this SecLists file as the NCSC mirror (secondary source).
- **Have I Been Pwned Pwned Passwords.** [S19] The page says "Pwned Passwords is free and open source for everyone to use" and points to the downloader. The CC BY 4.0 licence the lead cited was not found on haveibeenpwned.com (FAQs, Terms and Passwords pages read) [unverified]. The downloader (`haveibeenpwned-downloader`) is BSD 3-Clause, copyright 2022 HaveIBeenPwned [S20]. Full dataset size was not verified; third-party listings show older figures of about 9 GB (7z, v2, 2018) and 12 GB 7z for about 25 GB text (v5), both undated [unverified].

### 3.2 Storage size, measured on the 99,839 entries [M]

| Form | Entries | Size |
|---|---|---|
| SecLists plain text, as published | 99,839 | 835,538 bytes (not stored; source) |
| SHA-1 hex, uppercase, sorted, one per line | 99,839 | 4,093,399 bytes (gzip -9: 2,288,997 bytes) |
| SHA-1 20-byte binary, sorted | 99,839 | 1,996,780 bytes |
| Same, pruned to passwords of at least 12 characters | 1,212 | 24,240 bytes binary (49,692 bytes hex) |

- [I] The identity doc §3.1 sets a 12-character minimum. A list entry shorter than 12 characters can never be an accepted password, so pruning loses nothing for the policy as written. It does shrink coverage to the 1,212 most common passwords of 12 or more characters, which the owner should accept knowingly. If the minimum changes, the list must be rebuilt.
- [I] Matching is exact on the UTF-8 bytes; case variants pass unless the list is normalised (a policy decision).
- [I] Storing full 20-byte SHA-1 digests avoids the false positives a 5-hex-prefix range file gives. With 99,839 entries, about 9.5% of random 5-prefixes would hit an entry (99,839 / 1,048,576), and each hit would need a suffix check.

### 3.3 Licence and attribution

- [S16, S17] SecLists is MIT. The data licence of the NCSC list is not verified.
- Proposed attribution text (wording is ours, not a required licence string): "Breached-password list: NCSC top 100,000 passwords, derived from Have I Been Pwned Pwned Passwords data (Troy Hunt), taken from the SecLists repository (MIT, Daniel Miessler). Hashed locally for this product." [I]

### 3.4 Method constraint

- [I] AGENTS.md routes external calls through the outbox, so the HIBP range API (an outbound call from a handler) is excluded; only an offline list counts.

## 4. Refresh-token families and reuse grace

### 4.1 RFC 9700 (Best Current Practice, OAuth 2.0 Security)

- [S21] §4.14.2: "Authorization servers MUST utilize one of these methods to detect refresh token replay by malicious actors for public clients": sender-constrained refresh tokens, or refresh token rotation.
- [S21] Rotation, as the text defines it: "the authorization server issues a new refresh token with every access token refresh response. The previous refresh token is invalidated, but information about the relationship is retained by the authorization server. … it will revoke the active refresh token. This stops the attack at the cost of forcing the legitimate client to obtain a fresh authorization grant."
- [S21] The section text read does not mention a reuse grace or interval [I, the full RFC was not searched for "grace"].
- [S21] §4.14.2 also: "Refresh tokens SHOULD expire if the client has been inactive for some time" and revocation on password change or logout is MAY.

### 4.2 Auth0's "reuse interval" (named "leeway" in the API, "Rotation Overlap Period" in the dashboard)

- [S22] Read 2026-11-01: leeway is in seconds and disabled by default. Example `"leeway": 3`.
- [S22] Inside the window: "breach detection features don't apply and a new rotating refresh token is issued". Auth0 issues a new token, not the same pair.
- [S22] Outside the window: "if the second-to-last one is exchanged, breach detection will be triggered".
- [S23] The Auth0 rotation page: reuse leads to "all subsequent requests will be denied until the user re-authenticates" and no grace period is described.

### 4.3 The three positions in the repo

| Source | Grace | Returns |
|---|---|---|
| Roadmap Q-23 (provisional) | 30 s | the same pair, same family |
| ADR-0032 (proposed) | 10 s | the already-issued pair, same family and user agent |
| Auth0 leeway (vendor) | configurable, default off | a new rotating token |

- **Conflict** [S] between Q-23 (30 s) and ADR-0032 (10 s). The lead must reconcile them; A-3 in the roadmap waits on Q-23.

### 4.4 Pitfalls the sources imply

- [I] "Same pair returned" needs the server to keep the newly issued refresh token value for the window. A stored hash cannot re-derive the plaintext. Options: store the issued pair encrypted for the window, or mint a new pair like Auth0 (the Q-23 wording and Auth0 then diverge).
- [I] Inside the window, a stolen token and the legitimate second request look the same. The family is not revoked there. The window length is therefore the attacker's replay window for a stolen token, not the victim's grace alone.
- [I] ADR-0032 single-flights refresh across tabs (Web Locks), so the grace is a backstop.

### 4.5 Cookie pitfalls with SameSite=Lax and Path

- [S24] RFC 6265bis-22 (Internet-Draft; RFC 6265 of 2011 does not define these prefixes): a request path path-matches a cookie path when the cookie path is a prefix ending at a `/` boundary. So `Path=/v1/staff/auth` matches `/v1/staff/auth/refresh` and not `/v1/staff/authx` [S24, path-match rule].
- [S24 §4.1.2.7] `SameSite=Lax` cookies are sent with same-site requests and with cross-site top-level navigations. `Strict` is not sent on top-level navigations started cross-site [S24 §5.6.7.1]. Lax still sends on a cross-site top-level GET, so the refresh endpoint must be POST-only and must not change state on GET.
- [I] Conflict with ADR-0032: its middleware refreshes on document navigations (for example a GET of `/dashboard`). A cookie with `Path=/v1/staff/auth` is not sent on that navigation, so the middleware cannot refresh. Either the refresh cookie uses `Path=/`, which sends it on every request, or refresh needs another route. This needs an ADR, since ADR-0032 says "Path=/" for session cookies.
- [I] `Strict` on the refresh cookie would drop it on arrival from an external link, so the user would look signed out until a manual sign-in. Lax keeps that arrival working but needs the POST-only rule.
- [I] Site versus origin: SameSite uses the registrable domain (the "site"), not the origin. `web.<domain>` and `admin.<domain>` are same-site when they share the registrable domain (ADR-0038). Hosts under a public suffix are separate sites: [S25] the Public Suffix List (read 2026-11-01) lists `vercel.app`, so two apps on separate `*.vercel.app` hosts are cross-site. ADR-0032 keeps the API on the web origin, so the API itself is not affected.

## 5. Cookie names for `apps/web` and `apps/admin`

### 5.1 Prefix rules

- [S24 §4.1.3.2] `__Host-` cookies must have `Secure`, `Path=/`, and no `Domain`. Five examples are always rejected, including `Set-Cookie: __Host-SID=12345; Secure; Domain=site.example; Path=/`. Only `Secure; Path=/` from a secure origin is accepted.
- [S24 §4.1.3.2] "Ports are the only piece of the origin model that __Host- cookies continue to ignore." [I] So on `localhost` the web app on port 3000 and the admin app on port 3001 share cookies; distinct names are required for the local stack.
- [S24 §4.1.3.1] `__Secure-` requires only the `Secure` attribute, so it allows `Path=/v1/staff/auth`.
- [I] Conflict with the request's premise: a refresh cookie scoped to `Path=/v1/staff/auth` cannot carry `__Host-`. It can carry `__Secure-`.

### 5.2 Proposal (names only; the ADR decides the paths)

| Surface | Cookie | Attributes | Use |
|---|---|---|---|
| Merchant staff, `web` host | `__Host-el_staff_at` | `Secure; HttpOnly; SameSite=Lax; Path=/`; no Domain; 15 min | access JWT |
| Merchant staff, `web` host | `__Host-el_staff_rt` if `Path=/` (ADR-0032 as written); else `__Secure-el_staff_rt` with `Path=/v1/staff/auth` | `Secure; HttpOnly; SameSite=Lax` (POST-only refresh); 30 days | refresh |
| Platform, `admin` host | `__Host-el_platform_at` | as staff access | access JWT |
| Platform, `admin` host | `__Host-el_platform_rt` if `Path=/`; else `__Secure-el_platform_rt` with `Path=/v1/platform/auth` | as staff refresh; 12 h idle per identity doc §3.3 | refresh |

- [I] Distinct names are kept because the local stack shares `localhost` across ports.

## Recommendations

| # | Question | Recommendation | Version | Date (published or read) |
|---|---|---|---|---|
| 1 | Argon2id library | Use `crypto.argon2` from Node 24 with explicit OWASP parameters (m=19456, t=2, p=1), and write the PHC encoding and `timingSafeEqual` verify ourselves; fall back to `@node-rs/argon2` only if the owner wants a maintained encoding. | Node 24.22.2 (`crypto.argon2` since v24.7.0); `@node-rs/argon2` 2.2.2 | 2026-10-06 (`@node-rs/argon2`); read 2026-11-01 (Node docs) |
| 2 | TOTP | In-house on `node:crypto`, pinned by RFC 6238 Appendix B vectors, SHA1/6/30, ±1 step, replay store per user; `otpauth` only if the owner wants a maintained library. | RFC 6238 (May 2011); `otpauth` 9.5.2 | 2026-09-03 (`otpauth`) |
| 3 | Breached-password list | Full NCSC top-100k set as sorted 20-byte SHA-1 digests (99,839, 1.99 MB), with the SecLists MIT attribution and the NCSC licence checked before shipping; prune to ≥12 characters only if the owner accepts 1,212 entries. | SecLists repo file (no version) | read 2026-11-01 |
| 4 | Refresh reuse grace | Rotation with family revocation (RFC 9700 §4.14.2); settle 10 s versus 30 s and "same pair" versus "new pair" before PLAT-11, since Auth0 issues a new pair. | RFC 9700 (text read 2026-11-01); Auth0 leeway docs | read 2026-11-01 |
| 5 | Cookie names | `__Host-` for `Path=/` cookies; `__Secure-` for a refresh cookie scoped to a sub-path; resolve the Path conflict with ADR-0032 before naming. Separate `staff` and `platform` names. | RFC 6265bis-22 (draft) | read 2026-11-01 |

## Not verified

1. Node 24.22.2 on the Alpine (musl) image: `crypto.argon2` and the RFC vector were run on darwin-arm64 only. The `argon2` and `@node-rs/argon2` musl prebuilds were checked in the tarball, not loaded.
2. `crypto.argon2` stability (no marker in the fetched docs), threadpool use, and container timing and memory (Mac figures; Node 22 first run, Node 24 table).
3. NCSC top-100k licence and official URL (both spellings returned 404); Have I Been Pwned CC BY 4.0 claim; full Pwned Passwords size; SecLists file date.
4. Apple Passwords: accepted URI form and non-default algorithm, digits and period. `otpauth` defaults and `window` behaviour.
5. Browser behaviour for SameSite (only the draft was read), `Secure` cookies on plain `http://localhost`, and `@node-rs/argon2` Node-API version.
6. `hash-wasm` provenance history against `trustPolicy: no-downgrade`; RFC 9700 publication date.

## Sources

- [S1] Node.js crypto docs, `crypto.argon2` (added v24.7.0), https://nodejs.org/api/crypto.html (read 2026-11-01)
- [S2] npm registry, `@node-rs/argon2` metadata and platform packages, https://registry.npmjs.org/@node-rs%2Fargon2 (read 2026-11-01)
- [S3] `@node-rs/argon2` 2.2.2 package, README and `package.json` (installed and inspected), https://github.com/napi-rs/node-rs/tree/main/packages/argon2 (read 2026-11-01)
- [S4] GitHub API repository metadata (`pushed_at`, licence), https://api.github.com/repos/ranisalt/node-argon2, /napi-rs/node-rs, /Daninet/hash-wasm, /hectorm/otpauth (read 2026-11-01)
- [S5] npm registry, `argon2`, `hash-wasm`, `otpauth`, `jose`, `@noble/hashes` metadata and attestations, https://registry.npmjs.org/argon2 and the same pattern for each (read 2026-11-01)
- [S6] `argon2` 0.45.1 tarball listing (prebuilds, sources) and `argon2.cjs`, https://registry.npmjs.org/argon2/-/argon2-0.45.1.tgz (read 2026-11-01)
- [S7, S8] `apps/api/Dockerfile` and `pnpm-workspace.yaml` in the repository (worktree `lead-fable`, read 2026-11-01)
- [S9] Node.js Node-API version matrix, https://nodejs.org/api/n-api.html (read 2026-11-01)
- [S10] RFC 9106 §4 and §5.3, https://www.rfc-editor.org/rfc/rfc9106 (read 2026-11-01)
- [S11] OWASP Password Storage Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html (read 2026-11-01)
- [S12] Node.js CLI docs, `UV_THREADPOOL_SIZE`, https://nodejs.org/api/cli.html (read 2026-11-01)
- [S13] RFC 6238 §1.2, §5.2, §6, Appendix B, https://www.rfc-editor.org/rfc/rfc6238.txt (read 2026-11-01)
- [S14] Google Authenticator Key URI Format wiki, https://github.com/google/google-authenticator/wiki/Key-Uri-Format (read 2026-11-01)
- [S15] Apple Support, Passwords: set up a verification code, https://support.apple.com/guide/passwords/mchl873a6e72 (read 2026-11-01)
- [S16, S17] SecLists `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` and LICENSE (MIT, "Copyright (c) 2018 Daniel Miessler"), https://github.com/danielmiessler/SecLists (read 2026-11-01)
- [S18] Bitwarden, NCSC password list page, https://bitwarden.com/resources/ncsc-password-list.md (read 2026-11-01)
- [S19] Have I Been Pwned, Pwned Passwords page, https://haveibeenpwned.com/Passwords (read 2026-11-01)
- [S20] PwnedPasswordsDownloader README and LICENSE (BSD 3-Clause), https://github.com/HaveIBeenPwned/PwnedPasswordsDownloader (read 2026-11-01)
- [S21] RFC 9700 §4.14, https://www.rfc-editor.org/rfc/rfc9700.txt (read 2026-11-01)
- [S22] Auth0, Configure Refresh Token Rotation (leeway), https://auth0.com/docs/secure/tokens/refresh-tokens/configure-refresh-token-rotation.md (read 2026-11-01)
- [S23] Auth0, Refresh Token Rotation, https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation (read 2026-11-01)
- [S24] IETF, draft-ietf-httpbis-rfc6265bis-22 (§4.1.2.7, §4.1.3.2, §5.1.4, §5.2, §5.6.7.1), https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis (read 2026-11-01)
- [S25] Public Suffix List, https://publicsuffix.org/list/public_suffix_list.dat (read 2026-11-01; `vercel.app` present)
- Repository, read 2026-11-01: `docs/roadmap.md` (PLAT-11, Q-7, Q-23, A-3), `docs/architecture/identity-and-tenancy.md` (§3.1, §3.3, §4), `adr/0032-browser-reaches-api-on-web-origin.md`, `adr/0038-separate-admin-console-application.md`, `apps/api/package.json` (`jose` 6.2.13), `AGENTS.md`.

Scratch work was in `/tmp` and was deleted. No repository file other than this note was written.
