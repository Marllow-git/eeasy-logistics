import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { ClientFault } from './client-fault';
import { censusFaultsEnabled } from './settings';

/**
 * A page that fails on purpose so the census can prove the error pages (PLAT-14 plan 2.9): a
 * server component error (the boundary shows its digest), or with `?at=client` an error thrown in
 * the browser after hydration (the boundary reports it to Sentry and shows the event id). Local
 * and ci builds only; elsewhere 404. The planted phone number proves the scrubbing.
 */
export async function CensusFault({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  if (!censusFaultsEnabled()) notFound();
  const { at } = await searchParams;
  if (at === 'client') return <ClientFault />;
  throw new Error('Census fault: a server component failed on purpose for +966501234567');
}
