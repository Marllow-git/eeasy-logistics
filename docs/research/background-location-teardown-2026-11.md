# Background location teardown: react-native-background-geolocation vs Expo SDK 58

- **Date of research:** 2026-11-01 (every source below was read that day unless a page date is given)
- **Requested by:** the lead, for `docs/architecture/driver-app.md` section 6 (ADR-0009, ADR-0028)
- **Researcher:** `researcher` agent
- **Scope:** how Transistorsoft's plugin (v5.x, repo `transistorsoft/react-native-background-geolocation`, master, latest CHANGELOG entry 5.8.2 dated 2026-10-29) gets reliable, battery-aware background tracking, what each mechanism is built on, and what Expo SDK 58 gives us to rebuild it. No recommendation is made here.
- **Not done:** no native binary was opened or decompiled, and no code was copied. Mechanisms are described from the public typings, help pages, changelog, issues and wiki.

Legend: **[S]** stated by a named source. **[I]** inference by the researcher, not stated by any source read. Source keys are listed at the end.

## Summary for the lead

1. The plugin is a two-state machine: **moving** (location on, a point every `distanceFilter` metres) and **stationary** (location services off) [S1, S5]. Start-of-motion comes from the platform motion API (CoreMotion on iOS, Play Services activity recognition on Android) and, on iOS, from exiting a stationary geofence of `stationaryRadius` (default 25 m) [S2, S5].
2. Stop-detection is `stopTimeout` (default 5 min, "not recommended" above 15) after a STILL result on Android, and an accelerometer-based stop-detection on iOS [S2]. The vendor says iOS needs about 200 m of movement to leave the stationary geofence, even at 25 m [S2].
3. Battery levers the vendor names: GPS off while parked, speed-scaled `distanceFilter` ("elasticity"), `deferTime` batching, and batched HTTP with thresholds [S2]. No measured battery figures are published anywhere we read [S5].
4. The plugin's own issue tracker shows the failure modes that matter for us: tracking that stops mid-trip and does not resume (#2644, open, Aug 2026), stuck-stationary on Samsung (#2631), OEM background kills on Vivo/Xiaomi (#2579), and an iOS relaunch state after `stop()` (#2666, fixed in 5.8.0 per a maintainer) [S7].
5. Expo SDK 58 can do: continuous updates with `distanceInterval` and `timeInterval` (Android), deferred batches, accuracy levels, the Android foreground-service notification, and region monitoring with the 20 (iOS) and 100 (Android) limits [S9]. Verdict: Yes for these.
6. Expo SDK 58 cannot, as documented: detect motion in the background (its `watchMotionActivityAsync` is "foreground use only"), run significant-location-change monitoring, do stop-detection, or do elasticity. Those need a native module or an approximation [S9, I].
7. Google Play's policy page dates the removal of geofencing as an approved foreground-service use case to **January 27, 2027** [S11]. The vendor's 5.3.0 notes and a search snippet say **August 2026** [S4]. The two conflict; the owner should check Play Console before relying on either.
8. Traccar Client (Apache-2.0) and OwnTracks (EPL-1.0) give only architectural hints. OwnTracks separates a "move" mode from a "significant change" mode [S12]. Traccar's README documents almost nothing about its mechanisms [S12].
9. The vendor's `v5` licence and price facts are in the census (`client-library-census-2026-11.md`, category 2) and are not repeated here. The README says v4 licence keys do not work with v5 [S1].

## 0. Method and source keys

| Key | Source | Read | Notes |
|---|---|---|---|
| S1 | `README.md`, transistorsoft master | 2026-11-01 | v5 README; licence wording |
| S2 | `src/declarations/interfaces/Config.d.ts` (typings with per-option docs and a defaults table) | 2026-11-01 | Main source for options and defaults |
| S2a | `Authorization.d.ts`, `DeviceSettings.d.ts`, `MotionChangeEvent.d.ts`, `Sensors.d.ts`, `src/Logger.js`, `src/index.js` | 2026-11-01 | API surface |
| S3 | `help/geofencing.md`, `help/timing-diagram.md`, `help/http.md`, `help/MIGRATION-GUIDE-5.0.0.md`, `help/INSTALL-EXPO.md` | 2026-11-01 | Help pages |
| S4 | `CHANGELOG.md` (entries 5.0.0 to 5.8.2) | 2026-11-01 | Dated release notes; the most recent behaviour changes |
| S5 | GitHub wiki "Philosophy-of-Operation" (via WebFetch) | 2026-11-01 | Page date not shown; [I] text appears older than S2 |
| S5b | `docs.transistorsoft.com/react-native/BackgroundGeolocation/` (via WebFetch, first 100k chars) | 2026-11-01 | No version shown; prose on the state machine and platform APIs |
| S6 | `transistorsoft.github.io/react-native-background-geolocation/` | 2026-11-01 | Redirects to a 4.x TypeDoc reference; no prose; `4.x/md_doc_2_2_config.html` returned 404 |
| S7 | GitHub issues on the repo (`gh search issues`, `gh issue view`) | 2026-11-01 | User and maintainer comments; treated as reports, not verified |
| S8 | Sibling Flutter plugin `transistorsoft/flutter_background_geolocation`, `lib/models/config/geo_config.dart` | 2026-11-01 | Used only for the `LocationFilter` description; the RN repo does not carry its own copy |
| S9 | Expo SDK 58 reference, `https://docs.expo.dev/versions/v58.0.0/sdk/location/`, `.../task-manager/`, `.../background-task/`, `.../sensors/`; `https://docs.expo.dev/modules/overview/` | 2026-11-01 | Location page modified 2026-09-25; task-manager 2026-09-15; modules overview 2026-09-25. The SDK index and the `modules/overview` version-pinned URL returned 404 |
| S10 | Android developer, foreground service types (`developer.android.com/develop/background-work/services/fgs/service-types`) | 2026-11-01 | Android 14+ rules for `location` |
| S11 | Google Play policies: `developer.android.com/distribute/play-policies` and `support.google.com/googleplay/android-developer/answer/16965181` | 2026-11-01 | Policy timeline; the support page is a preview of "April 2026 policy updates" |
| S12 | OwnTracks booklet `owntracks.org/booklet/features/location/`; Traccar Client `github.com/traccar/traccar-client` README; OwnTracks Android repo metadata | 2026-11-01 | Secondary references |
| S13 | Census `docs/research/client-library-census-2026-11.md` | 2026-11-01 | Lives on branch `docs/research-stack-alternatives` (commit 9964121), not on `main`; read with `git show`, no branch switch |

