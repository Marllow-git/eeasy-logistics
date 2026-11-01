import type {
  AttemptStatus,
  CodCollectionCustody,
  OfferStatus,
  OrderStatus,
} from '@eeasy-logistics/contracts/staff';

// The four state machines of document 2 §3.13 to §3.16, as the contracts generate them. Each list
// is checked both ways against the generated union: `satisfies` refuses a state the contract does
// not have, and `Exhaustive` refuses a contract state missing from the list, so a new state in the
// OpenAPI files fails typecheck here until it has a token, an icon and a label.

type Exhaustive<Union, List extends readonly Union[]> = [Exclude<Union, List[number]>] extends [
  never,
]
  ? List
  : { missing: Exclude<Union, List[number]> };

function states<Union extends string>() {
  return <const List extends readonly Union[]>(list: List & Exhaustive<Union, List>) => list;
}

export const statusStates = {
  order: states<OrderStatus>()([
    'pending',
    'accepted',
    'offered',
    'assigned',
    'picked_up',
    'out_for_delivery',
    'attempted',
    'delivered',
    'failed',
    'returned',
    'cancelled',
  ]),
  offer: states<OfferStatus>()(['sent', 'accepted', 'declined', 'expired', 'withdrawn']),
  attempt: states<AttemptStatus>()(['open', 'succeeded', 'failed', 'voided']),
  custody: states<CodCollectionCustody>()(['collected', 'with_cashier', 'with_bank', 'not_held']),
} as const;

export type StatusMachine = keyof typeof statusStates;
export type StatusState<M extends StatusMachine> = (typeof statusStates)[M][number];
