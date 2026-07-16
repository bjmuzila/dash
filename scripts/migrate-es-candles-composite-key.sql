-- ─────────────────────────────────────────────────────────────────────────────
-- es_candles: UNIQUE("slotKey") → UNIQUE("slotKey","intervalMinutes")
--
-- WHY
-- slotKey is 'YYYY-MM-DDTHH:MM' and carries NO interval. The 5m writer floors to
-- :00/:05/:10…; the 1m writer doesn't floor at all. So a 1-minute bar at 09:30
-- and a 5-minute bar at 09:30 produce the SAME slotKey — and with a UNIQUE on
-- slotKey alone, `ON CONFLICT("slotKey") DO UPDATE` made the 1m bar overwrite
-- the 5m bar's close and volume. Worse, that upsert never touched
-- "intervalMinutes", so the clobbered row stayed labelled 5 and the damage was
-- invisible to `GROUP BY "intervalMinutes"`.
--
-- Observed on prod 2026-07-16: scripts/backfill-es-1m.js had been run, and all
-- 468 five-minute slots between 2026-06-23 and 2026-06-30 were carrying a
-- 1-minute close + a 1-minute volume. (open/high/low survived: `open` is not in
-- the DO UPDATE list, and GREATEST/LEAST kept the wider 5m high/low.)
--
-- WHAT THIS DOES
--   1. drops the slotKey-only UNIQUE (the actual defect)
--   2. deletes the intervalMinutes=1 rows — they're genuine bars but structurally
--      incomplete (every :00/:05 minute was swallowed by the collision), and
--      they get re-pulled cleanly afterwards
--   3. makes intervalMinutes NOT NULL DEFAULT 5 — REQUIRED: Postgres treats NULLs
--      as distinct in a UNIQUE, so a nullable column here would silently permit
--      the very duplicates this constraint exists to prevent
--   4. adds the composite UNIQUE
--
-- ORDER MATTERS: this must run BEFORE the 5m re-pull of 2026-06-23→06-30, so the
-- re-pull lands on the repaired key space instead of colliding all over again.
-- The code fixes (upsertEsCandle + backfill script conflict targets) must ship
-- with it — an old conflict target against the new constraint is an error, not a
-- silent overwrite, so a stale container will fail loudly rather than corrupt.
--
-- BACKUP FIRST:
--   pg_dump "$DATABASE_URL" -t es_candles > /root/es_candles_backup_$(date +%F).sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1) Drop the slotKey-only UNIQUE. Column-level UNIQUE on a quoted camelCase
--    column is named "<table>_<column>_key" by Postgres.
ALTER TABLE es_candles DROP CONSTRAINT IF EXISTS "es_candles_slotKey_key";

-- 2) Clear the 1-minute rows. Re-pulled after the constraint is fixed.
DELETE FROM es_candles WHERE "intervalMinutes" = 1;

-- 3) No NULLs allowed in a UNIQUE member (see header).
UPDATE es_candles SET "intervalMinutes" = 5 WHERE "intervalMinutes" IS NULL;
ALTER TABLE es_candles ALTER COLUMN "intervalMinutes" SET DEFAULT 5;
ALTER TABLE es_candles ALTER COLUMN "intervalMinutes" SET NOT NULL;

-- 4) The real key. A 1m and a 5m bar may now share a slotKey.
ALTER TABLE es_candles
  ADD CONSTRAINT es_candles_slot_interval_key UNIQUE ("slotKey", "intervalMinutes");

-- Lookups filter by interval as well as slot.
CREATE INDEX IF NOT EXISTS idx_ec_interval_date ON es_candles("intervalMinutes", date);

COMMIT;

-- Verify (expect: only intervalMinutes=5 remains, and the new constraint exists):
--   SELECT "intervalMinutes", COUNT(*) FROM es_candles GROUP BY 1 ORDER BY 1;
--   SELECT conname FROM pg_constraint WHERE conrelid = 'es_candles'::regclass;
