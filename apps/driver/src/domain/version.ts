// `min_app_version` (driver app §13.5, DRV-1 plan 2.9): the soft notice when this build is older than
// the minimum `driverGetMe` names for the platform; the hard stop is the API's 426.

function parts(version: string): number[] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** True when `current` is strictly older than `minimum`; false when either is not `x.y.z`. */
export function isOlderThan(current: string, minimum: string | undefined): boolean {
  if (minimum === undefined) return false;
  const a = parts(current);
  const b = parts(minimum);
  if (a === undefined || b === undefined) return false;
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! < b[index]!;
  }
  return false;
}
