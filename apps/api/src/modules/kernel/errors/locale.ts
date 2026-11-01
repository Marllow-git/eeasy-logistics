import type { Locale } from '@eeasy-logistics/i18n/errors';
import { defaultLocale, isLocale } from '@eeasy-logistics/i18n/errors';

/**
 * The locale of `message` texts from `Accept-Language` (contracts README §3 Language): the
 * supported language with the highest quality, matched on the primary subtag (`en-GB` is `en`);
 * Arabic when the header is absent or names nothing supported (ADR-0016). The account's own
 * locale becomes the fallback when accounts carry one (provisioning order).
 */
export function resolveLocale(header: string | readonly string[] | undefined): Locale {
  const value = typeof header === 'string' ? header : header?.join(',');
  if (value === undefined || value.length > 512) return defaultLocale;
  let best: { locale: Locale; quality: number } | undefined;
  for (const part of value.split(',')) {
    const [tag = '', ...parameters] = part.trim().split(';');
    const language = tag.trim().toLowerCase().split('-')[0];
    if (!isLocale(language)) continue;
    const q = parameters.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const quality = q === undefined ? 1 : Number(q.slice(2));
    if (!Number.isFinite(quality) || quality <= 0) continue;
    if (best === undefined || quality > best.quality) best = { locale: language, quality };
  }
  return best?.locale ?? defaultLocale;
}
