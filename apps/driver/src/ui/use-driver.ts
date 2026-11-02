import { useSyncExternalStore } from 'react';
import { gate, type Gate } from '../domain/gate';
import { driverApp, type SetupState } from '../sync/driver-app';
import type { SessionState } from '../sync/session';

export function useSessionState(): SessionState {
  const { session } = driverApp();
  return useSyncExternalStore(session.subscribe, session.getState);
}

export function useSetupState(): SetupState {
  const { setup } = driverApp();
  return useSyncExternalStore(setup.subscribe, setup.get);
}

/** The route group the app may show now (domain/gate.ts). */
export function useGate(): Gate {
  const session = useSessionState();
  const setup = useSetupState();
  return gate({
    hydrated: session.hydrated && setup.hydrated,
    signedIn: session.signedIn,
    updateRequired: session.updateRequired,
    cashPinSet: setup.cashPinSet,
    cashPinLocked: setup.cashPinLocked,
    verifierArmed: setup.verifierArmed,
    permissionsDone: setup.permissionsDone,
  });
}
