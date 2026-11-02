import type { GeocoderService, GeoPoint } from '../../kernel/public/index.js';
import { ApiException, GeocoderInputError } from '../../kernel/public/index.js';
import type { CoverageAnswer } from './coverage-query.js';
import { CoverageQuery } from './coverage-query.js';

// `checkCoverage` (DEL-1 plan 2.5): a point, or an address resolved through INT-2's geocoder (the
// National Address short code first, then the text and city), asked of `CoverageQuery`. `point`
// wins when both are sent. An address the geocoder cannot place (not found, or no source answers:
// `degraded`) is not covered and has no point. The text is asked in Arabic, the country's address
// language (the contract carries no locale for the check; the stub and the sources match either).

/** The request as the controller hands it over (contract types stay in the controller). */
export interface CoverageCheckInput {
  readonly point?: GeoPoint | undefined;
  readonly address?:
    | {
        readonly text: string;
        readonly city: string;
        readonly national_address_short_code?: string | undefined;
      }
    | undefined;
  readonly site_id?: string | undefined;
}

export interface CoverageCheckResult extends CoverageAnswer {
  readonly point: GeoPoint | null;
}

const addressPointer = {
  text: '/body/address/text',
  city: '/body/address/city',
  code: '/body/address/national_address_short_code',
  point: '/body/point',
} as const;

export class CoverageCheck {
  readonly #query = new CoverageQuery();

  constructor(private readonly geocoder: GeocoderService) {}

  async check(input: CoverageCheckInput): Promise<CoverageCheckResult> {
    const point = input.point ?? (await this.locate(input));
    if (point === null) return { zoneId: null, siteIds: [], point: null };
    const answer = await this.#query.coverage(point, { siteId: input.site_id });
    return { ...answer, point };
  }

  private async locate(input: CoverageCheckInput): Promise<GeoPoint | null> {
    const address = input.address;
    if (address === undefined) {
      throw new ApiException('validation_failed', {
        fields: [{ pointer: '/body/point', code: 'required' }],
      });
    }
    try {
      const code = address.national_address_short_code;
      if (code !== undefined) {
        const found = await this.geocoder.lookupShortCode(code, { degraded: true });
        if (found.kind === 'found') return found.point;
      }
      const found = await this.geocoder.geocode(
        { text: address.text, city: address.city, locale: 'ar' },
        { degraded: true },
      );
      return found.kind === 'found' ? found.point : null;
    } catch (error) {
      if (!(error instanceof GeocoderInputError)) throw error;
      throw new ApiException('validation_failed', {
        fields: [{ pointer: addressPointer[error.field], code: 'invalid' }],
      });
    }
  }
}
