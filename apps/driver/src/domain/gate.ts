// The sign-in state machine (driver app §9, DRV-1 plan 2.1): which route group the app may show.
// `(auth)` without a session, `(setup)` until the cash PIN step and the permissions step are done,
// `(app)` otherwise; an update notice above everything when the API refuses this build.

export type Gate = 'loading' | 'update' | 'auth' | 'setup-pin' | 'setup-permissions' | 'app';

export interface GateInput {
  /** The secure store and preferences were read. */
  readonly hydrated: boolean;
  readonly signedIn: boolean;
  /** The API answered `426 app_update_required`. */
  readonly updateRequired: boolean;
  /** From `driverVerifyOtp` or `driverGetMe`; undefined when not known yet (offline cold start). */
  readonly cashPinSet: boolean | undefined;
  /** The server locked the PIN (`423`, or `driver.cash_pin_locked`): cash waits for a dispatcher. */
  readonly cashPinLocked: boolean;
  /** A device verifier exists (ADR-0034). */
  readonly verifierArmed: boolean;
  /** The permissions step was shown and left (each permission granted, refused or put off). */
  readonly permissionsDone: boolean;
}

export function gate(input: GateInput): Gate {
  if (!input.hydrated) return 'loading';
  if (input.updateRequired) return 'update';
  if (!input.signedIn) return 'auth';
  if (needsPinStep(input)) return 'setup-pin';
  if (!input.permissionsDone) return 'setup-permissions';
  return 'app';
}

function needsPinStep(input: GateInput): boolean {
  if (input.cashPinSet === false) return true; // first sign-in: set a PIN (§5.2)
  if (input.verifierArmed || input.cashPinLocked) return false;
  // A PIN exists (or is not known offline) and this phone has no verifier: arm it (§5.3).
  return true;
}
