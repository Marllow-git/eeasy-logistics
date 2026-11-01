# Client library census: driver app and web app

Date of research: 2026-11-01. Requested by the lead. Researcher: `researcher` agent.
Scope: 12 categories (driver categories 1 to 6, web categories 7 to 12). Each candidate lists repo, stars, last push or release, licence, maintenance signal, Expo / React / Next compatibility as stated, and fit with ADRs.

Legend: **[S]** = stated by the source (named in the row or in Sources, with the page date shown on it). **[I]** = inference by the researcher, not stated by any source read. "not read" = the source was not opened in this session.

## Summary for the lead

1. Expo SDK 58 docs (page dated 2026-10-16) state the New Architecture is always on from SDK 55 and cannot be disabled, so every RN candidate must support it.
2. ADR-0034 names `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. The Expo SDK 58 secure-store page lists that value as **deprecated** and points to the AFTER_FIRST_UNLOCK level. The owner should decide before the ADR is accepted.
3. PowerSync's self-hostable service is licensed FSL-1.1-ALv2 (not OSI-approved); its SDK is Apache-2.0. Its native SQLite adapter needs a native build (not Expo Go).
4. Background location: expo-location + expo-task-manager is the Expo-native path. react-native-background-geolocation (Transistorsoft) is free in DEBUG but its README requires a paid licence key for RELEASE builds (per-app prices $399 to $999 on the vendor shop).
5. No Argon2 library found with a stated New Architecture and maintenance record fit for ADR-0034. react-native-argon2 (poowf) has a stale compatibility table; react-native-argon2-turbo (New Architecture only) has 0 stars and a 2026-08 first release. react-native-quick-crypto does not mention Argon2.
6. Android 15 timeouts (6 h per 24 h for dataSync and mediaProcessing) and the BOOT_COMPLETED restriction do not cover the `location` type [S]. Android 14+ forbids creating a location foreground service from the background, except listed exemptions [S]. Android 16 pages read cover only a background-job quota rule for all apps [S].
7. Web primitives: Radix, Base UI v1.9.0 and React Aria all document RTL support, but they differ: Base UI's `DirectionProvider` does not set the `dir` attribute; React Aria sets `lang`/`dir` from `useLocale()`.
8. Next.js docs (2026-03-20 CSP page, 2026-09-04 proxy page) [S]: nonce CSP forces dynamic rendering, PPR is incompatible, and proxy runs on Node.js by default. web.md section 3.6 keeps `style-src 'unsafe-inline'`; the Next docs do not address inline style attributes [I].
9. Tremor (`tremorlabs/tremor`) last pushed 2025-10-10, peer `react ^18` only [S]. Material React Table requires `@mui/material >=6` [S], which conflicts with ADR-0033's single styling system [I].
10. Download volumes (npm last week, 2026-10-23 to 2026-10-29) are in the tables; they are popularity signals, not quality signals.

## Method and dates

- GitHub metadata: `gh api repos/<owner>/<repo>` and `gh api repos/<owner>/<repo>/releases/latest`, read 2026-11-01 07:36 UTC. Several repos have no "latest release" (tag-only); the tag shown is the newest tag the endpoint returned.
- npm downloads: `https://api.npmjs.org/downloads/point/last-week/<pkg>`, window 2026-10-23 to 2026-10-29, read 2026-11-01. Some packages were not counted because the API rate-limited the session; those cells say "n/r".
- npm latest version and peer dependency ranges: `https://registry.npmjs.org/<pkg>/latest`, read 2026-11-01.
- Expo facts: version-pinned SDK 58 reference pages (`https://docs.expo.dev/versions/v58.0.0/...`), read 2026-11-01. Repo `apps/driver/package.json` pins `expo` 58.0.22 and `react-native` 0.88.1.
- Next facts: `https://nextjs.org/docs/...` pages, read 2026-11-01; repo `apps/web/package.json` pins `next` 16.4.3.

