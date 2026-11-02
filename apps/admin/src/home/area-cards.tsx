import { Card, CardContent, CardHeader, CardTitle } from '@eeasy-logistics/ui/components/card';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import type { AreaEntry } from '../routes';

/** One card per console area the session opens (WEB-4 plan 2.2), in the navigation's order. */
export async function AreaCards({ areas }: { areas: readonly AreaEntry[] }) {
  const t = await getTranslations('platform');
  if (areas.length === 0) return <p className="text-sm text-muted-foreground">{t('home.none')}</p>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {areas.map((area) => (
        <li key={area.href}>
          <Link
            href={area.href}
            className="block h-full rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Card className="h-full hover:bg-muted">
              <CardHeader>
                <CardTitle>{t(`nav.${area.label}`)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{t(`home.areas.${area.label}`)}</p>
              </CardContent>
            </Card>
          </Link>
        </li>
      ))}
    </ul>
  );
}
