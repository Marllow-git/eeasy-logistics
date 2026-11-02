'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { EnrolFlow } from './enrol-flow';
import { stepStore, useStoredStep } from './steps';

/** `/sign-in/second-factor/enrol`: the enrolment token `login` answered (N2), from this tab. */
export function EnrolAtSignIn() {
  const router = useRouter();
  const token = useStoredStep('enrolment');
  useEffect(() => {
    if (token === undefined && stepStore.enrolment() === undefined) router.replace('/sign-in');
  }, [token, router]);
  return token === undefined ? null : <EnrolFlow enrolmentToken={token} />;
}
