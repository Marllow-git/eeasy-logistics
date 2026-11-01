# OPS-3: EAS project and store accounts

- **Date:** 2026-11-02 (pages read that day unless a page date is given). **Requested by:** the lead, roadmap row OPS-3 (`docs/roadmap.md` line 102).
- **Local reads:** `adr/0004-new-driver-app.md`, `adr/0021-driver-app-inside-the-monorepo.md`, `docs/architecture/driver-app.md` §6.2, §6.3, §7.1, §9, §12.3, §12.4, §13, `apps/driver/app.json`, `apps/driver/package.json`. No `app.config.*` and no `eas.json` exist.
- **Legend:** [S] stated by the named source. [I] inference by the researcher. [repo] from a local file. [unverified] not confirmed by a source read today. "Carried" means taken from `docs/research/play-location-policy-2026-11.md` (2026-11-01) and not re-read.

## Summary for the lead
1. **Repo today** [repo]: `app.json` has no bundle ID, Android package, `extra.eas.projectId`, `owner`, `runtimeVersion`, `updates.url` or `expo-location` plugin. `package.json` pins `expo` 58.0.22 and lacks `expo-location`, `expo-task-manager` and `expo-updates`.
2. **EAS plan** [S1]: Free lists "Up to 15 Android and 15 iOS builds" and 1,000 EAS Update MAU. Starter is $19/month and Production $199/month, both plus usage. EAS Submit is included on all plans.
3. **Expo owner** [S3, S4]: an Organization owns the project through `owner` under `expo` in `app.json`. Only an owner or admin can invite members.
4. **Apple** [S13]: $99 a year. The company must be a legal entity with a D-U-N-S Number. No approval timeline is published.
5. **Google Play** [S15, S16, S17]: $25 one-time. An organisation needs a D-U-N-S Number. The 12-tester, 14-day closed-test rule covers personal accounts created after 13 Nov 2023.
6. **Geofence date** [S21]: Google removes geofencing as an approved foreground-service use case on 27 Jan 2027. This matches the 2026-11-01 note and contradicts the vendor's "August 2026".
7. **Largest review risk** [S20, carried]: the Play `location` use cases listed are user-initiated sharing, navigation and geofencing. None names driver tracking during a shift. [I] Declaring shift-long tracking needs an owner ruling.
8. **Apple background location** [S14]: Guideline 2.5.4 allows background services "for their intended purposes" and 5.1.5 requires location to be "directly relevant". Apple's own pages for the background mode and the "Always" prompt did not render.
9. **OTP-only sign-in** [S14 2.1(a)]: a demo account is required. Reviewers cannot receive a real OTP, so an owner-approved review path is needed.
10. **Not researched:** Saudi PDPL duties for location and phone data.

