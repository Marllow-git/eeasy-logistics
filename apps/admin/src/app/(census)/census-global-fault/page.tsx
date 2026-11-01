import { notFound } from 'next/navigation';

/** Census only: its layout fails first in local and ci builds; elsewhere a 404 (PLAT-14 2.9). */
export default function CensusGlobalFaultPage(): never {
  notFound();
}
