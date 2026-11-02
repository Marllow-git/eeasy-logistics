// The support reason of a tab (web §3.5; WEB-4 plan 2.4, §7 #4): held in `sessionStorage` under
// `elx:support:<userId>:<accountId>`, so it survives a reload in that tab, is never shared with
// another tab and is never read by another staff member signing in on the same tab (adversary fix
// round 1, M); removed when the tab leaves the account's routes and whenever the session ends.
// Pure functions over a `Storage`, no runtime imports, so `node --test` runs them as they are.

export const reasonPrefix = 'elx:support:';

/** The longest `X-Support-Reason` the API takes (PLAT-13 8.2 #33: the header's bound). */
export const headerReasonMax = 200;
/** The longest body reason (suspend, reactivate, close, a flag, a mode, a replay, a reset). */
export const bodyReasonMax = 500;

export type ReasonStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The account a console path acts on (`/accounts/<id>` and its tabs), if any. */
export function accountOfPath(pathname: string | null): string | undefined {
  const id = /^\/accounts\/([^/]+)(?:\/|$)/.exec(pathname ?? '')?.[1];
  return id !== undefined && uuid.test(id) ? id.toLowerCase() : undefined;
}

/** Whose reason for which account: the signed-in staff member's, for one account. */
export interface ReasonOwner {
  readonly userId: string;
  readonly accountId: string;
}

/** The storage key of `owner`'s reason. */
export function reasonKey({ userId, accountId }: ReasonOwner): string {
  return `${reasonPrefix}${userId.toLowerCase()}:${accountId.toLowerCase()}`;
}

export function readReason(storage: ReasonStorage, owner: ReasonOwner): string | undefined {
  const value = storage.getItem(reasonKey(owner));
  return value === null || value === '' ? undefined : value;
}

export function writeReason(storage: ReasonStorage, owner: ReasonOwner, reason: string): void {
  storage.setItem(reasonKey(owner), reason);
}

/** Removes every stored reason, any user's and any account's, but `keep`'s (none: all of them). */
export function keepOnly(storage: ReasonStorage, keep: ReasonOwner | undefined): void {
  const kept = keep === undefined ? undefined : reasonKey(keep);
  const stale: string[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== null && key.startsWith(reasonPrefix) && key !== kept) stale.push(key);
  }
  for (const key of stale) storage.removeItem(key);
}

/**
 * The reason as the `X-Support-Reason` header carries it. A fetch header takes Latin-1 only, so a
 * reason with any other character (Arabic) travels percent-encoded as UTF-8, and so does one with a
 * `%`, which the API would otherwise try to decode (the `SupportReason` contract note; the API
 * decodes it and audits the text as typed).
 */
export function headerReason(reason: string): string {
  return /[^\u0020-\u00ff]|%/u.test(reason) ? encodeURIComponent(reason) : reason;
}

/** The header's length as the API counts it: the code points of the decoded, trimmed text. */
export function headerReasonLength(reason: string): number {
  return [...reason.trim()].length;
}

/** The headers of a cross-tenant call: the tab's reason, or none (an optional-reason door). */
export function supportHeaders(reason: string | undefined): Record<string, string> {
  return reason === undefined ? {} : { 'X-Support-Reason': headerReason(reason) };
}
