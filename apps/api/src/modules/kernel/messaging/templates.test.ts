import { locales } from '@eeasy-logistics/i18n/templates';
import { messageTemplateKeys, messageTemplateTexts } from '@eeasy-logistics/i18n/templates';
import { describe, expect, it } from 'vitest';
import {
  TemplateParamsError,
  messageTemplates,
  placeholdersOf,
  providerTemplateName,
  renderTemplate,
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

  it('prefixes provider names with the namespace (integrations §5.2)', () => {
    expect(providerTemplateName('auth_otp', 'elx')).toBe('elx_auth_otp');
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

  it('refuses a missing, empty or unknown parameter', () => {
    expect(() => renderTemplate('password_reset', 'en', {})).toThrow(TemplateParamsError);
    expect(() => renderTemplate('password_reset', 'en', { link: '' })).toThrow(TemplateParamsError);
    expect(() =>
      renderTemplate('password_reset', 'en', { link: 'https://x.test', note: 'free text' }),
    ).toThrow(TemplateParamsError);
  });
});
