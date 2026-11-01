// Violation fixture (rule contracts-only-in-controllers-and-presenters, doc 3 §9 "Contract code
// stops at the edge", A-17): a service importing a contract type.
import type { Account } from '@eeasy-logistics/contracts/platform';

export type ServiceAccount = Account;