Not read: the vendor's native repository (`transistorsoft/native-background-geolocation`), Apple's CoreLocation and CoreMotion documentation, and Play Console policy declarations beyond S11. The Traccar and OwnTracks sources read were READMEs and one booklet page, not code.

## 1. Mechanisms

### 1.1 Motion-detection state machine

**What it does.** Two states, moving and stationary, switched automatically. Moving means location services run and a point is recorded every `distanceFilter` metres. Stationary means location services are off [S1, S5]. `isMoving` is the state; `onMotionChange` fires on each switch and carries `isMoving` and the location [S2a].

**Start of motion.**
- Android: the Activity Recognition System (ARS) reports a moving activity. `triggerActivities` defaults to any of `in_vehicle`, `on_bicycle`, `on_foot`, `running`, `walking` [S2, S2a]. `motionTriggerDelay` (ms) can require the moving state to persist before switching; it is cancelled if the activity returns to still [S2]. The default for `motionTriggerDelay` is not stated in the typings table [S2].
- iOS: CoreMotion's coprocessor motion activity, which needs the Motion & Fitness permission [S5, S2]. Exiting the stationary geofence also switches to moving [S5, S5b].
- Both: `changePace(true)` forces the moving state "bypassing stationary monitoring" [S5b, S2a].

**Stop.**
- Android: after ARS reports STILL, a timer of `stopTimeout` minutes runs before location services are turned off. Default 5 min. "Setting a value > 15 min is not recommended, particularly for Android" [S2]. The timer is cancelled by any movement activity [S5].
- iOS: an accelerometer-based stop-detection system. `stopDetectionDelay` (minutes, default 0) delays engaging it; while engaged, location services are off and "only the accelerometer is monitored" [S2]. With `disableStopDetection: true`, iOS uses its own default of turning location off after "exactly 15 minutes" stationary [S2].
- `stopOnStationary` (default false) stops tracking entirely when `stopTimeout` expires [S2].
- The vendor's timing diagram shows GPS off at stop-detection engage and "iOS has suspended the app when stop-detection expires" [S3].

**Config and defaults.** `isMoving` (initial state, default not given in the table; `start()` with `isMoving: true` bypasses stationary) [S2]. `stopTimeout` 5; `stopDetectionDelay` 0; `disableStopDetection` false; `disableMotionActivityUpdates` false; `triggerActivities` any moving activity; `motionTriggerDelay` not stated [S2].

**Platform API.** Stated: Android uses the ARS (Play Services) and iOS uses the motion coprocessor [S5, S5b]. Inferred: the Android side is the Play Services Activity Recognition API, since the vendor names it as the ARS and says Android 10+ asks for the "Physical Activity" permission [S2].

**Stated trade-offs.** The vendor calls the iOS motion setup "HIGHLY optimized" and advises against disabling it: disabling it "will drain more battery power" [S2]. The vendor says the motion-activity path is "highly optimized for motion-activity-updates" [S2].

**Known failure modes (issues and changelog).**
- #2644 (open, opened 2026-08-10, plugin 5.3.0 and later 5.4.0, iOS 26.6 and Android 16): tracking stops mid-trip, the stop timeout starts, and movement does not resume delivery "for several minutes" until sustained walking. A maintainer replied that they could not reproduce it and that the same symptom on both platforms "strongly points to a problem in your own Javascript code" [S7]. Unresolved in the thread we read.
- #2631 (closed, plugin 5.1.1 with native 4.1.6, Samsung S25 Edge, Android 16): devices "stuck in stationary mode" and not leaving it even after breaking a separate geofence. The maintainer's closing advice was to update [S7].
- #2402 (closed): spurious stationary-to-moving transitions with `motionTriggerDelay` 30 s on a still device [S7].
- Changelog 5.5.0: an iOS wedge in the stationary state after the `motionchange` location request fails, now cleared on retry [S4]. An Android watchdog re-registers geofences "when the motion API goes silent — a failure mode on devices whose vendors throttle activity recognition" [S4]. 5.8.0 re-subscribes to motion activity about once an hour while stationary, "so one that Play Services has stopped delivering is restored" [S4].

