-- Phase 3 Prompt D - started_at migration + data hygiene
-- Run in Supabase SQL Editor (production first, then staging if needed)

-- 1) Add started_at column for bot uptime tracking
ALTER TABLE bots
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- 2) Ensure PostgREST picks up schema changes quickly
NOTIFY pgrst, 'reload schema';

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
