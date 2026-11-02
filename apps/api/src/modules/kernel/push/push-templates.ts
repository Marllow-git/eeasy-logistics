import type { Locale, PushTemplateKey } from '@eeasy-logistics/i18n/push';
import { formatNumber, pushTemplateTexts } from '@eeasy-logistics/i18n/push';
import type { PushChannel } from './push-sender.js';

// The push template registry (INT-4 plan 2.7; driver app §8.2): per template, the parameters it
// takes and what kind of value each is, the Android channel, the priority and the sound. The texts
// live in `packages/i18n` (`<locale>/push.json`); push-templates.test.ts fails when a registry
// parameter is missing from a text, or a text names one the registry lacks. A parameter is a count
// or an order reference, never a name, phone or address: the handler refuses any other parameter.

/**
 * `count`: a whole number, written with `formatNumber` (Western digits in both locales, ADR-0016).
 * `reference`: a human number as the API renders it (`D-000123`, data §1.3): letters, digits and
 * dashes, passed through unchanged.
 */
export type PushParamKind = 'count' | 'reference';

export interface PushTemplateDefinition {
  readonly params: Readonly<Record<string, PushParamKind>>;
  readonly channelId: PushChannel;
  readonly priority: 'high' | 'default';
  readonly sound: boolean;
}

/** Offers: `offers`, high, sound; run changes: `run`, default, silent; cash: `cash`, high, sound. */
export const pushTemplates = {
  offer_received: {
    params: { expires_in_min: 'count' },
    channelId: 'offers',
    priority: 'high',
    sound: true,
  },
  order_assigned: {
    params: { order_number: 'reference' },
    channelId: 'run',
    priority: 'default',
    sound: false,
  },
  order_cancelled: {
    params: { order_number: 'reference' },
    channelId: 'run',
    priority: 'default',
    sound: false,
  },
  cash_block_notice: { params: {}, channelId: 'cash', priority: 'high', sound: true },
  sync_needed: { params: {}, channelId: 'run', priority: 'default', sound: false },
} as const satisfies Record<PushTemplateKey, PushTemplateDefinition>;

export type { PushTemplateKey };

export const pushTemplateKeys = Object.keys(pushTemplates) as readonly PushTemplateKey[];

export function isPushTemplateKey(value: unknown): value is PushTemplateKey {
  return typeof value === 'string' && Object.hasOwn(pushTemplates, value);
}

/** Every parameter value is at most this long (adversary L-7 of PLAT-9, as for messages). */
export const pushParamMaxLength = 80;

const valuePatterns: Readonly<Record<PushParamKind, RegExp>> = {
  count: /^(0|[1-9][0-9]{0,5})$/,
  reference: /^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/,
};

/**
 * Why `params` cannot fill the template, or undefined: an undeclared, missing or empty parameter,
 * a line break, a value over 80 characters, or a value that is not of its kind.
 */
export function pushParamsProblem(
  key: PushTemplateKey,
  params: Readonly<Record<string, string>>,
): string | undefined {
  const declared: Readonly<Record<string, PushParamKind>> = pushTemplates[key].params;
  for (const name of Object.keys(params)) {
    if (!Object.hasOwn(declared, name)) return `unknown parameter ${name}`;
  }
  for (const [name, kind] of Object.entries(declared)) {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (typeof value !== 'string' || value === '') return `parameter ${name} is missing`;
    if (/[\r\n]/.test(value)) return `parameter ${name} carries a line break`;
    if (Array.from(value).length > pushParamMaxLength) {
      return `parameter ${name} is longer than ${pushParamMaxLength} characters`;
    }
    if (!valuePatterns[kind].test(value)) return `parameter ${name} is not a ${kind}`;
  }
  return undefined;
}

/** Every `{name}` placeholder of a text, in order of appearance. */
export function pushPlaceholdersOf(text: string): string[] {
  return [...text.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1] ?? '');
}

/** Thrown for parameters that do not fit; the handler checks first and makes the row dead. */
export class PushParamsError extends Error {
  constructor(key: string, problem: string) {
    super(`Push template ${key}: ${problem}`);
    this.name = 'PushParamsError';
  }
}

/** The title and body of a template in a locale, every parameter filled in. */
export function renderPush(
  key: PushTemplateKey,
  locale: Locale,
  params: Readonly<Record<string, string>>,
): { readonly title: string; readonly body: string } {
  const problem = pushParamsProblem(key, params);
  if (problem !== undefined) throw new PushParamsError(key, problem);
  const declared: Readonly<Record<string, PushParamKind>> = pushTemplates[key].params;
  const fill = (text: string) =>
    text.replace(/\{([a-z][a-z0-9_]*)\}/g, (match, name: string) => {
      const value = Object.hasOwn(params, name) ? params[name] : undefined;
      if (value === undefined) return match;
      return declared[name] === 'count' ? formatNumber(locale, Number(value)) : value;
    });
  const texts = pushTemplateTexts[locale][key];
  return { title: fill(texts.title), body: fill(texts.body) };
}
