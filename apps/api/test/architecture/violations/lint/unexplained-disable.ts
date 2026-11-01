// Violation fixture (re-check M-6): a disable comment without its reason after " -- ".
// eslint-disable-next-line no-restricted-imports
import { createParamDecorator } from '@nestjs/common';

export const Raw = createParamDecorator(() => undefined);