## 1. Local DB and offline sync (driver)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Expo / RN / New Arch as stated | Fit with ADRs and driver doc 3 |
|---|---|---|---|---|---|---|
| **expo-sqlite** (current choice) | expo/expo, 53,259 | repo pushed 2026-10-31 | MIT (repo) | 2,555,070 | Expo SDK 58 reference [S, 2026-10-19 page]: sync and async APIs; WAL recommended; `withTransactionAsync` "can be interrupted by other async queries"; SQLCipher "not supported on Expo Go". No New Architecture note on the page (SDK 55+ always on, per guide dated 2026-10-16). | Matches driver doc 3.2 (outbox in SQLite, WAL, forward-only migrations). Expo-managed, no extra native build for SQLite itself [I]. |
| **op-sqlite** | OP-Engineering/op-sqlite, 1,053 | pushed 2026-10-29; release 19.0.3, 2026-10-29 | MIT | 911,285 | README: "Fastest SQLite library for react-native" [S]; supports SQLCipher and libsql as compile targets [S]. README and docs site (dated not shown) do not mention Expo or New Architecture [S, absence]. PowerSync's SDK needs `op-sqlite` >= 1.17.0 as a direct dependency [S, PowerSync page]. | Needs a native build and a direct dependency, not Expo Go [I, from the PowerSync statement]. Encryption options exist (SQLCipher) but the docs read do not state how to enable them. |
| **PowerSync** (SDK + self-hosted service) | powersync-ja/powersync-js, 737 (Apache-2.0); powersync-ja/powersync-service, 398 (FSL-1.1-ALv2) | SDK `@powersync/react-native` 2.3.3, 2026-10-19; service tag v1.27.2, 2026-10-24 | SDK Apache-2.0 [S, GitHub]; **service FSL-1.1-ALv2** [S, LICENSE file] | RN 84,034; web 159,782 | Native adapter needs op-sqlite >= 1.17.0; "not compatible with Expo Go's sandbox" [S]. Sync via Sync Streams from the source DB; SDK licence and service licence not stated on the page [S, absence]. | Puts a sync engine between app and Postgres. Driver doc 3 and ADR-0008 use our outbox and idempotent API. The sync engine would own replay [I]. FSL restricts competing uses (general FSL term, text not read in full) [I]. |
| **ElectricSQL** | electric-sql/electric, 10,420 | pushed 2026-10-06; GitHub latest tag is `y-electric@0.1.54`, 2026-09-09 (core Electric release not resolved) | Apache-2.0 [S, GitHub] | `@electric-sql/react` 35,757 | Deployment page (electric.ax, redirected from electric-sql.com) [S]: any Postgres 14+, logical replication, the Electric role needs `REPLICATION`; Electric is an Elixir service in Docker; "By default Electric exposes database contents publicly" and recommends an API or proxy in front. No React Native or Expo client statement [S, absence]. | Read path (shapes over HTTP). Access control sits outside Electric, so tenancy (ADR-0025) and RLS would be enforced in our proxy layer [I]. Writes not described on the page read. |
| **Zero (Rocicorp)** | rocicorp/mono, 3,431 | pushed 2026-10-31; GitHub "latest release" returns a 2023 tag (`v12.2.2-source`); npm is the active channel | Apache-2.0 [S, GitHub]; README says tests for zero-cache and zql were removed from the public repo on 2026-09-30 and earlier copies stay Apache-2.0 [S] | `@rocicorp/zero` 256,281 | Intro docs (undated) state no client platform, server requirement, licence or status [S, absence]. | Fit with Expo and our Postgres is **not established** by the sources read. |
| **WatermelonDB** | Nozbe/WatermelonDB, 11,797 | pushed 2026-09-16; npm 0.28.0 | MIT | 115,717 | README: "Offline-first. Sync with your own backend" [S]. No Expo or New Architecture statement read. | Its sync protocol is pull and push against your backend [S, README link], which is close to our outbox shape [I]. Last push about six weeks before read. |
| **TinyBase** | tinyplex/tinybase, 5,206 | release v10.0.0, 2026-09-24; npm 10.0.1 | MIT | 20,217 | README lists "Expo SQLite" persister [S]; npm peer dependency `expo ^57` (not 58) [S, registry]. Native CRDT `MergeableStore` [S]. | ADR-0008 rejects "full CRDT sync" as unnecessary for an append-only per-order stream [S, ADR]. TinyBase's centre is CRDT [S]. |
| **Legend-State** | LegendApp/legend-state, 4,225 | pushed 2026-10-10; npm 2.1.15 | MIT | 164,129 | README: "Local persistence plugins for the browser and React Native ... sync plugins for Keel, Supabase, TanStack Query, and fetch" [S]. | A state library with persistence and a `fetch` sync plugin, not a relational store [I]. |

Labels: the sync-engine rows are sourced to their docs; the "fit" column is inference against ADR-0008, ADR-0024 (outbox), ADR-0025 (tenancy) and ADR-0031 (ledger single writer).

