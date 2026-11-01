import type { Locale, MessageTemplateKey } from '@eeasy-logistics/i18n/templates';
import { messageTemplateTexts } from '@eeasy-logistics/i18n/templates';

// The template registry (PLAT-9 plan 2.3; ADR-0037; integrations §5.1, §5.2): which channel each
// template leaves on, its provider category, the parameters it takes and which of them are secret.
// The texts live in `packages/i18n` (`<locale>/messages.json`); templates.test.ts fails when a
// registry parameter is missing from a text, or a text names a parameter the registry lacks.

export type MessageChannel = 'whatsapp' | 'mail';

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
}

export const messageTemplates = {
  auth_otp: {
    channel: 'whatsapp',
    category: 'authentication',
    params: ['code'],
    secretParams: ['code'],
    deferrable: false,
  },
  invitation: {
    channel: 'mail',
    category: 'transactional',
    params: ['account_name', 'link'],
    secretParams: [],
    deferrable: false,
  },
  password_reset: {
    channel: 'mail',
    category: 'transactional',
    params: ['link'],
    secretParams: [],
    deferrable: false,
  },
  platform_invitation: {
    channel: 'mail',
    category: 'transactional',
    params: ['link'],
    secretParams: [],
    deferrable: false,
  },
} as const satisfies Record<MessageTemplateKey, TemplateDefinition>;

export type TemplateKey = keyof typeof messageTemplates;
export type { MessageTemplateKey };

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === 'string' && Object.hasOwn(messageTemplates, value);
}

/**
 * The name a template is approved under at the provider: the namespace prefix keeps a shared
 * WhatsApp Business account's names apart (integrations §5.2: `elx_auth_otp`).
 */
export function providerTemplateName(key: TemplateKey, namespace: string): string {
  return `${namespace}_${key}`;
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
  const definition: TemplateDefinition = messageTemplates[key];
  const given = Object.keys(params);
  for (const name of given) {
    if (!definition.params.includes(name))
      throw new TemplateParamsError(key, `unknown parameter ${name}`);
  }
  for (const name of definition.params) {
    const value = Object.hasOwn(params, name) ? params[name] : undefined;
    if (typeof value !== 'string' || value === '') {
      throw new TemplateParamsError(key, `parameter ${name} is missing`);
    }
  }
  const texts = messageTemplateTexts[locale][key] as Readonly<Record<string, string>>;
  const rendered: Record<string, string> = {};
  for (const [part, text] of Object.entries(texts)) {
    rendered[part] = text.replace(/\{([a-z][a-z0-9_]*)\}/g, (_match, name: string) =>
      Object.hasOwn(params, name) ? (params[name] ?? '') : `{${name}}`,
    );
  }
  return rendered;
}
