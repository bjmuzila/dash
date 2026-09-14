-- ─────────────────────────────────────────────────────────────────────────────
-- migrate-es-candles-contract-key.sql            2026-09-14
--
-- Add `contract` to es_candles and widen the UNIQUE key onto it.
--
-- WHY
-- ---
-- es_candles had no idea which future a bar came off. `symbol` was the literal
-- string '/ES' on every row — set once, in the dxLink Candle handler, and never
-- derived from the contract actually subscribed. So across a quarterly roll the
-- table accumulated bars from two contracts trading ~30-40pt apart, in one
-- series, with nothing to tell them apart.
--
-- Two separate failures came out of that:
--
--   1. The chart drew the roll as a cliff and autoscaled the pane around it.
--   2. Worse and quieter: the UNIQUE key was ("slotKey","intervalMinutes"), so
--      the incoming contract's 09:30 bar UPSERTED OVER the outgoing contract's
--      09:30 bar on any session where both were recorded. The old bar was not
--      just mixed in, it was destroyed.
--
-- SAFETY
-- ------
-- Widening a unique key can never create a conflict — it only makes the key
-- less restrictive — so this migration cannot fail on existing data and needs
-- no de-duplication pass. Existing rows get contract = '' ("some pre-migration
-- front contract, unknowable"), which is why the column is NOT NULL DEFAULT ''
-- rather than nullable: NULL never compares equal to NULL in a UNIQUE
-- constraint, so a nullable column would silently stop deduplicating every one
-- of those rows.
--
-- Idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

ALTER TABLE es_candles
  ADD COLUMN IF NOT EXISTS contract TEXT NOT NULL DEFAULT '';

-- The old key, by either name it may carry. The original CREATE named it
-- es_candles_slot_interval_key; a DB migrated by hand may have the Postgres
-- default es_candles_slotKey_intervalMinutes_key instead.
ALTER TABLE es_candles DROP CONSTRAINT IF EXISTS es_candles_slot_interval_key;
ALTER TABLE es_candles DROP CONSTRAINT IF EXISTS "es_candles_slotKey_intervalMinutes_key";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'es_candles_slot_interval_contract_key'
  ) THEN
    ALTER TABLE es_candles
      ADD CONSTRAINT es_candles_slot_interval_contract_key
      UNIQUE ("slotKey", "intervalMinutes", contract);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ec_contract_interval_date
  ON es_candles(contract, "intervalMinutes", date);

COMMIT;

-- Verify:
--   SELECT contract, "intervalMinutes", COUNT(*), MIN(date), MAX(date)
--     FROM es_candles GROUP BY 1,2 ORDER BY 4;
--
-- Immediately after this runs every row is contract=''. New bars carry the real
-- code (/ESZ6, …) from the first flush after the server restarts, and the
-- chart's ?contract=latest follows them.
