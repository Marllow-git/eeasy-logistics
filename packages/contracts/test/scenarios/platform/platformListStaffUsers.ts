// platformListStaffUsers (PLAT-13 leg 2). The contract run has no platform session, so the scenario
// checks the unauthenticated answer against the contract's error shape.
import { client } from '../../../src/platform.ts';
import { defineScenario } from '../../contract/scenario.ts';

export default defineScenario({
  expectedStatus: 401,
  run: ({ fetcher }) => client.platformListStaffUsers({ limit: 10 }, { fetcher }),
});
