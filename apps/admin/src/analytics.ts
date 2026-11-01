// The product event catalogue of apps/admin (web §10.4, PLAT-14 plan 2.8): every event PostHog may
// receive, named `<area>.<object>.<action>` in the past tense, with its properties. Properties are
// ids and enums only, enforced by the type: a free-text `string` (a name, a phone number, an
// address, a message) fails typecheck (`tests/analytics.types.ts` proves it). Ids are `Id`
// values, made by `asId`, never raw strings. The census asserts that the events a screen claims to
// send are in `analyticsEvents` (`expectAnalyticsEvents`, tests/census/helpers.ts).

declare const idBrand: unique symbol;

/** An opaque identifier (a UUID or a digest), never personal data or free text. */
export type Id = string & { readonly [idBrand]: true };

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;

/** `value` as an `Id` when it has an id's shape (letters, digits, `_`, `-`, at most 64). */
export function asId(value: string): Id | undefined {
  return idPattern.test(value) ? (value as Id) : undefined;
}

/** A property value the catalogue allows: an `Id`, a string literal union (an enum), a number, a boolean. */
type Allowed<Value> = Value extends Id
  ? Value
  : Value extends string
    ? string extends Value
      ? never
      : Value
    : Value extends number | boolean | null | undefined
      ? Value
      : never;

/** The catalogue with every property checked; an event name needs three dot-separated parts. */
type Checked<Catalogue> = {
  [Event in keyof Catalogue]: Event extends `${string}.${string}.${string}`
    ? { [Property in keyof Catalogue[Event]]: Allowed<Catalogue[Event][Property]> }
    : never;
};

/** Accepts a catalogue only when every property is an id, an enum, a number or a boolean. */
export type IdsAndEnumsOnly<Catalogue extends Checked<Catalogue>> = Catalogue;

export type AnalyticsCatalogue = IdsAndEnumsOnly<{
  /** An error page was shown (web §10.4): which boundary and which route group. */
  'shell.error_page.shown': {
    boundary: 'segment' | 'global';
    group: 'platform' | 'auth' | 'root';
  };
}>;

export type AnalyticsEvent = keyof AnalyticsCatalogue;

/** The event names at run time, for the census (`expectAnalyticsEvents`). */
export const analyticsEvents = [
  'shell.error_page.shown',
] as const satisfies readonly AnalyticsEvent[];

// Every catalogue event is listed above, and nothing else.
type Missing = Exclude<AnalyticsEvent, (typeof analyticsEvents)[number]>;
const everyEventListed: Missing extends never ? true : Missing = true;
void everyEventListed;

/** Sends a catalogue event to PostHog (after the analytics chunk loads; dropped when off). */
export function track<Event extends AnalyticsEvent>(
  event: Event,
  properties: AnalyticsCatalogue[Event],
): void {
  void import('./observability/analytics-client').then(({ captureEvent }) =>
    captureEvent(event, properties),
  );
}
