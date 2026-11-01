// The admin app's seam to the API is @eeasy-logistics/contracts (web §2.2). Until WEB-2 and WEB-4
// wire the generated platform client, this type import proves the pipeline: typecheck needs the
// contracts built first (`^build` in apps/admin/turbo.json). The architecture test allows only the
// platform, http and unions entry points (ADR-0038, WEB-19 decision 2.9).
import type { Permission } from '@eeasy-logistics/contracts/unions';

export type { Permission };
