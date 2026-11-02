import { client } from '@eeasy-logistics/contracts/platform';
import { RolloutScreen } from '../../../rollout/rollout-screen';
import { platformServerFetcher } from '../../../server/api';

/** Rollout modes (WEB-4 plan 2.6): every registered key, read on the server. */
export default async function RolloutPage() {
  const answer = await client.platformListRolloutModes({ fetcher: await platformServerFetcher() });
  if (answer.status !== 200) throw new Error(`platformListRolloutModes ${answer.status}`);
  return <RolloutScreen initial={answer.data.data ?? []} />;
}
