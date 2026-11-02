// The lists the tenancy schema test reads (PLAT-5 plan 2.4; data §2.4, §3.1, §4.1). Change them in
// the same PR as the migration that needs it; a reviewer checks every entry against data §2.4.

/**
 * Tables without `account_id` (data §2.4). Each needs a class and a reason. A table listed here
 * that does not exist fails the test, so the list never goes stale.
 */
export const tenancyExemptions: Readonly<Record<string, { class: string; reason: string }>> = {
  core_accounts: {
    class: 'platform table',
    reason: 'the tenant itself (data §2.4); keyed by id, with the template policies',
  },
  core_schema_meta: {
    class: 'platform table',
    reason: 'the migration version for /ready; written only by the migration job (PLAT-5)',
  },
  core_roles: {
    class: 'platform table',
    reason: 'the system role bundles (data §2.4), seeded by migration 0008; runtime SELECT only',
  },
  core_engine_callback_nonces: {
    class: 'platform table',
    reason:
      'the engine callback replay cache, keyed by (service, nonce); no account (PLAT-9 plan 2A.2, migration 0011)',
  },
  core_otp_challenges: {
    class: 'users',
    reason:
      'the challenge precedes knowing the account; keyed by E.164 phone (data §2.4; PLAT-9, migration 0009)',
  },
  core_users: {
    class: 'users',
    reason:
      'a person may belong to several accounts or none (data §2.4, identity §1; PLAT-11, migration 0012)',
  },
  core_platform_staff: {
    class: 'users',
    reason: 'platform staff have no membership and no account (data §2.4; PLAT-11, migration 0012)',
  },
  core_refresh_tokens: {
    class: 'users',
    reason:
      'a session of a user; membership_id names the account when there is one (data §2.4; PLAT-11)',
  },
  core_password_resets: {
    class: 'users',
    reason: 'a reset belongs to the person, not to one of their accounts (data §2.4; PLAT-11)',
  },
  core_auth_challenges: {
    class: 'users',
    reason:
      'sign-in steps before the account is chosen; selection pins membership ids (data §2.4, A-26; PLAT-11)',
  },
};

/**
 * Tenant tables whose `account_id` may be NULL (data §2.4 "nullable account"): platform actors
 * write rows with no account. Everything else of a tenant table still applies (foreign key, leading
 * index, unique indexes with account_id, both policies). A listed table must exist and must have
 * the column nullable, so the list never goes stale.
 */
export const nullableAccountTables: Readonly<Record<string, string>> = {
  core_idempotency_keys: 'platform principals off the cross-tenant door (data §2.4, §5.1; PLAT-6)',
  core_audit_log: 'platform actors and refused cross-tenant calls (data §2.4, §2.1; PLAT-7)',
  core_outbox: 'platform-only effects carry no account (data §2.4; PLAT-8 plan 2.1)',
  core_consumer_receipts: "mirrors the event's account, none for a platform-only event (PLAT-8)",
  core_consumer_dead_letters:
    "mirrors the event's account, none for a platform-only event (PLAT-8)",
  core_invitations: 'a platform staff invitation has no account (data §2.4; PLAT-11 plan 2.1)',
};

/**
 * Unique indexes on tenant tables that may omit `account_id`, because the value is globally unique
 * (data §4.1: token hashes, `ledger_seq`, `(consumer, event_id)`, worker-owned keys). A unique index
 * on `id` alone is always allowed. Key: table; value: the indexed columns in order.
 */
export const globalUniqueIndexes: Readonly<Record<string, readonly (readonly string[])[]>> = {
  // The key of a partitioned table must contain the partition key (data §2.1; PLAT-7).
  core_audit_log: [['id', 'occurred_at']],
  // Event ids are UUIDv7, unique across accounts (data §4.1 names `(consumer, event_id)`).
  core_consumer_receipts: [['consumer', 'event_id']],
  core_consumer_dead_letters: [['consumer', 'event_id']],
  // An engine sender instance is bound to exactly one account by the engine (PLAT-9 plan 2A.4).
  core_messaging_senders: [['sender_instance_id']],
  // The SHA-256 of 32 random bytes (data §4.1 "token hashes"; PLAT-11 plan 2.3).
  core_invitations: [['token_hash']],
  // Expo's ticket id, minted by the push service and unique across projects (INT-4 plan 2.4).
  core_push_tickets: [['ticket_id']],
};

/**
 * Append-only and insert-only tables (data §3.1, document 2 §8). Each must have the row trigger
 * `BEFORE UPDATE OR DELETE` and the statement trigger `BEFORE TRUNCATE` calling
 * `core_reject_mutation()`, and the runtime roles must lack UPDATE, DELETE and TRUNCATE. A
 * migration adds a table with `SELECT core_make_append_only('<table>')` and lists it here. A
 * partitioned table is listed by its parent; each partition must carry the cloned row trigger and
 * grant the runtime roles nothing (PLAT-5 plan §6, PLAT-7).
 */
export const appendOnlyTables: readonly string[] = ['core_audit_log'];

/**
 * Personal-data columns (data §10 inventory), each tagged `COMMENT ON COLUMN … IS 'pii:<actor>'`
 * in its migration. The schema test fails when a listed column lacks the tag; an order adding a
 * personal-data column lists it here (the staging anonymiser, OPS-1, reads the same tags).
 */
export const piiColumns: Readonly<Record<string, readonly string[]>> = {
  core_audit_log: ['actor_id', 'ip', 'user_agent', 'before', 'after', 'reason'],
  core_outbox: ['payload', 'last_error'],
  core_consumer_dead_letters: ['last_error'],
  core_messaging_opt_outs: ['phone'],
  core_users: ['name', 'email', 'phone', 'password_hash', 'second_factor_phone'],
  core_platform_staff: ['totp_secret_ciphertext'],
  core_invitations: ['email', 'name'],
  core_auth_challenges: ['pending_phone', 'ip'],
  // DEL-4 plan 2.1 (data §10, driver row): the PIN hash, the app's device id, the push token.
  del_drivers: ['cash_pin_hash'],
  del_driver_devices: ['device_id', 'push_token'],
};

/**
 * Tables guarded by `core_outbox_envelope_immutable()` `BEFORE UPDATE` (data §3.1, K-10): the
 * envelope columns never change, delivery state does. Checked like `appendOnlyTables`.
 */
export const envelopeImmutableTables: readonly string[] = ['core_outbox'];
