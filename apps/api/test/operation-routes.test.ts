import { operationSchemas as platformOps } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas as staffOps } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { routeTemplates } from '../src/modules/kernel/authz/operation-routes.check.js';
import { Operation, Public } from '../src/modules/kernel/public/index.js';

// PLAT-10 plan 2.5: a route handler that is not @Public() binds a generated operation of its own
// surface, or the application refuses to start naming it (OperationRoutesCheck). The permission the
// guard requires therefore always comes from the contract.

@Controller('v1/staff/bound')
class Bound {
  @Get()
  @Operation(staffOps.listSites)
  list(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/unbound')
class Unbound {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/public-door')
class PublicDoor {
  @Get()
  @Public()
  list(): { ok: true } {
    return { ok: true };
  }
}

// A spread copy names its own permission: not the generated (frozen) entry, so refused.
@Controller('v1/staff/forged')
class Forged {
  @Get()
  @Operation({ ...staffOps.listSites, permission: 'core.auth.self' })
  list(): { ok: true } {
    return { ok: true };
  }
}

// A platform operation on a staff route.
@Controller('v1/staff/wrong-surface')
class WrongSurface {
  @Get()
  @Operation(platformOps.platformListAccounts)
  list(): { ok: true } {
    return { ok: true };
  }
}

// Inherited handlers count (as in IdempotentRoutesCheck, re-check N-3).
class UnboundBase {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/inherited')
class Inherited extends UnboundBase {}

async function start(controller: new () => unknown): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [controller],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  try {
    await app.init();
  } finally {
    await app.close();
  }
}

describe('every non-public route binds a contract operation (OperationRoutesCheck)', () => {
  it('starts with a bound handler and with a public one', async () => {
    await expect(start(Bound)).resolves.toBeUndefined();
    await expect(start(PublicDoor)).resolves.toBeUndefined();
  });

  it('refuses to start naming a handler without an operation, inherited ones included', async () => {
    await expect(start(Unbound)).rejects.toThrow(
      'Handlers without a contract operation: Unbound.list (no generated operation)',
    );
    await expect(start(Inherited)).rejects.toThrow('Inherited.list (no generated operation)');
  });

  it('refuses a hand-built operation and an operation of another surface', async () => {
    await expect(start(Forged)).rejects.toThrow('Forged.list (no generated operation)');
    await expect(start(WrongSurface)).rejects.toThrow(
      'WrongSurface.list (platformListAccounts is a platform operation)',
    );
  });

  it('joins controller and method paths into route templates', () => {
    expect(routeTemplates('v1/staff/sites', ':site_id')).toEqual(['/v1/staff/sites/:site_id']);
    expect(routeTemplates(['/v1/staff/a/', 'v1/platform/b'], undefined)).toEqual([
      '/v1/staff/a',
      '/v1/platform/b',
    ]);
  });
});
