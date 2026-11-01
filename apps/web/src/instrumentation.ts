import { nextRuntime } from '@eeasy-logistics/config/web';
import type { Instrumentation } from 'next';

// Server instrumentation (PLAT-14 plan 2.7): Sentry for the Node.js server only; the edge runtime
// runs nothing of ours yet.

export async function register(): Promise<void> {
  if (nextRuntime() === 'nodejs') await import('./observability/sentry-server');
}

/** Errors Next.js caught in a server component, route handler or server action. */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (nextRuntime() !== 'nodejs') return;
  const { reportServerError } = await import('./observability/sentry-server');
  reportServerError(error, context);
};
