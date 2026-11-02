# WEB-2 · Browser sessions and sign-in doors — design references

Found and read on 2026-11-02 with the Mobbin MCP (platform `web`). Source of the screen list and rules: `docs/roadmap.md` row WEB-2, `docs/architecture/web.md` §1, §3.4 and §5, `docs/architecture/identity-and-tenancy.md` §3.1, §3.2 and §3.3, `docs/contracts/errors.md` §1 and §2, `docs/contracts/openapi/staff.yaml` (auth paths). Mobbin collection: https://mobbin.com/collections/48aea75a-0924-4ca6-960c-ccc266aceda4 (named "eeasy-logistics · WEB-2"). Screens are left-to-right in the references; the merchant and platform screens mirror for Arabic (ADR-0016). The notes below come from Mobbin preview images and the flow titles; no reference was opened in a live product.

## Summary for the lead

- Each screen family has two to four references, except platform TOTP verify, which has one modal reference and reuses the authenticator set. Phone-number enrolment has two.
- Sign-in and reset references (Hume, HoneyBook, Typeform) are single-column forms with inline error text. Keep that shape; do not copy the SSO and passkey button rows, which WEB-2 does not build.
- The six-digit OTP is best shown as six boxes with a resend line that counts down (Visual Electric, Calendly, Mercor, Notion). The driver rule of a 60 s resend cooldown and the five-attempt limit in errors.md fit that pattern; the staff values are open (Unanswered).
- Authenticator enrolment: take the QR-then-manual-key-then-code order (Vimeo, Mercury, Airwallex). Show the key with a copy control, as Mercury does.
- Invitation accept: 1Password shows live password rules with a counter and a checklist. Take that. None of the references shows a breached-password refusal, so that message has no reference (see Unanswered).
- Session expired: take the in-page re-sign-in dialog over a dimmed page (Employment Hero, Rocket Money) for unsaved state, as web.md §3.4 requires. Use a full-page signed-out screen (Melio, Revolut Business) only for navigations.
- No reference is Arabic or RTL. The OTP box direction stays `dir="ltr"` as web.md §5 requires; no Mobbin RTL reference was found for it.
- Session expiring (silent refresh) needs no screen and has no reference.

## Sign-in with email and password

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/9c7e2abe-0a27-41f3-a33b-e29f923c6df6 | Hume AI, "Resetting password" (sign-in screen in the flow) | email and password stacked, "Forgot password?" aligned to the end of the password label, one full-width primary button | the gradient side panel; the all-caps button labels |
| https://mobbin.com/flows/c5b526c7-b001-46da-bb6b-ac4cceda5c66 | Retool, "Resetting password" (sign-in screen with the "Incorrect email or password" error, and a success toast after reset) | error shown under the form in red with a warning icon; the same error for both fields, which fits the identical-response rule in identity doc §8 | the SSO-first button order; the marketing illustration |
| https://mobbin.com/flows/ba3ae062-a579-4b6a-9f68-97794ea582b5 | HoneyBook, "Logging in" (password screen, then the code screen) | one card, a "Forgot your password?" link under the password field, a "Create one" link for a new account | the biometric icon beside the password field (WEB-2 has no biometric login); the social-login buttons |

## Second-factor code entry (phone OTP, six digits, resend with cooldown, five attempts)

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/29512f87-6b92-403f-8256-c2bc4e905808 | Visual Electric, "Logging in" (check-your-email screen) | six separate boxes in one row; the address the code went to shown above the boxes; "Didn't receive a code? Resend (20)" on one line under the boxes, the count visible | the red focus ring on the first box in the capture (use the token focus style) |
| https://mobbin.com/flows/de082a8f-4228-473d-9b4b-55c6bc7b9bdb | Sana, "Logging in" (code screen) | "Back" beside a disabled "Continue" until six digits are entered; "Resend code" as a text link under the boxes | the dark marketing panel on the right of the sign-in screen |
| https://mobbin.com/flows/d05b14be-1791-4f64-953b-691dd4eacf69 | Notion, "Logging in" (verification-code screen) | "Resend in 29s" as a countdown in plain text beside the code field; the "We sent a code" line with the address | the "or continue with" SSO row under the code field |
| https://mobbin.com/screens/c85d5ff1-20be-443e-9f7a-cbe8ae12dfaa | Shopify, "Verify your account to continue" (modal over a dark page) | a compact modal with one line of why, six boxes, "Didn't receive a code? Resend code" | the dark backdrop as the only page context; WEB-2 keeps the sign-in page layout |

Mobbin's Notion and Visual Electric captures show the code field before the code is sent; the 60 s cooldown and the 5-attempt rule from the identity doc are not visible in any capture and are inferred to match these patterns.

