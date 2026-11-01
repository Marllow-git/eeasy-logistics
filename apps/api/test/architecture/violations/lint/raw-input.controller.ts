// Violation fixture (ESLint raw-input rule, adversary M-6, A-17): a controller reading its input
// with Nest's raw parameter decorators instead of `@Input()`. Ignored by `eslint .`; linted by
// test/architecture-violations.test.ts, which expects one error per decorator.
import { Body, Controller, Headers, Param, Post, Query, Req, Request } from '@nestjs/common';

@Controller('v1/staff/raw-input')
export class RawInputController {
  @Post(':id')
  create(
    @Body() body: unknown,
    @Query() query: unknown,
    @Param('id') id: string,
    @Headers() headers: unknown,
    @Req() req: unknown,
    @Request() request: unknown,
  ): unknown[] {
    return [body, query, id, headers, req, request];
  }
}
