'use client';

import { dir, type Locale } from '@eeasy-logistics/i18n';
import { Languages } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '../components/button/button';
import { useLocale, useTranslations } from '../intl';
import { localeCookieString } from './locale-cookie';

/**
 * Switches between Arabic and English (web §5): stores the `el_locale` cookie and re-renders the
 * server tree, whose root layout sets `<html lang dir>` again. No server action (web §2.2: none in
 * waves 0 to 4); the cookie is a preference the server only reads.
 */
export function LocaleSwitch() {
  const locale = useLocale();
  const t = useTranslations('common.locale');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === 'ar' ? 'en' : 'ar';

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      aria-label={`${t('label')}: ${t(next)}`}
      onClick={() => {
        document.cookie = localeCookieString(next, window.location.protocol === 'https:');
        startTransition(() => router.refresh());
      }}
    >
      <Languages aria-hidden />
      <span lang={next} dir={dir(next)}>
        {t(next)}
      </span>
    </Button>
  );
}