## Second-factor enrolment by phone (enter phone, then code)

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/857e1fb7-a8ae-4ce4-9782-581ba4f7b5a5 | Calendly, "Adding a phone number" | country flag and number in one field; "Send verification code" beside the field, enabled once a number is typed; the code boxes appear under the same field, with "Resend code" beside it | the auto-save line at the bottom ("changes are saved automatically"); we need an explicit submit |
| https://mobbin.com/flows/5846cf20-26e8-438f-8880-d17c668699ae | Mercor, "Verifying a phone number" (code modal) | "We've sent a six-digit code to +…", a "Change" link to the number, and "Resend code in 59 seconds" in the modal | the success toast that sits over the page header; the progress chips in the header |

## Authenticator-app enrolment with QR and manual key (platform console TOTP)

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/a6258c10-405d-4b4f-b9fb-cacd7c98f0ca | Vimeo, "Setting up two-factor authentication" (setup modal) | the QR code and, under it, "Manual Entry Code" with the key under it; the three numbered steps beside the QR; a single code field with "Validate code" | the method chooser that offers email codes as a first option (the platform has TOTP only, identity doc §3.3) |
| https://mobbin.com/flows/5aedd6f7-f48a-4f03-b988-8aaa9aee27cc | Mercury, "Setting up two-factor authentication" (step 2 of onboarding) | the QR with "Or manually enter this key into your authentication app:" and a copy icon beside the key; the code entry in step 3 | the live code display with a spinner in step 3 (WEB-2 shows a plain code field, not a generated code) |
| https://mobbin.com/flows/84bd2f58-91d4-4f47-8d82-17f0e71b186c | Airwallex, "Setting up two-factor authentication" (9 screens) | "Enter authentication code" with the inline error "Please enter the 6-digit code" under the field, and "Back" beside "Verify and activate" | the progress bar at the top of the page; the upsell to the Airwallex app as a second factor |

## Platform sign-in: TOTP verify

Use the TOTP verify screen of the same family as the authenticator enrolment above: a single six-digit field, the same inline error, and a "Back" action. The enable modal in https://mobbin.com/flows/37798159-560f-4c50-879d-da9dbf5e6a40 (Mistral AI, "Setting up two-factor authentication") shows a bare code field with "Back" and "Enable" buttons in a modal; take that layout for the platform verify step and drop the modal, since the platform sign-in is a full page (identity doc §3.3).

## Account selection (several memberships)

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/5e19256c-ef96-404e-8fb1-7300781eed57 | Featurebase, "Switching organizations" (the "Choose your organization" screen) | a short vertical list of the organisations with the name only, and a "Create a new organization" row at the end | the create-organisation row as a way in for WEB-2: merchant accounts are created by the platform, not by staff |
| https://mobbin.com/flows/f0d98767-ce65-4168-a951-716a2d4597ae | Employment Hero, "Switching organisations" | a search field above the list when many memberships exist; the current selection marked with a check | the side panel that covers the page |
| https://mobbin.com/flows/dfebc8d0-3b36-492d-8441-546fff694406 | Steep, "Logging in" (the "Workspaces" card) | the card that lists the memberships with a "Log out" button at the foot, so a wrong login has a way out | the dashed "New workspace" row |

## Invitation accept (name and password, password rules)

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/1e2b0d32-f63d-4151-95b0-08697cdde284 | 1Password, "Accepting an invitation" (password screen) | a green banner naming the inviter, then the name field; the password field with the live rule "Use 10 or more characters" and a counter that turns to a check mark, and the list of required kinds in small text (we have no composition rules, identity doc §3.1, so drop that list) | the company-role dropdown and the newsletter checkbox; the decorative illustrations |
| https://mobbin.com/flows/f37841a1-9dcc-486e-8335-53202935e63b | Square, "Accepting team invitation" (create password) | two password fields, "Create password" and "Confirm password", each with a show/hide control, and the helper line "Use at least 8 characters" under them | the 8-character minimum (WEB-2 needs 12, identity doc §3.1); the Learn more link in the header |
| https://mobbin.com/flows/b2df1053-3a88-44cb-b77f-851292c77db6 | Toggl Track, "Accepting an invitation" | a single card with the organisation name, one "Accept and join" button | the marketing and legal paragraph under the button; the emails-opt-in line (no marketing opt-in in WEB-2) |

Breached-password refusal: none of the invitation and reset captures shows a refusal message for a breached password. The text for it has no reference (Unanswered).

## Password reset request and confirm

