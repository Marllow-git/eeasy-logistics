'use client';

import { uuidv7 } from '@eeasy-logistics/contracts/http';
import { useCallback, useState } from 'react';

/**
 * The intent's `Idempotency-Key` (web §7.4): minted when the form or dialog mounts, kept across
 * retries, renewed after a success. Its own module, so a dialog needs no form library.
 */
export function useIntentKey(): { key: string; renew: () => void } {
  const [key, setKey] = useState(() => uuidv7());
  const renew = useCallback(() => setKey(uuidv7()), []);
  return { key, renew };
}
