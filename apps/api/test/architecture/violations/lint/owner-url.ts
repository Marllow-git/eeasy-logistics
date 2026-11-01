// Violation: reading the elx_owner URL outside the migration and audit partition jobs (PLAT-7).
import type { Config } from '@eeasy-logistics/config';

export const ownerUrl = (config: Config) => config.db.urls.owner;
export const destructured = (config: Config) => {
  const { owner } = config.db.urls;
  return owner;
};
