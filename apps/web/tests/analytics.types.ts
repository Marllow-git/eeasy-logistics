// Typecheck-only proof (PLAT-14 plan 2.8, item G): the analytics catalogue refuses free text.
// `pnpm run typecheck` compiles this file; each `@ts-expect-error` fails the typecheck if the line
// below it compiles, so a catalogue type that let a planted string through would turn it red.
import { track, type Id, type IdsAndEnumsOnly } from '../src/analytics';

// @ts-expect-error a free-text string property (a name, a phone) is refused
export type PlantedString = IdsAndEnumsOnly<{
  'orders.recipient.updated': { recipient_name: string };
}>;

// @ts-expect-error an optional free-text string is refused too
export type PlantedOptionalString = IdsAndEnumsOnly<{
  'orders.recipient.updated': { note?: string };
}>;

// @ts-expect-error an object property (an address, say) is refused
export type PlantedNestedObject = IdsAndEnumsOnly<{
  'orders.address.updated': { address: { line1: string } };
}>;

// @ts-expect-error an event name needs `<area>.<object>.<action>`
export type PlantedEventName = IdsAndEnumsOnly<{
  order_updated: { order_id: string };
}>;

// Ids, enums, numbers and booleans pass.
export type Allowed = IdsAndEnumsOnly<{
  'dispatch.order.assigned': {
    order_id: Id;
    source: 'board' | 'map';
    count: number;
    retried: boolean;
  };
}>;

export function plantedCalls(): void {
  // @ts-expect-error an event outside the catalogue
  track('orders.order.deleted', {});
  // @ts-expect-error a property the event does not declare
  track('shell.error_page.shown', { boundary: 'segment', group: 'merchant', phone: '+9665' });
  // @ts-expect-error a value outside the enum
  track('shell.error_page.shown', { boundary: 'segment', group: 'somewhere' });
  track('shell.error_page.shown', { boundary: 'global', group: 'root' });
}
