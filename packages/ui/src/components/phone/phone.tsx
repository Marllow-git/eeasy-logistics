import { formatPhone } from '@eeasy-logistics/i18n';

/** An E.164 number, grouped and isolated left to right in both locales (web §5). */
export function Phone({ e164, className }: { e164: string; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {formatPhone(e164)}
    </bdi>
  );
}