## 0. Sources
| Key | Source | Page date | Read |
|---|---|---|---|
| S1 | https://expo.dev/pricing | none shown | 2026-11-02 |
| S2 | https://docs.expo.dev/eas/environment-variables/ | Jul 21, 2026 | 2026-11-02 |
| S3 | https://docs.expo.dev/accounts/account-types.md | Oct 29, 2026 | 2026-11-02 |
| S4 | https://docs.expo.dev/versions/latest/config/app/ | v58.0.0, no date | 2026-11-02 |
| S6 | https://docs.expo.dev/eas-update/getting-started/ | Oct 16, 2026 | 2026-11-02 |
| S7 | https://docs.expo.dev/eas-update/runtime-versions/ | Jul 3, 2026 | 2026-11-02 |
| S8 | https://docs.expo.dev/app-signing/app-credentials/ | none shown | 2026-11-02 |
| S9 | https://docs.expo.dev/submit/introduction/ | Oct 12, 2026 | 2026-11-02 |
| S10 | https://docs.expo.dev/submit/ios/ | Oct 12, 2026 | 2026-11-02 |
| S11 | https://docs.expo.dev/submit/android/ | Oct 9, 2026 | 2026-11-02 |
| S12 | https://docs.expo.dev/versions/latest/sdk/location/ | v58.0.0, no date | 2026-11-02 |
| S13 | https://developer.apple.com/programs/enroll/ | "© 2026" | 2026-11-02 |
| S14 | https://developer.apple.com/app-store/review/guidelines/ | none; cut off after 5.2.5 | 2026-11-02 |
| S15 | https://support.google.com/googleplay/android-developer/answer/6112435 | "© 2026" | 2026-11-02 |
| S16 | https://support.google.com/googleplay/android-developer/answer/13634885 | "© 2026" | 2026-11-02 |
| S17 | https://support.google.com/googleplay/android-developer/answer/14151465 | "© 2026" | 2026-11-02 |
| S18 | https://support.google.com/googleplay/android-developer/answer/10787469 (Data safety) | change log Dec 5, 2023 | 2026-11-02 |
| S19 | https://support.google.com/googleplay/android-developer/answer/9799150 (Location permissions) | "© 2026" | 2026-11-02 |
| S20 | https://support.google.com/googleplay/android-developer/answer/13392821 (Foreground services) | none | 2026-11-02 |
| S21 | https://developer.android.com/distribute/play-policies | dated timeline | 2026-11-02 |
| S22 | `docs/research/play-location-policy-2026-11.md` | 2026-11-01 | carried |
| T1 / T2 / T3 | Apple forum threads 117256, 671943, 771202; OTP review guides (Authgear, Descope); third-party fee and D-U-N-S guides. Search snippets | n/a | 2026-11-02, low weight |

## 1. Expo and EAS
### 1.1 Create the organisation and project
1. Create an **Organization** account. Expo advises this for team work [S3]. Roles: owner ("any action... including deleting them"), admin (paid services, permissions), developer (create projects, builds, releases, credentials), viewer. Owners grant any role; admins up to admin [S3].
2. Transfers are limited and need owner or admin on both accounts [S3]. Set `owner` under `expo` in `app.json` to link the project to the organisation. If omitted it defaults to the current user [S3, S4].
4. `eas update:configure` adds `runtimeVersion` and `updates.url` to `app.json`, and adds `extra.eas.projectId` "if your project wasn't using any EAS services previously" [S6]. The loaded `expo:eas-app-stores` skill says `eas init` "links or creates the EAS project" (skill text, not an official page read today).
5. `eas update:configure` sets the channel on the `preview` and `production` profiles in `eas.json`. Set them manually if profile names differ [S6].

Owner inputs: who holds Owner (someone who stays), who holds Admin, and the organisation name for `owner`.

### 1.2 Plan and build allowance [S1, no page date]
| Plan | Price | Builds / credit | Build timeout | Concurrency | EAS Update MAU / bandwidth |
|---|---|---|---|---|---|
| Free | $0 | Up to 15 Android + 15 iOS builds | 45 min | 5 (1 on macOS) | 1,000 / 100 GiB |
| Starter | $19/mo + usage | $45 credit, then usage | 2 h | 5 (2 on macOS) | 3,000 / 100 GiB |
| Production | $199/mo + usage | $225 credit, then usage | 2 h | 15 (10 on macOS) | 50,000 / 1 TiB |

- Build jobs are flat-rate: $1 Android medium, $2 Android large, $2 iOS medium, $4 iOS large [S1].
- The page gives build counts and credit, not build minutes, and states no period for the Free build limit [S1].
- [I] Each store cycle uses several builds: preview builds for QA, then production builds. `driver-app.md` §12.4 requires a native build for each permission-string, `UIBackgroundModes` or service-type change, so the Free 15 + 15 may not cover a cycle.

