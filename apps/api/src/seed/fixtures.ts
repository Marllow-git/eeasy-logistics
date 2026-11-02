import type { MultiPolygonGeoJson } from '@eeasy-logistics/db';

// Deterministic fixtures (PLAT-5 plan 2.8, data §11.6): fixed UUIDv7 ids, so every seeded database
// holds the same rows. Two accounts, because the tenancy tests need a second tenant that must stay
// invisible. DEL-1 (plan 2.8) adds per account a Riyadh and a Jeddah branch, a drawn zone around
// each (a small rectangle; official city boundaries wait on §7 #1) and the coverage of each zone
// from its city's branch. Later orders add drivers, orders and stock here.

export interface AccountFixture {
  readonly id: string;
  readonly name: string;
  readonly status: 'active';
}

export const accountFixtures: readonly AccountFixture[] = [
  { id: '01920000-0000-7000-8000-00000000000a', name: 'Seed Account A', status: 'active' },
  { id: '01920000-0000-7000-8000-00000000000b', name: 'Seed Account B', status: 'active' },
];

export interface SiteFixture {
  readonly id: string;
  readonly accountId: string;
  readonly kind: 'branch';
  readonly nameAr: string;
  readonly nameEn: string;
  /** Longitude, latitude (data §8). */
  readonly lng: number;
  readonly lat: number;
}

export interface ZoneFixture {
  readonly id: string;
  readonly accountId: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly source: 'drawn';
  readonly boundary: MultiPolygonGeoJson;
}

export interface CoverageFixture {
  readonly id: string;
  readonly accountId: string;
  readonly siteId: string;
  readonly zoneId: string;
}

/** A closed rectangle as a one-polygon MultiPolygon, longitude first. */
function rectangle(west: number, south: number, east: number, north: number): MultiPolygonGeoJson {
  return {
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    ],
  };
}

const cities = [
  {
    key: '1',
    siteAr: 'فرع الرياض',
    siteEn: 'Riyadh branch',
    zoneAr: 'وسط الرياض',
    zoneEn: 'Central Riyadh',
    lng: 46.6753,
    lat: 24.7136,
    box: rectangle(46.62, 24.66, 46.74, 24.77),
  },
  {
    key: '2',
    siteAr: 'فرع جدة',
    siteEn: 'Jeddah branch',
    zoneAr: 'وسط جدة',
    zoneEn: 'Central Jeddah',
    lng: 39.1925,
    lat: 21.4858,
    box: rectangle(39.14, 21.44, 39.25, 21.55),
  },
] as const;

/** `<account letter><kind digit><city digit>` at the end of a fixed UUIDv7. */
const fixtureId = (accountId: string, kind: string, city: string) =>
  `01920000-0000-7000-8000-00000000${accountId.at(-1) ?? 'x'}${kind}${city}0`;

export const siteFixtures: readonly SiteFixture[] = accountFixtures.flatMap((account) =>
  cities.map((city) => ({
    id: fixtureId(account.id, '1', city.key),
    accountId: account.id,
    kind: 'branch' as const,
    nameAr: city.siteAr,
    nameEn: city.siteEn,
    lng: city.lng,
    lat: city.lat,
  })),
);

export const zoneFixtures: readonly ZoneFixture[] = accountFixtures.flatMap((account) =>
  cities.map((city) => ({
    id: fixtureId(account.id, '2', city.key),
    accountId: account.id,
    nameAr: city.zoneAr,
    nameEn: city.zoneEn,
    source: 'drawn' as const,
    boundary: city.box,
  })),
);

export const coverageFixtures: readonly CoverageFixture[] = accountFixtures.flatMap((account) =>
  cities.map((city) => ({
    id: fixtureId(account.id, '3', city.key),
    accountId: account.id,
    siteId: fixtureId(account.id, '1', city.key),
    zoneId: fixtureId(account.id, '2', city.key),
  })),
);
