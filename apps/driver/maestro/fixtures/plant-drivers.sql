-- The Maestro flows' drivers on a scratch database (never the shared one), after `seed` wrote the
-- two fixture accounts: psql "<scratch database as its owner or superuser>" -f plant-drivers.sql.
-- Planted as apps/api/test/integration/driver-fixtures.ts plants them (DRV-1 §8.1).
-- Driver "multi" (+966500000101) drives for Seed Account A and B; driver "single" (+966500000102)
-- for A only. Re-running resets them: no devices, no PIN, no challenges, no sessions.
\set a '01920000-0000-7000-8000-00000000000a'
\set b '01920000-0000-7000-8000-00000000000b'
BEGIN;
INSERT INTO core_sites (id, account_id, kind, name_ar, name_en) VALUES
  ('01920000-0000-7d01-8000-0000000000a1', :'a', 'branch', 'فرع العليا', 'Olaya branch'),
  ('01920000-0000-7d01-8000-0000000000b1', :'b', 'branch', 'فرع الحمراء', 'Hamra branch')
ON CONFLICT (id) DO NOTHING;
INSERT INTO core_users (id, name, phone, locale) VALUES
  ('01920000-0000-7d01-8000-000000000101', 'سائق الحسابين', '+966500000101', 'ar'),
  ('01920000-0000-7d01-8000-000000000102', 'سائق حساب واحد', '+966500000102', 'ar')
ON CONFLICT (id) DO NOTHING;
INSERT INTO core_memberships (id, account_id, user_id, roles, site_ids, status) VALUES
  ('01920000-0000-7d01-8000-00000000a101', :'a', '01920000-0000-7d01-8000-000000000101', '{driver}', '{01920000-0000-7d01-8000-0000000000a1}', 'active'),
  ('01920000-0000-7d01-8000-00000000b101', :'b', '01920000-0000-7d01-8000-000000000101', '{driver}', '{01920000-0000-7d01-8000-0000000000b1}', 'active'),
  ('01920000-0000-7d01-8000-00000000a102', :'a', '01920000-0000-7d01-8000-000000000102', '{driver}', '{01920000-0000-7d01-8000-0000000000a1}', 'active')
ON CONFLICT (id) DO NOTHING;
INSERT INTO del_drivers (id, account_id, user_id, membership_id, home_site_id, name) VALUES
  ('01920000-0000-7d01-8000-0000000da101', :'a', '01920000-0000-7d01-8000-000000000101', '01920000-0000-7d01-8000-00000000a101', '01920000-0000-7d01-8000-0000000000a1', 'سائق الحسابين'),
  ('01920000-0000-7d01-8000-0000000db101', :'b', '01920000-0000-7d01-8000-000000000101', '01920000-0000-7d01-8000-00000000b101', '01920000-0000-7d01-8000-0000000000b1', 'سائق الحسابين'),
  ('01920000-0000-7d01-8000-0000000da102', :'a', '01920000-0000-7d01-8000-000000000102', '01920000-0000-7d01-8000-00000000a102', '01920000-0000-7d01-8000-0000000000a1', 'سائق حساب واحد')
ON CONFLICT (id) DO NOTHING;
-- Reset for a fresh run.
DELETE FROM core_refresh_tokens WHERE user_id IN ('01920000-0000-7d01-8000-000000000101', '01920000-0000-7d01-8000-000000000102');
DELETE FROM del_driver_devices WHERE driver_id IN ('01920000-0000-7d01-8000-0000000da101', '01920000-0000-7d01-8000-0000000db101', '01920000-0000-7d01-8000-0000000da102');
UPDATE del_drivers SET cash_pin_hash = NULL, cash_pin_failures = 0, cash_pin_locked_at = NULL
  WHERE user_id IN ('01920000-0000-7d01-8000-000000000101', '01920000-0000-7d01-8000-000000000102');
DELETE FROM core_otp_challenges WHERE phone IN ('+966500000101', '+966500000102');
COMMIT;