### 1.2 Stationary geofence and iOS wake-up

**What it does.** When stationary on iOS, the plugin places a circular region of `stationaryRadius` around the last known position. Leaving the region wakes the app and switches to moving [S5, S2]. iOS suspends the app in the stationary state [S5].

**Config and defaults.** `stationaryRadius`: default 25 m, "minimum of 25" is enforced; "configuring stationaryRadius: 0 has NO EFFECT" [S2]. The vendor says exit detection "typically takes ~200 meters of movement" on iOS (stated; no conditions given) [S2]. For Android, the fallback fence "typically 200-500 meters" before tracking starts [S2].

**Keep-alive with the stationary region.** `stopOnTerminate` (default true). When false on iOS, the plugin creates the stationary geofence before the app terminates, and "iOS will completely reboot your application in the background" when the device leaves it [S2]. `startOnBoot` (default false): "iOS cannot immediately engage tracking after a device reboot" and waits for the stationary geofence or a background-fetch event [S2].

**Android equivalent.** Older changelog entries and the 4.19.4 entry describe an Android stationary geofence. 4.19.4 states "Google Play Services seems to have a bug where geofence exit events fire even while the device is still inside the geofence, causing the SDK to constantly enter the moving state, draining the battery" [S4]. The vendor's Android 5.x changelog says geofence exits are "verified rather than assumed" [S4]. The wiki says "No stationary geofence is needed" on Android [S5], which conflicts with S4 (see section 3).

**Stated trade-offs.** `preventSuspend` (iOS, default false) keeps the app awake while stationary "for faster motion-activity response", but "will have a very noticeable impact on battery performance" [S2, S5]. The vendor adds that iOS throttles heartbeats about two minutes after backgrounding when unplugged with the screen off [S2].

**Known failure modes.** #2631 (above). #2666 (open in the search list, opened 2026-10-01; a maintainer comment says it is fixed in 5.8.0): after `stop()` in a relaunched process, iOS "keeps waking the stopped app" because the previous process's `__STATIONARY_REGION__` stayed registered [S7]. This is a concrete example of state that outlives the process.

### 1.3 Distance filter, elasticity, accuracy, intervals

**distanceFilter and elasticity.** `distanceFilter` default 10 m. By default the SDK scales it with speed: speed is rounded to the nearest 5 m/s, a multiplier is `rounded / 5`, and the effective filter is `multiplier × distanceFilter` [S2]. Their example: 7.7 m/s with `distanceFilter: 30` gives 60 m [S2]. `elasticityMultiplier` (default 1) scales it; a value of 0 is the same as `disableElasticity: true` (default false) [S2]. The typings contain two worked examples that disagree about whether `elasticityMultiplier` is applied (see section 3).

**Accuracy.** `desiredAccuracy` default `DESIRED_ACCURACY_HIGH` (GPS, Wi-Fi and cell). MEDIUM is Wi-Fi and cell; LOW and VERY_LOW use no GPS; NAVIGATION and LOWEST are iOS only [S2]. "Only DESIRED_ACCURACY_HIGH uses GPS. speed, heading and altitude are available only from GPS" [S2].

**Android intervals.** `locationUpdateInterval` default 1000 ms, "ignored when distanceFilter > 0" [S2]. `fastestLocationUpdateInterval` default 10000 ms in the table; the description says 30000 ms when not set [S2]. `deferTime` default 0; if it is at least twice `locationUpdateInterval`, "location delivery may be delayed and multiple locations can be delivered at once... This can consume less battery" [S2]. The vendor qualifies this with "depending on the device's hardware capabilities" [S2].

**iOS activity type.** `activityType` default `OTHER`. Stated: it "presumably" affects the iOS GPS algorithm, and Apple is "vague" about it [S2]. The 5.6.0 changelog reports that a hard-coded `AutomotiveNavigation` made tracks snap to roads [S4].

**useSignificantChangesOnly.** Default false. When true, locations are recorded "only every 500 to 1000 meters" on iOS, and "many of the plugin's configuration parameters will have no effect" [S2]. On Android it records "several times per hour" without the persistent foreground service [S2].

**Stated trade-offs.** Elasticity is described as recording "fewer locations and conserve energy" [S2]. `deferTime` "can consume less battery and give more accurate locations, depending on the device's hardware" [S2].

**Failure modes.** Issue #2565 (closed, iOS, geofence-only mode, user reports 15%+ per hour driving) was answered by a maintainer who said "Geofence-only mode consumes very little energy" [S7]. This is a maintainer claim with no numbers.

### 1.4 Filtering bad fixes