### 1.3 EAS Submit [S9, S10, S11]
- **Apple:** a paid Apple Developer account is required. Use an App Store Connect API key (`ascApiKeyPath`, `ascApiKeyIssuerId`, `ascApiKeyId` in `eas.json`) or an Apple ID with `EXPO_APPLE_APP_SPECIFIC_PASSWORD`. `ascAppId` is required in the submit profile. CI cannot prompt for the API key [S9, S10].
- **Google Play:** a service account JSON key, uploaded in the EAS dashboard or with `eas credentials --platform android`. The app must exist in Play Console first [S11]. S9 says the default first release goes to internal testing "even before you complete the store listing"; S9 and S11 differ on order [unverified].

### 1.4 EAS Update [S6, S7; repo]
- Install `expo-updates` (not installed today). Runtime policies documented: `appVersion` and `fingerprint` [S7]. `fingerprint` changes "whenever anything that may impact the native runtime changes" and means "creating builds more often" [S7]. `driver-app.md` §12.4 chooses `fingerprint`.
- Native changes need a new build, not an update [repo §12.4].

### 1.5 Repo versus EAS secrets
- **Repo:** non-secret configuration: `app.json` (bundle IDs, package, `owner`, `projectId`, `runtimeVersion`, `updates.url`, plugins), `eas.json` (profiles, channels, `ascAppId`, key file paths) [S4, S6, S10; [I] for the split].
- **The repository is public** (owner memory note, since 2026-11-01). [I] Anything committed is visible, so no key or keystore may be committed.
- **EAS environment variables** are per environment with visibility plain text, sensitive or secret. Secrets are "not readable outside of the EAS servers" [S2].
- **Client-side values are public** whatever their visibility, and secrets "do not provide any additional security for values that you end up embedding" [S2].
- **Credentials:** EAS manages the iOS distribution certificate, provisioning profiles, push keys and the Android keystore. The keystore must never be checked in [S8].
- **Store keys:** the `.p8` App Store Connect key and the Play JSON key stay outside git and are uploaded to EAS [S10, S11; [I]].

## 2. Apple
### 2.1 Developer Program enrolment for a Saudi company [S13]
- **Legal entity:** "We don't accept DBAs, fictitious businesses, trade names, or branches." The legal name becomes the seller.
- **D-U-N-S:** "must have a D-U-N-S Number", "free in most jurisdictions". Check for an existing number first.
- **Authority to bind:** owner or founder, executive, senior project lead, or an employee granted authority by a senior employee.
- **Verification:** work email on the company domain, a public website, possibly notarised documents. **Fee:** "99 USD" a year, in local currency where available. The Enterprise Program is 299 USD and a different product.
- **Steps:** Apple verifies, emails, then purchase. If no confirmation within 24 hours of purchase, contact support with the Enrollment ID.
- **Timeline:** none published [S13]. Third-party guides say D-U-N-S takes about 5 business days up to 30 days [T3, unverified].

### 2.2 App Store Connect roles
- [unverified] Apple's role page did not render. The researcher's general knowledge, not a source, says Account Holder holds agreements, tax and banking. [I] Whoever accepts agreements and creates the API key needs a role for both.

### 2.3 Background location and review [S14, read 2026-11-02]
- **2.5.4:** "Multitasking apps may only use background services for their intended purposes: VoIP, audio playback, location, task completion, local notifications, etc."
- **5.1.5:** location "only when it is directly relevant to the features and services provided by the app"; notify and obtain consent; "explain the purpose in your app".
- **5.1.1(ii):** purpose strings must "clearly and completely describe your use of the data"; consent must be withdrawable.
- **2.3.1(a):** features must be described "with specificity in the Notes for Review section"; generic descriptions are rejected.
- **Reviewer practice** [T1, anecdotal]: 2.5.4 rejections where background location was declared but no feature seemed to need it. [I] Shift tracking needs its justification in the review notes (section 4).
- **Purpose-string template:** none found on an Apple page [unverified].

