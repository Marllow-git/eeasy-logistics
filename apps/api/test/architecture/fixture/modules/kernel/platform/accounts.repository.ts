// Fixture: the platform module is the one place in a context tree that may import the
// cross-tenant pool and PlatformRepository (ADR-0031, data §4.4).
import type { PlatformRepository } from '@eeasy-logistics/db/platform';

export type PlatformAccountsRepository = PlatformRepository<never>;
