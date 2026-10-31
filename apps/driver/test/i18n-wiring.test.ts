import { defaultLocale, dir, t } from '@eeasy-logistics/i18n';

// Wiring check: the jest-expo transform compiles the workspace i18n package (TypeScript source and
// JSON catalogues), and the driver app's defaults hold (driver app §10: Arabic first, right to left).
describe('i18n in the driver app', () => {
  it('defaults to Arabic, right to left', () => {
    expect(defaultLocale).toBe('ar');
    expect(dir(defaultLocale)).toBe('rtl');
  });

  it('resolves the placeholder string in both locales', () => {
    expect(t('ar', 'placeholder.driver')).toBe('تطبيق السائق قيد الإنشاء.');
    expect(t('en', 'placeholder.driver')).toBe('The driver app is under construction.');
  });
});