### 2.4 Plugin keys [S12, v58 reference]
- `locationAlwaysAndWhenInUsePermission` and `locationWhenInUsePermission` set the two usage strings; `isIosBackgroundLocationEnabled` (default `false`) adds `location` to `UIBackgroundModes`. Raw `ios.infoPlist` is "at your own risk of rejection" [S4, S12].
- [unverified] whether the plugin exposes `showsBackgroundLocationIndicator`, `pausesUpdatesAutomatically` and `OtherNavigation` (`driver-app.md` §6.3), or they must be set in code.

### 2.5 "Always" prompt rules [unverified against Apple]
- Apple's pages for `requestAlwaysAuthorization()` rendered only titles. Forum reports [T1] say "Always" follows When In Use, and from iOS 13.4 the upgrade prompt appears at once. [I] This matches `driver-app.md` §6.3. Test on an iOS matrix.

### 2.6 OTP-only sign-in and the review account [S14 2.1(a), 4.8; T2]
- **2.1(a):** "include demo account info (and turn on your back-end service!) if your app includes a login". If a demo account is impossible "due to legal or security obligations", a built-in demo mode can replace it "with prior approval by Apple".
- **4.8** covers third-party or social login used as the primary account. It exempts apps that "exclusively use your company's own account setup and sign-in systems" [S14]. [I] Company phone-OTP is outside 4.8. Apple does not name phone OTP.
- **Reviewer cannot receive the OTP.** Vendor practice is an account-scoped fixed code with SMS suppressed for one reviewer number [T2]. Vendors warn a static code must match only that account.
- [I] The brief says sign-in is WhatsApp OTP, and ADR-0041 routes messages through the WhatsApp engine [repo]. Confirm how a reviewer gets a code.
- **Privacy policy:** a link is required in App Store Connect and inside the app [S14 5.1.1(i)].

## 3. Google Play
### 3.1 Organisation account [S15, S16]
- **Fee:** "a US$25 one-time registration fee" [S15].
- **Account type and D-U-N-S:** "To create a developer account for an organization, you must provide a D-U-N-S number" [S16].
- **Other verification:** a separate article, not read [unverified]. Third-party guides list a website, a verified phone and a named contact [T3, unverified].
- **Conversion** from personal to organisation: sources conflict [unverified].

### 3.2 New-account rules
- **Closed test:** "a minimum of 12 testers who have been opted in continuously for at least 14 days" before production. Scope: "personal developer accounts created after November 13, 2023" [S17].
- [I] An organisation account falls outside that scope. The page does not say so in those words.
- **Target API:** new apps and updates must target API 36 from 31 Aug 2026 [carried, S22]. Identity checks for new accounts are reported but unverified [T3].

### 3.3 Foreground-service `location` declaration [S20, S21]
- **Where:** Play Console, Monitor and improve, App content, a declaration per foreground-service type [S20].
- **Per type:** description; "the impact if the system defers the task or interrupts it"; a use case from a preset list or a custom one; and "a link to a video of each foreground service feature" showing the steps to trigger it [S20].
- **Location use cases listed** [carried, S22]: "User-initiated location sharing" (e.g. vehicle activity tracking), "Navigation" (e.g. ride tracking), and "Geofencing".
- **Geofencing removal:** "We're removing geofencing as an approved [foreground services use case]. Developers can instead use the [Geofence API]." Effective **27 Jan 2027** [S21].
- **Location button:** from 27 Jan 2027, apps targeting API 37 must use the location button for one-time or infrequent precise requests. Broader fine location needs a declaration [S21].
- **Expo** [S12]: `isAndroidForegroundServiceEnabled` adds `FOREGROUND_SERVICE_LOCATION` and defaults to true with background location. `foregroundService` requires `notificationTitle` and `notificationBody`.
- [I] Shift-long tracking is not a one-time request, so the declaration route applies. Google does not say so in terms.

