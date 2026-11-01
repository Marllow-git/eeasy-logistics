import { formatDate, formatDateTime } from '@eeasy-logistics/i18n';
import { useLocale } from '../../intl';

type DateTimeProps =
  | {
      /** An instant (ISO 8601 timestamp), shown in Riyadh time. */
      value: string | Date;
      date?: never;
      dateStyle?: Intl.DateTimeFormatOptions['dateStyle'];
      timeStyle?: Intl.DateTimeFormatOptions['timeStyle'];
    }
  | {
      /** A business date (`YYYY-MM-DD`), shown as that calendar day in any zone. */
      date: string;
      value?: never;
      dateStyle?: Intl.DateTimeFormatOptions['dateStyle'];
      timeStyle?: never;
    };

/** Gregorian, Western digits, Asia/Riyadh (web §5, ADR-0016), in a machine-readable `<time>`. */
export function DateTime(props: DateTimeProps) {
  const locale = useLocale();
  if (props.date !== undefined) {
    return (
      <time dateTime={props.date}>
        {formatDate(locale, props.date, { dateStyle: props.dateStyle ?? 'medium' })}
      </time>
    );
  }
  const instant = props.value instanceof Date ? props.value : new Date(props.value);
  return (
    <time dateTime={instant.toISOString()}>
      {formatDateTime(locale, instant, {
        dateStyle: props.dateStyle ?? 'medium',
        timeStyle: props.timeStyle ?? 'short',
      })}
    </time>
  );
}
