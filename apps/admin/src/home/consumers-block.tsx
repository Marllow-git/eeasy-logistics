import { formatNumber, type Locale } from '@eeasy-logistics/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export interface ConsumerRow {
  readonly consumer: string;
  readonly parked: number;
  readonly dead: number;
  readonly lagSeconds: number;
}

/**
 * The outbox consumers on the home page (WEB-4 plan 2.2; `platformListConsumers`): per consumer
 * its parked and dead rows and its lag, the only counts the console shows (ADR-0029). A dead
 * count above zero links to the outbox filtered on `status=dead`. Consumer names are code
 * identifiers, isolated left to right.
 */
export async function ConsumersBlock({
  rows,
  locale,
}: {
  rows: readonly ConsumerRow[] | 'failed';
  locale: Locale;
}) {
  const t = await getTranslations('platform.home.consumers');
  const number = (value: number) => formatNumber(locale, value);
  return (
    <Card className="mt-6" aria-labelledby="consumers-title">
      <CardHeader>
        <CardTitle id="consumers-title">{t('title')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </CardHeader>
      <CardContent>
        {rows === 'failed' ? (
          <p role="alert" className="text-sm text-danger">
            {t('failed')}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-labelledby="consumers-title"
          >
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-muted-foreground">
                  <th scope="col" className="py-2 pe-4 text-start font-semibold">
                    {t('columns.consumer')}
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-semibold">
                    {t('columns.parked')}
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-semibold">
                    {t('columns.dead')}
                  </th>
                  <th scope="col" className="py-2 text-start font-semibold">
                    {t('columns.lag')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.consumer} className="border-b border-border last:border-b-0">
                    <th scope="row" className="py-2 pe-4 text-start font-normal">
                      <bdi dir="ltr">{row.consumer}</bdi>
                    </th>
                    <td className="py-2 pe-4">{number(row.parked)}</td>
                    <td className="py-2 pe-4">
                      {row.dead > 0 ? (
                        <Link
                          href="/outbox?status=dead"
                          className="font-semibold text-danger underline underline-offset-2"
                        >
                          {t('dead_link', { count: row.dead, value: number(row.dead) })}
                        </Link>
                      ) : (
                        number(0)
                      )}
                    </td>
                    <td className="py-2">{t('lag', { value: number(row.lagSeconds) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