### 3.4 Background-location policy and form [S19]
- "Background location may only be used when it provides a significant benefit to users."
- **Disclosure:** shown in normal use without menus; "cannot only be placed in a privacy policy"; before the runtime prompt; must include "location" and "when the app is closed" or "when the app is not in use".
- **Form:** "Tell us about one location-based feature only", and why it cannot work without background access. The video shows background activation, the disclosure and the prompt; "30 seconds or shorter", YouTube preferred.
- **Scope:** approval covers the whole app [carried, S22]. Driver-side tracking is not on the foreground-instead list [carried; [I]].

### 3.5 Data safety form [S18, change log Dec 5, 2023]
- **Location:** approximate (areas of 3 km² or more) and precise are separate types [S18].
- **Personal info:** name, email and phone number are separate types [S18]. The driver signs in with a phone OTP (`driverRequestOtp`, [repo §9]).
- **Photos, app interactions, SDKs:** declare proof-of-delivery photos [repo §4; [I]], and Sentry data, since SDK data must be declared [S18; repo §11].
- **Financial info:** [unverified] whether cash-on-delivery records fall under "Other financial info".
- **Collection** means "transmitting data from your app off a user's device". Data processed only on the device is not collection [S18]. [I] Location points sent to the API are collected. The on-device store (ADR-0039) is not, if it never leaves the device.

## 4. Background-location justification (draft)
Checked against `driver-app.md` §6.2 and §6.3. Every sentence must match the build; a reviewer who finds a gap will reject.

### 4.1 Apple App Review notes (English)
> Background location: Eeasy Logistics Driver is used by drivers who deliver for merchants with their own drivers. A driver starts a shift with "Start shift" and ends it with "End shift". Location is collected only while a shift is active or paused. During a shift the merchant's dispatcher sees where the driver is, so orders can be assigned and followed, and the recipient sees where the parcel is on its way. Background access is needed because drivers move between doors and vehicles with the screen locked or another app open; with foreground access only, positions stop updating. Off shift nothing is sent. "Always" location is requested after shift start, after an in-app explanation. A driver can refuse; then positions are sent only while the app is open. The system location indicator is shown during background tracking. Test: sign in with the reviewer account, tap Start shift, grant location, lock the screen, check the indicator, tap End shift.

### 4.2 Google Play declaration, one feature (English)
> Feature: shift location sharing. While a driver is on an active or paused shift, the app sends the driver's position to the merchant's dispatch, and the recipient of the parcel can see it. Background access is required because positions must keep flowing while the screen is locked or another app is open; with foreground access only, dispatch and recipients lose sight of the parcel during the run. Off shift nothing is collected. The disclosure appears before the permission prompt on the setup screen. The video shows shift start, the disclosure, the prompt, background tracking, and shift end.

### 4.3 In-app disclosure (English and Arabic)
- **English:** "Eeasy Logistics Driver collects your location during your shift, including when the app is closed or not in use, so the dispatcher and the recipient can see where the delivery is. Outside your shift, no location is collected."
- **Arabic:** "يجمع تطبيق Eeasy Logistics Driver موقعك أثناء الوردية، حتى عندما يكون التطبيق مغلقاً أو غير مستخدم، ليتمكن المرسل والمستلم من معرفة مكان التوصيل. خارج الوردية لا يُجمع أي موقع."

The Play text must include "location" and "when the app is closed" or "not in use" [S19].

### 4.4 Arabic review paragraph
> يستخدم تطبيق Eeasy Logistics Driver سائقي التجار الذين يوصلون لصالحهم. يبدأ السائق الوردية بالضغط على «بدء الوردية» وينهيها بالضغط على «إنهاء الوردية». يُجمع الموقع فقط أثناء وردية نشطة أو متوقفة مؤقتاً. خلال الوردية يرى المرسل مكان السائق لإسناد الطلبات ومتابعتها، ويرى المستلم مكان الشحنة في الطريق. الموقع في الخلفية ضروري لأن السائق يتنقل بين الأبواب والمركبات والشاشة مقفلة أو تطبيق آخر مفتوح، وبدونه تتوقف المواقع عن التحديث. خارج الوردية لا يُرسل شيء. يُطلب إذن الموقع «دائماً» بعد بدء الوردية وبعد شرح داخل التطبيق، ويستطيع السائق الرفض؛ وعندها تُرسل المواقع فقط أثناء فتح التطبيق. يظهر مؤشر الموقع في النظام أثناء التتبع في الخلفية.

