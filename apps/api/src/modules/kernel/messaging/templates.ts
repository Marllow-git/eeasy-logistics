import type { Locale, MessageTemplateKey } from '@eeasy-logistics/i18n/templates';
import { messageTemplateTexts } from '@eeasy-logistics/i18n/templates';

// The template registry (PLAT-9 plan 2.3, 2A.5; ADR-0037, ADR-0041; integrations §5.1): which channel
// each template leaves on, its category, the parameters it takes and which of them are secret. The
// kernel renders every text itself; the engine receives text, so there are no provider template
// names or approvals (ADR-0041).
// The texts live in `packages/i18n` (`<locale>/messages.json`); templates.test.ts fails when a
// registry parameter is missing from a text, or a text names a parameter the registry lacks.

export type MessageChannel = 'whatsapp' | 'mail';

/**
 * The engine's closed `message_type` a WhatsApp template is sent as (engine contract §6.1; plan
 * 2A.1): it fixes the priority class and the hold the engine re-derives. `verification` goes through
 * `message.send.verification`, every other type through `message.send.text`.
 */
export type EngineMessageType =
  | 'verification'
  | 'shipment_issued'
  | 'digest_daily'
  | 'digest_weekly'
  | 'digest_monthly'
  | 'manual_custom'
  | 'connection_test';

export interface TemplateDefinition {
  readonly channel: MessageChannel;
  /** The provider category (WhatsApp) or `transactional` (mail). */
  readonly category: 'authentication' | 'utility' | 'transactional';
  /** Parameter names, each a `{name}` placeholder in the texts; values come from domain data. */
  readonly params: readonly string[];
  /**
   * Parameters carried encrypted on the outbox row and decrypted at send time only (data §10: the
   * OTP code). Never logged, never stored readable.
   */
  readonly secretParams: readonly string[];
  /** Waits out quiet hours (integrations §5.4); none in wave 0, and never OTP. */
  readonly deferrable: boolean;
  /** Mail templates: the one parameter that may carry a URL (the one-time link, PLAT-11). */
  readonly linkParam?: string;
  /**
   * The table whose row the outbox row is about (its aggregate id): the secret parameters are
   * encrypted under `<table>:<aggregate id>` (PLAT-11 item J, as `core_otp_challenges:<id>` for the
   * OTP code), so a link is readable only at send time, never from the row.
   */
  readonly secretContext?: string;
  /** WhatsApp templates only: the engine `message_type` it is sent as (ADR-0041). */
  readonly engineMessageType?: EngineMessageType;
}

export const messageTemplates = {
  auth_otp: {
    channel: 'whatsapp',
    category: 'authentication',
    params: ['code'],
    secretParams: ['code'],
    deferrable: false,
    engineMessageType: 'verification',
  },
  invitation: {
    channel: 'mail',
    linkParam: 'link',
    category: 'transactional',
    params: ['account_name', 'link'],
    secretParams: ['link'],
    secretContext: 'core_invitations',
    deferrable: false,
  },
  password_reset: {
    channel: 'mail',
    linkParam: 'link',
    category: 'transactional',
    params: ['link'],
    secretParams: ['link'],
    secretContext: 'core_password_resets',
    deferrable: false,
  },
  platform_invitation: {
    channel: 'mail',
    linkParam: 'link',
    category: 'transactional',
    params: ['link'],
    secretParams: ['link'],
    secretContext: 'core_invitations',
    deferrable: false,
  },
  // PLAT-11 plan 2.8: the re-enrolment link after `resetMemberSecondFactor` (24 hours).
  second_factor_reset: {
    channel: 'mail',
    linkParam: 'link',
    category: 'transactional',
    params: ['link'],
    secretParams: ['link'],
    secretContext: 'core_auth_challenges',
    deferrable: false,
  },
  // PLAT-13 plan 2.9, 2.11: the notice after `platformResetStaffTotp`; no link, no parameter, no
  // secret (the user signs in with the password and enrols again).
  platform_totp_reset: {
    channel: 'mail',
    category: 'transactional',
    params: [],
    secretParams: [],
    deferrable: false,
  },
} as const satisfies Record<MessageTemplateKey, TemplateDefinition>;

export type TemplateKey = keyof typeof messageTemplates;
export type { MessageTemplateKey };

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && Object.hasOwn(messageTemplates, value);
}

/** Every `{name}` placeholder of a text, in order of appearance. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{([a-z][a-z0-9_]*)\}/g)].map((match) => match[1] ?? '');
}

/** A template's texts with every parameter filled in. */
export type RenderedTemplate = Readonly<Record<string, string>>;

/** Thrown for parameters that do not match the registry; a programming error, never user input. */
export class TemplateParamsError extends Error {
  constructor(key: string, problem: string) {
    super(`Template ${key}: ${problem}`);
    this.name = 'TemplateParamsError';
  }
}

/** Parameters with a length cap (adversary L-7; bounding the name at creation is PLAT-12's). */
export const paramMaxLength: Readonly<Record<string, number>> = { account_name: 80 };

/**
 * Why `params` cannot fill the template, or undefined: an unknown, missing or empty parameter; in a
 * mail, a line break anywhere, or `://` outside the template's link parameter (adversary L-7: a
 * value from domain data, an account name, cannot smuggle a header line or a second link into an
 * invitation); a value over its cap. Producers check at enqueue; the `message` handler checks again
 * at send time and makes a row that fails `dead`.
 */
export function templateParamsProblem(
  key: TemplateKey,
  params: Readonly<Record<string, string>>,
): string | undefined {
  const definition: TemplateDefinition = messageTemplates[key];
  for (const name of Object.keys(params)) {
    if (!definition.params.includes(name)) return `unknown parameter ${name}`;
  }
  for (const name of definition.params) {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (typeof value !== 'string' || value === '') return `parameter ${name} is missing`;
    const cap = Object.hasOwn(paramMaxLength, name) ? paramMaxLength[name] : undefined;
    if (cap !== undefined && Array.from(value).length > cap) {
      return `parameter ${name} is longer than ${cap} characters`;
    }
    if (definition.channel === 'mail') {
      if (/[\r\n]/.test(value)) return `parameter ${name} carries a line break`;
      if (name !== definition.linkParam && value.includes('://')) {
        return `parameter ${name} carries a link`;
      }
    }
  }
  return undefined;
}

/**
 * Fills a template's texts in a locale. Every registry parameter must be given, as a non-empty
 * string, and nothing else: a free-text field cannot slip into a message (ADR-0037). Mail bodies are
 * plain text, so no value is interpreted as markup.
 */
export function renderTemplate(
  key: TemplateKey,
  locale: Locale,
  params: Readonly<Record<string, string>>,
): RenderedTemplate {
  const problem = templateParamsProblem(key, params);
  if (problem !== undefined) throw new TemplateParamsError(key, problem);
  const texts = messageTemplateTexts[locale][key] as Readonly<Record<string, string>>;
  const rendered: Record<string, string> = {};
  for (const [part, text] of Object.entries(texts)) {
    rendered[part] = text.replace(/\{([a-z][a-z0-9_]*)\}/g, (_match, name: string) =>
      Object.hasOwn(params, name) ? (params[name] ?? '') : `{${name}}`,
    );
  }
  return rendered;
}
