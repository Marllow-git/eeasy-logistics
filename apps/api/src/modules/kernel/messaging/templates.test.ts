import { locales } from '@eeasy-logistics/i18n/templates';
import { messageTemplateKeys, messageTemplateTexts } from '@eeasy-logistics/i18n/templates';
import { describe, expect, it } from 'vitest';
import type { TemplateDefinition } from './templates.js';
import {
  TemplateParamsError,
  messageTemplates,
  placeholdersOf,
  renderTemplate,
  templateParamsProblem,
} from './templates.js';

// PLAT-9 plan 2.3: the registry and the texts of packages/i18n agree in both locales.
describe('message template registry', () => {
  it('has one entry per template text, and a text per entry', () => {
    expect(Object.keys(messageTemplates).sort()).toEqual([...messageTemplateKeys].sort());
  });

  describe.each(Object.keys(messageTemplates) as (keyof typeof messageTemplates)[])('%s', (key) => {
    const definition = messageTemplates[key];

    it.each(locales)(
      'names every registry parameter in the %s body, and nothing else',
      (locale) => {
        const texts = messageTemplateTexts[locale][key] as Record<string, string>;
        const body = texts.body ?? '';
        for (const name of definition.params) expect(placeholdersOf(body)).toContain(name);
        const used = Object.values(texts).flatMap(placeholdersOf);
        for (const name of used) expect(definition.params).toContain(name);
      },
    );

    it.each(locales)('has the parts of its channel in %s', (locale) => {
      const parts = Object.keys(messageTemplateTexts[locale][key]).sort();
      expect(parts).toEqual(
        definition.channel === 'mail' ? ['body', 'subject'] : ['body', 'button', 'footer'],
      );
    });

    it('marks only declared parameters secret', () => {
      for (const name of definition.secretParams) {
        expect(definition.params as readonly string[]).toContain(name);
      }
    });
  });

  it('keeps OTP an authentication template that is never deferred, its code secret', () => {
    expect(messageTemplates.auth_otp).toMatchObject({
      channel: 'whatsapp',
      category: 'authentication',
      deferrable: false,
      secretParams: ['code'],
    });
  });

  it('gives every WhatsApp template, and only those, an engine message type (ADR-0041)', () => {
    for (const definition of Object.values(messageTemplates) as TemplateDefinition[]) {
      expect(definition.engineMessageType !== undefined).toBe(definition.channel === 'whatsapp');
    }
    expect(messageTemplates.auth_otp.engineMessageType).toBe('verification');
  });
});

describe('renderTemplate', () => {
  it('fills the parameters in both locales with Western digits kept as given', () => {
    const en = renderTemplate('auth_otp', 'en', { code: '123456' });
    const ar = renderTemplate('auth_otp', 'ar', { code: '123456' });
    expect(en.body).toContain('123456 is your verification code');
    expect(ar.body).toContain('123456');
    expect(ar.body).not.toMatch(/[٠-٩]/);
    expect(en.button).toBe('Copy code');
  });

  it('does not re-read placeholders inside a value', () => {
    const mail = renderTemplate('invitation', 'en', {
      account_name: '{link}',
      link: 'https://app.example.test/invite/x',
    });
    expect(mail.subject).toContain('join {link} on');
    expect(mail.body).toContain('https://app.example.test/invite/x');
  });

  it.each([
    ['a line break in the account name', { account_name: 'Acme\r\nBcc: x@example.test' }],
    ['a link in the account name', { account_name: 'Visit https://evil.example.test' }],
    ['an account name over 80 characters', { account_name: 'a'.repeat(81) }],
    ['a line break in the link', { link: 'https://app.example.test/x\nBcc: y' }],
  ])('refuses a mail with %s (adversary L-7)', (_name, change) => {
    const params = { account_name: 'Acme', link: 'https://app.example.test/invite/x', ...change };
    expect(templateParamsProblem('invitation', params)).toBeDefined();
    expect(() => renderTemplate('invitation', 'en', params)).toThrow(TemplateParamsError);
  });

  it('accepts the link in its own parameter and an 80-character Arabic name', () => {
    expect(
      templateParamsProblem('invitation', {
        account_name: 'م'.repeat(80),
        link: 'https://app.example.test/invite/x',
      }),
    ).toBeUndefined();
  });

  it('refuses a missing, empty or unknown parameter', () => {
    expect(() => renderTemplate('password_reset', 'en', {})).toThrow(TemplateParamsError);
    expect(() => renderTemplate('password_reset', 'en', { link: '' })).toThrow(TemplateParamsError);
    expect(() =>
      renderTemplate('password_reset', 'en', { link: 'https://x.test', note: 'free text' }),
    ).toThrow(TemplateParamsError);
  });
});
