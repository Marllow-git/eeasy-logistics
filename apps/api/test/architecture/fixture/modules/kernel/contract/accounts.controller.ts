// Fixture: permitted (doc 3 §9, A-17). A controller imports its surface entry point of
// @eeasy-logistics/contracts for the operation's schemas and response type.
import type { OperationId } from '@eeasy-logistics/contracts/platform';
import type { AccountsPage } from './accounts.presenter.js';

export type SampleOperation = Extract<OperationId, 'platformListAccounts'>;
export type SampleAnswer = AccountsPage;
