// The kernel's public surface: the only path other contexts may import from (ADR-0026).
export { ApiException, type FieldProblem } from '../errors/api-exception.js';
export type { ErrorCode } from '../errors/error-codes.js';
export { Public } from '../tenancy/frame.js';
