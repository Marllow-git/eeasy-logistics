/** Errors already reported, with the id each was reported under. */
const reported = new WeakMap<object, string>();

/**
 * Reports an error a boundary caught in the browser (web §10.4) and returns the event id the page
 * shows as its reference. The id is chosen here so the page has it at once; the Sentry chunk loads
 * afterwards and sends the event under it, when a DSN is configured (in a build without one the
 * reference identifies nothing). React may render a boundary's fallback more than once for one
 * error, so an error is reported once and keeps its id. Server errors are reported on the server
 * (`onRequestError`) and carry their digest instead, so boundaries call this only for errors
 * without one.
 */
export function reportClientError(error: unknown, tags: Record<string, string>): string {
  const key = typeof error === 'object' && error !== null ? error : undefined;
  const known = key === undefined ? undefined : reported.get(key);
  if (known !== undefined) return known;
  const eventId = crypto.randomUUID().replaceAll('-', '');
  if (key !== undefined) reported.set(key, eventId);
  void import('./sentry-client').then(({ captureClientError }) =>
    captureClientError(error, eventId, tags),
  );
  return eventId;
}
