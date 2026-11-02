# apps/api/resources

Data files the API reads at run time. The image copies this folder next to `dist/` (`apps/api/Dockerfile`).

## `breached-passwords.sha1`

The breached-password check of staff and platform passwords (identity and tenancy §3.1; PLAT-11 plan 2.2, owner question 3): the SHA-1 digests of the passwords of 12 characters or more in the NCSC top-100k list, sorted, 20 bytes each, no separator. `modules/kernel/auth/passwords.ts` loads it once and binary-searches it; a match is refused as `400 validation_failed` with `password: breached`. The Have I Been Pwned range API is never called from a request.

| Fact | Value |
|---|---|
| Source | SecLists `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`, commit `1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56` (2025-11-19), read 2026-11-02 |
| Source sha256 | `c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0` (99,840 lines) |
| Filter | entries of 12 Unicode code points or more, exact text (a trailing carriage return dropped), duplicates removed |
| Output | 1,212 digests, 24,240 bytes, sha256 `6a877287ab8256b5884fd02e32136cab6c2fec0802d2610af4ab705c1afaa072` |
| Rebuild | download the source into a directory of its own, then `node apps/api/resources/build-breached-list.mjs <path>` |

Shorter entries are left out because the length rule (12 to 256 characters, no composition rule) refuses them before the list is read, so the pruning loses nothing.

### Attribution

SecLists, MIT licence, Copyright (c) 2018 Daniel Miessler (https://github.com/danielmiessler/SecLists). The list itself is the UK National Cyber Security Centre's "100,000 most used passwords" (PwnedPasswordsTop100k), derived from Have I Been Pwned; its own licence could not be verified (`docs/research/auth-libraries-2026-11.md`, "Not verified" 3). Only digests are shipped, never the passwords.
