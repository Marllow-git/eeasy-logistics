# ADR-0034: Check the cash PIN on the device offline and again on the server at replay

- **Status:** proposed
- **Date:** 2026-10-31
- **Deciders:** architecture lead, owner to accept
- **Source:** driver app architecture (document 8) §5.3; contracts (document 3) §12 open point 2; document 4 §3.2; ADR-0007, ADR-0008

## Context

Document 4 §3.2 requires the cash PIN for every cash collection, and five failures lock cash actions. Deliveries happen offline (ADR-0008), so the server cannot check the PIN at the door. The contract sends `cash_pin` inside the replayed `delivered` event and verifies it at replay; a wrong PIN still records the delivery (D-23) and flags the collection for review. Checked only at replay, the PIN gives the driver no feedback at the door and does not stop someone else holding an unlocked phone from recording cash.

## Decision

The app keeps a PIN verifier on the device and checks the PIN against it before a cash collection is written to the outbox; the event still carries the PIN and the server still verifies it at replay, with the flag-for-review rule unchanged.

- The verifier is Argon2id (19 MiB, 2 iterations, random 16-byte salt) computed on the device from a PIN the server has just accepted (PIN set or change, handover request, an online cash delivery, or a new online operation `driverVerifyCashPin`, `POST /v1/driver/cash-pin/verify`, used at sign-in when a PIN exists and the device has no verifier). The server's hash never leaves the server.
- It lives in the OS secure store (iOS keychain `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`, Android Keystore), is never backed up, and is deleted on sign-out, device revocation, a server PIN lock and a PIN change seen from another device.
- Five consecutive local failures lock cash recording on the device until an online PIN check succeeds and the server shows the PIN unlocked.
- The PIN of a pending cash event is held in the secure store under the outbox item id, added to the request at send time and deleted after the result; it is never in SQLite, logs or analytics.
- `driverVerifyCashPin` counts failures toward the same server lock as every other PIN check and returns `cash_pin_invalid` or `cash_pin_locked` (both in `errors.md`). It is added to `driver.yaml` by the contracts owner when this ADR is accepted.

## Consequences

Drivers learn of a mistyped PIN at the door, and a phone in the wrong hands cannot record cash past five tries. Review flags at replay become rare: they remain for a PIN changed on another device while this one was offline. A rooted-device attacker who extracts the keystore can brute-force the verifier offline, quickly for a four-digit PIN; this is accepted because the same attacker already holds the device-bound refresh token, and because the server re-verifies every PIN at replay, so the verifier gates the app, never the ledger. The app needs a native Argon2 module (a native build, document 8 §12.4).

## Alternatives considered

Verify only at replay (the contract default): no feedback and no protection at the door; every typo becomes a supervisor review. Verifier only, without server re-verification: makes the device the authority over cash attestation, which a modified app could bypass. Sending the server's hash to the device: exposes the server's stored credential and ties the app to its hashing parameters.
