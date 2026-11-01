# Google Play location policy and the geofencing foreground-service change (Q-41)

Question: lead, 2026-11-01. Roadmap Q-41 (docs/roadmap.md §4); docs/research/background-location-teardown-2026-11.md §3 item 1; adr/0039; docs/architecture/driver-app.md §6.2–6.3.
Method: pages read 2026-11-01 with WebFetch. Quotes are extracted by the fetch tool, not copied by hand, so spot-check exact wording before citing them in a policy reply. Dates in "Source dates" are each page's own stamp where it has one.

## Summary for the lead
- **Date: January 27, 2027.** Google's Play policy timeline says "We're removing geofencing as an approved foreground services use case" with that effective date [S1]. No Google page I read gives August 2026 for this change. The August 26, 2026 rows in the same timeline cover Families and anonymous-chat policies [S1].
- **Removed: the FGS use case "Geofencing" under type `location`, not geofencing.** Google's replacement is "the Geofence API for this use case" [S1]. The Geofence API page does not mention foreground services [S13]. [I] Our parked geofence (Geofencing API via `startGeofencingAsync`) therefore does not depend on the removed use case.
- [I] What does change for us: if our Play Console `location` declaration names geofencing as a use case, that entry must go by Jan 27, 2027.
- Listed `location` use cases in the Play declaration: "User-initiated location sharing" (example "vehicle activity tracking"), "Navigation" (example "ride tracking for ride share"), "Geofencing" [S2]. "Driver tracking during a shift" is not listed. The list is non-exhaustive, and a custom use case can be entered [S2].
- **Stated tension:** the Location Permissions policy allows foreground-service location access only when "the access continues a direct, user-initiated action in the app, and the service stops immediately after completing that user action" [S3]. A shift-long service reads against that text. No effective date is given for that clause [S3]. Unresolved.
- Background location: Google lists "Delivery/service tracking (for things like food, packages, or a ride) for users (not drivers)" among features that can use foreground location instead [S4]. Driver-side tracking is not listed as an accepted background use.
- Background location needs an in-app prominent disclosure before the runtime prompt, a Play Console declaration covering one location feature, and a demo video [S4, S5].
- Target API: new apps and updates must target API 36 from Aug 31, 2026. Google's extension window for updates runs "to November 1, 2026," which is today [S12]. Confirm our targetSdk.
- From Jan 27, 2027, apps targeting API 37 must use the Android location button for one-time or infrequent precise requests. Broader precise access needs a declaration [S1, S3].
- Android 15/16/17 docs I read add no `location` FGS timeout [S6, S8, S9, S10]. The background-start rules conflict between two pages (see section 4) and need a device check.

## 1. Geofencing foreground-service change

Source dates: S1 ©2026 (no own date); S2 ©2026 (no own date).

- Timeline row, effective **2027-01-27** [S1]: "We're removing geofencing as an approved [foreground services use case]. Developers can instead use the [Geofence API] for this use case."
- The FGS page's `location` table still lists "Geofencing" as a use case: "Define parameters, which surround the areas of interest", with the video requirement "Show the user taking the steps within the app tied to a specific location or perimeter... to activate geofencing" [S2]. The table has no effective date [S2].
- The Play timeline is the only source giving a date for the removal [S1]. The April 2026 policy-preview article [S2] describes the same change but gives no date.
- The vendor's "August 2026" claim is in docs/research/background-location-teardown-2026-11.md §3 item 1 and §1.7 and §3 (vendor 5.3.0 changelog, cited as S4 there). The October 28, 2026 date seen in an SDK issue title is a secondary source [S15]. Neither matches the Google page.
- [I] The vendor's August date may be a misread of the August 26, 2026 rows in the timeline, which cover other policies [S1]. Not confirmed.
- [I] The change removes the FGS-use-case route. It does not remove the Geofence API, and the Geofence API page needs no foreground service [S13].
- Stated, separate from the use case: an app may start an FGS from the background when it "receives an event that's related to geofencing or activity recognition transition" [S7]. Whether that exemption survives the policy change is not stated [Unresolved].

## 2. Play Console declaration for FGS type `location`

Source dates: S2 ©2026 (no own date); S3 ©2026.

