import type { PlatformListAccounts200 } from '@eeasy-logistics/contracts/platform';
import { operationSchemas } from '@eeasy-logistics/contracts/platform';
import { getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { Controller, Get } from '@nestjs/common';
import type { ContractInput } from '../../src/modules/kernel/public/index.js';
import { Input, Operation } from '../../src/modules/kernel/public/index.js';
import type { AccountStatus } from '../../src/modules/kernel/schema/accounts.js';
import { accountStatuses } from '../../src/modules/kernel/schema/accounts.js';
import { presentAccountsPage } from './accounts.presenter.js';
import { SampleAccounts } from './accounts.repository.js';

// The A-17 sample controller (PLAT-6 item I): a real operation of the platform surface,
// `platformListAccounts`, its input parsed by the kernel ContractPipe with the generated strict
// schema of the platform entry point, its return type the generated response type. Test-only:
// the operation itself ships with the provisioning order. Not `@CrossTenant()`: it lists the
// accounts themselves, a platform table.

const operation = operationSchemas.platformListAccounts;

function isAccountStatus(value: string): value is AccountStatus {
  return (accountStatuses as readonly string[]).includes(value);
}

@Controller('v1/platform/accounts')
export class SampleAccountsController {
  @Get()
  @Operation(operation)
  async list(@Input() input: ContractInput<typeof operation>): Promise<PlatformListAccounts200> {
    const { status, limit } = input.query;
    const statuses = (status ?? '').split(',').filter(isAccountStatus);
    const rows = await new SampleAccounts(getPlatformUnitOfWork()).list({ statuses, limit });
    return presentAccountsPage(rows);
  }
}
