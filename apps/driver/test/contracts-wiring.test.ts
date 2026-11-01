import type { Permission } from '@eeasy-logistics/contracts/unions';

// Wiring check (PLAT-15 plan 2.11): the driver app typechecks against the generated contracts
// (`^build` in apps/driver/turbo.json). A misspelt permission here fails `tsc`. DRV-1 wires the
// driver client; the architecture test allows only the driver, http and unions entry points.
const driverPermissions: Permission[] = [
  'delivery.driver.work',
  'delivery.driver.cash',
  'delivery.driver.locations',
];

describe('contracts in the driver app', () => {
  it('types the driver permissions of document 3 §11', () => {
    expect(driverPermissions).toHaveLength(3);
  });
});
