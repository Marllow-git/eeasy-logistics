import { dir, type Locale } from '@eeasy-logistics/i18n';
import { useLocale } from '../../intl';

/**
 * A `name_ar` / `name_en` pair shown in the reader's language (web §5). User-entered text keeps
 * `dir="auto"`; when only the other language exists it is shown marked with its own `lang` and `dir`
 * so screen readers and the bidi algorithm treat it correctly.
 */
export function BilingualText({
  ar,
  en,
  className,
}: {
  ar?: string | null;
  en?: string | null;
  className?: string;
}) {
  const locale = useLocale();
  const values: Record<Locale, string | null | undefined> = { ar, en };
  const own = values[locale];
  if (own) {
    return (
      <span dir="auto" className={className}>
        {own}
      </span>
    );
  }
  const other: Locale = locale === 'ar' ? 'en' : 'ar';
  const fallback = values[other];
  if (!fallback) return null;
  return (
    <span lang={other} dir={dir(other)} className={className}>
      {fallback}
    </span>
  );
}
