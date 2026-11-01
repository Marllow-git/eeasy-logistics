// Violation fixture (ESLint operation-binding rule, PLAT-10 plan 2.5): a controller that builds its
// own operation instead of binding the generated entry, so it could name its own permission.
// Ignored by `eslint .`; linted by test/architecture-violations.test.ts, which expects three errors:
// the object literal, the spread copy inside it, and the call.
import { operationSchemas } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get } from '@nestjs/common';
import { Operation } from '../../../../src/modules/kernel/public/index.js';

const operationOf = (id: 'listSites') => operationSchemas[id];

@Controller('v1/staff/forged')
export class ForgedOperationController {
  @Get()
  @Operation({ ...operationSchemas.listSites, permission: 'core.auth.self' })
  list(): unknown {
    return [];
  }

  @Get('call')
  @Operation(operationOf('listSites'))
  call(): unknown {
    return [];
  }
}
