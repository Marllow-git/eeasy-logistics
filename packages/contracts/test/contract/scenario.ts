// The shape of a contract scenario (PLAT-15 plan 2.8). One file per operation:
// `test/scenarios/<surface>/<operationId>.ts`, default export `defineScenario({...})`. The order
// that implements the operation adds its scenario in the same PR (handbook 03 "Contract" row).
import type { Fetcher } from '../../src/http.ts';

export interface ScenarioContext {
  /** The API origin under test (`--api` or `CONTRACT_API_URL`). */
  apiUrl: string;
  /** Records every answer for the harness; pass it to every generated call as `{ fetcher }`. */
  fetcher: Fetcher;
}

export interface Scenario {
  /** The status the scenario's call to its operation must answer with. */
  expectedStatus: number;
  /**
   * Calls the operation through the generated client (signing in first if it needs to). An
   * `ApiError` thrown by the client is expected for an error status and is not a failure.
   */
  run: (context: ScenarioContext) => Promise<unknown>;
}

export const defineScenario = (scenario: Scenario): Scenario => scenario;
