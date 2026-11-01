'use client';

import { formatDateTime, formatNumber } from '@eeasy-logistics/i18n';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from '../../intl';

/**
 * "Updated X seconds ago" (ADR-0009, web §6.3), ticking every second for the first minute, every
 * thirty seconds until the first hour, and once a minute after (the text then changes hourly). The exact time is in `dateTime` and the tooltip. Server and client clocks
 * differ by the render delay, so the text may change on hydration (warning suppressed).
 */
export function UpdatedAgo({ at, now: fixedNow }: { at: string | Date; now?: number }) {
  const locale = useLocale();
  const t = useTranslations('common.updated_ago');
  const instant = at instanceof Date ? at : new Date(at);
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  const seconds = Math.max(0, Math.floor((now - instant.getTime()) / 1000));

  // One interval per cadence, not per tick: it is replaced only when the minute or the hour ends.
  const cadence = seconds < 60 ? 1000 : seconds < 3600 ? 30_000 : 60_000;
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), cadence);
    return () => clearInterval(id);
  }, [fixedNow, cadence]);

  let text: string;
  if (seconds < 5) {
    text = t('just_now');
  } else {
    const [unit, count] =
      seconds < 60
        ? (['seconds', seconds] as const)
        : seconds < 3600
          ? (['minutes', Math.floor(seconds / 60)] as const)
          : (['hours', Math.floor(seconds / 3600)] as const);
    text = t(unit, { count, value: formatNumber(locale, count) });
  }

  return (
    <time
      dateTime={instant.toISOString()}
      title={formatDateTime(locale, instant)}
      suppressHydrationWarning
      className="text-xs text-muted-foreground"
    >
      {text}
    </time>
  );
}
