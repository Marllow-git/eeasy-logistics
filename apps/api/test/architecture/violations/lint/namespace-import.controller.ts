// Violation fixture (re-check M-6): the raw decorators reached through a namespace import.
import * as nest from '@nestjs/common';

@nest.Controller('v1/staff/namespace-import')
export class NamespaceImportController {
  @nest.Post()
  create(@nest.Body() body: unknown): unknown {
    return body;
  }
}