- **Odometer accuracy.** `desiredOdometerAccuracy` default 100 m: a fix with accuracy worse than that "will not be used to update the odometer" [S2].
- **Speed jump (Android, experimental).** `speedJumpFilter` drops fixes implying a speed above a threshold; the default is 300 m/s [S2].
- **Identical fixes.** `allowIdenticalLocations` default false: Android ignores a fix identical to the previous one [S2].
- **Tracking filter (newer).** Config `geolocation.filter` (compound config, v5) with a `LocationFilter` and `LocationFilterPolicy`. The fields named in the sources are `policy`, `useKalman` (default true, "has no effect on delivered locations" and affects the odometer), `rollingWindow`, `burstWindow` (default 10 s), `kalmanProfile`, and `trackingAccuracyThreshold` [S8, S4, S7]. Issue #2676 logs also show `maxImpliedSpeed` 60 and `maxBurstDistance` 300 [S7]. The RN repo does not carry the typings for this group; the description is from the Flutter sibling [S8].
- **Rejection events.** 5.2.0 adds `onLocationFilter`, which fires for rejected fixes with a `reason` of `low-accuracy`, `implied-speed` or `outlier-capped`; rejected fixes "are not delivered to onLocation" [S4].
- **Reported false rejections.** Issue #2676 (open, 2026-10-27, Android 16, Samsung Galaxy Z Fold7, plugin 5.7.0): the reporter lists 68 `implied-speed` rejections of fixes more than 300 m from the previous fix within 5 to 12 s; for 64 of them the implied speed matched the speed the fix itself reported within 10% [S7]. This is the reporter's analysis; no maintainer reply on the point was read.

### 1.5 Persistence and sync

**Local buffer.** Every recorded location is written to "the native SQLite database" [S5b, S2]. `persistMode` default `all` (locations and geofence events) [S2]. `maxDaysToPersist` default 1 day; `maxRecordsToPersist` default -1 (no limit); 0 disables persistence [S2]. `locationsOrderDirection` default `ASC` (oldest first) [S2]. Since 5.3.0, `getLocations(query)` pages through the table with `limit`, `offset`, `page` and `order`, to avoid out-of-memory crashes "when reading a database holding several thousand records" [S4]. The 5.4.0 entry adds `insertLocation()` [S4].

**Upload.** `url` (no default), `method` POST (PUT and OPTIONS allowed), `httpRootProperty` default `location`, `httpTimeout` 60000 ms, `params`, `headers`, `extras` [S2]. `locationTemplate` and `geofenceTemplate` produce custom bodies using ERB-style tags [S2].

**Sync policy.**
- `autoSync` default true: each location is uploaded "as soon as it is recorded" [S2].
- `autoSyncThreshold` default 0: wait until N records are stored; the vendor says this "can conserve battery... since HTTP requests consume far more energy / second than GPS" [S2]. The threshold is ignored during `onMotionChange`, so queued locations are uploaded at each state change [S2].
- `batchSync` default false: all stored locations in one POST; `maxBatchSize` default -1 (no limit) [S2].
- `disableAutoSyncOnCellular` default false [S2].

**Retry.** "When your server fails to respond with HTTP 200 OK, the plugin will continue periodically attempting to upload to your server until maxDaysToPersist" [S2]. No backoff schedule is stated.

**Auth and refresh.** `authorization` (JWT only). The SDK adds `Authorization: Bearer ...` and, given `refreshUrl`, `refreshToken` and `refreshPayload`, refreshes the token on a `401` [S2a]. The `onAuthorization` event reports success or error [S2a]. 5.8.0: a server can send RPC commands in a `401` response (for example `destroyLocations` or `stop`) [S4].

**Storage and secrecy.** 5.8.0 encrypts the stored config (headers, params, extras, auth tokens) with AES-256-GCM under a key in the Android Keystore or iOS Keychain. "The SDK's SQLite database of recorded locations is not encrypted" [S4]. Issue #2663 (open, 2026-09-23) asked for encrypted header persistence before 5.8.0 [S7].

**Stated trade-offs.** Batch sync trades upload frequency for latency. The vendor warns that a threshold can delay what the server sees "the device may have been sitting dormant for a long period" [S2].

### 1.6 Keep-alive, restart and scheduling

**Android foreground service.** `foregroundService`: the table says default false; the description says "Defaults to true and cannot be set to false" on Android 8+ because of background execution limits [S2]. The notification "cannot be hidden" [S2]. 5.3.0 says geofencing and activity recognition no longer need the foreground service, and that continuous `trackingMode: LOCATION` "still uses a foreground service where permitted" [S4]. The SDK applies `android:foregroundServiceType="location"` to its own services [S4].

**Terminated app.** `stopOnTerminate` default true. When false, Android "will not pause at all" because the plugin's own service keeps running [S2]. iOS reboots the app through the stationary geofence (section 1.2) [S2]. `enableHeadless` (Android, default false) runs "headless" JS with the service alive after termination; it requires `stopOnTerminate: false`, and `registerHeadlessTask` supplies the callback [S2]. The `forceReload*` options are deprecated: "Banned in Android 10" [S2].

**Boot.** `startOnBoot` default false [S2]. Changelog 5.5.0 says Android tracking, geofences and stationary region "were not re-armed after a device reboot with startOnBoot: true" before a fix [S4].

**Heartbeat.** `heartbeatInterval` default 60 s. Android minimum 60 s, with heartbeats on AlarmManager that "stop once the plugin is moving" [S2, S5]. On iOS, `onHeartbeat` fires only with `preventSuspend: true` [S2].

