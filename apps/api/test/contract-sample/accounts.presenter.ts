import type { Account, PlatformListAccounts200 } from '@eeasy-logistics/contracts/platform';
import type { AccountRow } from './accounts.repository.js';

// The sample's presenter (PLAT-6 item I): maps repository rows to the generated response type of
// `platformListAccounts`; one of the two places contract types may appear (doc 3 §9).

function presentAccount(row: AccountRow): Account {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    name: row.name,
    status: row.status,
  };
}

export function presentAccountsPage(rows: readonly AccountRow[]): PlatformListAccounts200 {
  // Cursor pagination (ADR-0029) ships with the real operation; the sample answers one page.
  return { data: rows.map(presentAccount), next_cursor: null };
}
