-- Phase 4: Backtesting Engine — backtest_runs table
-- Run this in Supabase SQL Editor

-- Create the backtest_runs table
CREATE TABLE IF NOT EXISTS backtest_runs (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name            TEXT         NOT NULL DEFAULT '',
    pair            TEXT         NOT NULL,
    timeframe       TEXT         NOT NULL,
    from_date       TEXT         NOT NULL,
    to_date         TEXT         NOT NULL,
    initial_balance NUMERIC(18, 8) NOT NULL DEFAULT 10000,
    config          JSONB        NOT NULL DEFAULT '{}',
    result          JSONB,                          -- equity_curve, trades, metrics
    total_trades    INTEGER,
    win_rate        NUMERIC(8, 4),
    pnl_pct         NUMERIC(12, 4),
    max_drawdown_pct NUMERIC(12, 4),
    sharpe_ratio    NUMERIC(8, 4),
    candle_count    INTEGER,
    status          TEXT         NOT NULL DEFAULT 'completed',
    error           TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- RLS: Users can only see their own backtest results
ALTER TABLE backtest_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own backtests"
    ON backtest_runs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users insert own backtests"
    ON backtest_runs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own backtests"
    ON backtest_runs FOR DELETE
    USING (auth.uid() = user_id);

-- Index for fast user-specific queries
CREATE INDEX IF NOT EXISTS backtest_runs_user_id_created_at
    ON backtest_runs (user_id, created_at DESC);

-- Notify PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