**Schedule.** `schedule` takes strings like `"1-7 09:00-17:00"` (days Sunday=1, 24h times) and can start with location or geofences only [S2]. `scheduleUseAlarmManager` (Android, default false) uses AlarmManager instead of JobScheduler "more precise" [S2]. Issue #2517 (closed): "Scheduled stop is not executing" [S7].

**OEM failure modes.** Issue #2579 (closed, Vivo Y21 on Android 12, plugin 5.1.1): background tracking suspended on Vivo and Xiaomi after a swipe-kill; `deviceSettings.showPowerManager()` failed on that model ("Failed to find POWER_MANAGER screen"); the maintainer pointed to `DeviceSettings` and dontkillmyapp.com [S7]. Issue #2400 (closed, Huawei and Honor): tracking issues [S7]. Issue #2627 (closed): `RemoteServiceException` on `LocationRequestService` on Android 10 and below, Oppo and Vivo [S7]. Issue #2676 (above) reports an Android 16 foreground-service start failure on Samsung [S7]. Changelog 5.5.0: `ForegroundServiceDidNotStartInTime` "seen most often on Motorola" [S4].

### 1.7 Geofencing

**Limits and proximity.** The platform limits are 20 (iOS) and 100 (Android) [S2, S3, S9]. The plugin stores any number in its own SQLite database and activates the nearest ones. `geofenceProximityRadius` default 1000 m (also the minimum, per the description). While moving, it re-runs the proximity query "periodically (eg. every minute)" using the last recorded location; the query is a spatial query over the database [S3, S2]. The geofences in proximity are swapped as the device moves. `geofencesChange` (event name `geofenceschange` in S3) reports `on` and `off` arrays [S3].

**Other options.** `geofenceInitialTriggerEntry` default true (fire enter immediately if already inside) [S2]. `geofenceModeHighAccuracy` (Android, default false): runs geofence-only mode with a foreground service "far more responsive" and "will consume more power" [S2]. `addGeofences` (plural) is "over 10x faster" than looping `addGeofence` [S3].

**Changelog.** 5.3.0 removed the requirement for a foreground service for geofencing on Android and cites a Play policy change (see section 3) [S4].

### 1.8 Permissions and OS policy handling

**Authorization.** `locationAuthorizationRequest` default `Always`. "WhenInUse blocks automatic background transitions, and geofencing requires Always" [S5]. `locationAuthorizationAlert` and `disableLocationAuthorizationAlert` (default false) control the iOS prompt that appears when the user changes location settings [S2]. `showsBackgroundLocationIndicator` default true (status-bar indicator) [S2, S4].

**Motion permission.** `disableMotionActivityUpdates` default false. Disabling it makes the plugin use the stationary geofence fallback, and "the plugin will drain more battery power" [S2]. 5.6.0 adds `requestPermission(Permission.Location | Permission.Motion)` so the two can be requested separately, `AuthorizationStatus.DeniedAlways` for a permanent motion denial, and a fix so an OS-cancelled request is no longer reported as granted [S4].

**Android background permission.** `backgroundPermissionRationale` configures the dialog shown on Android 11+ before the "Allow all the time" flow. It is shown "just once" after the positive action; a Cancel press does not count, and it can be shown again if the user resets permissions to ask every time [S2].

**Battery optimisation and OEM screens.** The `deviceSettings` API (Android): `isIgnoringBatteryOptimizations()`, `showIgnoreBatteryOptimizations()` (returns a request object with `seen` and `lastSeenAt` so the app can avoid repeating the prompt; it does not redirect by itself), and `show(request)` to open the screen [S2a]. The vendor warns: "Ignoring battery optimizations will cause your app to consume much more power" [S2a]. The vendor points to dontkillmyapp.com for vendor-specific behaviour [S2a].

**Play Store notes.** The vendor says 5.3.0 removes the geofencing foreground-service dependence "ahead of Google Play's August 2026 policy" [S4]. Google's policy page gives January 27, 2027 [S11] (section 3). Google's location foreground-service types: `location` requires `FOREGROUND_SERVICE_LOCATION` and a location runtime permission, and the Play declaration lists its use cases as "User-initiated location sharing" and "Navigation" [S10, S11]. Whether a shift tracking app fits either category is a policy question not settled by any source read.

**Background start.** "You cannot create a location foreground service while your app is in the background, unless you've been granted the ACCESS_BACKGROUND_LOCATION runtime permission" [S10]. The census already records the same rule [S13].

### 1.9 Diagnostics

- **Logs in SQLite.** `logLevel` controls volume; `logMaxDays` default 3 [S2]. The table says `logLevel` defaults to `LOG_LEVEL_VERBOSE`; the description says the plugin "boots with a value of LOG_LEVEL_OFF"; the 5.8.0 changelog says "the default is off" [S2, S4] (see section 3).
- **API.** `getLog(query)`, `emailLog(email, query)`, `destroyLog()`; the plugin also logs at `debug`, `info`, `notice`, `warn` and `error` levels from app code [S2a]. The 5.8.0 change masks header values in the log; "an Authorization header or an API key ended up in a log that may be emailed" was the reason given [S4].
- **Debug sounds.** `debug: true` (default false): "emit debugging sounds and notifications for life-cycle events" [S2]. The vendor cites a "Lullabye" sound for iOS stop-detection and "zap" for the Android stationary geofence [S2, S4].
- **Event surface.** `onHttp`, `onMotionChange`, `onActivityChange`, `onProviderChange`, `onHeartbeat`, `onGeofence`, `onGeofencesChange`, `onLocationFilter`, `onAuthorization` [S2, S4, S2a].
- **HTTP debugging.** The `url` docs show the plugin's HTTP requests appearing in its logs [S2].

