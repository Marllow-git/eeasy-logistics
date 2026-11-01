// Shared locations and the surface list for the generation scripts (PLAT-15 plan 2.2).
import { resolve } from 'node:path';

export const packageRoot = resolve(import.meta.dirname, '..');
export const contractsDir = resolve(packageRoot, '../../docs/contracts');
export const generatedDir = resolve(packageRoot, 'generated');

export type SurfaceName = 'staff' | 'platform' | 'driver' | 'recipient' | 'public';

export interface Surface {
  name: SurfaceName;
  /** Source files under docs/contracts/openapi, without `.yaml`; several are joined. */
  files: readonly string[];
}

export const surfaces: readonly Surface[] = [
  { name: 'staff', files: ['staff', 'staff-delivery', 'staff-wms'] },
  { name: 'platform', files: ['platform'] },
  { name: 'driver', files: ['driver'] },
  { name: 'recipient', files: ['recipient'] },
  { name: 'public', files: ['public'] },
];
