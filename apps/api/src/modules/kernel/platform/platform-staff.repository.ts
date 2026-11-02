import type { PlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import { PlatformRepository, getPlatformUnitOfWork } from '@eeasy-logistics/db/platform';
import type { SQL } from 'drizzle-orm';
import { eq, sql } from 'drizzle-orm';
import type { ListPagePlan } from '../contract/list-page.js';
import { keysetAfter, keysetOrder } from '../contract/list-page.js';
import type { PlatformStaffRole, UserLocale } from '../schema/identity.js';
import { corePlatformStaff, coreUsers } from '../schema/identity.js';

// The platform staff list (PLAT-13 plan 2.9, `platformListStaffUsers`): every `core_platform_staff`
// row with its user, revoked ones included, keyset-paged on the platform pool. Never the TOTP
// secret: only whether one is enrolled.

/** The documented sort fields of `platformListStaffUsers` (the user's). */
export type StaffSortField = 'created_at' | 'name';

/** One staff member as the staff doors present them (`PlatformUser`). */
export interface StaffMemberRow {
  readonly userId: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly locale: UserLocale;
  readonly secondFactorEnabled: boolean;
  readonly role: PlatformStaffRole;
  readonly revoked: boolean;
  readonly totpEnrolled: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const memberColumns = {
  userId: coreUsers.id,
  name: coreUsers.name,
  email: coreUsers.email,
  phone: coreUsers.phone,
  locale: coreUsers.locale,
  secondFactorEnabled: coreUsers.secondFactorEnabled,
  role: corePlatformStaff.role,
  revoked: sql<boolean>`${corePlatformStaff.revokedAt} IS NOT NULL`,
  totpEnrolled: sql<boolean>`${corePlatformStaff.totpSecretCiphertext} IS NOT NULL`,
  createdAt: coreUsers.createdAt,
  updatedAt: coreUsers.updatedAt,
};

/** The sort value: the user's `created_at` at millisecond precision (PLAT-12 trap), or the name. */
function staffSortValue(field: StaffSortField): SQL {
  return field === 'created_at'
    ? sql`date_trunc('milliseconds', ${coreUsers.createdAt})`
    : sql`${coreUsers.name}`;
}

export class PlatformStaffDirectory extends PlatformRepository<typeof corePlatformStaff> {
  constructor(uow: PlatformUnitOfWork) {
    super(uow, corePlatformStaff);
  }

  /** One page (`plan.limit` rows: the page plus one), keyset-ordered on the user. */
  async page(plan: ListPagePlan<StaffSortField>): Promise<StaffMemberRow[]> {
    const value = staffSortValue(plan.sort.field);
    return this.unscoped()
      .select(memberColumns)
      .from(corePlatformStaff)
      .innerJoin(coreUsers, eq(coreUsers.id, corePlatformStaff.userId))
      .where(keysetAfter(plan, value, coreUsers.id))
      .orderBy(...keysetOrder(plan, value, coreUsers.id))
      .limit(plan.limit);
  }

  /** One staff member, or undefined when the user holds no staff row. */
  async find(userId: string): Promise<StaffMemberRow | undefined> {
    const [row] = await this.unscoped()
      .select(memberColumns)
      .from(corePlatformStaff)
      .innerJoin(coreUsers, eq(coreUsers.id, corePlatformStaff.userId))
      .where(eq(corePlatformStaff.userId, userId));
    return row;
  }
}

/** The directory on the current platform request's transaction (the staff doors, plan 2.9). */
export function currentStaffDirectory(): PlatformStaffDirectory {
  return new PlatformStaffDirectory(getPlatformUnitOfWork());
}