### 1.10 Measured battery numbers and test method

- **Stated figures.** None. The wiki says the plugin "gives no measured battery figures or benchmarks" and its quantitative statements are the 200 m and 10 m thresholds [S5]. The README and typings use qualitative language only ("most battery-efficient", "highly optimized") [S1, S2, S5].
- **Test method.** Not published. Maintainer comments in issues describe field tests ("a ~200km roadtrip this weekend with iOS and Android devices") as anecdote [S7].
- **User-reported numbers.** Issue #2565 reports 15%+ per hour while driving (user claim, geofence-only mode); the maintainer said geofence-only mode is cheap [S7]. Issue #2649 (closed, iOS, client-reported) gives no figures [S7].

## 2. Expo SDK 58 mapping

Verdicts: **Yes** = documented and usable as stated. **Partial** = buildable with documented APIs, but a behaviour the plugin relies on is missing or undocumented. **Needs native module** = not in the documented SDK 58 surface. Source tags are S9 unless stated. [I] marks inferences.

| # | Mechanism (section) | Expo SDK 58 (expo-location, expo-task-manager, expo-sensors, expo-background-task) | Verdict | Notes |
|---|---|---|---|---|
| 1 | Moving and stationary state from the motion API (1.1) | `watchMotionActivityAsync` exists, but "Only foreground use is supported - updates pause when the app is backgrounded" [S9]. No background motion-activity API documented. `expo-sensors` says nothing about background use [S9]. | Needs native module | Background motion needs CoreMotion (iOS) and an Activity Recognition broadcast or PendingIntent (Android) [I]. |
| 2 | Stop timeout and GPS off while parked (1.1) | `stopLocationUpdatesAsync` exists [S9, via task-manager reference]. No stop-detection or stop-timeout option. A task only runs when a location arrives, so a parked device cannot be seen from the task without a motion signal [I]. | Needs native module | Can be emulated only with a motion signal (row 1) [I]. |
| 3 | iOS stationary geofence and wake (1.2) | `startGeofencingAsync(taskName, regions)`; limits 20 (iOS), 100 (Android); `notifyOnEnter`/`notifyOnExit` default true; "The system will restart the terminated app when a new geofence event occurs" (iOS) [S9]. Minimum radius and exit latency not stated [S9]. | Partial | Buildable: create a region at the stop point. The vendor's 25 m minimum and ~200 m exit figure are their claims [S2]. |
| 4 | Significant-location-change monitoring (1.3) | Not in the SDK 58 location docs read [S9]. | Needs native module | OwnTracks uses significant-change mode on iOS and a balanced-power request on Android [S12]. |
| 5 | `distanceFilter` (1.3) | `distanceInterval` (meters; "Receive updates only when the location has changed by at least this distance") [S9]. | Yes | Default depends on `accuracy` (not numeric in the page) [S9]. |
| 6 | Elasticity (speed-scaled distance) (1.3) | Not documented. | Partial | Possible by restarting updates with a new `distanceInterval` as speed changes [I; restart behaviour not documented in S9]. |
| 7 | `desiredAccuracy` (1.3) | `Accuracy` enum: Lowest (about 3 km), Low (about 1 km), Balanced (within 100 m, default), High (within 10 m), Highest, BestForNavigation [S9]. | Yes | Vendor's mapping differs (HIGH uses GPS only in their table) [S2]. |
| 8 | Android `locationUpdateInterval` and `fastestLocationUpdateInterval` (1.3) | `timeInterval` (Android only, minimum time between updates); no "fastest" option documented [S9]. | Partial | No documented equivalent to the fastest interval [S9]. |
| 9 | `deferTime` batching (1.3) | `deferredUpdatesInterval` and `deferredUpdatesDistance`; "Deferred locations apply only when the app is in the background" [S9]. | Yes | Default 0 [S9]. |
| 10 | iOS `activityType`, `pausesUpdatesAutomatically`, background indicator (1.3) | `activityType` (`Other`, `AutomotiveNavigation`, `Fitness`, `OtherNavigation`, `Airborne`), `pausesUpdatesAutomatically` (default false), `showsBackgroundLocationIndicator` (default false) [S9]. | Yes | Expo's indicator default is false; the vendor's default is true [S2]. |
| 11 | Odometer and jump filters, identical-fix filter (1.4) | No filter options in the location task; `accuracy` and speed are on each location object [I]. | Partial (app code) | JS filter over `accuracy` and implied speed [I]. |
| 12 | Local buffer and sync (1.5) | Not part of Expo. The repo already plans `expo-sqlite` and an outbox (driver doc 6.2) [repo]. | Yes (app code) | Not a platform feature; no retry policy from Expo. |
| 13 | Auth token refresh on 401 (1.5) | Not part of Expo; app code with `expo-secure-store` (driver doc 7.2) [repo]. | Yes (app code) | Vendor's built-in auth refresh is a convenience, not required [S2a]. |
| 14 | Android foreground service and notification (1.6) | `foregroundService` (`notificationTitle` and `notificationBody` required, `notificationColor`, `killServiceOnDestroy`) [S9]. Config plugin: `isAndroidForegroundServiceEnabled` defaults to true only when Android background location is enabled [S9]. | Yes | Which `foregroundServiceType` Expo declares is not stated [S9]. |
| 15 | Keep running after the app is killed (Android) (1.6) | "A terminated app will not automatically restart when a location or geofencing event occurs due to platform limitations" [S9]. "Background location will stop if the user terminates the app" [S9]. | Needs native module | Vendor keeps its own service alive with `stopOnTerminate: false` [S2]. [I] that matching this needs a native service. |
| 16 | Restart after kill on iOS (1.2, 1.6) | "The system will restart the terminated app when a new geofence event occurs" [S9]. | Partial | Only through a geofence (row 3). Significant-change wake (row 4) not available [S9]. |
| 17 | `startOnBoot` (1.6) | Not documented in the pages read [S9]. | Needs native module [I] | Android boot receiver would be native code [I]. |
| 18 | Headless JS after termination (1.6) | `expo-task-manager` tasks run "while the app is in the background"; the page does not say whether tasks run after termination [S9]. | Partial | Android location task does not restart after termination [S9]. |
| 19 | Heartbeat and `preventSuspend` (1.2, 1.6) | `expo-background-task`: minimum interval 15 minutes, "Tasks won't run exactly on schedule", stopped when the user kills the app [S9]. No iOS suspend-prevention option documented [S9]. | Needs native module | Coarse periodic work only [S9]. |
| 20 | Scheduled start and stop (1.6) | Not documented as a feature. The app can call start and stop from JS while it runs [I]. | Partial | Background schedule not available through documented APIs [I]. |
| 21 | Geofence limits and proximity swapping (1.7) | Limits 20 and 100 [S9]. No proximity logic documented. | Partial | App must do the swap itself (nearest-N selection and re-register) [I]. |
| 22 | Permission flow (1.8) | `requestForegroundPermissionsAsync` before `requestBackgroundPermissionsAsync`; "Foreground permissions should be granted before asking for the background permissions"; "Allow Once" is session-only and a later background request "will silently fail" [S9]. | Yes | Android background prompt rules are per the Android docs [S10, S13]. |
| 23 | Battery-optimisation and OEM screens (1.6, 1.8) | Not in the SDK 58 pages read. | Needs native module or third-party [I] | Not verified: whether an intent launcher package is available [unverified]. |
| 24 | Diagnostics to local storage (1.9) | Not an Expo feature. App code with `expo-sqlite` [I]. | Yes (app code) | Vendor's SQLite log is a convenience [S2]. |
| 25 | Battery percentage in each point (driver doc 6.2) | Not covered by the sources read here (`expo-battery`). | Not checked | Outside this note's scope. |
| 26 | Background sensors (accelerometer, gyro) as a motion signal | `expo-sensors` lists Accelerometer, DeviceMotion, Gyroscope, Magnetometer, Barometer, Pedometer; Android caps sensors at 200 Hz from Android 12; no page says whether any sensor runs in background [S9]. | Needs native module | A background accelerometer path would need native code [I]. |

