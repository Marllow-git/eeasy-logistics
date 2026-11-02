'use client';

import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import dynamic from 'next/dynamic';

// The account settings forms load with `next/dynamic` (WEB-3 leg 2, lead ruling on the budget):
// react-hook-form and the generated schemas leave the route's first load, which holds the merchant
// budget as the catalogues grow. Server-rendered still, from the hydrated settings.
export const AccountSettingsScreen = dynamic(
  () => import('./account-settings').then((module) => module.AccountSettingsForms),
  { loading: () => <Skeleton className="h-64 w-full" /> },
);