- Each FGS type must be declared in Play Console: "declare any foreground service types that you use," with a description of the functionality, the user impact if the task is deferred or interrupted, a use case, and a demo video [S2].
- Listed `location` use cases [S2]:
  - "Background Location Updates: User-initiated location sharing", example "Find My Friend feature, vehicle activity tracking". Video: "Show the user triggering the location-sharing feature."
  - "Background Location Updates: Navigation", example "continuing driving navigation in maps, ride tracking for ride share". Video: "Show the user initiating active navigation or ride tracking."
  - "Geofencing" (removed Jan 27, 2027 [S1]).
- "Delivery/shift tracking" is not a listed example. The nearest listed examples are vehicle activity tracking and ride tracking [S2].
- [I] A shift-start toggle could be framed as user-initiated location sharing. Google has not said whether a merchant-facing dispatch tracker fits. Unresolved.
- Stated, S3 "Foreground Service Location Access": "Your app may access location using a foreground service" only if "the access continues a direct, user-initiated action in the app, and the service stops immediately after completing that user action." This is written as a requirement [S3]. No effective date is stated for this clause [S3]. [I] Read together with S2, the continuous shift tracking is not clearly covered. Unresolved.

## 3. Background location (ACCESS_BACKGROUND_LOCATION)

Source dates: S4 ©2026 (no own date); S5 ©2026 (no own date).

- Policy [S3, S4]: "Always request the minimum scope needed for your app's core functionality"; "We may reject apps that request background location without strong justification"; "Background location may only be used when it provides a significant benefit to users."
- Foreground-instead list [S4] includes "Delivery/service tracking (for things like food, packages, or a ride) for users (not drivers)" and "Turn-by-turn navigation." No accepted background example for drivers is listed. [I] Driver-side tracking is not on any accepted list; it is not named as prohibited either.
- Prominent disclosure [S4, S5]: in-app, shown during normal use, "Cannot only be placed in a privacy policy," must mention "location" and background usage, and must appear before the runtime prompt. S5 adds that the video must include the app opening and the consent and non-consent flows.
- Declaration form [S4]: "Tell us about one location-based feature only." "Approval will be granted for your entire app, not just for this single feature." The form focuses on "What is the main purpose of your app?"
- Video [S4]: must show the feature working from the background, the disclosure, and the runtime prompt. Google's text says "Aim for a video duration of 30 seconds or less" and prefers a YouTube link.
- Google-named examples that fit delivery/fleet apps: none for drivers. The delivery example is for recipients [S4].
- Android 17 location button [S1, S3]: from 2027-01-27, apps targeting API 37 that need precise location only for one-time or infrequent actions must use the location button. If core functionality needs broader `ACCESS_FINE_LOCATION`, a Play Console declaration is required [S3].
- [I] Continuous shift tracking is not a one-time or infrequent action, so the location button probably does not cover it. Not stated by Google.

## 4. Target API and Android 15/16/17 FGS rules

Source dates: S12 ©2026, last updated 2026-10-28 UTC; S6 and S7 last updated 2026-10-28 UTC; S8 and S9 last updated 2026-10-28 UTC; S10 last updated 2026-10-31 UTC.

- Play target API [S12]: "Starting August 31 2026: New apps and app updates must target Android 16 (API level 36) or higher to be submitted to Google Play." Extension: "you'll be able to request an extension to November 1, 2026."
- Play target API policy [S11]: new apps and updates "MUST target an Android API level within one year of the latest major Android version release." Existing apps "need to target an API level within two years." Extensions are requested in Play Console.
- 2027 API 37 deadline: only secondary sources [S15] mention "August 2027." Not in Google's pages I read. Unresolved.
- `location` FGS type [S6]: permission `FOREGROUND_SERVICE_LOCATION`, runtime grant of `ACCESS_COARSE_LOCATION` or `ACCESS_FINE_LOCATION`, and location services enabled. Use case: "Long-running use cases that require location access, such as navigation and location sharing." No timeout is described for this type.
- Start from background [S6]: "you cannot create a location foreground service while your app is in the background, unless you've been granted the ACCESS_BACKGROUND_LOCATION runtime permission."
- Start from background [S7]: the list of situations includes "A service that declares the location foreground service type and is started by an app that has the ACCESS_BACKGROUND_LOCATION permission" can access location all the time. The same page lists this only among other situations (system component, widget, notification, PendingIntent from a visible app, etc.) [S7].
- [I] The two pages conflict on whether holding ACCESS_BACKGROUND_LOCATION alone allows starting a `location` FGS from background. driver-app.md §6.2 (watchdog row) assumes the platform blocks it on Android 14+. Verify on a device, Android 14, 15 and 16.
- Android 15 [S8]: new timeouts for `dataSync` and `mediaProcessing` only (6 h per 24 h). `location` is not in the BOOT_COMPLETED restriction list [S8].
- Android 16 [S9]: no FGS start or timeout change for `location` found on the page.
- Android 17 [S10]: FGS requirements are for background audio, not location.

