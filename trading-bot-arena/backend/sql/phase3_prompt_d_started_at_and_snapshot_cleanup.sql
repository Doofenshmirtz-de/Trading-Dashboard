-- Phase 3 Prompt D - started_at migration + data hygiene
-- Run in Supabase SQL Editor (production first, then staging if needed)

-- 1) Add started_at column for bot uptime tracking
ALTER TABLE bots
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- 2) Ensure PostgREST picks up schema changes quickly
NOTIFY pgrst, 'reload schema';

-- 2b) Backfill started_at for already running bots (once)
-- Uses updated_at as best-available proxy when historical start time is unknown.
UPDATE bots
SET started_at = COALESCE(started_at, updated_at, NOW())
WHERE status = 'running'
  AND started_at IS NULL;

-- 3) Reset obviously corrupted balances
UPDATE bots
SET virtual_balance = initial_balance,
    updated_at = NOW()
WHERE virtual_balance > 100000
  AND initial_balance <= 10000;

-- 4) Inspect possibly corrupted snapshots
-- (review first before deletion)
SELECT bot_id, timestamp, pnl_pct, total_value
FROM bot_snapshots
WHERE ABS(pnl_pct) > 250
ORDER BY timestamp ASC;

-- 5) Backup + targeted cleanup for known outlier series
-- Affected bot from incident:
-- 5cb9fb52-2444-4bff-b271-b09c1c69bb6a
--
-- 5a) Backup suspicious rows into a safety table (idempotent create)
CREATE TABLE IF NOT EXISTS bot_snapshots_outlier_backup AS
SELECT *
FROM bot_snapshots
WHERE FALSE;

INSERT INTO bot_snapshots_outlier_backup
SELECT s.*
FROM bot_snapshots s
JOIN bots b ON b.id = s.bot_id
WHERE s.bot_id = '5cb9fb52-2444-4bff-b271-b09c1c69bb6a'
  AND (
    ABS(s.pnl_pct) > 250
    OR s.total_value > (b.initial_balance * 5)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM bot_snapshots_outlier_backup bkp
    WHERE bkp.id = s.id
  );

-- 5b) Verify what would be removed
SELECT id, bot_id, timestamp, pnl_pct, total_value
FROM bot_snapshots
WHERE bot_id = '5cb9fb52-2444-4bff-b271-b09c1c69bb6a'
  AND ABS(pnl_pct) > 250
ORDER BY timestamp ASC;

-- 5c) Remove outlier snapshots
DELETE FROM bot_snapshots
WHERE bot_id = '5cb9fb52-2444-4bff-b271-b09c1c69bb6a'
  AND ABS(pnl_pct) > 250;

-- 5d) Post-delete verification
SELECT bot_id, MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts, COUNT(*) AS snapshots_left
FROM bot_snapshots
WHERE bot_id = '5cb9fb52-2444-4bff-b271-b09c1c69bb6a'
GROUP BY bot_id;
