import type { FieldProblem, VehicleKind } from '../../kernel/public/index.js';

// The vehicle doors' input rules (DEL-4 plan 2.6; domain model §3.5): pure functions, unit-tested
// beside this file.

/** The longest plate once normalised (plan 2.6). */
export const maxPlateLength = 20;

/** Any line break or control character: a plate is one line of printable text. */
const controlCharacter = /\p{Cc}/u;

/** A plate as stored: trimmed, every run of white space one space, upper-cased (plan 2.6). */
export function normalisePlate(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ').toUpperCase();
}

/** The problem of a plate at `/body/plate`, if any, after normalising. */
export function plateProblem(raw: string): FieldProblem | undefined {
  const pointer = '/body/plate';
  if (controlCharacter.test(raw.replace(/[\t\n\r ]/g, ' ').trim())) {
    return { pointer, code: 'invalid' };
  }
  const plate = normalisePlate(raw);
  const length = Array.from(plate).length;
  if (length === 0) return { pointer, code: 'too_short' };
  if (length > maxPlateLength) return { pointer, code: 'too_long' };
  return undefined;
}

/** `Vehicle` as a create or an update sends it (contract types stay in the controller). */
export interface VehicleBody {
  readonly plate?: string | undefined;
  readonly kind?: VehicleKind | undefined;
  readonly capacity_parcels?: number | undefined;
  readonly active?: boolean | undefined;
}

/**
 * The problems of a create body (plan 2.6): `plate`, `kind` and `capacity_parcels` are required
 * here (the contract's `Vehicle` makes every field optional, being the read shape too); the plate
 * must normalise to 1 to 20 characters.
 */
export function createProblems(body: VehicleBody): FieldProblem[] {
  const problems: FieldProblem[] = [];
  if (body.plate === undefined) problems.push({ pointer: '/body/plate', code: 'required' });
  else {
    const problem = plateProblem(body.plate);
    if (problem !== undefined) problems.push(problem);
  }
  if (body.kind === undefined) problems.push({ pointer: '/body/kind', code: 'required' });
  if (body.capacity_parcels === undefined) {
    problems.push({ pointer: '/body/capacity_parcels', code: 'required' });
  }
  return problems;
}