## 5. Managed Google Play and private apps

Source dates: S14 ©2026 (no own date); S16 says "26 June 2026" published and last edited 2026-11-01 (secondary).

- Google [S14]: "Private apps are intended to be built and used by an individual enterprise." "Private apps go through a streamlined verification process compared to public and custom apps." "Google provides greater flexibility over the use of restricted features such as location or telephony features" (sentence continues on the page).
- Google [S14]: "Applications built for businesses are subject to the same rules as all other applications in Google Play." The page does not say whether the FGS declaration or the location policy applies to private apps.
- Secondary [S16]: org-only private apps are exempt from the target-API requirement. Google's target-API page [S11, S12] does not mention private apps, so this is not confirmed.
- [I] If the driver app ships as an org-only private app, the target-API deadline may not apply, but the FGS and location declarations may still apply. Google's "greater flexibility" line does not say how far.

## Unanswered
1. Whether the "continues a direct, user-initiated action... stops immediately" clause [S3] restricts a shift-long `location` FGS, and whether it is in force now (no date given).
2. Whether "user-initiated location sharing" (vehicle tracking example) covers a merchant-facing shift tracker. Not stated by Google.
3. Whether the BACKGROUND_LOCATION grant alone allows starting a `location` FGS from the background. S6 and S7 conflict. Device check needed.
4. Whether the geofence-transition start exemption [S7] survives the FGS use-case removal.
5. Whether the Android 17 location-button rule (Jan 27, 2027) applies to continuous shift tracking.
6. The 2027 API 37 target deadline. Only secondary sources.
7. Whether private/org-only apps are exempt from the FGS and background-location declarations. Google's managed-Play page is incomplete.
8. Our actual targetSdk (Expo SDK 58 default not read). Needed to know whether the Aug 31, 2026 rule and the Nov 1, 2026 extension apply.
9. The developer verification exemption for managed-Play private apps (secondary only).
10. The full sentence of "Google provides greater flexibility..." [S14]; the fetch truncated it.

## Sources (read 2026-11-01)
- S1 https://developer.android.com/distribute/play-policies (Play policy timeline; no own date)
- S2 https://support.google.com/googleplay/android-developer/answer/13392821?hl=en ("Understanding foreground service and full-screen intent requirements"; preview at answer/16965181)
- S3 https://support.google.com/googleplay/android-developer/answer/16909972?hl=en (Location Permissions)
- S4 https://support.google.com/googleplay/android-developer/answer/9799150?hl=en ("Understanding location in the background permissions")
- S5 https://support.google.com/googleplay/android-developer/answer/11150561?hl=en (prominent disclosure)
- S6 https://developer.android.com/develop/background-work/services/fgs/service-types (last updated 2026-10-28 UTC)
- S7 https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start (last updated 2026-10-28 UTC)
- S8 https://developer.android.com/about/versions/15/behavior-changes-15 (last updated 2026-10-28 UTC)
- S9 https://developer.android.com/about/versions/16/behavior-changes-16 (last updated 2026-10-28 UTC)
- S10 https://developer.android.com/about/versions/17/behavior-changes-17 (last updated 2026-10-31 UTC)
- S11 https://support.google.com/googleplay/android-developer/answer/11917020?hl=en (target API level policy)
- S12 https://developer.android.com/google/play/requirements/target-sdk (last updated 2026-10-28 UTC)
- S13 https://developer.android.com/develop/sensors-and-location/location/geofencing (last updated 2026-10-28 UTC)
- S14 https://support.google.com/googleplay/work/answer/10637198?hl=en (Managed Google Play, private apps)
- S15 Secondary, search snippets only: https://github.com/transistorsoft/flutter_background_geolocation/issues/1697 (Oct 28, 2026 claim); https://grand-screen.com/tools/android-version-checker/ and daily.dev post (API 37 by August 2027). Not read in full.
- S16 Secondary, read: https://bayton.org/android/android-enterprise-faq/google-play-target-api-requirements-enterprise/
- S17 Repo, read in worktree: docs/research/background-location-teardown-2026-11.md §1.7, §3; docs/architecture/driver-app.md §6.2, §6.3.
