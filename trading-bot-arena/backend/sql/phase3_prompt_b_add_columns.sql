-- Phase 3 Prompt B: Erweiterte Spalten für bot_signals
-- Fügt Spalten für MACD und Bollinger Bands hinzu
-- Sicher für bestehende Daten (NULL erlaubt)

-- Zuerst: Prüfe ob bot_signals existiert
-- Wenn nicht, sollte die Tabelle zuerst erstellt werden (aus phase3_prompt_a.sql)

-- MACD Spalten
ALTER TABLE bot_signals
ADD COLUMN IF NOT EXISTS macd_value NUMERIC(20, 8);

-- Bollinger Bands Spalten
ALTER TABLE bot_signals
ADD COLUMN IF NOT EXISTS bb_lower NUMERIC(20, 8);

ALTER TABLE bot_signals
ADD COLUMN IF NOT EXISTS bb_upper NUMERIC(20, 8);

ALTER TABLE bot_signals
ADD COLUMN IF NOT EXISTS bb_position TEXT;

-- Index für schnelle Abfragen nach Indikator-Typ (optional, falls Filter nach MACD/BB gewünscht)
-- CREATE INDEX IF NOT EXISTS idx_bot_signals_macd ON bot_signals(macd_value) WHERE macd_value IS NOT NULL;
-- CREATE INDEX IF NOT EXISTS idx_bot_signals_bb ON bot_signals(bb_position) WHERE bb_position IS NOT NULL;

-- Bestätigung: Zeige aktuelle Struktur
-- \d bot_signals

COMMENT ON COLUMN bot_signals.macd_value IS 'MACD Line Wert bei Signal-Generation (nur bei MACD Bots)';
COMMENT ON COLUMN bot_signals.bb_lower IS 'Bollinger Lower Band bei Signal-Generation (nur bei Bollinger Bots)';
COMMENT ON COLUMN bot_signals.bb_upper IS 'Bollinger Upper Band bei Signal-Generation (nur bei Bollinger Bots)';
COMMENT ON COLUMN bot_signals.bb_position IS 'Position relativ zu Bollinger Bands: below_lower, above_upper, within';
