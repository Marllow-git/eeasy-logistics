import { client } from '@eeasy-logistics/contracts/platform';
import { PageHeader } from '@eeasy-logistics/ui/components/page-header';
import { getLocale, getTranslations } from 'next-intl/server';
import { ConsumersBlock, type ConsumerRow } from '../../home/consumers-block';
import { AreaCards } from '../../home/area-cards';
import { homeAreas } from '../../routes';
import { platformServerFetcher } from '../../server/api';
import { getPlatformSession } from '../../server/session';

/** What the consumers block shows: the rows, or that the read failed (the page still renders). */
async function consumers(): Promise<ConsumerRow[] | 'failed'> {
  try {
    const answer = await client.platformListConsumers({ fetcher: await platformServerFetcher() });
    if (answer.status !== 200) return 'failed';
    return (answer.data.data ?? []).map((row) => ({
      consumer: row.consumer ?? '',
      parked: row.parked ?? 0,
      dead: row.dead ?? 0,
      lagSeconds: row.lag_seconds ?? 0,
    }));
  } catch {
    return 'failed';
  }
}

/**
 * The console's home (WEB-4 plan 2.2): a card for every area the staff member may open (from the
 * route manifest), and for `platform.outbox.read` the consumers block (`platformListConsumers`:
 * parked, dead and lag per consumer). No account or outbox totals anywhere (ADR-0029): the
 * consumers' counts are per consumer and bounded.
 */
export default async function PlatformHomePage() {
  const [t, me, locale] = await Promise.all([
    getTranslations('platform'),
    getPlatformSession(),
    getLocale(),
  ]);
  const readsOutbox = (me.permissions ?? []).includes('platform.outbox.read');
  const rows = readsOutbox ? await consumers() : undefined;
  return (
    <>
      <PageHeader title={t('nav.home')} description={t('home.description')} />
      <AreaCards areas={homeAreas(me)} />
      {rows === undefined ? null : (
        <ConsumersBlock rows={rows} locale={locale === 'en' ? 'en' : 'ar'} />
      )}
    </>
  );
}