## 3. Discrepancies in the sources

1. **Geofencing Play policy date.** S4 (5.3.0 entry) says Google Play's "August 2026" policy removes geofencing as an approved foreground-service use case. A web search snippet (not a Google page) gives August 26, 2026. The Google Play policy timeline page gives **January 27, 2027** [S11, read 2026-11-01]. Google's support answer 16965181 gives the same January 27, 2027 date, and calls itself a preview of "April 2026 policy updates" [S11]. The owner should check the Play Console policy notice.
2. **`logLevel` default.** S2 table: `LOG_LEVEL_VERBOSE`. S2 description: "boots with LOG_LEVEL_OFF". S4 5.8.0: "the default is off" [S2, S4].
3. **`foregroundService` default.** S2 table: false. S2 description: defaults to true and cannot be false on Android 8+ [S2].
4. **`fastestLocationUpdateInterval` default.** S2 table: 10000 ms. S2 description: 30000 ms when not called [S2].
5. **Elasticity worked examples.** S2 gives two examples; the first computes `multiplier × distanceFilter` and the second adds `× elasticityMultiplier`. The first example omits the multiplier [S2].
6. **Android stationary geofence.** S5 (wiki): "No stationary geofence is needed" on Android. S4 (4.x and 5.x entries): an Android stationary geofence exists and is a secondary trigger. The wiki text appears to be older [S4, S5].
7. **`stopDetectionDelay` and `preventSuspend` wording.** S2 table: `preventSuspend` applies "in the stationary state"; the description says "after location-services have been switched off". These mean the same thing for practical purposes [S2].
8. **Vendor docs site.** The `transistorsoft.github.io` URL redirects to a 4.x TypeDoc reference with no prose [S6]. The `docs.transistorsoft.com` API reference has prose but no version [S5b]. The repo typings are the most current single source [S2].
9. **v5 licence.** The census (category 2) records the v5 licence facts. This note's README read confirms that v4 keys do not work with v5 [S1].
10. **Issue #2666.** It is open in the search list; a maintainer comment says it is fixed in 5.8.0. The 5.8.0 changelog entries read do not mention the region fix [S4, S7]. Treat the fix as a maintainer statement.

