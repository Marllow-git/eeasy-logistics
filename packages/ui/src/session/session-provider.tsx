'use client';

import {
  createSessionFetcher,
  sessionPaths,
  type Fetcher,
  type SessionEndReason,
  type SessionSurface,
} from '@eeasy-logistics/contracts/http';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ReSignInDialog, type Reauthentication } from '../auth/re-sign-in-dialog';
import { signInPath } from './tokens';

// The session of a signed-in page (web §3.4, §4; WEB-2 plan 2.3, 2.8). The root layout of
// (merchant) or (platform) reads `getMe` (`platformGetMe`) on the server and renders this provider
// with it; client components read it with `useSession()` and `usePermissions()`, call the API with
// `useSessionFetcher()` (the single-flight refresh of plan 2.4), and register unsaved state with
// `useUnsavedState()`. When the session ends, a page with unsaved state shows the re-sign-in dialog
// and keeps its state; any other page goes to sign-in with the path it was on.

/** What the page knows of its session: the parts of `Me` (or the platform's) the shell reads. */
export interface SessionMe {
  readonly user?: { readonly name?: string; readonly email?: string | null } | undefined;
  readonly account?: { readonly name?: string } | null | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly features?: readonly string[] | undefined;
}

interface SessionContextValue {
  readonly me: SessionMe;
  readonly fetcher: Fetcher;
  readonly signOut: () => Promise<void>;
  readonly registerUnsaved: () => () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function useSessionContext(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error('useSession needs a SessionProvider above it');
  return value;
}

/** Where a sign-out lands (web §3.4; WEB-2 plan 2.7). */
export const signedOutPath = '/signed-out';
/** Where a suspended account lands (plan 2.8). */
export const suspendedPath = '/account-suspended';

export interface SessionProviderProps<Me extends SessionMe> {
  readonly me: Me;
  readonly surface: SessionSurface;
  /** The surface's steps for the re-sign-in dialog, given the page's fetcher. */
  readonly reauthentication: (fetcher: Fetcher, me: Me) => Reauthentication;
  /** The dialog's line at the code step (the platform's TOTP line; the staff phone line by default). */
  readonly codeDescription?: string;
  /** Told when the session ends (analytics `auth.session.ended`): the reason only. */
  readonly onSessionEnded?: (reason: SessionEndReason) => void;
  readonly children: ReactNode;
}

/** Full-page navigation, replaceable in component tests (jsdom has no navigation). */
export const sessionNavigation = {
  assign(path: string): void {
    window.location.assign(path);
  },
};

/** Leaves the page for `path` with a full load: the session's state goes with the page. */
function hardNavigate(path: string): void {
  sessionNavigation.assign(path);
}

const here = () => `${window.location.pathname}${window.location.search}`;

/**
 * The page's session outside React: the fetcher, the unsaved-state count and the open re-sign-in
 * request. One per provider, made once; the dialog subscribes to it.
 */
class SessionController {
  readonly fetcher: Fetcher;
  #unsaved = 0;
  #pending: { promise: Promise<boolean>; resolve: (value: boolean) => void } | null = null;
  #listeners = new Set<() => void>();
  #reported: ((reason: SessionEndReason) => void) | undefined;

  constructor(readonly surface: SessionSurface) {
    this.fetcher = createSessionFetcher({
      surface,
      locale: () => (document.documentElement.lang === 'en' ? 'en' : 'ar'),
      onSessionEnded: (reason) => this.ended(reason),
    });
  }

  readonly subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly dialogOpen = () => this.#pending !== null;

  /** Who hears that the session ended (the app's analytics). */
  readonly report = (listener: ((reason: SessionEndReason) => void) | undefined) => {
    this.#reported = listener;
  };

  #notify() {
    for (const listener of this.#listeners) listener();
  }

  ended(reason: SessionEndReason): Promise<boolean> {
    this.#reported?.(reason);
    if (reason === 'account_suspended') {
      hardNavigate(suspendedPath);
      return Promise.resolve(false);
    }
    if (this.#unsaved > 0) {
      if (this.#pending === null) {
        let resolve!: (value: boolean) => void;
        const promise = new Promise<boolean>((done) => (resolve = done));
        this.#pending = { promise, resolve };
        this.#notify();
      }
      return this.#pending.promise;
    }
    hardNavigate(signInPath(here(), 'ended'));
    return Promise.resolve(false);
  }

  readonly closeDialog = (resumed: boolean) => {
    this.#pending?.resolve(resumed);
    this.#pending = null;
    this.#notify();
  };

  readonly registerUnsaved = () => {
    this.#unsaved += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#unsaved -= 1;
    };
  };

  readonly signOut = async () => {
    try {
      await this.fetcher(sessionPaths[this.surface].logout, { method: 'POST' });
    } catch {
      // The cookies end with the page either way: the API clears them, and an unreachable API
      // leaves a session that ends at its own expiry.
    }
    // No query cache or event stream exists yet (WEB-3, WEB-5 add them and clear them here).
    window.sessionStorage.clear();
    hardNavigate(signedOutPath);
  };
}

export function SessionProvider<Me extends SessionMe>({
  me,
  surface,
  reauthentication,
  codeDescription,
  onSessionEnded,
  children,
}: SessionProviderProps<Me>) {
  const [controller] = useState(() => new SessionController(surface));
  useEffect(() => {
    controller.report(onSessionEnded);
  }, [controller, onSessionEnded]);
  const dialogOpen = useSyncExternalStore(controller.subscribe, controller.dialogOpen, () => false);

  const value = useMemo(
    () => ({
      me,
      fetcher: controller.fetcher,
      signOut: controller.signOut,
      registerUnsaved: controller.registerUnsaved,
    }),
    [me, controller],
  );
  const steps = useMemo(
    () => reauthentication(controller.fetcher, me),
    [reauthentication, controller, me],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      <ReSignInDialog
        open={dialogOpen}
        reauthentication={steps}
        codeDescription={codeDescription}
        onSignedIn={() => controller.closeDialog(true)}
        onDismiss={() => controller.closeDialog(false)}
        onOtherAccount={() => {
          controller.closeDialog(false);
          hardNavigate(signInPath(here(), 'ended'));
        }}
      />
    </SessionContext.Provider>
  );
}

/** The signed-in user, account, permissions and features of this page (web §4). */
export function useSession<Me extends SessionMe = SessionMe>(): Me {
  return useSessionContext().me as Me;
}

/** The session's permissions; `Can` and the route manifest are WEB-3's (web §4). */
export function usePermissions(): { readonly has: (permission: string) => boolean } {
  const { me } = useSessionContext();
  return useMemo(() => {
    const granted = new Set(me.permissions ?? []);
    return { has: (permission: string) => granted.has(permission) };
  }, [me]);
}

/** The page's fetcher: pass it to a generated call as `{ fetcher }`. */
export function useSessionFetcher(): Fetcher {
  return useSessionContext().fetcher;
}

/** Signs out: `logout`, then `sessionStorage` cleared and a full load of the signed-out page. */
export function useSignOut(): () => Promise<void> {
  return useSessionContext().signOut;
}

/**
 * Registers unsaved state while `active` (an open form or dialog with edits): if the session ends
 * meanwhile, the page shows the re-sign-in dialog instead of leaving (web §3.4, plan 2.8).
 */
export function useUnsavedState(active: boolean): void {
  const { registerUnsaved } = useSessionContext();
  useEffect(() => (active ? registerUnsaved() : undefined), [active, registerUnsaved]);
}