## 2. Background location (driver)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Expo / platform rules as stated | Fit |
|---|---|---|---|---|---|---|
| **expo-location + expo-task-manager** (planned) | expo/expo, 53,259 | repo pushed 2026-10-31 | MIT | expo-location 3,782,990; expo-task-manager 1,840,103 | Expo SDK 58 location page (2026-09-25) [S]: `startLocationUpdatesAsync` with `TaskManager.defineTask` at top level; iOS needs a development build (not Expo Go); "Background location will stop if the user terminates the app"; Android: "A terminated app will not automatically restart when a location or geofencing event occurs". Android 14+: `FOREGROUND_SERVICE_LOCATION` and `isAndroidForegroundServiceEnabled` required [S]. `ACCESS_BACKGROUND_LOCATION` needs store review [S]. `deferredUpdatesInterval` defaults to 0; `timeInterval` default "may depend on accuracy", no number [S]. No New Architecture note on the page [S, absence]. | Matches driver doc 6.2 cadence fields by name (`timeInterval`, `distanceInterval`, `deferredUpdatesInterval`, `accuracy`). The driver doc's `Accuracy.High` / `Balanced` options exist [S]. |
| **expo-background-task** (drain trigger, not location) | expo/expo | same | MIT | 661,062 | Docs v58 [S, page undated]: minimum interval 15 minutes; "Tasks won't run exactly on schedule"; iOS BGTaskScheduler, Android WorkManager. | Fits driver doc 3.3 "opportunistic" replay trigger [I]. Cannot be used for a time-exact location cadence [S]. |
| **react-native-background-geolocation** (Transistorsoft) | transistorsoft/…, 2,946 | pushed 2026-10-29; no GitHub release endpoint result | Repo LICENSE is MIT [S, file]; README: "A license is required for **RELEASE** builds on both iOS and Android"; DEBUG is free; 30-day release trial [S, README 2026-11-01]. Shop: per-app-identifier perpetual licences: Starter $399 (1 app), Venture $599 (5), Pro $749 (25), Studio $999 (100), with one year of updates [S, shop page © 2026]. | npm `react-native-background-geolocation` latest 5.8.2; npm wk 101,329 | README: "Background Geolocation for React Native & Expo" and an Expo install section [S]. v4 licence keys do not work with v5 [S]. New Architecture and Expo SDK 58 not stated in what was read [S, absence]. | Paid per app identifier for release builds [S]. Licence cost is a owner-level decision [I]. |
| gabriel-sisjr/react-native-background-location | 33 stars | pushed 2026-10-27 | MIT | n/r | README: TurboModule-based [S, repo description]. Not vetted further. | Low adoption [I]. |

Android rules (all read 2026-11-01):
- Android 12+: no FGS start from background except listed exemptions [S, restrictions page].
- Android 14+: location (camera, microphone) FGS cannot be **created** from background even if an exemption applies; it throws `SecurityException` [S].
- Location FGS started from the background may still use location in foreground when started by a notification, widget, or system component [S].
- Android 15 (targetSdk 35+): `dataSync` and `mediaProcessing` get a 6-hour-per-24-hour limit; `BOOT_COMPLETED` receivers cannot launch dataSync, camera, mediaPlayback, phoneCall, mediaProjection or microphone FGS types [S]. The page does not restrict `location` [S, absence].
- Android 16 (API 36): background jobs started from an FGS must follow runtime quotas, for all apps on Android 16 [S, changes page]. The Android 16 behaviour-change page read covers only the health-type change [S].
- Inference from the restriction page: driver doc 6.2 "reconciled with `me` on every app start" is safe only while the app is in front when the location FGS is created. A restart from a background job would hit the Android 14+ rule [I].

## 3. Barcode and QR scanning (driver)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Docs and stated behaviour | Fit / speed |
|---|---|---|---|---|---|---|
| **expo-camera** scanner | expo/expo | same as above | MIT | 3,863,171 | Docs v58 (2026-09-15) [S]: `onBarcodeScanned`, `barcodeScannerSettings` with 13 types (qr, code128, ean13, ...); `launchScanner` and `onModernBarcodeScanned` on Android and iOS; `scanFromURLAsync` (iOS QR only) [S]. **No frame-rate or speed figures** [S, absence]. Included in Expo Go [S]. | Expo-managed. Speed not sourced. |
| **react-native-vision-camera** code scanner | mrousavy/react-native-vision-camera, 9,650 | pushed 2026-10-29; v5.2.4 2026-10-29 | MIT | 886,334 | Docs (visioncamera.margelo.com, undated, no version) [S]: MLKit-based barcode scanner; `<CodeScanner />` view, `useBarcodeScannerOutput`, frame-processor path `useBarcodeScanner` with `scanCodes(frame)`; `barcodeFormats` narrowing "to improve performance"; **no fps or throttling figures** [S]. Requires `react-native-vision-camera-barcode-scanner` [S]. No Expo or New Arch statement [S, absence]. | Heavier native stack; frame-processor path needs worklets [I]. |
| expo-barcode-scanner | expo (legacy package), npm latest 13.0.1 | n/r | n/r | 26,789 | npm shows no deprecation flag [S, registry]. Expo SDK 58 camera docs do not mention it [S, absence]. | Status unresolved. |

Speed for warehouse scanning: neither sourced page gives a benchmark. Unanswered (see end).

## 4. Argon2 native for React Native (driver, ADR-0034)

