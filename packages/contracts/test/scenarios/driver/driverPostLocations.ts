// driverPostLocations (DEL-5 item E): without a bearer token the door is unauthenticated (401).
// Signed-in scenarios need a seeded driver on a shift, which the contract run has no fixture for;
// the HTTP suites of apps/api (locations.http) cover them. No Idempotency-Key (ADR-0028).
import { client } from '../../../src/driver.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) =>
    client.driverPostLocations(
      { points: [{ client_ts: '2026-11-02T08:00:00Z', lat: 24.7, lng: 46.6 }] },
      { fetcher },
    ),
});
