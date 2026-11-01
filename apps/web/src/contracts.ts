// The web app's seam to the API is @eeasy-logistics/contracts (web §2.2). Until WEB-1 wires the
// generated clients, this type import proves the pipeline: typecheck needs the contracts built
// first (`^build` in apps/web/turbo.json). The architecture test allows only the staff, recipient,
// http and unions entry points (PLAT-15 plan item E).
import type { Permission } from '@eeasy-logistics/contracts/unions';

export type { Permission };