| Candidate | Repo / stars | Last push / release | Licence | npm | Stated behaviour | Fit with ADR-0034 |
|---|---|---|---|---|---|---|
| **react-native-argon2** (poowf) | poowf/react-native-argon2, 10 | pushed 2026-03-22; npm latest 4.0.0, published 2025-11-13 | MIT | wk 10,888 | README: iOS uses Argon2Swift, Android uses argon2kt [S]; example default `m=32768, t=2, p=1` [S]. **Compatibility table stops at RN 0.63.3 (package 1.0.0)** [S, README] — stale. No New Architecture statement [S, absence]. | ADR-0034 needs 19 MiB, 2 iterations, 16-byte salt [S, ADR]. Whether the API accepts those parameters: not verified [U]. |
| **react-native-argon2-turbo** (nitishxyz) | nitishxyz/react-native-argon2-turbo, 0 | pushed 2026-08-22; npm 0.1.2, 2026-08-22 | MIT | n/r | README: TurboModule, "React Native 0.75+, New Architecture only", Argon2i/d/id, iOS + Android [S]. "10x faster" is the author's claim, not measured here [S, vendor claim]. | New Architecture only, which matches SDK 58 [I]. Zero stars and a first release weeks ago: maintenance and audit history not established [I]. |
| **react-native-quick-crypto** (margelo) | margelo/react-native-quick-crypto, 1,071 | pushed 2026-10-28; v1.1.9, 2026-10-26 | GitHub reports **NOASSERTION**, not an SPDX licence [S] | wk 377,793 | README mentions no Argon2 [S, grep of README]. It implements Node's `crypto` module [S, repo description]. | **Not an Argon2 candidate** [S, absence]. Licence must be read before any use [I]. |
| noble-hashes (pure JS) | paulmillr/noble-hashes, 941 | pushed 2026-09-08 | MIT | n/r | Repo description: "Audited & minimal JS implementation of hash functions, MACs and KDFs" [S]. Argon2 coverage and on-device speed **not checked**. | Pure JS, no native module. Speed at 19 MiB on low-end Android not measured [U]. |

Expo SDK 58 native module note: adding a native module requires a native build (driver doc 12.4, repo ADR-0035) [S, repo docs]. Expo Go is not an option for these candidates [I].

## 5. Secure storage, push, MMKV, AsyncStorage (driver)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Stated behaviour | Fit |
|---|---|---|---|---|---|---|
| **expo-secure-store** | expo/expo | same | MIT | 9,754,988 | Docs v58 (2026-09-15) [S]: Keychain (iOS, `kSecClassGenericPassword`) and SharedPreferences encrypted with Android Keystore (Android). `keychainAccessible` list: AFTER_FIRST_UNLOCK; **AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY (deprecated)**; ALWAYS (deprecated); ALWAYS_THIS_DEVICE_ONLY; WHEN_PASSCODE_SET_THIS_DEVICE_ONLY; WHEN_UNLOCKED (default); WHEN_UNLOCKED_THIS_DEVICE_ONLY [S]. Android data not preserved on uninstall; iOS persistence across reinstall "not guaranteed" [S]. "Expo does not enforce a limit"; older iOS rejected values above roughly 2048 bytes [S]. | **ADR-0034 names the deprecated value** [S, ADR vs docs]. ADR-0034 also says the verifier is "never backed up" [S, ADR]; the docs say `THIS_DEVICE_ONLY` items are not migrated on restore [S]. |
| react-native-keychain | n/r | not checked | n/r | 650,420 | Not read. | Not evaluated. |
| **expo-notifications** | expo/expo | docs v58 (2026-10-09) | MIT | 8,316,825 | Remote push unavailable in Expo Go on Android "from SDK 53"; development build required [S]. Android 13+: permission prompt does not appear until a notification channel exists; `setNotificationChannelAsync` must run before token request [S]. `projectId` default from `Constants.expoConfig.extra.eas.projectId`, recommended to set manually [S]. Expo push service rate limits: not stated [S, absence]. | Driver doc 8.2 channels (offers, run, cash) match the channel requirement [I]. |
| **react-native-mmkv** | margelo/react-native-mmkv, 8,522 | release v4.3.2, 2026-06-22; pushed 2026-10-08 | MIT | 2,346,365 | V4 is a Nitro Module; needs `react-native-nitro-modules`; Expo install runs `npx expo prebuild` [S, README]. | Not Expo Go (prebuild step) [I]. Not for secrets; ADR-0034 keeps the verifier in the OS secure store [S, ADR]. |
| AsyncStorage | react-native-async-storage/async-storage, 5,073 | release 3.1.1, 2026-05-29; pushed 2026-10-26 | MIT | 10,449,112 | README has no Expo or New Architecture statement [S, absence]. | Plain key-value, unencrypted [I]. |

## 6. Server state and client state (driver and web)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Stated behaviour | Fit |
|---|---|---|---|---|---|---|
| **TanStack Query** (planned, web.md 2.2) | TanStack/query, 50,507 | release tag `release-2026-10-26-0932`; pushed 2026-11-01 | MIT | 79,359,425 | RN guide (undated) [S]: `onlineManager` wired to NetInfo or `expo-network`; `focusManager` wired to `AppState`. Offline mutation persistence: **not covered** on the page read [S, absence]. Peer `react ^18 || ^19` [S, registry]. | Web already plans it (web.md 2.2, Orval). Driver doc 3 owns its own outbox, so TanStack Query would not replace the outbox [I]. |
| Zustand | pmndrs/zustand, 58,888 | v5.0.16, 2026-10-22 | MIT | 86,597,741 | Peer `react >=18` [S, registry]. | Client state only [I]. |
| Jotai | pmndrs/jotai, 21,305 | v3.0.1, 2026-09-29 | MIT | 9,053,186 | Peer `react >=18` [S, registry]. | Atomic client state [I]. |
| Legend-State | see section 1 | see section 1 | MIT | 164,129 | Fetch sync plugin and TanStack Query plugin [S]. | Overlaps both rows [I]. |