## 4. Facts that bear on driver-app.md section 6

These are facts, not recommendations.

- Driver doc 6.2 fixes `timeInterval` at 10 s and `distanceInterval` at 20 m for the whole shift. No stop-detection or elasticity is in the documented Expo surface (rows 1, 2, 6 above), so the GPS duty cycle during a parked stop is set by those two numbers unless the app changes them.
- The vendor names GPS off while stationary as its main battery lever [S2, S5], and gives no figures for it [S5]. Our own measurement would be the only number.
- The vendor's background motion path depends on platform motion APIs. The Expo motion API is documented as foreground-only [S9], so the background signal that the vendor uses is not reachable with the documented Expo surface.
- The vendor stores recorded locations in SQLite without encryption and says so [S4]. Doc 6.2 uses `expo-sqlite` for the buffer; the same caveat applies to that store [I].
- The vendor's failure reports cluster on OEM Android (Vivo, Xiaomi, Oppo, Huawei, Samsung, Motorola) and on iOS relaunch and stuck-state bugs [S7]. The Expo location page says a terminated Android app does not restart on location events [S9], which matches doc 6.3 lists swipe-away stops on iOS and OEM battery managers on Android.
- Android 14+ forbids creating a location foreground service from the background without `ACCESS_BACKGROUND_LOCATION` [S10]. Doc 6.2's "reconciled on every app start" is covered by the census's inference that a restart from a background job would hit this rule [S13, I].

## 5. Traccar Client and OwnTracks

- **Traccar Client** (Android and iOS, Apache-2.0, last push 2026-10-30 per GitHub metadata). The README says it "runs in the background", offers "update intervals, accuracy, and data usage" settings, and does not describe distance filters, offline buffering, retries, the foreground service, or battery behaviour [S12]. The README says the Android repo "contains the old version" and that development moved [S12]. No mechanism is described from the sources read.
- **OwnTracks** (Android repo EPL-1.0, last push 2026-10-31 per GitHub metadata). The booklet describes four modes [S12]:
  - **Move mode**: iOS publishes when displacement reaches 100 m (`locatorDisplacement`) or after 300 s (`locatorInterval`), "higher battery usage". Android requests a GPS fix every 10 s in high-power mode (`moveModeLocatorInterval`) [S12].
  - **Significant-change mode** (the default background mode): iOS uses Apple's significant change (at least 500 m in 5 min, as OwnTracks states it), with occasional pings. Android uses a balanced-power request about every 15 min and relies on cell and Wi-Fi [S12].
  - **Manual and quiet modes**: no automatic background monitoring on iOS [S12].
  - **Region monitoring** runs independently of the modes [S12].
  - The booklet says accuracy and frequency "rise together with battery drain" [S12]. OwnTracks has no stop-detection equivalent in these pages [S12, I].

## Unanswered

1. **Play policy date.** Is geofencing's foreground-service removal August 2026 (vendor and search snippet) or January 27, 2027 (Google's policy page)? Owner to check Play Console.
2. **Play category for shift tracking.** Which Play foreground-service declaration (for example "User-initiated location sharing" or "Navigation") fits a shift-based delivery tracker? Not settled by any source read; needs an owner decision and the Play declaration video.
3. **Expo restart behaviour.** Does calling `startLocationUpdatesAsync` again with new options update an active task (needed for an elasticity emulation)? Not documented in S9.
4. **Expo foreground-service type.** Which `foregroundServiceType` does `expo-location` declare on Android, and is it `location`? Not stated in S9.
5. **Expo region minimum and exit latency.** Minimum radius and exit latency for `startGeofencingAsync` on iOS are not stated in S9. The vendor's 25 m and ~200 m are vendor claims [S2].
6. **Expo `startOnBoot` and terminated-state work on Android.** Not documented in the pages read; would need a native check.
7. **Vendor battery numbers.** No source publishes measured battery figures or a test method. Any drain target must come from our own measurement; the owner should set the acceptable value.
8. **Vendor fixes.** Whether 5.8.2 resolves #2644 and #2676 is not known; both were open at the last read.
9. **HTTP retry backoff.** The vendor's retry schedule is "periodic" until `maxDaysToPersist`; the interval and backoff are not stated [S2].
10. **Stop detection internals.** The thresholds and signals inside each vendor's stop detection are not public, and reverse engineering is out of scope. Only their documented options and behaviour are reported.
11. **Traccar and OwnTracks mechanisms in detail.** Traccar's README and OwnTracks' booklet page on modes were the only sources read. No code was read.
12. **Apple background-location review and Android background-location declaration.** Not researched in this note; the driver doc (6.3) lists them as requirements, and neither was verified here.
13. **Sensor background behaviour in Expo.** No SDK 58 page says whether `expo-sensors` or Pedometer runs in the background.
