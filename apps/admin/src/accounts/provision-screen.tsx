'use client';

import { Skeleton } from '@eeasy-logistics/ui/components/skeleton';
import dynamic from 'next/dynamic';

// The provisioning form loads with `next/dynamic` (`ssr: false`: it holds react-hook-form), so the
// route's first load stays inside the budget (WEB-3 leg 2 ruling).
const ProvisionForm = dynamic(
  () => import('./provision-form').then((module) => module.ProvisionForm),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full max-w-2xl" /> },
);

export function ProvisionScreen({ featureKeys }: { featureKeys: readonly string[] }) {
  return <ProvisionForm featureKeys={featureKeys} />;
}
