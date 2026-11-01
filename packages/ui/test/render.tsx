import { dir, messages, type Locale } from '@eeasy-logistics/i18n';
import { cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { afterEach } from 'vitest';
import { DirectionProvider } from '../src/components/direction-provider/direction-provider';

afterEach(cleanup);

/** Both reading directions: Arabic right to left, English left to right (web §6.3, plan 2.6). */
export const directions = [
  { locale: 'ar', dir: 'rtl' },
  { locale: 'en', dir: 'ltr' },
] as const satisfies readonly { locale: Locale; dir: 'rtl' | 'ltr' }[];

/** Renders `ui` the way a root layout does: `<html dir>` equivalent, Radix direction, messages. */
export function renderIn(locale: Locale, ui: ReactNode) {
  document.documentElement.lang = locale;
  document.documentElement.dir = dir(locale);
  return render(wrapIn(locale, ui));
}

/** The providers `renderIn` adds, for a `rerender` of the same tree. */
export function wrapIn(locale: Locale, ui: ReactNode) {
  return (
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Asia/Riyadh">
      <DirectionProvider dir={dir(locale)}>{ui}</DirectionProvider>
    </NextIntlClientProvider>
  );
}

/** Western digits only (ADR-0016). */
export const arabicIndicDigits = /[٠-٩۰-۹]/;
