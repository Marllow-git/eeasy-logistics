# DRV-1 · Driver app shell and sign-in

- **Status:** planned 2026-11-02; registers when the design references (`docs/references/design/DRV-1.md`, researcher in flight) are on `main`; briefs as the third executor beside WEB-4 and DEL-1 (owner ruling 2026-11-02: dependencies merged, files disjoint: `apps/driver` and the `driver` i18n namespace against `apps/admin` and `apps/api`).
- **Date:** 2026-11-02
- **Wave:** 1 (roadmap §1.2). **Depends on:** PLAT-15 (merged: the `driver` contracts entry), DEL-4 (merged, PR #114: the driver doors, device binding, the cash PIN, the account choice), INT-4 (merged: push tokens are accepted). **Unblocks:** DRV-2 (outbox and sync), DRV-3 and DRV-4 (the field loop), DRV-5 (push).
- **Lead:** architecture lead. **Executor:** `executor-driver` (Opus), own worktree, native stack (the API on a scratch port with DEL-4's doors, the WhatsApp stub for the OTP, Mailpit), the iOS simulator and the Android emulator through the device tools. **Adversary:** yes, Opus (tokens and the PIN verifier on the device, secure storage, the single-flight refresh, what sign-out clears; driver-app §7 and ADR-0034).
- **Issue:** opened at registration. **Merge danger:** two-way door (no migration, no contract change). Blast radius: `apps/driver` only; the first real screens of the app; a `driver` namespace in `packages/i18n`.
- **Paths:** `apps/driver` (`app/(auth)/*`, `app/(setup)/*`, `app/(app)/*` shells, `src/` layers per driver-app §2: `ui/`, `domain/`, `sync/` (session, refresh), `platform/` (secure store, device id, network, updates), `i18n/`, `observability/`; `app.json` plugins and permission strings; `eas.json`; `test/`; `maestro/`), `packages/i18n` (`driver` namespace, both locales, the parity test), `docs/architecture/driver-app.md` §7.1 (the account picker, 2.5) and §13 (answered questions), `docs/release-notes`, `.serena/memories`. Shared seams `packages/contracts` and `packages/config`: nothing expected (`publicConfig()` for the driver app exists from PLAT-4; a missing public variable is recorded in §8.1).
- **Design references:** `docs/references/design/DRV-1.md` (Mobbin; layout and states only; ADR-0016 and ADR-0033 win).

## 0. Goal

A driver installs the app, sees it in Arabic, enters a phone number and a six-digit code, chooses the account when the phone drives for several, binds the phone as one of two devices, sets a cash PIN right after the first sign-in or arms the device verifier when a PIN exists, grants the permissions the field loop needs, and lands in a tabbed shell whose run, sync and cash tabs are placeholders for DRV-2 to DRV-4; the session refreshes once at a time across the foreground and a background task, a revoked device or a revoked family signs the driver out and clears what §7.4 says, a suspended account shows a read-only banner, an old build is told to update, and every string exists in both languages, so that DRV-2 can build the outbox on a session, a device id and a PIN verifier that already behave as the architecture says.

## 1. Binding rules and ADRs

- AGENTS.md hard rules: Arabic and English for every string; secrets never in code (the API base URL and the PostHog and Sentry keys come from `publicConfig()`); no production actions (no EAS build or submit here; the `development` profile only).
- ADR-0004 and ADR-0021 (the app is `apps/driver` in the monorepo, Expo with Expo Router, typed from `packages/contracts`); ADR-0034 "Decision" in full (the Argon2id verifier on the device, its storage class, its deletion rules, the five local failures, `driverVerifyCashPin` to arm it); ADR-0016 and ADR-0033 (a driver kit mirrored for RTL; tokens); ADR-0008 (the outbox is DRV-2's; this order creates nothing in SQLite but the refresh lease row of 2.4).
- `docs/architecture/driver-app.md` §2 (layers; the UI never touches an adapter directly), §5.2 (PIN rules: four to six digits, setup right after the first sign-in when `cash_pin_set` is false, Western digits, no digits shown, screenshots disabled on the PIN screen, never in SQLite, logs or analytics), §5.3 and ADR-0034 (the verifier), §7.1 to §7.4 (sign-in and device binding, tokens, forced sign-out, what is cleared and kept), §9 (routes and groups: `(auth)` without a session, `(setup)` until PIN and permissions are done, `(app)` with one), §10 (Arabic default, `I18nManager.forceRTL`, reload on language change, `ar-SA-u-nu-latn` and the Gregorian calendar, Unicode isolates, 56 dp targets, high contrast), §11 (Sentry and PostHog with ids only; `beforeSend` scrubbing), §12.1 (Jest with `jest-expo`; token refresh single-flight and the PIN verifier tests), §12.2 (Maestro, ADR-0035 proposed), §13.5 and Q-24 (`min_app_version`).
- `docs/contracts/openapi/driver.yaml` `driverRequestOtp`, `driverVerifyOtp` (with `account_id` and `409 account_choice_required`, `401 device_revoked`, `409 device_limit_reached`), `driverRefresh`, `driverLogout`, `driverGetMe`, `driverUpdatePushToken`, `driverSetCashPin`, `driverVerifyCashPin`; schemas `OtpRequest`, `OtpVerifyRequest`, `DeviceInfo`, `DriverSession`, `DriverRefreshRequest`, `DriverMe`, `CashPinRequest`, `CashPinVerifyRequest`; parameters `XAppVersion`, `XAppPlatform`; `docs/contracts/errors.md` for every code the screens render.
- DEL-4 plan §2.7 to §2.9 and §8.2 #26, #29 to #32, #37, #39, #40, #43 (the door behaviours the app meets: device fields validated before the code is spent; a third device `409` after the code; `account_choice_required` leaves the code valid for one retry; a revoked app id is `device_revoked` at verify and `token_invalid` at refresh; `tokenDriver()` refuses stale tokens on me and the PIN doors; the version guard reads `X-App-Version` and `X-App-Platform` on every driver route, the anonymous ones included).
- `packages/contracts` `./driver` (the generated fetch client and Zod schemas; the architecture test allows only `driver`, `http` and `unions`), `./http` (`createFetcher`, `ApiError`; the session fetcher pattern of WEB-2 is browser-only: the app writes its own on `createFetcher`).
- Owner rule: Expo skills first. The lead loaded `expo:expo-overview` (plugin 1.13.9) on 2026-11-02: the project is SDK 58 (`expo 58.0.22`, managed, no `ios/` or `android/`); the executor loads `expo:expo-router`, `expo:expo-native-ui`, `expo:expo-ui`, `expo:expo-data-fetching` and `expo:expo-dev-client`, reads the SDK 58 docs (never `latest`), installs with `npx expo install`, and records versions and dates in §8.1.
- Memories `core`, `driver/core` if one exists.

## 2. Decisions (with defaults)

| # | Decision | Default |
|---|---|---|
| 2.1 | Project shape | The three route groups of §9 with a root layout that reads the session state once (`(auth)` when none, `(setup)` while `cash_pin_set` is false or the verifier is missing or a permission is undecided, `(app)` otherwise); `src/` folders per the layers of §2 with a dependency-cruiser rule (UI → domain and sync; sync → platform; platform → nothing of ours); a `development` EAS profile and dev client (`expo-dev-client`), since the Argon2 module and secure storage class need a native build; no store or preview profile here |
| 2.2 | Language and direction | `ar` default on first launch; the choice in secure storage? No: in plain app storage (`expo-sqlite` key-value or `AsyncStorage`-class store, not the secure store); `I18nManager.forceRTL` plus `expo-updates` `reloadAsync` on change; strings from `packages/i18n` `driver` namespace (new; the parity test covers it; the executor records how the app loads the catalogue without the web's next-intl); `Intl` with `ar-SA-u-ca-gregory-nu-latn`; isolates around phone numbers and codes; the driver kit's base components (`Screen`, `Button` 56 dp, `TextField`, `Keypad`, `Banner`, `Sheet`) mirrored for RTL with the token set of ADR-0033 ported to React Native styles (no Tailwind in the app unless `expo:expo-tailwind-setup` is the executor's reasoned pick, recorded) |
| 2.3 | Device id and storage | A UUID v4 generated on first launch (`expo-crypto`), kept in `expo-secure-store` under the `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` class, never backed up; no hardware identifier is read; the refresh token in the same class; the access token in memory only; the PIN verifier in the same store (2.6); nothing of these in SQLite, logs or analytics |
| 2.4 | API client and session | `src/sync/session.ts` on `createFetcher` of `packages/contracts/http`: every request carries `X-App-Version` (the build version from `expo-constants`) and `X-App-Platform`, `Accept-Language` from the app language, the bearer access token when one exists, an `Idempotency-Key` (UUID v7) on writes kept for the retry; refresh single-flight: one in-memory promise per JS context plus a SQLite lease row (`refresh_lease`, 30 s) shared with the background task that DRV-2 adds (this order creates the table and the lease helper, tested with two concurrent callers); refresh on `401 token_expired` and proactively 60 s before `expires_in` while in front; `driverRefresh` with the refresh token and `device_id`; `401 device_revoked` and `401 token_invalid` end the session (2.8); `403 account_suspended` keeps a read-only session behind a banner; `426 app_update_required` on any door opens the full-screen update notice (2.9); `429 rate_limited` shows the wait from `retry_after_s` |
| 2.5 | Sign-in and OTP | `(auth)/sign-in`: the phone field with the `+966` prefix offered, spaces stripped, the generic "if this number is registered, a code was sent" after `driverRequestOtp` (202 whatever the phone), a 60 s resend timer, the language switch reachable here; `(auth)/verify`: six boxes with Western digits, SMS auto-read where the OS offers it (iOS one-time-code content type; Android SMS Retriever is not wired here, §7 #3), `driverVerifyOtp` with `DeviceInfo` (the push token only when permission is already granted); `409 account_choice_required` opens the account picker sheet listing `details.accounts` by name and resends the same code with `account_id` (the code stays valid for that retry, DEL-4 8.2 #37); `409 device_limit_reached` shows "ask your dispatcher to remove an old phone" and stays; `401 device_revoked` shows "this phone was removed by your dispatcher; ask them before signing in again" and stays; `401 otp_invalid` keeps the boxes with the attempts hint; on success the tokens and `driver.id` go to secure storage, `cash_pin_set` decides the setup path; driver-app §7.1 gains the picker step (the lead amends) |
| 2.6 | PIN setup and the verifier | `(setup)/pin`: when `cash_pin_set` is false, a four-to-six-digit keypad twice (enter, confirm), then `driverSetCashPin` with a fresh OTP (`driverRequestOtp` again on the signed-in phone, the code entered on the same screen; `401 otp_invalid` and `429` handled); when a PIN exists and no verifier is on the device, one entry and `driverVerifyCashPin` (`403 cash_pin_invalid` keeps the screen with the remaining attempts, `423 cash_pin_locked` shows the locked notice with "ask your dispatcher to reset" and lets the driver continue without cash); the verifier is Argon2id (19 MiB, 2 iterations, a random 16-byte salt) computed on the device from a PIN the server has just accepted, through a native Argon2 module chosen by the executor after a Context7 check against SDK 58 (an Expo Modules API wrapper of libsodium's `crypto_pwhash` is the expected shape; a pure-JS fallback is refused unless no maintained module exists, recorded in §8.1 and §7 #2); screenshots disabled on this screen (`expo-screen-capture`); the PIN never leaves the keypad component except into the request body; five local failures (DRV-2 and DRV-4 use the check; this order ships the verifier module with its counter and tests) |
| 2.7 | Permissions | `(setup)/permissions`: location (foreground now, background explained and requested per §6.3's platform differences), notifications, camera, each with its one-sentence purpose and a "later" path; a refused background location is allowed with the warning of §13 #4 (the proposal); the choices are not stored beyond the OS; the push token is sent with `driverUpdatePushToken` when notification permission is granted or when Expo rotates it (`expo-notifications` listener) |
| 2.8 | Shell, settings and sign-out | `(app)/(tabs)`: run, sync and cash tabs as placeholder screens naming their orders (DRV-2 to DRV-4), the tab bar mirrored in Arabic; `(app)/settings`: language, the navigation app choice (Google Maps, Apple Maps, Waze; stored), "change PIN" (current PIN then the new one twice, `driverSetCashPin` with `current_pin`), "sign out" (`driverLogout`, then the clearing of §7.4: tokens, the read model (none yet), the verifier; the outbox confirmation text is wired for DRV-2 and shows no count yet); the suspended banner (read-only) from `403 account_suspended` on refresh; forced sign-out on `device_revoked` or `token_invalid` lands on `(auth)/sign-in` with the reason's notice; the device row and `min_app_version` from `driverGetMe` shown on a small "this device" line in settings |
| 2.9 | App version | `X-App-Version` and `X-App-Platform` on every request; `426 app_update_required` opens a full-screen notice with the store link placeholders from `publicConfig()` (none in wave 1: the notice says "update from your store"); `driverGetMe.min_app_version` compared on each foreground and the same notice shown when the build is older (soft, dismissible; the hard stop is the API's 426) |
| 2.10 | Observability | `@sentry/react-native` and `posthog-react-native` initialised from `publicConfig()` keys (absent keys disable them), release `<version>+<update id>`, `beforeSend` stripping names, phones, PINs, tokens and request bodies; PostHog events of §11 that exist here: sign-in, language change, PIN set, PIN locked locally, device revoked; ids only |
| 2.11 | Tests | Jest (`jest-expo`): the session's single-flight refresh under two concurrent callers and across the lease; the version header on every request; the PIN verifier (arming, five failures, wipe on server lock, nothing in SQLite); the phone normalisation; the sign-in state machine (the groups' gating) table-driven; i18n parity. Maestro flows (`maestro/`): sign-in with the stub's test OTP, the account picker on a two-account phone, PIN setup, permissions, language switch, sign-out, each in `ar` and `en` with screenshots, run by the executor on the iOS simulator and the Android emulator through the device tools against the native stack with DEL-4's seed (a seeded driver on two accounts); CI runs typecheck, lint, Jest and the architecture test (`driver-test` lane); a CI Maestro lane is §7 #1 |
| 2.12 | Release note | Arabic `docs/release-notes/2026-11-<dd>-driver-app-sign-in.md` (the driver app's first sign-in, the PIN, two devices, Arabic first) |

### 2a. Lead's improvements over the roadmap row

- **The account picker** (2.5) exists because DEL-4's adversary added `account_choice_required`; the roadmap row and driver-app §7.1 predate it.
- **The revoked-device and suspended states** are first-class screens here, not DRV-2 leftovers, since DEL-4 made a revocation stick (8.2 #39) and refresh answers differ by case.
- **The refresh lease table** ships now with two-caller tests, so DRV-2's background task finds the single-flight rule already proven instead of building it under the outbox.
- **The version headers and the 426 notice** come with the shell, because the API's guard already refuses requests without them.
- **A dev client and a native Argon2 module** are decided here, so DRV-2 to DRV-4 do not discover mid-build that Expo Go cannot run the app.

## 3. Build list

### Leg 1 (foundations, sign-in, setup)

| Item | Delivers | Verify |
|---|---|---|
| A | Project shape, dev client, language and RTL, the driver kit base, device id and storage, the API client and session with the lease, version headers and the 426 notice, observability per 2.1 to 2.4, 2.9, 2.10 | Jest: refresh single-flight, headers; the architecture test; both languages render |
| B | Sign-in, OTP, the account picker and the device notices per 2.5 | Maestro sign-in flows in `ar` and `en` against the stub |
| C | PIN setup and the verifier, permissions per 2.6, 2.7; plan §8 for the leg; memories; draft PR | Jest verifier tests; Maestro PIN and permissions flows |

### Leg 2 (shell, settings, sign-out, release note)

| Item | Delivers | Verify |
|---|---|---|
| D | Tabs, settings, change PIN, sign-out and the clearing rules, the suspended banner and forced sign-out per 2.8 | Jest gating table; Maestro settings and sign-out flows |
| E | driver-app.md §7.1 and §13 amendments; release note per 2.12; plan §8 complete; memories | gate passes |

## 4. Commit plan

One commit per item `DRV-1: <letter> <title>` with its §8.0 row, pushed after each; draft PR from the template with the exact headings; body lines `Release note: docs/release-notes/2026-11-<dd>-driver-app-sign-in.md` and `Memories:`.

## 5. Exit criteria

- A seeded driver signs in on the simulator and the emulator in Arabic and English, picks the account when two exist, sets a PIN, grants permissions and reaches the shell; a second phone binds; a third is refused with the dispatcher message.
- Two concurrent refresh callers present one token once; a revoked device signs out and clears what §7.4 says; a suspended account shows the read-only banner.
- The verifier arms from an accepted PIN, locks after five local failures, and never appears in SQLite, logs or analytics.
- Every request carries the version headers; an old build sees the update notice.
- Jest, lint, typecheck and the architecture test pass in CI; the Arabic screenshots of every screen are reviewed in §8.0; the Arabic release note exists.

## 6. Not in this order

The outbox, the sync screen and the local read model (DRV-2); the run list, offers and the field loop (DRV-3, DRV-4); push handling beyond token registration (DRV-5); shift start (DRV-3 with DEL-5); a CI Maestro lane and Toxiproxy (§7 #1); EAS preview or production builds and store submission (OPS orders); Android SMS Retriever (§7 #3).

## 7. Owner questions

| # | Question | Provisional default |
|---|---|---|
| 1 | Maestro in CI (simulator runners cost minutes and need an OPS order) | Flows run by the executor on the device tools for this order; a CI lane follows OPS-1 |
| 2 | Argon2 on the device: a native module through the Expo Modules API, or pure JS | Native (ADR-0034's "native Argon2 module"); the executor picks the library after a Context7 check and records it; pure JS only if none fits SDK 58, with the owner told |
| 3 | SMS auto-read on Android (SMS Retriever needs the app hash in the message template) | Not in wave 1; iOS one-time-code autofill only |
| 4 | Background location refused at setup (driver-app §13 #4) | Allowed with a warning, as the document proposes |

## 8. Executor notes (filled by the executor)

### 8.0 Counts

### 8.1 Deviations

### 8.2 Notes

### 8.3 Not done here

## 9. Lead review and adversary