## 7. Component primitives (web, ADR-0033)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | RTL as stated | Maintenance / React |
|---|---|---|---|---|---|---|
| **Radix Primitives** (planned) | radix-ui/primitives, 19,459 | pushed 2026-10-14; umbrella `radix-ui` 1.8.1 (registry) | MIT | `radix-ui` 24,909,307; `@radix-ui/react-dialog` 88,502,473 | Docs (undated) [S]: wrap in `Direction.Provider` with `dir`; "all of the primitives adjust their behavior based on the `dir` prop". Per-component keyboard behaviour not stated [S, absence]. | Peer `react ^16.8 || ... || ^19` for dialog 1.3.1 [S, registry]. |
| **Base UI** | mui/base-ui, 11,271 | release v1.9.0, 2026-10-09; pushed 2026-10-31 | MIT | `@base-ui/react` 26,169,449 | Docs v1.9.0 [S]: `DirectionProvider` with `direction` ('ltr' or 'rtl', default 'ltr'); "does not affect HTML and CSS"; app must set `dir` itself; `useDirection` for portals [S]. Keyboard flip per component not stated [S, absence]. | Peer `react ^17 || ^18 || ^19` [S, registry]. |
| **React Aria / React Aria Components** | adobe/react-spectrum, 16,004 (Apache-2.0) | pushed 2026-10-29 | Apache-2.0 [S] | `react-aria-components` 7,637,101 | React Aria docs (react-aria.adobe.com, undated) [S]: "supports right-to-left interactions (e.g. keyboard navigation)"; `I18nProvider` locale; auto-detects locale; `useLocale()` returns `direction`, set on `<html lang dir>`; grid and flex mirror automatically. Per-component keyboard list not stated. | Active. |
| **shadcn/ui** (distribution) | shadcn-ui/ui, 127,084 | CLI `shadcn@4.23.0`, 2026-10-27 | MIT | 16,711,958 | Not an RTL library; copies component source into the repo [S, repo description "Build your own component library"]. | ADR-0033 uses "the shadcn pattern" [S]. Which primitive layer shadcn currently targets was not read [U]. |

## 8. Data tables and grids (web, ops dashboards)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | RTL / stated behaviour | Fit |
|---|---|---|---|---|---|---|
| **TanStack Table** (planned) | TanStack/table, 28,537 | pushed 2026-10-21; npm `@tanstack/react-table` latest 9.3.1 (registry) | MIT | 33,804,945 | Headless [S, repo description]. No RTL feature read; column order follows `dir` in our markup per web.md 6.3 [S, ours]. Peer `react >=18` [S, registry]. | Matches ADR-0033. |
| **TanStack Virtual** (planned) | TanStack/virtual, 7,178 | pushed 2026-10-30 | MIT | 39,240,886 (react-virtual) | Headless virtualiser [S]. Peer `react ^16.8 ... ^19` [S, registry]. | Matches ADR-0033. |
| **AG Grid Community** | ag-grid/ag-grid, 15,671 | release 36.2.0, 2026-09-16; pushed 2026-10-31 | GitHub reports NOASSERTION [S]; Enterprise is a separate commercial edition [I, not read] | ag-grid-community 4,995,246; ag-grid-react 3,725,464 | Source search finds `enableRtl` in `packages/ag-grid-community/src` (35 hits) [S, code search]. Docs page `ag-grid.com/react-data-grid/right-to-left/` returned **404** [S]. | Peer `react ^16.8 ... ^19` [S, registry]. |
| Material React Table | KevinVandy/material-react-table, 1,808 | pushed 2026-06-05 | MIT | 462,486 | Built on Material UI; peer `@mui/material >=6` [S, registry]. | Second styling system conflicts with ADR-0033 [I]. Last push about five months before read. |

## 9. Forms (web)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Stated behaviour | Fit |
|---|---|---|---|---|---|---|
| **react-hook-form** (planned) | react-hook-form/react-hook-form, 44,896 | v7.91.0, 2026-10-23; pushed 2026-11-01 | MIT | 60,500,655 | Repo description "React Hooks for form state management and validation (Web + React Native)" [S]. Peer `react ^16.8 ... ^19` [S, registry]. | Matches ADR-0033 and web.md 6.3 (Zod resolver). |
| TanStack Form | TanStack/form, 6,759 | pushed 2026-10-31; `@tanstack/react-form` 1.33.5 (registry) | MIT | 5,867,204 | "Headless ... type-safe form state management" [S]. Peer `react ^17 ... ^19` [S, registry]. Next server actions: not read. | Adds a second form system alongside TanStack Query [I]. |
| Conform | edmundhung/conform, 2,587 | v1.21.3, 2026-10-31; pushed 2026-10-31 | MIT | `@conform-to/react` 416,963 | Repo description "Progressively enhance HTML forms with React" [S]. Peer `react >=18` [S, registry]. | Its progressive enhancement targets server actions [I]. web.md 2.2 bans server actions in waves 0 to 4 [S, web.md], so that benefit does not apply now [I]. |

