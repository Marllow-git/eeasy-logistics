import { Controller, HttpCode, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { Idempotent, Operation } from '../src/modules/kernel/public/index.js';
import { probeOperations } from './support/probe-operations.js';

// PLAT-6 review round 2, finding 4: the stored replay status is `response.statusCode` when the
// handler returns, so every `@Idempotent()` handler must declare `@HttpCode()`; the application
// refuses to start otherwise. Each probe binds a staff operation (PLAT-10 OperationRoutesCheck).

@Controller('v1/staff/declared')
class Declared {
  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(probeOperations.staffWrite)
  create(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/undeclared')
class Undeclared {
  @Post()
  @Idempotent()
  @Operation(probeOperations.staffWrite)
  create(): { ok: true } {
    return { ok: true };
  }
}

// Re-check N-3: the handler lives on a base class, the route on the subclass.
class UndeclaredBase {
  @Post()
  @Idempotent()
  @Operation(probeOperations.staffWrite)
  create(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/inherited')
class Inherited extends UndeclaredBase {}

class DeclaredBase {
  @Post()
  @HttpCode(201)
  @Idempotent()
  @Operation(probeOperations.staffWrite)
  create(): { ok: true } {
    return { ok: true };
  }
}

@Controller('v1/staff/inherited-declared')
class InheritedDeclared extends DeclaredBase {}

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

describe('@Idempotent() handlers declare @HttpCode() (IdempotentRoutesCheck)', () => {
  it('starts when every idempotent handler declares its status', async () => {
    await expect(start(Declared)).resolves.toBeUndefined();
  });

  it('checks handlers inherited from a base class (re-check N-3)', async () => {
    await expect(start(InheritedDeclared)).resolves.toBeUndefined();
    await expect(start(Inherited)).rejects.toThrow(
      '@Idempotent() handlers need @HttpCode(): Inherited.create',
    );
  });

  it('refuses to start naming the handler without @HttpCode()', async () => {
    await expect(start(Undeclared)).rejects.toThrow(
      '@Idempotent() handlers need @HttpCode(): Undeclared.create',
    );
  });
});