| Reference | Product, flow | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/flows/c5b526c7-b001-46da-bb6b-ac4cceda5c66 | Retool, "Resetting password" (request, then "Finish resetting your password") | the request form and the confirm form each with one heading, the email field repeated on the confirm screen, "New password" and "Confirm new password" fields | the marketing side panel on the sign-in page |
| https://mobbin.com/flows/9c7e2abe-0a27-41f3-a33b-e29f923c6df6 | Hume AI, "Resetting password" (request sent, reset form, "Your password has been reset") | the same message after the request whether or not the email exists ("A link ... has been sent to your email"), which matches the always-202 rule (staff.yaml, password-reset/request); a final "Go to log in" state | the monospace type and the all-caps buttons |
| https://mobbin.com/flows/fd75017d-c956-4db1-8bac-eaa5329f305d | Typeform, "Resetting password" (rules block above the fields) | the rules stated in one plain paragraph above the two fields, and "Back to sign in" as the last link | the composition rules (at least one number and one symbol, no username parts, no last-four reuse); the identity doc has length and breached-password checks only (§3.1) |

## Session expired and signed out

| Reference | Product, flow or screen | Take | Do not take |
|---|---|---|---|
| https://mobbin.com/screens/80a62519-da66-4bc6-b988-92bbf392b408 | Employment Hero, re-sign-in dialog ("Hi Jane, are you still there?") over a dimmed page | the dialog keeps the page state under it; one password field, "Log in" and a "Not Jane?" link that goes to a full sign-in; this is the modal of web.md §3.4 for unsaved state | the countdown to an automatic redirect ("You will be redirected to the login page in 1:52:42"); WEB-2 does not redirect silently while a form is open |
| https://mobbin.com/screens/0727897f-0c0a-464c-844e-dd987cb1e671 | Rocket Money, "You're busy, we've got your back" modal over a dimmed dashboard | the dimmed page behind a single dialog with one "Log in" action | the illustration and the chatty heading; the wording has to follow the Arabic and English catalogues |
| https://mobbin.com/screens/13f6a790-96f6-4235-b115-fe403d7b0d53 | Melio, "Your session has expired due to inactivity" (full page) | a full-page message with one line of cause and one "Sign in" button, for a navigation that has no page state to keep (web.md §3.4, "Refresh rejected on a navigation") | the mascot illustration and the feedback tab on the edge |
| https://mobbin.com/screens/0d6fe0a6-280e-4461-b1e1-bc7efc9f4ec9 | Revolut Business, "You've been logged out" (card with a close control) | a centred card with the cause and a "Log in" button | the shield logo as a brand mark; the dark theme (WEB-2 uses the token set of ADR-0033) |

Session expiring (silent refresh, middleware and fetch wrapper): no screen and no reference. The refresh runs without UI (web.md §3.2).

## Right-to-left and the OTP boxes

- No reference found in the set above is Arabic or right-to-left. The RTL search (query "Arabic right-to-left sign-in or verification code screen with six digit code boxes") returned incident.io, Base, Shopify and Telegram; none is an Arabic-locale screen, so none shows the box order in RTL.
- The code boxes stay `dir="ltr"` in both locales (web.md §5). The references above show the digits in one left-to-right row only.
- The order of the boxes in Arabic (whether the first box is at the start edge or the end edge of the row) is not settled by any reference. It is an owner or design decision (Unanswered).

## Unanswered

- Breached-password refusal text and placement: no reference shows it. Identity doc §3.1 requires the check; the message and its place in the invitation and reset forms need a design decision.
- Cooldown and attempts for merchant-staff OTP: identity doc §3.2 states the 60 s cooldown and the five-attempt limit for drivers. The merchant second factor (§3.1) has no stated cooldown or attempt count, and errors.md groups five attempts under `otp_invalid` for both. The owner should confirm the staff values before the OTP screen copy is written.
- Arabic OTP box order: no reference settles whether the six boxes run from the start edge in Arabic. Needs a design review or an owner ruling.
- RTL references: no Arabic or RTL reference for any WEB-2 screen was found. A second search with `ar` content, or a design review, is needed before the Arabic layout is signed off.
- Collection name: the brief asked for "eeasy-logistics WEB-2"; this note and the Mobbin collection use "eeasy-logistics · WEB-2", the form the handbook (04) and the WEB-1 and PLAT-14 collections use. The lead should confirm.
- Platform TOTP verify screen: the reference set has no full-page TOTP verify screen. The layout above is taken from enrolment captures and the Mistral modal; a dedicated full-page reference was not found.
- Mobbin previews only: all observations come from preview images captured on 2026-11-02 and the flow titles. No reference was exercised in a live product, so states such as the exact error copy or timing are unverified.
