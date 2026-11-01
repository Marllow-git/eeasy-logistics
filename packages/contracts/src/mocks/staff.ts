// MSW handlers and mock factories for the staff surface, for tests only: a separate entry point,
// so no production bundle pulls in msw or faker (PLAT-15 plan 2.7, 2.12). faker is seeded on
// import, so the factories return the same data on every run; `seedMocks(n)` reseeds.
import { faker } from '@faker-js/faker';

export const mockSeed = 1;
faker.seed(mockSeed);

/** Reseeds the faker instance behind the mock factories (call in `beforeEach` for per-test data). */
export function seedMocks(seed: number = mockSeed): void {
  faker.seed(seed);
}

export * from '../../generated/staff/hooks.msw.ts';
