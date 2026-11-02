// A one-time notice carried from one console page to the next within the tab (WEB-4 plan 2.3:
// "invitation sent to <email>" after provisioning). Held in the tab's `sessionStorage` (not in a
// module variable: two route chunks may each hold their own copy of a module) and never in the
// URL, so an email address does not reach the address bar, the history or an error report. Read
// once by the page it is left for; another tab never sees it.

const prefix = 'elx:notice:';

/** Leaves `text` for the page that shows notices under `key` (an account id). */
export function leaveNotice(key: string, text: string): void {
  window.sessionStorage.setItem(prefix + key, text);
}

/** The notice left for `key`, once; undefined after that or for another key. */
export function takeNotice(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const text = window.sessionStorage.getItem(prefix + key);
  if (text === null) return undefined;
  // Removed after this render, so a double render in development reads it twice alike.
  setTimeout(() => window.sessionStorage.removeItem(prefix + key), 0);
  return text;
}
