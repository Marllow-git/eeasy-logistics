# DRV-1 · Driver app shell and sign-in — design references

Found and read on 2026-11-02 with the Mobbin MCP (`search_screens` and `search_flows`, platform `ios`). Saved to the Mobbin collection "eeasy-logistics · DRV-1" (https://mobbin.com/collections/ecbfbd79-6723-4866-b55a-738789a7c679): 27 screens and 2 flows, read back the same day. Scope and rules from: `docs/roadmap.md` row DRV-1 (lane `driver`, depends on PLAT-15 and DEL-4, ADR-0004, ADR-0021, ADR-0034, doc 8 §5.2, §5.3, §7, §10); `docs/architecture/driver-app.md` §5.2 (PIN rules), §5.3 (offline PIN verifier, proposed ADR-0034), §7.1 to §7.3 (OTP, device binding, forced sign-out), §9 (screens per wave), §10 (internationalisation); `docs/handbook/04-conventions.md` "Design references". The rule that ADR-0016 (Arabic first, RTL) and ADR-0033 (our design system) win is from that convention; I did not open the ADR texts. The notes come from Mobbin preview images and flow titles. No reference was opened in a live app, so copy, timing and validation are unverified.

## Summary for the lead

- Sources: 27 Mobbin screens and 2 flows, read 2026-11-02 (collection link above). Layout and states only; no copy or asset is copied.
- Android: the Mobbin tool accepts only `ios` or `web` (its error, 2026-11-02), so no Android reference was searched or saved. Android Material patterns are unanswered.
- Phone OTP: Waymo, Venmo and Lightyear for entry; Cash App, Brick and Klarna for code entry with resend countdown and sent confirmation; Brick and Posh for a wrong code. No reference shows an automatic code read.
- Device binding: Swiggy and Copilot for the other-device list and the "log out of all devices" confirm (its "up to 60 minutes" line); Venmo and Neo Financial for the "This device" tag. No reference shows a "signed in on another device" notice.
- PIN: Venmo, Neo Financial, Klarna and Grab for set and confirm; Starling for verifying an existing PIN. No reference shows a lockout notice. Grab's "Show PIN" conflicts with driver-app §5.2 (no digits shown).
- Update required: Google Health (Fitbit), v0 and Phantom show one full-page action. The driver-app doc has no update screen in §9; roadmap DRV-6 says "minimum-version handling if ruled".
- Shell: talabat (three tabs), Blue Apron (status track), Glovo (grouped profile list) and Fiverr (headline earnings figure). Doc §9 names run, sync and cash as tabs; settings is a separate route.
- Offline: Fresha, Facebook and Perplexity keep the shell and offer a retry in place. None shows an offline banner with a count of items waiting to sync.
- RTL: no right-to-left or Arabic reference was found in four Arabic or Saudi-market searches. Every result opened showed an English, left-to-right layout (see the RTL section).

## Phone-number OTP sign-in (phone entry, code entry)

Doc basis: phone normalised to E.164 by the server, the app offers the `+966` prefix; a 60 s resend timer; generic "if this number is registered, a code was sent" (§7.1).

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/4a86fd1c-a6cd-4b65-9fb5-9de31c776ee7 | Waymo, "What's your mobile number?" with "We'll text you a code to confirm" | one field, a primary "Next" disabled until a number is typed, the numeric keypad open on arrival | the top-right menu; the blurred suggestion strip above the keypad |
| https://mobbin.com/screens/dce2127c-7e22-4d60-befc-0715e63f5dec | Venmo, "What's your number?" with "Send code" | the consent line in small text above the primary button, the button pinned to the foot | the six-segment progress bar (it implies a multi-step flow §7.1 does not have); the carrier-fee and data-sharing wording |
| https://mobbin.com/screens/93e08e06-9f37-497b-852d-12dab575ce3b | Lightyear, "Phone number" with a country select beside the field | the country prefix as its own control beside the number field | the +44 default; ours is `+966` (§7.1) |
| https://mobbin.com/flows/00da93c5-c23b-4701-a51d-5b13fb2c2094 | DoorDash Dasher, onboarding flow (16 screens): welcome, six-box code, permissions, SMS opt-in | the order sign-in, code, then permissions, where each permission shows its state and a Retry; the opt-in with two equal buttons, "Opt in" and "No thanks" | the "Log in with email and password" link and the email login screen; §7.1 defines phone OTP only (inference from the doc); the welcome illustration |

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/40353ce6-9e7b-4390-aed5-9dea0efd6fbe | Cash App, "Please enter the code sent to" with "You can request another code in 56 seconds" | a sentence with the cooldown above a disabled "Resend" control that becomes active at zero; matches the 60 s timer in §7.1 | the code-with-dash format (046-148), which is one bank's code shape |
| https://mobbin.com/screens/100c684d-99c9-472d-a6bc-165dc4597936 | Brick, "We sent you a verification code" with six boxes and "Resend code in 22s" above "Verify" | the countdown inline above the primary action; six boxes that show the cursor on the active one | the dark primary button |
| https://mobbin.com/screens/6e90b627-7ba2-4e15-a943-5dae7df8bbbb | Klarna, "Enter the 6-digit code" with a green "Code sent to phone" banner and "You should get a text within 20 seconds" | a confirmation after send that names the channel and the expected wait | the browser-style sheet frame with a domain bar |

Auto-read: no reference shows how a code arrives or fills (the screens are static). The mechanism is not in the sources read (Unanswered).

## Code errors (wrong code, expired code)

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/cd3239fd-a502-4e5e-aa98-3e42506886fa | Brick, "Hmmm, that code didn't work" in red under the boxes, the countdown still shown | the error stays on the entry screen, under the boxes, and names the number the code went to; the countdown keeps running | the informal tone of the copy |
| https://mobbin.com/screens/450e9571-11d6-4e9b-bc7e-5b0373470d9e | Posh, "Invalid pincode" as a red top banner with the six boxes outlined in red | the red outline on the entry boxes as well as the message | the dark theme and the ticket-scanning context |

No reference shows an expired-code state or the rate-limit message the server sends. The doc gives no code for either (Unanswered).

## Device binding and the "this device" notice

Doc basis: `device_id` is a random UUID kept in secure storage; a second active device is `409 device_limit_reached` with "ask your dispatcher to remove an old phone" (§7.1); a removed device ends the session with `401 device_revoked` (§7.3). The dispatcher removes devices; the doc has no driver self-service revoke.

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/489cb332-231d-4924-b101-f1f0c268e707 | Swiggy, "Logout Options": "Current device" and "Other logged in devices" sections, each row with its last-active time | the two sections, current device first, each row with a last-active line | the per-row "Logout" action and the "Logout of All Devices" button (the driver does not revoke devices, §7.1); the orange brand colour |
| https://mobbin.com/screens/993a1804-7f90-4d92-b680-81f44a65ffce | Neo Financial, "Verified devices" with one row and a "This device" tag | the "This device" tag beside the row, with the last sign-in time under it | the masked name bar (a placeholder in the capture) |
| https://mobbin.com/screens/a1e1533c-313e-4b47-b264-a6d02e721ef0 | Venmo, "Remembered Devices": explanation sentence, "This Device" and "Other Devices" headings | a plain sentence at the top that says what the list does | the promise "you won't have to submit a code": the doc has no OTP skip on a known device (§7.1 verifies an OTP at every sign-in) |
| https://mobbin.com/screens/bc94d0b5-77eb-431f-a97e-7702d50d4acf | Copilot, "Log out of all devices" confirm: "It may take up to 60 minutes for all devices to be logged out", Cancel and a red confirm | the note that a revoke takes effect with a delay, in the confirm text; Cancel first, one red confirm | the self-service "log out everywhere" action itself (no driver self-service in the doc) |

No reference shows the notice a driver gets when a session ends because the device was removed. The nearest is the list above, which is not a notice (Unanswered).

## PIN setup, confirm and the existing-PIN check

Doc basis: four to six digits, Argon2id on the server; setup right after the first sign-in when `cash_pin_set` is false; the keypad uses Western digits, shows no digits, disables screenshots on the PIN screen, never stores the PIN in SQLite, logs or analytics (§5.2). A device verifier is armed at setup (§5.3, proposed ADR-0034).

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/02e071b2-f1a8-4336-bce3-82863da55b2e | Venmo, "Create your PIN": a short purpose line and a row of empty boxes above the keypad | the purpose line above the boxes, the boxes filled as dots | the decimal "." key on the pad (the PIN is digits only, §5.2); the close (X) as the only exit |
| https://mobbin.com/screens/90b6eb53-4b07-40bb-928d-36fd941f080e | Neo Financial, "Confirm your PIN": "Re-enter your 4-digit PIN" with the same boxes | the confirm step as its own screen with the same keypad, and the length in words | the last typed digit shown in clear (§5.2: no digits shown); the illustration |
| https://mobbin.com/screens/1bf09e53-a6df-403b-990c-c5656366f0c4 | Klarna, "Set your PIN": one rule line under the title, four dots, a back arrow on the pad | one line of rules under the title, before any entry | the rule wording itself (copy is ours, in `ar` and `en`) |
| https://mobbin.com/screens/919d9031-9b4e-45a1-9a54-74ff2b8bfbf7 | Grab, "Enter a new PIN": rules for repeats and sequences, six dots, a "Show PIN" link | the rule shown before the first digit | the "Show PIN" link (conflicts with §5.2); the sequence rule is a product decision (Unanswered) |
| https://mobbin.com/screens/64d828ee-b904-4111-a01f-61a55ec78db4 | Starling, "Enter your existing 6-digit passcode" with a "Forgot passcode" link | the verify-existing-PIN screen as a stand-alone step (the handover request asks for the PIN, §5.6) | the "Forgot passcode" self-reset; §5.2 says only a dispatcher resets a locked PIN |

No reference shows a lockout notice. §5.2 requires a locked cash screen with "ask your dispatcher to reset" and says deliveries without cash stay possible; no reference shows that split (Unanswered).

## App update required and forced screens

Doc basis: none in §9. Roadmap DRV-6 lists "minimum-version handling if ruled" as an open item. The forced-screen patterns below are references only.

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/9b8c3d26-fbcf-4154-af94-03420944083e | Google Health (Fitbit), "Update your Fitbit Air": an icon, one title, one sentence, one blue "Update" button at the foot | the single page, one action at the foot, one reason sentence | the product image; "The update may take several minutes" (we cannot time a store update) |
| https://mobbin.com/screens/f0ad5ac6-1728-4de2-8a61-c93f07ef9c7f | v0, "Updated Terms of Service" with "Accept & Continue" fixed at the foot | a required step that holds the action at the foot | the close (X) at the top right: inference that a required update must not be dismissible; the doc does not say |
| https://mobbin.com/screens/610eda20-87ee-445d-8eb7-a2e967a08477 | Phantom, "We've updated our Privacy Policy": one primary "Continue" and a "Learn more" link | a full-screen gate with one action and a link to detail | the consent wording and the dark theme (not ruled for the driver app) |

No reference shows a store link or a version line. Those depend on the owner's ruling for DRV-6 (Unanswered).

## Driver shell: tab bar (run, cash, sync, profile)

Doc basis: §9 lists the run list, sync and cash as tabs under `(app)/(tabs)`, and settings as `(app)/settings`. The brief asked for runs, cash and profile. Groups: `(auth)`, `(setup)`, `(app)` (§9 note).

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/82ee1273-1991-4306-8f27-49c484c5f6b4 | talabat, home with a three-item bottom bar (Home, Orders, Account) with icon and label | three labelled tabs with icon and word, so the bar reads without a legend | the promotional strip above the bar; the location header |
| https://mobbin.com/screens/d1a35bd9-27c7-4dde-b80f-c96699e5a286 | Blue Apron, "Upcoming orders" card with a four-step track (Confirmed, On the way, Out for delivery, Delivered) | a step track for one run stop, as the §9 "Start stop" and deliver actions imply | the segmented "Upcoming / Past orders" control; the menu and the extra tab |
| https://mobbin.com/screens/6d8778a6-a7d7-44e6-b9ed-500b211fc5c2 | Glovo, "Profile" tab with grouped rows and chevrons (Account, Language, Appearance, FAQ) | a grouped profile list with a language row (§10: `ar` default, `en` is a setting) | the dark theme; the promotional rows (Prime, promo codes, share and earn) |
| https://mobbin.com/screens/a6c384b2-1dbe-4706-b4af-62c7112f631a | Fiverr, "Earnings": one large figure "Available for withdrawal" above a period chip and a tab pair | one headline figure with a caption, as the cash screen's "confirmed SAR X" line (§5.4) | the chart and the "Withdraw" button (no driver withdrawal; handover is online only, §5.6); the floating tab bar |

Tab set: the references show three to five tabs. Whether settings or profile is a tab is open (Unanswered).

## Offline and poor-connectivity states

Doc basis: the outbox and sync screen (§3, §4.5); cash shows "confirmed" and "waiting to sync" as two lines (§5.4); the run list marks "not synced" rows (§9).

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/b6f7d349-7d9f-466f-87ce-a2ed5c95b585 | Fresha, "No internet connection ... Try again" in place of the list, with the tab bar still shown | the tab bar stays and the state fills the content area with one retry | the map behind the sheet; the filter chips |
| https://mobbin.com/screens/4ecaa84d-2715-42a5-acb7-47b550651e00 | Facebook, "Feed isn't available right now ... Reload page" inside the shell | a failure confined to one part of the screen, with the rest of the shell usable | the gear illustration |
| https://mobbin.com/screens/53c1cd17-3832-45bf-adcc-d86bd15c7a15 | Perplexity, a grey card "Something went wrong. Please try again later." with "Try again" | an inline card with a retry action | the message with no cause; the driver needs to know whether the phone is offline or the server failed |

No reference shows a banner that says changes are saved on the phone and will sync, with a count. That is the state §3 and §5.4 need (Unanswered).

## Right-to-left and Arabic

- Four searches (an Arabic-language query for sign-in and the verification code; a right-to-left sign-in query in English; a Saudi super-app query for Careem and Snoonu; a Saudi wallet query) returned no right-to-left layout. The results I opened (talabat, Careem, Snoonu, Swiggy, Pool, Glovo, CLEAR, Klarna and others) showed English labels in a left-to-right layout, read from the preview images.
- Items that the sources set for the driver app and that no reference shows: `I18nManager.forceRTL` and the reload on language switch (§10); mirrored back and next icons with maps and the signature pad not mirrored (§10); Western digits and the Gregorian dates inside Arabic text with isolates (§10). The sources in this note do not show how a tab bar orders its items in RTL.
- Chevrons and back arrows mirror; checkmarks, the map pin and the code boxes do not (the doc's rule for the merchant web applies by analogy; inference).

## Unanswered

- Android: no Android reference is captured because the Mobbin tool accepts only `ios` or `web`. Is an Android capture from another source acceptable for DRV-1, and which Android version is the target? Android Material patterns are not covered.
- Automatic code read: no reference shows it, and the sources read do not name the platform mechanism. Confirm the fallback when the read does not happen.
- PIN length: most references use four boxes; §5.2 says four to six digits. Fixed length or variable with a confirm button?
- Lockout: the copy, and whether the locked screen shows the dispatcher's contact, have no reference.
- Signed in on another device: no reference shows the notice. Does the driver see a reason on the sign-in screen after a removal, or is the session ended silently?
- Device list: the doc gives the dispatcher the removal. Should the driver see the "this device" and "other devices" list at all?
- Tab set: run, sync and cash (§9), or run, cash and profile (the brief)? Where does settings and sign-out sit?
- Update required: no §9 screen, and DRV-6 says "if ruled". Owner ruling on the minimum version, the store link and whether the gate can be dismissed.
- Offline banner with pending count: no reference. Owner to confirm the copy source for "waiting to sync" (§5.4) and where it sits.
- RTL and Arabic: no reference. Owner to decide whether DRV-1 relies on the Arabic-first rule (ADR-0016) without a reference, or needs an Arabic capture from a live product before the executor is briefed.
- Keypad: the references use the system numeric keypad. §5.2 asks that digits never show and screenshots are disabled on the PIN screen; neither is visible in a static image, so engineering confirms both.
- Expired-code and rate-limit states: no reference and no copy in the doc.
