// The api, worker and migration job run the same image; `--role` picks the process role
// (platform §2, data §11.5).
export const roles = ['api', 'worker', 'migrate', 'bootstrap'] as const;
export type Role = (typeof roles)[number];

/** Reads `--role <api|worker|migrate|bootstrap>` or `--role=<…>` from the arguments; defaults to `api`. */
export function parseRole(args: readonly string[]): Role {
  const index = args.findIndex((arg) => arg === '--role' || arg.startsWith('--role='));
  if (index === -1) return 'api';
  const arg = args[index] ?? '';
  const value = arg === '--role' ? args[index + 1] : arg.slice('--role='.length);
  if (value === undefined || !(roles as readonly string[]).includes(value)) {
    throw new Error(`Invalid --role "${value ?? ''}"; expected one of: ${roles.join(', ')}`);
  }
  return value as Role;
}
