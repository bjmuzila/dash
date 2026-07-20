-- Run on the VPS Postgres AFTER deploying the code that stops the recorder.
-- Removes both vol-pin tables so they disappear from the /database page.
DROP TABLE IF EXISTS vol_pin_events;
DROP TABLE IF EXISTS vol_pin_snapshots;
