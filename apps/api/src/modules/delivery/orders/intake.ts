import type {
  GeocodeLocale,
  GeocoderService,
  IntakeRule,
  PendingReason,
  PinSource,
} from '../../kernel/public/index.js';
import { ApiException, GeocoderInputError } from '../../kernel/public/index.js';
import type { OrderAddressFields } from './order-input.js';

// Intake (DEL-2 plan 2.4 to 2.6; integrations §6.2; D-3; ADR-0015). Where the address is, then
// what the account's intake rule makes of the order. The geocoder asks degraded, so an outage
// answers `unavailable` and the order is still created, `pending` with `needs_location`.

/** Plan §7 #2: a constant until `AccountSettings` gains a threshold key (a contract change). */
export const geocodeConfidenceThreshold = 0.6;

export interface Located {
  readonly point: { readonly lat: number; readonly lng: number };
  readonly pinSource: PinSource;
  readonly confidence: number;
}

/**
 * Integrations §6.2 in order: a sent point (`manual`, 1.0); else the National Address short code;
 * else the text with its city, kept at or above the threshold. Nothing reliable is undefined.
 */
export async function locate(
  geocoder: Pick<GeocoderService, 'geocode' | 'lookupShortCode'>,
  address: OrderAddressFields,
  locale: GeocodeLocale,
): Promise<Located | undefined> {
  if (address.point !== null) return { point: address.point, pinSource: 'manual', confidence: 1 };
  try {
    if (address.shortCode !== null) {
      const hit = await geocoder.lookupShortCode(address.shortCode, { degraded: true });
      if (hit.kind === 'found') {
        return { point: hit.point, pinSource: 'geocoded', confidence: hit.confidence };
      }
    }
    const found = await geocoder.geocode(
      { text: address.text, city: address.city, locale },
      { degraded: true },
    );
    if (found.kind === 'found' && found.confidence >= geocodeConfidenceThreshold) {
      return { point: found.point, pinSource: 'geocoded', confidence: found.confidence };
    }
    return undefined;
  } catch (error) {
    // The fields passed the contract and the order rules, so this is a geocoder bound they missed.
    if (error instanceof GeocoderInputError) {
      const field =
        error.field === 'city'
          ? 'city'
          : error.field === 'code'
            ? 'national_address_short_code'
            : 'text';
      throw new ApiException('validation_failed', {
        fields: [{ pointer: `/body/address/${field}`, code: 'invalid' }],
      });
    }
    throw error;
  }
}

export interface IntakeOutcome {
  readonly status: 'pending' | 'accepted';
  readonly pendingReason: PendingReason | null;
}

/**
 * Plan 2.6, D-3: no point → `pending`, `needs_location`; a point no zone of the site covers →
 * `pending`, `outside_coverage`; covered → `accepted` under `auto_accept`, else `pending` with no
 * reason (the dispatcher accepts).
 */
export function intakeOutcome(
  rule: IntakeRule,
  located: boolean,
  zoneId: string | null,
): IntakeOutcome {
  if (!located) return { status: 'pending', pendingReason: 'needs_location' };
  if (zoneId === null) return { status: 'pending', pendingReason: 'outside_coverage' };
  return rule === 'auto_accept'
    ? { status: 'accepted', pendingReason: null }
    : { status: 'pending', pendingReason: null };
}
