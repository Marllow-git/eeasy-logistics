import { randomUUID } from 'node:crypto';
import type { Config } from '@eeasy-logistics/config';
import { AuditWriter } from './modules/kernel/audit/audit-writer.js';
import { Invitations } from './modules/kernel/auth/invitations.js';
import { OutboxWriter } from './modules/kernel/outbox/outbox-writer.js';
import type { BootstrapPool } from './modules/kernel/platform/bootstrap-pool.js';
import { withBootstrapPool } from './modules/kernel/platform/bootstrap-pool.js';
import { identityStore } from './modules/kernel/platform/identity.repository.js';

// `--role bootstrap --email <email> --name <name> [--locale ar|en]` (PLAT-11 plan 2.12, owner
// question 5): the first platform super admin without anyone editing the database. A fourth process
// role beside api, worker and migrate; it holds only the platform pool's URL. It refuses when any
// platform staff row, or a live super admin invitation, exists; else it creates the invitation and
// prints the console accept link once to stdout (no mail: SMTP may not exist yet). Audited
// `core.platform_staff.bootstrapped` as the system. OPS-1 runs it once (apps/api/README.md).

export const bootstrapExit = { created: 0, refused: 1, usage: 64 } as const;

export interface BootstrapArgs {
  readonly email: string;
  readonly name: string;
  readonly locale: 'ar' | 'en';
}

export class BootstrapUsageError extends Error {
  constructor(problem: string) {
    super(`${problem}. Usage: --role bootstrap --email <email> --name <name> [--locale ar|en]`);
    this.name = 'BootstrapUsageError';
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function option(args: readonly string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
  if (index === -1) return undefined;
  const arg = args[index] ?? '';
  return arg === `--${name}` ? args[index + 1] : arg.slice(name.length + 3);
}

/** The command's options; a missing or malformed one is a `BootstrapUsageError`. */
export function parseBootstrapArgs(args: readonly string[]): BootstrapArgs {
  const email = option(args, 'email')?.trim().toLowerCase();
  const name = option(args, 'name')?.trim();
  const locale = option(args, 'locale') ?? 'en';
  if (email === undefined || !emailPattern.test(email) || email.length > 320) {
    throw new BootstrapUsageError('A valid --email is required');
  }
  if (name === undefined || name === '' || name.length > 200) {
    throw new BootstrapUsageError('A --name of 1 to 200 characters is required');
  }
  if (locale !== 'ar' && locale !== 'en') throw new BootstrapUsageError('--locale is ar or en');
  return { email, name, locale };
}

export type BootstrapOutcome =
  | { readonly kind: 'created'; readonly link: string; readonly userId: string }
  | { readonly kind: 'refused' };

/** The bootstrap on a platform pool: the invitation, or a refusal when one exists already. */
export async function bootstrapSuperAdmin(
  config: Config,
  pool: BootstrapPool,
  args: BootstrapArgs,
  runId: string = randomUUID(),
): Promise<BootstrapOutcome> {
  const invitations = new Invitations({
    store: identityStore(pool.db),
    outbox: new OutboxWriter(),
    resolver: undefined,
    publicWebUrl: config.app.publicWebUrl,
    publicAdminUrl: config.app.publicAdminUrl,
  });
  const created = await invitations.bootstrap(args, new AuditWriter(pool), runId);
  return created === undefined
    ? { kind: 'refused' }
    : { kind: 'created', link: created.link, userId: created.userId };
}

/** The command: parse, check the pool's role, run, print; returns the exit code. */
export async function runBootstrap(
  config: Config,
  argv: readonly string[],
  out: { log: (line: string) => void; error: (line: string) => void },
): Promise<number> {
  let args: BootstrapArgs;
  try {
    args = parseBootstrapArgs(argv);
  } catch (error) {
    out.error(error instanceof Error ? error.message : 'Bad arguments');
    return bootstrapExit.usage;
  }
  if (config.db.urls.platform === undefined) {
    out.error('DATABASE_URL_PLATFORM is required for --role bootstrap');
    return bootstrapExit.usage;
  }
  const outcome = await withBootstrapPool(config, (pool) =>
    bootstrapSuperAdmin(config, pool, args),
  );
  if (outcome.kind === 'refused') {
    out.error('Refusing: platform staff already exist, or a super admin invitation is still open.');
    return bootstrapExit.refused;
  }
  out.log(`Super admin invitation created for ${args.email} (valid 72 hours). Accept it at:`);
  out.log(outcome.link);
  return bootstrapExit.created;
}
