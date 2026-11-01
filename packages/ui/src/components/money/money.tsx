import { formatMoneyParts } from '@eeasy-logistics/i18n';
import { cn } from '../../cn';
import { useLocale, useTranslations } from '../../intl';
import { RiyalSign } from './riyal-sign';

const noBreakSpace = '\u00a0';

/**
 * Integer halalas with the riyal sign (web §5). The sign takes the place `Intl.NumberFormat` gives
 * the currency in the locale (after the amount in Arabic, before it in English; lead ruling on
 * WEB-1 §8.2 #18), joined by a no-break space. The digits sit in a left-to-right isolate; the
 * currency name is visually hidden text for screen readers.
 */
export function Money({ halalas, className }: { halalas: number; className?: string }) {
  const locale = useLocale();
  const t = useTranslations('common.currency');
  const { amount, currencyFirst } = formatMoneyParts(locale, halalas);
  const sign = <RiyalSign className="inline-block size-[0.85em] align-[-0.1em]" />;
  const digits = <bdi dir="ltr">{amount}</bdi>;
  return (
    <span className={cn('whitespace-nowrap tabular-nums', className)}>
      {currencyFirst ? sign : digits}
      {noBreakSpace}
      {currencyFirst ? digits : sign}
      <span className="sr-only">{t('sar')}</span>
    </span>
  );
}
