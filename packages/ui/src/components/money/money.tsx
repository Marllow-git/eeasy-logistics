import { formatMoneyAmount } from '@eeasy-logistics/i18n';
import { cn } from '../../cn';
import { useLocale, useTranslations } from '../../intl';
import { RiyalSign } from './riyal-sign';

/**
 * Integer halalas as an amount with the riyal sign (web §5). The amount sits in a left-to-right
 * isolate so its digits and sign keep their order inside Arabic text; the currency name is given
 * as visually hidden text for screen readers.
 */
export function Money({ halalas, className }: { halalas: number; className?: string }) {
  const locale = useLocale();
  const t = useTranslations('common.currency');
  return (
    <bdi dir="ltr" className={cn('inline-flex items-baseline gap-1 tabular-nums', className)}>
      <RiyalSign className="size-[0.85em] self-center" />
      <span>{formatMoneyAmount(locale, halalas)}</span>
      <span className="sr-only">{t('sar')}</span>
    </bdi>
  );
}