## 10. i18n (web)

| Candidate | Repo / stars | Last push / release | Licence | npm wk | Stated behaviour | Fit |
|---|---|---|---|---|---|---|
| **next-intl** (planned) | amannn/next-intl, 4,390 | v4.14.9, 2026-10-02 | MIT | 9,354,405 | Docs (undated) [S]: ICU message syntax; `plural` with `=0`, `zero`, `one`, `two`, `few`, `many`, `other`; `select` requires `other`. Lists Arabic, Hebrew, Persian as RTL; "Proper RTL support requires the dir attribute" [S]. Peer `next ^12 ... ^16`, `react ^19` [S, registry]. Next 16.4.3 is in the peer range `^16.0.0` [S]. Type-safety method: not read in detail [U]. | Matches web.md 5 (non-routing mode, types from `ar`). |
| Lingui (`@lingui/core`, `@lingui/react`) | lingui/js-lingui, 5,933 | v6.11.0, 2026-10-29 | MIT | `@lingui/core` 2,655,783 | Repo description: "readable, automated, and optimized (2 kb) internationalization" [S]. Peer `react ^16.14 ... ^19` [S, registry]. Docs not read. | Not evaluated beyond metadata. |
| Paraglide JS (`@inlang/paraglide-js`) | opral/inlang, 2,006 (repo description "Git-based translation management system"; GitHub licence NONE) [S] | npm 2.29.3 (registry); `opral/monorepo` returned 404 [S] | not stated | 1,277,504 | Docs not read. | Repo location for Paraglide not confirmed [U]. |

## 11. Charts (web)

| Candidate | Repo / stars | Last push / release | Licence | npm | RTL | Notes |
|---|---|---|---|---|---|---|
| Recharts | recharts/recharts, 27,677 | v3.10.1, 2026-07-25; pushed 2026-10-31 | MIT | n/r | CHANGELOG has no "rtl" hit [S, code search]; source has 137 `rtl` hits [S, code search]; no documented RTL option read [U]. | Peer `react ^16.8 ... ^19` [S, registry]. |
| visx | airbnb/visx, 21,092 | v4.0.0, 2026-06-11; pushed 2026-06-22 | MIT | `@visx/visx` 119,435 | Low-level primitives; RTL not read [U]. | Peer `react ^18 || ^19` [S, registry]. Last push about four months before read. |
| Apache ECharts | apache/echarts, 67,651 | 6.1.0, 2026-05-19; pushed 2026-10-13 | Apache-2.0 | `echarts` 9,056,410; `echarts-for-react` 2,250,025 | RTL not read [U]. | Canvas or SVG rendering; not checked. |
| Tremor | tremorlabs/tremor, 3,684 | pushed **2025-10-10** (about 13 months before read) [S] | Apache-2.0 [S] | `@tremor/react` 554,899 | RTL not read [U]. | Peer `react ^18.0.0` only [S, registry]. Stale. |

## 12. Security helpers for Next.js (web)

### 12a. CSP nonce in proxy.ts (official docs)

Stated [S, Next CSP guide, lastUpdated 2026-03-20; proxy reference, lastUpdated 2026-09-04]:
- Nonce created in `proxy.ts` per request; the CSP header is set on both the request and response; the nonce is passed in `x-nonce`.
- "Every time a page is viewed, a fresh nonce should be generated. This means that you must use dynamic rendering to add nonces."
- Force dynamic with `await connection()` (`next/server`).
- "Static optimization and Incremental Static Regeneration (ISR) are disabled"; "Partial Prerendering (PPR) is incompatible with nonce-based CSP".
- `proxy.ts` runs on the Node.js runtime by default; a `runtime` option in proxy throws [S].
- The proxy docs list authentication, logging and redirects as its use; they name no rate-limiting use [S, absence].
- Server functions are POST requests to the route they belong to; a matcher that excludes a path also skips them [S].
- Example CSP uses `style-src 'self' 'nonce-${nonce}'` [S]; dev adds `'unsafe-inline'` for styles [S].

Our current design [S, web.md 3.6]: `style-src 'self' 'unsafe-inline'` because Radix positions popovers with inline styles; per-request nonce; `worker-src 'self' blob:` for MapLibre.

Inference [I]: a nonce covers `<style>` and `<script>` elements, not inline `style` attributes set by JavaScript; the Next docs do not discuss attributes, so this is unverified. The web.md choice (unsafe-inline for styles) is consistent with that reading.

### 12b. next-safe-action

