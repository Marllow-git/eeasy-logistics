import type { FieldProblem } from '../errors/api-exception.js';

// One-line display text the contract types as a bare string (PLAT-12 plan 2.3 reason-code labels,
// 2.5 site names): a length in characters (code points, so an Arabic letter or an emoji is one)
// and no line break.

/** CR, LF, NEL, LINE SEPARATOR, PARAGRAPH SEPARATOR: the text stays on one line. */
const lineBreak = new RegExp(`[\r\n${String.fromCodePoint(0x85, 0x2028, 0x2029)}]`);

/** The problem of a one-line text of 1 to `maxLength` characters at `pointer`, if any. */
export function oneLineTextProblem(
  pointer: string,
  value: unknown,
  maxLength: number,
): FieldProblem | undefined {
  if (typeof value !== 'string') return { pointer, code: 'invalid' };
  const length = Array.from(value).length;
  if (length === 0) return { pointer, code: 'too_short' };
  if (length > maxLength) return { pointer, code: 'too_long' };
  if (lineBreak.test(value)) return { pointer, code: 'invalid' };
  return undefined;
}
