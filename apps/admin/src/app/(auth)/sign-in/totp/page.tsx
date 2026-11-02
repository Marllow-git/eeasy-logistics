import { TotpDoor } from '../../../../auth/totp-door';

/**
 * `/sign-in/totp` (web §1; WEB-2 plan 2.9): the authenticator code of a console sign-in, or the
 * enrolment view on first use. The step comes from `sessionStorage`, so the card renders in the
 * browser; a page opened without a sign-in in progress goes back to `/sign-in`.
 */
export default function TotpPage() {
  return <TotpDoor />;
}