- Repo `next-safe-action/next-safe-action`, 3,085 stars, MIT, pushed 2026-10-12; npm 8.7.3, weekly 549,164 [S].
- Peer `next >= 14.0.0`, `react >= 18.2.0` [S, registry]. Next 16 is covered by the range, but no Next 16 test is stated [I].
- Adapter for react-hook-form, 88 stars, pushed 2026-03-06 [S].
- Fit: it is a server action wrapper; web.md 2.2 bans server actions in waves 0 to 4 [S, web.md], so this conflicts with the current architecture doc [I].

### 12c. Rate limiting at the Next edge

- `@upstash/ratelimit` v2.2.0, 2026-09-23; repo `upstash/ratelimit-js`, 2,049 stars, MIT, pushed 2026-10-27; npm weekly 3,057,854 [S]. Repo description: "Rate limiting library for serverless runtimes" [S].
- Backend: the library needs a Redis store; the read sources did not say which Redis service is required [U]. Inference: it needs Upstash Redis or a compatible store, which would not be self-hosted in the Gulf-region host (ADR-0022) without extra work [I].
- Arcjet: not checked (search rate-limited).
- Next proxy runs on the Node.js runtime and sees every request in its matcher [S], so an edge rate limit is possible in proxy, but the docs do not describe rate limiting as an intended use [S, absence].

## Trade-offs the sources name

- expo-sqlite sync APIs "can block the JavaScript thread"; async variants do not [S, Expo SQLite docs].
- expo-sqlite: SQLCipher is not in Expo Go and `PRAGMA key` silently does nothing if the binary lacks SQLCipher [S].
- op-sqlite: "Fastest SQLite library for react-native"; SQLCipher as a build target [S, README].
- PowerSync: native adapter not Expo Go compatible; sync requires a deployed service and Sync Streams [S]; service licence FSL-1.1-ALv2 [S].
- Electric: data public by default; the docs advise an API or proxy in front [S].
- Zero: removed zero-cache and zql tests from the public repo on 2026-09-30 [S, README].
- expo-location: background updates stop when the user terminates the app; a terminated Android app does not restart on location events [S].
- expo-background-task: minimum interval 15 min; "Tasks won't run exactly on schedule" [S].
- Transistorsoft: free DEBUG; paid RELEASE licence per app identifier; v4 keys do not work with v5 [S].
- Android 14+: location FGS cannot be created from the background [S].
- Android 15: dataSync and mediaProcessing have a 6-hour-per-24-hour limit; the rule applies to targetSdk 35+ [S].
- Android 16: background jobs started from an FGS follow runtime quotas, for all apps [S].
- expo-secure-store: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY and ALWAYS are deprecated; Android data is lost on uninstall [S].
- expo-notifications: Android channel must exist before token request; no Expo Go remote push on Android since SDK 53 [S].
- react-native-mmkv v4 is a Nitro module; Expo needs `expo prebuild` [S].
- react-native-argon2-turbo: New Architecture only, RN 0.75+ [S, README].
- react-native-argon2 (poowf): compatibility table stops at RN 0.63.3 [S, README].
- Base UI DirectionProvider does not set `dir`; the app must [S].
- React Aria auto-detects locale; `useLocale()` gives `direction` [S].
- Next nonce CSP: dynamic rendering only; no ISR; no PPR [S].
- Next proxy: Node.js runtime by default; `runtime` option not allowed [S].
- next-intl: RTL needs the `dir` attribute from the app [S].
- TanStack Query RN: connectivity and focus must be wired by hand (NetInfo or expo-network; AppState) [S].
- Tremor: last push 2025-10-10; peer React 18 only [S].
- Material React Table: needs MUI >= 6 [S].
- AG Grid: RTL docs page returns 404 [S]; enableRtl in source [S].

## Sources

