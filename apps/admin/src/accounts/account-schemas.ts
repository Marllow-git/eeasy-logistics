import { schemas } from '@eeasy-logistics/contracts/platform';

// The account forms' schemas (WEB-4 plan 2.3, 2.5): the generated bodies with PLAT-13's rules the
// contract does not carry (2.2: a name of 1 to 80 code points, one line, no `://`; every limit
// required and whole, `>= 0`). Zod's messages never reach the screen: `Form` maps each issue to a
// field code of the `errors` catalogue (WEB-3 8.2 #5).

/** The `AccountLimits` keys, in the order the forms show them. */
export const limitKeys = ['orders_per_month', 'drivers', 'sites', 'api_keys'] as const;
export type LimitKey = (typeof limitKeys)[number];

const lineBreak = /[\r\n\u0085\u2028\u2029]/u;

/** The account name as PLAT-13 2.2 bounds it. */
const accountName = schemas.PlatformProvisionAccountBody.shape.name
  .min(1, { message: 'required' })
  .refine((value) => !lineBreak.test(value) && !value.includes('://'), { message: 'invalid' })
  .refine((value) => [...value].length <= 80, { message: 'too_long' });

const provisionLimits = schemas.PlatformProvisionAccountBody.shape.limits.shape;
/** Every limit required (the contract marks them optional; the door requires each). */
const requiredLimits = schemas.PlatformProvisionAccountBody.shape.limits.extend({
  orders_per_month: provisionLimits.orders_per_month.unwrap(),
  drivers: provisionLimits.drivers.unwrap(),
  sites: provisionLimits.sites.unwrap(),
  api_keys: provisionLimits.api_keys.unwrap(),
});

const ownerShape = schemas.PlatformProvisionAccountBody.shape.owner.shape;

export const provisionSchema = schemas.PlatformProvisionAccountBody.extend({
  name: accountName,
  limits: requiredLimits,
  owner: schemas.PlatformProvisionAccountBody.shape.owner.extend({
    name: ownerShape.name
      .min(1, { message: 'required' })
      .refine((value) => !lineBreak.test(value), { message: 'invalid' })
      .refine((value) => [...value].length <= 120, { message: 'too_long' }),
  }),
});

/** The details form: name, language and all four limits (sent as changed, PATCH). */
export const detailsSchema = schemas.PlatformUpdateAccountBody.extend({
  name: accountName,
  default_locale: schemas.PlatformProvisionAccountBody.shape.default_locale,
  limits: requiredLimits,
});

/** The invite-owner dialog. */
export const inviteOwnerSchema = schemas.PlatformInviteOwnerBody.extend({
  name: ownerShape.name
    .min(1, { message: 'required' })
    .refine((value) => !lineBreak.test(value), { message: 'invalid' })
    .refine((value) => [...value].length <= 120, { message: 'too_long' }),
});
