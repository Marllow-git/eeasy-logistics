import type { Site } from '@eeasy-logistics/contracts/staff/schemas';
import type { SiteRow } from './sites.repository.js';
import { latLngOf } from './sites.service.js';

/** `Site` (components.yaml; ADR-0018) from a row; a cleared optional field is left out. */
export function presentSite(row: SiteRow): Site {
  const point = latLngOf(row);
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    kind: row.kind,
    name_ar: row.nameAr,
    name_en: row.nameEn,
    ...(row.addressText === null ? {} : { address_text: row.addressText }),
    ...(row.nationalAddressShortCode === null
      ? {}
      : { national_address_short_code: row.nationalAddressShortCode }),
    ...(point === null ? {} : { point }),
    opening_hours: row.openingHours.map(({ weekday, opens, closes }) => ({
      weekday,
      opens,
      closes,
    })),
    status: row.status,
  };
}
