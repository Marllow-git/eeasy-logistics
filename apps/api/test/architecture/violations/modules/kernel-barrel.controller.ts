// Violation fixture (rule contracts-server-entries-only, PLAT-6 review round 2): a controller
// importing the barrel surface entry, which loads the fetch client and the hooks at run time.
import type { OperationId } from '@eeasy-logistics/contracts/platform';

export type BarrelOperation = OperationId;
