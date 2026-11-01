// Violation: reading the elx_owner URL outside the migration job (PLAT-7 adversary M-3, L-1).
import type { Config } from '@eeasy-logistics/config';

export const ownerUrl = (config: Config) => config.db.urls.owner;
export const computed = (config: Config) => config.db.urls['owner'];
export const destructured = (config: Config) => {
  const { owner } = config.db.urls;
  return owner;
};