All read 2026-11-01 unless noted.
- Expo SDK 58 location: https://docs.expo.dev/versions/v58.0.0/sdk/location/ (page modified 2026-09-25 as read)
- Expo SDK 58 SQLite: https://docs.expo.dev/versions/v58.0.0/sdk/sqlite/ (modified 2026-10-19)
- Expo SDK 58 camera: https://docs.expo.dev/versions/v58.0.0/sdk/camera/ (modified 2026-09-15)
- Expo SDK 58 secure store: https://docs.expo.dev/versions/v58.0.0/sdk/securestore/ (modified 2026-09-15)
- Expo SDK 58 notifications: https://docs.expo.dev/versions/v58.0.0/sdk/notifications/ (modified 2026-10-09)
- Expo SDK 58 background task: https://docs.expo.dev/versions/v58.0.0/sdk/background-task/ (no date shown)
- Expo New Architecture guide: https://docs.expo.dev/guides/new-architecture/ (modified 2026-10-16)
- Android FGS restrictions: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- Android FGS changes (Android 15 and 16): https://developer.android.com/develop/background-work/services/fgs/changes
- Android 15 behaviour changes: https://developer.android.com/about/versions/15/behavior-changes-15
- Android 16 behaviour changes: https://developer.android.com/about/versions/16/behavior-changes-16 (covers only the health item for FGS)
- VisionCamera code scanning: https://visioncamera.margelo.com/docs/guides/code-scanning (redirect from react-native-vision-camera.com; no version shown)
- Transistorsoft README: https://github.com/transistorsoft/react-native-background-geolocation
- Transistorsoft shop: https://shop.transistorsoft.com/ (© 2026)
- PowerSync React Native docs: https://docs.powersync.com/client-sdks/reference/react-native-and-expo (no date shown)
- PowerSync service LICENSE: https://github.com/powersync-ja/powersync-service/blob/main/LICENSE (FSL-1.1-ALv2 header)
- Zero repo README: https://github.com/rocicorp/mono
- Zero intro: https://zero.rocicorp.dev/docs/introduction (no version shown)
- ElectricSQL deployment: https://electric.ax/docs/guides/deployment (redirect from electric-sql.com; no date shown)
- Next.js CSP: https://nextjs.org/docs/app/guides/content-security-policy (lastUpdated 2026-03-20)
- Next.js proxy: https://nextjs.org/docs/app/api-reference/file-conventions/proxy (lastUpdated 2026-09-04)
- Radix DirectionProvider: https://www.radix-ui.com/primitives/docs/utilities/direction-provider
- Base UI DirectionProvider: https://base-ui.com/react/utils/direction-provider (v1.9.0)
- React Aria quality, internationalization: https://react-aria.adobe.com/quality#internationalization (redirect from react-spectrum.adobe.com)
- TanStack Query React Native: https://tanstack.com/query/latest/docs/framework/react/react-native (no version shown)
- next-intl messages: https://next-intl.dev/docs/usage/messages (version toggle shown, not identified)
- op-sqlite docs: https://op-engineering.github.io/op-sqlite/
- ADRs read: /Users/sajjad/Documents/eeasy-logistics/adr/0004, 0008, 0016, 0021, 0028, 0032, 0033, 0034, 0035, 0038
- Driver architecture: /Users/sajjad/Documents/eeasy-logistics/docs/architecture/driver-app.md (sections 3, 6, 8, 10, 12)
- Web architecture: /Users/sajjad/Documents/eeasy-logistics/docs/architecture/web.md (sections 2, 3, 5, 6, 10)
- Manifests: /Users/sajjad/Documents/eeasy-logistics/apps/driver/package.json, /Users/sajjad/Documents/eeasy-logistics/apps/web/package.json
- GitHub metadata: `gh api` calls on the repos named in the tables, 2026-11-01 07:36 UTC
- npm downloads and registry: api.npmjs.org and registry.npmjs.org, 2026-11-01

## Unanswered

1. op-sqlite: Expo SDK 58 support, config plugin and New Architecture were not stated in the README or docs read. Needs its full docs or a spike.
2. Zero and ElectricSQL: no React Native or Expo client statement was found in the pages read. Zero's server and Postgres requirement not stated.
3. PowerSync: the full FSL-1.1-ALv2 text and whether our intended use is "competing" were not reviewed. Legal reading needed. The SDK licence was not stated on its docs page.
4. Transistorsoft: New Architecture and Expo SDK 58 support not stated in what was read; whether the MIT repo licence changes the RELEASE key requirement; the owner's cost decision.
5. Android 16: the pages read cover only the background-job quota rule. The "Behavior changes: all apps" page was not read in full. No location-specific Android 16 rule was found in pages read.
6. Barcode speed: neither expo-camera nor VisionCamera publishes frame-rate or throughput figures in the pages read. A device benchmark on the target warehouse hardware is needed.
7. Argon2: react-native-argon2 option names for memory, iterations and parallelism, and whether it runs on New Architecture, were not verified. react-native-argon2-turbo's audit history and maintainer count not checked. noble-hashes Argon2 coverage and on-device time not checked.
8. ADR-0034: `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` is deprecated in the SDK 58 docs. The owner or the contracts owner must choose a replacement level before ADR-0034 is accepted.
9. expo-barcode-scanner status: docs v58 do not mention it and npm carries no deprecation flag. Its status is unresolved.
10. react-native-keychain: not evaluated.
11. Expo push rate limits: not stated in the docs read.
12. Charts RTL: Recharts, visx, ECharts and Tremor RTL behaviour not confirmed. AG Grid RTL docs returned 404; only the source flag was seen. AG Grid Enterprise licence not read.
13. Lingui and Paraglide: docs not read; ICU and RTL claims unverified; Paraglide repository not confirmed.
14. Radix and Base UI keyboard flip per component: not stated.
15. TanStack Query: offline mutation persistence was not covered by the page read.
16. next-safe-action and Next 16: no Next 16 test is stated; peer range only.
17. Rate limiting: Upstash's Redis dependency and Arcjet were not verified.
18. Maintenance thresholds: no owner-set threshold for "stale" exists in the repo; this note flags pushes older than six months as stale.
19. The inference that a Next nonce does not cover inline style attributes is unverified (see section 12a).
20. Background location: whether our planned start-on-app-start plus reconcile-on-launch (driver doc 6.2 and 6.3) avoids the Android 14+ background-start rule has not been tested on a device.
