import { oneLineTextProblem } from '../contract/text-rules.js';
import type { FieldProblem } from '../errors/api-exception.js';
import { isFeatureKey } from '../features/feature-keys.js';
import type { FeatureKey } from '../features/feature-keys.js';
import { paramMaxLength } from '../messaging/templates.js';

// The input rules of the provisioning doors (PLAT-13 plan 2.2, 2.4) that the contract leaves open:
// the account name bound, the owner's name, the module keys. Each answers field problems for one
// `400 validation_failed`.

/**
 * The longest account name: PLAT-9's `account_name` cap (adversary L-7), so every name the door
 * accepts fits the invitation mail it is sent in.
 */
export const accountNameMaxLength = paramMaxLength.account_name ?? 80;

/** The longest invited person's name (PLAT-12's member invitation bound). */
export const ownerNameMaxLength = 120;

/**
 * The problem of an account name at `pointer`, if any: 1 to 80 characters on one line, and no
 * `://` (PLAT-9 L-7: an account name is a mail parameter, and must not carry a second link into an
 * invitation). Checked when the account is created or renamed, so a stored name always renders.
 */
export function accountNameProblem(pointer: string, value: unknown): FieldProblem | undefined {
  const problem = oneLineTextProblem(pointer, value, accountNameMaxLength);
  if (problem !== undefined) return problem;
  return typeof value === 'string' && value.includes('://')
    ? { pointer, code: 'invalid' }
    : undefined;
}

/**
 * The registered keys of `modules`, without repeats, or the problem of the first unknown one at
 * `/body/modules/<i>` (plan 2.2).
 */
export function moduleKeys(
  modules: readonly string[] | undefined,
): { readonly keys: FeatureKey[] } | { readonly problem: FieldProblem } {
  const sent = modules ?? [];
  const unknown = sent.findIndex((key) => !isFeatureKey(key));
  if (unknown >= 0) return { problem: { pointer: `/body/modules/${unknown}`, code: 'invalid' } };
  return { keys: [...new Set(sent.filter(isFeatureKey))] };
}
