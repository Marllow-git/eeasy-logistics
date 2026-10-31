-- The three extensions of PLAT-2 decision 2.3 (ADR-0019).
--
-- Created in template1 first, so every database made later from it (elx_seed,
-- the empty stack clones of tools/stack.sh) has them, then in elx itself.
-- This directory replaces the image's own init script, so the other PostGIS
-- extensions it would add (topology, tiger geocoder) are not installed.

\connect template1
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

\connect elx
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
