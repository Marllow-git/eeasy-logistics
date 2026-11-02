import {
  defaultLocale,
  dir,
  driverMessage,
  isLocale,
  type DriverKey,
  type Locale,
} from '@eeasy-logistics/i18n/driver';
import { preferences } from '../platform/database';
import { forceDirection, reloadApp } from '../platform/direction';

// The app language (driver app §10, DRV-1 plan 2.2): Arabic on first launch whatever the phone's
// language, English as a choice kept in plain app storage. The language is fixed for the life of
// the JS bundle: a change persists, forces the direction and reloads.

const languageKey = 'app.language';

let current: Locale | undefined;

/** The language of this run, read once from storage; Arabic when none was chosen. */
export function appLocale(): Locale {
  if (current === undefined) {
    const stored = preferences.get(languageKey);
    current = isLocale(stored) ? stored : defaultLocale;
  }
  return current;
}

/** Applies the direction of the stored language; true when the app must reload to show it. */
export function applyDirection(): boolean {
  return forceDirection(dir(appLocale()) === 'rtl');
}

/** Reloads once so the direction forced at start takes effect (first launch in Arabic). */
export const reloadForDirection = reloadApp;

export async function changeLocale(locale: Locale): Promise<void> {
  preferences.set(languageKey, locale);
  current = locale;
  forceDirection(dir(locale) === 'rtl');
  await reloadApp();
}

export type { DriverKey, Locale };

/** A driver string in the app language. */
export function t(key: DriverKey, values?: Readonly<Record<string, string | number>>): string {
  return driverMessage(appLocale(), key, values);
}

const isolateStart = '⁦';
const isolateEnd = '⁩';

/** Wraps a phone number, code or amount so it stays left to right inside Arabic text. */
export function isolate(value: string): string {
  return `${isolateStart}${value}${isolateEnd}`;
}
