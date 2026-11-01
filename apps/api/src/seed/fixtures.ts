// Deterministic fixtures (PLAT-5 plan 2.8, data §11.6): fixed UUIDv7 ids, so every seeded database
// holds the same rows. Two accounts, because the tenancy tests need a second tenant that must stay
// invisible. Later orders add sites, zones, drivers, orders and stock here.

export interface AccountFixture {
  readonly id: string;
  readonly name: string;
  readonly status: 'active';
}

export const accountFixtures: readonly AccountFixture[] = [
  { id: '01920000-0000-7000-8000-00000000000a', name: 'Seed Account A', status: 'active' },
  { id: '01920000-0000-7000-8000-00000000000b', name: 'Seed Account B', status: 'active' },
];