## 5. Owner inputs OPS-3 needs
| Item | Who | Lead time (source or unknown) |
|---|---|---|
| Expo Organization, its name (`owner`), Owner and Admin holders | Owner | Unknown [S3] |
| EAS plan: Free, Starter ($19/mo) or Production ($199/mo) | Owner | Before first preview build [S1] |
| Final iOS bundle ID and Android package | Owner with lead | Before first build; must be unique [S4]. Changeability [unverified] |
| D-U-N-S for the legal entity | Owner or finance | Free; about 5 to 30 business days [T3, unverified] |
| Apple Developer Program, $99/yr | Owner with authority to bind | Unknown [S13] |
| App Store Connect record, `ascAppId`, `.p8` key kept outside git | Account Holder or Admin | After enrolment [S10] |
| Google Play organisation account, $25, and service account JSON kept outside git | Owner | Unknown; D-U-N-S first [S15, S16]; JSON after the app exists [S11] |
| Privacy policy URL, English and Arabic | Owner with counsel | Before either submission [S14 5.1.1(i)] |
| Saudi PDPL position on location and phone data | Owner with counsel | Unknown; not researched |
| OTP review path: fixed-code test account or Apple-approved demo mode | Owner with lead | Before review [S14 2.1(a)] |
| Background-location video (30 s or less) and review-note text | Lead with QA on a preview build | Needs a working build [S19] |
| Play foreground-service declaration and Data safety form | Owner | Unknown |
| Ruling on which Play use case covers shift-long tracking (Q-41) | Owner | Before the Play declaration; change effective 27 Jan 2027 [S21] |
| Ruling on denied `Always` permission (`driver-app.md` §13 q.4) | Owner | Before review build |

## 6. Not verified
- Apple role names; Apple's own text on `UIBackgroundModes`, `requestAlwaysAuthorization()` and usage keys (sections 2.3 and 2.5 rest on forums and vendors); Apple and D-U-N-S timelines; any Saudi fee or currency.
- Whether bundle IDs or Android packages can change after first upload; the file `eas init` writes `projectId` to; the Free build period; whether the first Android release precedes the listing (S9 and S11 differ).
- Play: identity checks, conversion to organisation, verification beyond D-U-N-S, whether the 12-tester rule applies to organisations (scope only), manifest details (snippet only), the target-API date (carried).
- Whether a private organisation-only app escapes the target-API and declaration rules; whether Guideline 4.8 applies to company phone OTP (inferred); whether the Expo plugin exposes the iOS keys in `driver-app.md` §6.3; whether cash-on-delivery counts as "Other financial info"; Apple App Privacy labels; Saudi PDPL and any Saudi rule on tracking drivers.

## Unanswered
1. Who holds the Expo Owner role, and what is the `owner` name?
2. Does the legal entity have a D-U-N-S Number, and does its name match the D&B record?
3. Can the bundle ID and Android package be changed after first upload?
4. Which EAS plan, given Free's 15 + 15 build limit per cycle?
5. Which Play use case declares shift-long tracking, since none listed names driver tracking?
6. Fixed-code test account or Apple-approved demo mode for OTP review?
7. How does the reviewer receive an OTP if it is sent by WhatsApp?
8. Which legal basis and privacy text cover location and phone data under Saudi PDPL?
9. Does the organisation exemption from the 12-tester rule hold, and is a private organisation-only app a route around the Play rules?
