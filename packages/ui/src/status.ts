import {
  attemptStates,
  custodyStates,
  offerStates,
  orderStates,
} from '@eeasy-logistics/contracts/unions';

// The four state machines of document 2 §3.13 to §3.16, as the contracts generate them into
// `/unions` (the entry both web apps may import, ADR-0038). A new state in the OpenAPI files fails
// typecheck in the status chip until it has an icon and a label, and fails the token test until
// it has a `--status-<machine>-<state>` colour.
export const statusStates = {
  order: orderStates,
  offer: offerStates,
  attempt: attemptStates,
  custody: custodyStates,
} as const;

export type StatusMachine = keyof typeof statusStates;
export type StatusState<M extends StatusMachine> = (typeof statusStates)[M][number];
