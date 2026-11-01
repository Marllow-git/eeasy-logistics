import { operationSchemas as platformOps } from '@eeasy-logistics/contracts/platform/schemas';
import { operationSchemas as staffOps } from '@eeasy-logistics/contracts/staff/schemas';
import { Controller, Get, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { routeTemplates } from '../src/modules/kernel/authz/operation-routes.check.js';
import { CrossTenant, Operation, Public } from '../src/modules/kernel/public/index.js';

// PLAT-10 plan 2.5 and adversary A-1, A-3, A-4: every route on a surface binds a generated
// operation of that surface, or the application refuses to start naming it (OperationRoutesCheck).
// A non-public handler binds any operation; a @Public() one only a door; @CrossTenant() is present
// exactly when the operation is x-cross-tenant; a copy of a generated entry is refused. The
// permission the guard requires therefore always comes from the contract.

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

// A public sign-in door on the staff surface: binds `login` (core.auth.anonymous).
@Controller('v1/staff/public-door')
class PublicDoor {
  @Post()
  @Public()
  @Operation(staffOps.login)
  signIn(): { ok: true } {
    return { ok: true };
  }
}

// A-1: @Public() on a surface route without a door operation would skip every check.
@Controller('v1/staff/public-escape')
class PublicEscape {
  @Get()
  @Public()
  @Operation(staffOps.listSites)
  list(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/public-unbound')
@Public()
class PublicUnbound {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }
}

// Public routes outside every surface (health probes) need no operation.
@Controller('probe/outside')
@Public()
class PublicOutside {
  @Get()
  list(): { ok: true } {
    return { ok: true };
  }
}

// A spread copy names its own permission: not the generated (frozen, branded) entry.
@Controller('v1/staff/forged')
class Forged {
  @Get()
  @Operation({ ...staffOps.listSites, permission: 'core.auth.self' })
  list(): { ok: true } {
    return { ok: true };
  }
}

// A-4: a spread copy frozen again still lacks the non-enumerable brand.
@Controller('v1/staff/refrozen')
class Refrozen {
  @Get()
  @Operation(Object.freeze({ ...staffOps.listSites }))
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

// A-3: an x-cross-tenant operation without @CrossTenant(), and @CrossTenant() on one that is not.
@Controller('v1/platform/accounts')
class MissingDoor {
  @Get(':account_id')
  @Operation(platformOps.platformGetAccount)
  get(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/platform/accounts')
class ExtraDoor {
  @Get()
  @CrossTenant({ from: 'query', name: 'account_id' })
  @Operation(platformOps.platformListAccounts)
  list(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/platform/accounts')
class MatchedDoor {
  @Get(':account_id')
  @CrossTenant()
  @Operation(platformOps.platformGetAccount)
  get(): { ok: true } {
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

const refusal = 'Handlers without a contract operation: ';

describe('every route on a surface binds a contract operation (OperationRoutesCheck)', () => {
  it('starts with a bound handler, a public door, a public route outside the surfaces and a matched door', async () => {
    await expect(start(Bound)).resolves.toBeUndefined();
    await expect(start(PublicDoor)).resolves.toBeUndefined();
    await expect(start(PublicOutside)).resolves.toBeUndefined();
    await expect(start(MatchedDoor)).resolves.toBeUndefined();
  });

  it('refuses to start naming a handler without an operation, inherited ones included', async () => {
    await expect(start(Unbound)).rejects.toThrow(`${refusal}Unbound.list (no generated operation)`);
    await expect(start(Inherited)).rejects.toThrow('Inherited.list (no generated operation)');
  });

  it('refuses @Public() on a surface route unless it binds a door (A-1)', async () => {
    await expect(start(PublicEscape)).rejects.toThrow(
      'PublicEscape.list (@Public() on listSites, which is not a door)',
    );
    await expect(start(PublicUnbound)).rejects.toThrow(
      'PublicUnbound.list (no generated operation)',
    );
  });

  it('refuses a copied operation, re-frozen or not (A-4), and another surface', async () => {
    await expect(start(Forged)).rejects.toThrow('Forged.list (no generated operation)');
    await expect(start(Refrozen)).rejects.toThrow('Refrozen.list (no generated operation)');
    await expect(start(WrongSurface)).rejects.toThrow(
      'WrongSurface.list (platformListAccounts is a platform operation)',
    );
  });

  it('matches @CrossTenant() with x-cross-tenant in both directions (A-3)', async () => {
    await expect(start(MissingDoor)).rejects.toThrow(
      'MissingDoor.get (platformGetAccount is x-cross-tenant: it needs @CrossTenant())',
    );
    await expect(start(ExtraDoor)).rejects.toThrow(
      'ExtraDoor.list (@CrossTenant() on platformListAccounts, which is not x-cross-tenant)',
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
