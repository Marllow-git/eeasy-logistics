// Violation: the migration job reaching the application graph and, through it, the generated
// contracts (rule migrate-job-loads-no-application, PLAT-7 CI fix).
import { AppModule } from '../../../../src/app.module.js';

export const app = AppModule;
