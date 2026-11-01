// The error codes of docs/contracts/errors.md with their HTTP status (contracts README §4). Defined
// here until PLAT-15's generated union (`packages/contracts` unions entry) merges; the first order
// after that switches the type to it (PLAT-6 plan §8.2). error-codes.test.ts fails when this table
// and errors.md disagree in either direction, or when a code lacks a message in `ar` or `en`.

export const errorStatus = {
  // §1 Common
  validation_failed: 400,
  idempotency_key_required: 400,
  idempotency_key_reused: 422,
  unauthenticated: 401,
  token_expired: 401,
  token_invalid: 401,
  forbidden: 403,
  feature_not_enabled: 403,
  account_suspended: 403,
  not_found: 404,
  version_required: 428,
  version_conflict: 409,
  invalid_transition: 409,
  secret_already_issued: 409,
  limit_exceeded: 422,
  rate_limited: 429,
  internal_error: 500,
  // §2 Authentication and devices
  role_combination_forbidden: 422,
  invalid_credentials: 401,
  second_factor_required: 401,
  reauthentication_required: 401,
  second_factor_already_enrolled: 409,
  otp_invalid: 401,
  device_limit_reached: 409,
  device_revoked: 401,
  app_update_required: 426,
  cash_pin_invalid: 403,
  cash_pin_locked: 423,
  // §3 Delivery
  outside_coverage: 422,
  cod_not_allowed: 422,
  order_locked: 409,
  driver_cash_blocked: 422,
  driver_not_eligible: 422,
  capacity_exceeded: 422,
  driver_not_assignee: 403,
  shift_not_active: 409,
  offer_expired: 409,
  offer_withdrawn: 409,
  proof_required: 422,
  cod_amount_mismatch: 422,
  method_not_allowed_for_cash: 422,
  client_ts_out_of_range: 422,
  stale_driver_event: 409,
  collection_not_eligible: 422,
  deposit_sum_mismatch: 422,
  method_not_allowed: 422,
  upload_mismatch: 422,
  slot_not_available: 422,
  slot_full: 409,
  handover_amount_required: 422,
  cash_report_unbalanced: 409,
  site_in_use: 409,
  site_kind_mismatch: 422,
  // §4 WMS
  location_tree_invalid: 422,
  tracking_mode_locked: 409,
  tracking_mode_mismatch: 422,
  insufficient_stock: 409,
  approval_required: 422,
  separation_of_duties: 403,
  package_not_measured: 422,
  method_change_forbidden: 409,
  store_already_connected: 409,
  channel_credentials_invalid: 422,
  carrier_unavailable: 503,
  // §5 Public API, webhooks and platform
  api_key_revoked: 401,
  webhook_url_invalid: 422,
  verification_token_invalid: 422,
  reason_required: 400,
  rollout_change_forbidden: 403,
  replay_not_allowed: 409,
  fix_not_whitelisted: 403,
} as const satisfies Record<string, number>;

/** A stable error code of errors.md; clients branch on it, never on the message. */
export type ErrorCode = keyof typeof errorStatus;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(errorStatus, value);
}
