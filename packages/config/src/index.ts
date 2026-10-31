// Server-side configuration (plan PLAT-4). Pure: nothing here reads `process.env`; the process entry
// point is `@eeasy-logistics/config/node`. Browser and app code import `/web` or `/driver` instead.
export { ConfigError, EX_CONFIG, type ConfigIssue } from './errors.ts';
export type { EnvRecord } from './fields.ts';
export { appEnvs, type AppEnv } from './formats.ts';
export { Secret } from './secret.ts';
export {
  appRoles,
  defineConfig,
  messagingProviders,
  serverVariables,
  type AppRole,
  type Config,
  type DefineConfigOptions,
  type MessagingProvider,
  type ServerVariable,
} from './server.ts';
