# ADR-0039: Track driver location with our own adaptive tracker on Expo, without a commercial plugin

- **Status:** accepted
- **Date:** 2026-11-01
- **Deciders:** owner
- **Source:** owner ruling 2026-11-01; teardown `docs/research/background-location-teardown-2026-11.md`; census `docs/research/client-library-census-2026-11.md` category 2; ADR-0009, ADR-0028; document 8 §6

## Context

Document 8 §6.2 runs `expo-location` at `High` accuracy, a point every 10 s or 20 m, for the whole 8 to 12 hour shift, including the minutes a driver spends parked at each stop. The leading commercial plugin (Transistorsoft `react-native-background-geolocation`) saves battery mainly by turning GPS down while the device is stationary. Its other techniques are speed-scaled distance filtering, batched uploads and filtering of bad fixes. It needs a paid per-app key for release builds and ships closed native code. Its own issue tracker shows tracking that stops without resuming and devices that OEM battery managers stop. Expo SDK 58 documents continuous and deferred updates, the Android `location` foreground service and geofencing. iOS restarts a terminated app on a geofence event; Android does not. Expo has no background motion-activity API, no significant-change mode and no stop detection. The vendor publishes no measured battery figures.

## Decision

The driver app tracks location with its own tracker built on `expo-location` and `expo-task-manager`. It uses no commercial location plugin. The tracker:

1. **Two profiles, driven by the domain first.** `moving` keeps the ADR-0009 cadence (`High`, 10 s / 20 m). `parked` uses `Balanced`, about 60 s / 50 m. The app enters `parked` when the driver arrives at a stop (its own field events) or when fixes stay within 30 m for 3 minutes. It returns to `moving` when the driver departs or starts the next stop, or on a geofence exit (point 2). It never infers a stop from motion sensors.
2. **A parked geofence.** On entering `parked`, the app registers one geofence of about 150 m around the spot with `startGeofencingAsync`. An exit switches to `moving`. On iOS that exit also restarts an app the driver swiped away.
3. **Speed bands.** In `moving`, the distance interval widens in a few speed bands, with hysteresis and at most one change a minute. Changing profile restarts the location task with the new options, which needs a device test because Expo does not document it.
4. **Fix filtering.** Fixes are dropped when worse than 100 m accuracy, older than the last point sent, identical to the previous point, or implying an impossible jump. A jump is only dropped when the fix's own reported speed disagrees with it too. Every drop is counted by reason.
5. **Upload policy.** Points batch every 15 s in `moving` and every 2 to 3 minutes in `parked`. They flush immediately on every profile change. ADR-0028 is unchanged: points never enter the outbox.
6. **Two watchdogs.** The app checks the last fix age on every wake (outbox drain, push, foreground) and restarts the task, or posts a local notification asking the driver to open the app where Android 14+ forbids a background start. The API raises a stale-tracking alert (push to the driver, flag to dispatch) when an active shift sends no point for 5 minutes.
7. **OEM guidance.** The setup screen gives per-maker battery instructions and opens the battery-optimisation settings screen. The app does not request `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`. Each point carries charging state and power-saver mode, alongside `battery_pct`.
8. **iOS activity type** `OtherNavigation`, not `AutomotiveNavigation`, which snaps tracks to roads.
9. **Battery budget** (owner ruling 2026-11-01): at most **4 % per hour** during an active shift on the reference Android device, measured with the driver diagnostics (points per hour, gaps over 2 minutes, battery per hour) on one reference Android and one reference iPhone before wave 1 exit.
10. **Encrypted local store** (owner ruling 2026-11-01): the driver app's SQLite database (outbox, location buffer, local read model) uses SQLCipher through `expo-sqlite` `useSQLCipher`. A random 256-bit key is generated on first launch and kept in `expo-secure-store`. At open, the app checks `PRAGMA cipher_version` and refuses to start if it returns no row, because an unencrypted build would otherwise run silently.

A small Expo native module of our own is the next step only if measurement misses the budget or the stop detection proves unreliable. It would cover background activity recognition and iOS significant-change relaunch. It needs its own ADR.

## Consequences

GPS duty drops during the parked minutes that make up much of a last-mile shift, with no licence cost and no closed binary in the app. The app's own stop events make the profile switch more accurate than a generic motion signal. We own the failure modes: the tracker's state machine, filter and watchdogs need unit tests and device tests, and the OEM matrix needs real devices. The API gains a stale-tracking job (DEL-5). SQLCipher adds a native build requirement (already true for Argon2, ADR-0034) and a key-management rule; losing the key loses the local store, which only holds data the server already has or the outbox replays. The secure-store accessibility value chosen for ADR-0034 applies to this key too.

## Alternatives considered

- **Transistorsoft `react-native-background-geolocation`.** Mature motion detection and keep-alive, but a paid release key per app, closed native code, and the same OEM and stuck-state failures in its tracker. It lost on cost, control and auditability.
- **Keep document 8 §6.2 as written.** Simplest, but full-power GPS for the whole shift with no stop handling and no watchdog for silent stops.
- **Native module first.** Background activity recognition and significant-change relaunch from day one. It lost because domain events and a geofence cover most of the benefit with documented Expo APIs; the module waits for measurements.
- **Open-source trackers (Traccar Client, OwnTracks).** Native apps, not React Native libraries. Useful only as design references.
