# Trading Bot Arena — Tageslog (14. Mai 2026)
> Arbeitsjournal für heutige Änderungen.
> Der vollständige Master-Plan liegt in `projektplan.md`.

---

## Aktueller Gesamtstatus

**Phase 3 (Sandbox Engine): ~90%**

**Live-Stack:** Vercel (Frontend) + Railway (Backend) + Supabase (DB/Auth)

### Stand heute
- Scheduler läuft wieder und tickt minütlich.
- Regime-Service liefert wieder valide Regime-Werte.
- Comparison Dashboard ist implementiert.
- Kritische Restpunkte: DB-Migration `started_at` live ausrollen + Datenbereinigung alter Snapshot-Ausreißer.

---

## Fortschritts-Log (laufend aktualisieren)

### 2026-05-14 (spät)

#### Backend
- `FastAPI lifespan` + Scheduler-Hardening aktiv.
- `/debug/tick-status` und `/debug/trigger-tick` hinzugefügt.
- Tick-Loop robust gegen Bot-Fehler gemacht.
- Regime-ADX-Berechnung ersetzt (Wilder smoothing, validierter Ablauf).
- Performance-PnL auf Snapshot-Basis vereinheitlicht.
- **Fix Stop-Bug vorbereitet:** Fallback eingebaut, wenn `started_at` noch nicht im Supabase-Schema-Cache verfügbar ist.

#### Frontend
- Equity Curve: Timeframe-Buttons 1D / 1W / 1M / ALL.
- Drawdown-Achse gepolstert (kein Abschneiden mehr).
- X-Achsen-Tick-Dichte verbessert.
- Stale-Data-Warnung eingebaut.
- BotDetail: „Time online“ auf `started_at` umgestellt.
- Comparison Dashboard (Tabelle, Chart, Korrelation) eingebaut.

#### Neu aus aktuellem Incident (Logs)
- **Stoppen von Bots schlug fehl (`PATCH /bots/{id}` 500)** wegen:
  - `PGRST204: started_at column missing in schema cache`
- **Fix im Code:** defensive Retry-Logik ohne `started_at`, damit Statuswechsel nicht mehr blockiert.
- **Chart-Bug (nur 1W realistisch):** Backend-Snapshot-Endpoint auf echtes Zeitfenster umgestellt (rolling window statt nur „letzte N Reihen“), plus Ausreißer-Filter für alte korrupte Snapshot-Werte.
- **Outlier-Serie bestätigt:** Bot `5cb9fb52-2444-4bff-b271-b09c1c69bb6a` hatte historische Snapshots mit `pnl_pct ~900%` und `total_value ~100000` (Datenkorruption April 2026).
- **SQL-Cleanup erweitert:** Backup-Tabelle + gezieltes Löschen der Outlier-Snapshots für den betroffenen Bot ergänzt.
- **Cleanup durchgeführt & verifiziert:** Für Bot `5cb9fb52-2444-4bff-b271-b09c1c69bb6a` sind nur noch realistische Snapshots vorhanden (ca. +13% bis +16%, `snapshots_left=338`, keine 900%-Werte mehr).
- **started_at-Backfill ergänzt:** SQL enthält jetzt Backfill für laufende Bots (`started_at IS NULL`), um „Time online“ sofort korrekt anzuzeigen.

---

## Offene Aufgaben (Priorität)

### P0 — Sofort
- [x] Supabase-Migration für `started_at` in Produktion ausführen
- [x] PostgREST Schema-Cache nach Migration reloaden
- [x] Verifizieren: Bot Stop/Start ohne 500er

### P1 — Datenqualität
- [~] Alte korrupte Snapshot-/Balance-Werte bereinigen (für Bot `5cb9...` erledigt und verifiziert; Restbots weiter prüfen)
- [ ] Bot 4/3 historisch prüfen (negative Balance / Ausreißer)

### P2 — Stabilität
- [ ] Beobachten, ob alle laufenden Bots weiterhin Snapshots/Trades schreiben
- [ ] Railway Logs: Tick jede Minute + keine Scheduler-Error-Spikes

---

## Operative SQL-Kommandos (Prod)

```sql
-- 1) started_at Spalte anlegen (idempotent)
ALTER TABLE bots
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- 2) PostgREST Schema-Cache reload
NOTIFY pgrst, 'reload schema';

-- 3) Korrupt hohe Balances zurücksetzen
UPDATE bots
SET virtual_balance = initial_balance,
    updated_at = NOW()
WHERE virtual_balance > 100000
  AND initial_balance <= 10000;

-- 4) Prüfen, ob wieder neue Snapshots ankommen
SELECT bot_id, MAX(timestamp) AS latest_snapshot
FROM bot_snapshots
GROUP BY bot_id
ORDER BY latest_snapshot DESC;
```

---

## Ergebnis heute

- [x] Bots lassen sich wieder zuverlässig starten/stoppen (ohne 500).
- [x] Equity Curve zeigt nach Cleanup realistische Verläufe.
- [x] Scheduler tickt stabil und schreibt kontinuierlich Snapshots.
- [x] Keine kritischen TypeScript-Fehler in den geänderten Komponenten.

Offen für morgen:
- Bot-4-Parameterfeinschliff (hoher Hold-Anteil auf 1m).
- 24h Monitoring zur finalen Phase-3-Abnahme.

