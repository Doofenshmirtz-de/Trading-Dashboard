# Trading Bot Arena — Projektplan
> Zuletzt aktualisiert: 14. Mai 2026

---

## 1. Projekt-Status
**Phase 3 — Sandbox Engine (96% abgeschlossen)**
Live auf Vercel + Railway + Supabase. Bots laufen, generieren Signale und tracken Performance.
Offen: Abschluss-Monitoring und Bot-4-Strategiefeinschliff.

---

## 2. Kernziele
- Eine strukturierte **Multi-Bot Paper-Trading-Plattform** für Binance Futures
- Beliebig viele Bot-Instanzen laufen parallel mit virtuellem Kapital
- Strategien werden objektiv verglichen bevor echtes Geld eingesetzt wird
- **Du entscheidest — immer.** Kein blindes Kopieren, volle Transparenz

### Bot-Typen (geplant)
| Typ | Status |
|---|---|
| RSI (Rule Based) | ✅ Live |
| MACD | ✅ Implementiert |
| Bollinger Band | ✅ Implementiert |
| Copy Trading | ⚠️ UI vorhanden, keine Logik |
| ML/AI | 🔲 Phase 4 |
| Custom | 🔲 Phase 4 |

---

## 3. Aktuelle Dateistruktur

```
trading-bot-arena/
├── frontend/                          # Vite + React 18 + TypeScript + Tailwind
│   ├── src/
│   │   ├── components/
│   │   │   ├── auth/
│   │   │   │   ├── LoginForm.tsx      ✅
│   │   │   │   └── SignUpForm.tsx     ✅
│   │   │   ├── charts/
│   │   │   │   ├── EquityCurve.tsx    ✅
│   │   │   │   └── DrawdownChart.tsx  ✅
│   │   │   ├── layout/
│   │   │   │   ├── Navbar.tsx         ✅
│   │   │   │   └── ProtectedRoute.tsx ✅
│   │   │   ├── bots/
│   │   │   │   └── CreateBotModal.tsx ✅
│   │   │   ├── market/
│   │   │   │   └── RegimeWidget.tsx   ⚠️ (zeigt "Unknown")
│   │   │   └── ui/
│   │   │       ├── Toast.tsx          ✅
│   │   │       └── StatusBadge.tsx    ✅
│   │   ├── context/
│   │   │   └── AuthContext.tsx        ✅
│   │   ├── lib/
│   │   │   ├── supabase.ts            ✅
│   │   │   ├── api.ts                 ✅ (retry logic, JWT)
│   │   │   └── requestLog.ts          ✅
│   │   ├── pages/
│   │   │   ├── Login.tsx              ✅
│   │   │   ├── SignUp.tsx             ✅
│   │   │   └── dashboard/
│   │   │       ├── Dashboard.tsx      ✅
│   │   │       ├── Overview.tsx       ✅
│   │   │       ├── Bots.tsx           ✅
│   │   │       ├── BotDetail.tsx      ✅
│   │   │       ├── Markets.tsx        ✅
│   │   │       ├── Debug.tsx          ✅
│   │   │       └── Comparison.tsx     🔲 fehlt noch
│   │   └── types/
│   │       └── index.ts               ✅
│   ├── vercel.json                    ✅
│   └── .env.example                   ✅
│
├── backend/                           # FastAPI + Python 3.11
│   ├── app/
│   │   ├── main.py                    ✅ (APScheduler, lifespan)
│   │   ├── config.py                  ✅
│   │   ├── dependencies.py            ✅ (JWT Guard)
│   │   ├── routers/
│   │   │   ├── health.py              ✅ (latency_ms, last_error)
│   │   │   ├── bots.py                ✅ (CRUD + trades/snapshots/signals)
│   │   │   └── market.py              ✅ (pairs, candles, ticker, regime)
│   │   ├── models/
│   │   │   ├── bot.py                 ✅ (transitions, validation)
│   │   │   └── market.py              ✅
│   │   ├── services/
│   │   │   ├── supabase.py            ✅
│   │   │   ├── binance.py             ✅ (ccxt, 1h cache)
│   │   │   ├── bot_runner.py          ✅ (tick, start/stop, warm-up)
│   │   │   ├── bot_manager.py         ✅
│   │   │   └── regime_service.py      ⚠️ (ADX liefert "Unknown")
│   │   └── core/
│   │       ├── bot_base.py            ✅
│   │       ├── portfolio_engine.py    ✅ (slippage, fees)
│   │       ├── logging.py             ✅ (JSON structured)
│   │       ├── exceptions.py          ✅
│   │       └── bots/
│   │           ├── rsi_bot.py         ✅
│   │           ├── macd_bot.py        ✅
│   │           └── bollinger_bot.py   ✅
│   ├── tests/
│   │   ├── conftest.py                ✅
│   │   ├── test_health.py             ✅
│   │   ├── test_bots.py               ✅
│   │   └── test_market.py             ✅
│   ├── Dockerfile                     ✅
│   ├── railway.toml                   ✅
│   └── requirements.txt               ✅
│
└── README.md                          ✅
```

---

## 4. Erledigte Aufgaben

### Infrastruktur
- [x] Monorepo-Struktur (frontend/ + backend/)
- [x] Vercel Deploy (Frontend)
- [x] Railway Deploy (Backend FastAPI)
- [x] Supabase (Postgres + Auth + RLS)
- [x] Docker + railway.toml Konfiguration
- [x] Structured JSON Logging auf Railway
- [x] CORS korrekt konfiguriert

### Authentifizierung
- [x] Email + Passwort Auth via Supabase
- [x] AuthContext mit onAuthStateChange + Cleanup
- [x] ProtectedRoute mit Loading-State
- [x] Session-Persistenz (kein Flash auf Reload)
- [x] Redirect nach Login zur ursprünglichen Route
- [x] Passwort Show/Hide Toggle
- [x] Inline Error Messages (kein alert())

### Backend API
- [x] GET /health (Binance + Supabase latency + last_error)
- [x] JWT-Verifikation (python-jose, alle Endpoints geschützt)
- [x] Bot CRUD (GET, POST, PATCH, DELETE)
- [x] Status-Transition-Validierung (stopped→paused verboten)
- [x] GET /market/pairs (673 Binance Futures Pairs, 1h Cache)
- [x] GET /market/candles
- [x] GET /market/ticker
- [x] GET /market/regime (⚠️ gibt Unknown zurück)
- [x] GET /bots/{id}/trades
- [x] GET /bots/{id}/snapshots
- [x] GET /bots/{id}/signals
- [x] GET /bots/{id}/performance (Sharpe, Drawdown, Win Rate)

### Bot Engine
- [x] BaseBot abstrakte Klasse (on_candle, get_config_schema)
- [x] VirtualPortfolioEngine (Slippage 0.05%, Fee 0.04%, Position Sizing)
- [x] RSIBot (Wilder's RSI, Crossover-Logik, warm-up)
- [x] MACDBot (EMA from scratch, Signal Line Crossover)
- [x] BollingerBot (Population StdDev, Band Break Signals)
- [x] BotRunner (tick every 1min, start/stop, load on startup)
- [x] APScheduler Integration (max_instances=1)
- [x] Signale in bot_signals gespeichert
- [x] Trades in bot_trades gespeichert
- [x] Snapshots in bot_snapshots gespeichert

### Frontend Dashboard
- [x] Overview mit Stat Cards (Total Bots, Running, Stopped)
- [x] Recent Bots Liste
- [x] System Status Widget (Binance + Supabase latency)
- [x] Markets Page (673 Pairs, Live Ticker, Suche, Pagination)
- [x] Bots Page (Liste, Stop/Start, Delete, + New Bot Modal)
- [x] Bot Detail Page (PnL, Win Rate, Sharpe, Max DD)
- [x] Equity Curve Chart (recharts AreaChart, rot/grün)
- [x] Drawdown Chart (immer ≤ 0)
- [x] Signal Log (50 Signale, 60s auto-refresh)
- [x] Trade History (BUY/SELL Badges, PnL on SELL)
- [x] Debug Panel (Environment, Connection Tests, JWT Inspector,
      Request Log, Manual Endpoint Tester)
- [x] RegimeWidget auf Overview (⚠️ zeigt "Unknown")
- [x] CreateBotModal mit Config-Templates pro Bot-Typ

### Datenbank (Supabase)
- [x] bots Tabelle + RLS
- [x] bot_trades Tabelle + RLS
- [x] bot_snapshots Tabelle + RLS
- [x] bot_signals Tabelle + RLS (inkl. macd_value, bb_upper/lower)
- [x] updated_at Trigger auf bots

---

## 5. Offene To-dos (nächste 3 konkrete Schritte)

### Schritt 1 — Bot-4 Strategiefeinschliff (1m RSI) 🟡
**Problem:** Sehr hoher `hold`-Anteil (`1287/1438` in 24h), wenig Ausführungen.
**Ziel:** Trades qualitativ verbessern, ohne Overtrading zu erzeugen.
**Fix:**
- RSI-Parameter für 1m prüfen/kalibrieren (Schwellen + Period)
- Trade-Trigger gegen Position-State matchen
- 24h Vergleich vorher/nachher dokumentieren

### Schritt 2 — Restliche Snapshot-Ausreißer prüfen 🟡
**Status:** Für Bot 3 (`5cb9...`) bereits bereinigt + verifiziert.
**Offen:**
- Restliche Bots auf Alt-Ausreißer prüfen
- Bei Bedarf mit Backup-Tabelle gezielt bereinigen

### Schritt 3 — 24h Stabilitätsbeobachtung 🟢
**Ziel:** Phase-3-Abnahme mit Monitoring absichern.
**Checks:**
- Scheduler tickt durchgehend
- Snapshots kommen pro Timeframe erwartbar
- Keine neuen 500er bei Start/Stop

### Schritt 4 — `started_at` in Prod finalisieren 🔴 (abgeschlossen)
**Problem:** `PATCH /bots/{id}` schlug mit 500 fehl, wenn `started_at` im PostgREST Schema-Cache fehlte.
**Status:** ✅ SQL ausgeführt, Backfill erfolgreich, Start/Stop wieder stabil.
**Fix:**
- `ALTER TABLE ... ADD COLUMN started_at` in Supabase ausführen
- `NOTIFY pgrst, 'reload schema'` ausführen
- Start/Stop-Endpunkte danach aktiv verifizieren

---

## 6. Bekannte Probleme / Bugs

| # | Schwere | Problem | Wahrscheinliche Ursache | Status |
|---|---|---|---|---|
| 1 | 🟢 Behoben | `started_at` fehlte im Schema-Cache | PostgREST Cache nach Migration nicht aktualisiert | Behoben (Migration + Backfill + Reload) |
| 2 | 🟢 Behoben | Regime zeigt "Unknown" | ADX-Berechnung + Fallback waren unvollständig | Behoben |
| 3 | 🟡 Mittel | Bot 4: -32.92% PnL | Möglicherweise zu aggressives Trading bei 1m Timeframe mit engen RSI-Grenzen (45/55) | Erwartet, aber prüfen |
| 4 | 🟢 Behoben | "Time online: 0m" | `started_at` war null bei Alt-Bots | Behoben (Backfill ausgeführt) |
| 5 | 🟢 Behoben | Snapshot-Stopp seit 30. Apr. | Scheduler-Startup/Robustness unvollständig | Behoben |
| 6 | 🟢 Behoben | Comparison Dashboard fehlt | Noch nicht implementiert | Behoben |
| 7 | 🟢 Gering | Copy Trading Bot hat keine Logik | Placeholder-Status in DB, keine BotRunner-Implementierung | Bekannt, Phase 4 |

---

## 7. Architektur-Überblick

```
Vercel (React)  ←→  Railway (FastAPI)  ←→  Supabase (Postgres)
                         ↓
                  Binance API (ccxt)
                  APScheduler (1min tick)
                  BotRunner (in-memory)
```

### Tech Stack
| Bereich | Technologie |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind |
| Backend | Python 3.11 + FastAPI |
| Datenbank | Supabase (Postgres + Auth + RLS) |
| Exchange | ccxt + Binance Futures |
| Scheduler | APScheduler (in-process) |
| Charts | Recharts |
| Deployment | Vercel + Railway |

---

## 8. Phasen-Übersicht

| Phase | Name | Status |
|---|---|---|
| Phase 1 | Fundament (Auth, DB, Deployment) | ✅ Abgeschlossen |
| Phase 2 | Backend + Dashboard UI | ✅ Abgeschlossen |
| Phase 3 | Sandbox Engine + Vergleich | 🔄 96% — Monitoring + Bot-4-Feinschliff offen |
| Phase 4 | Erweiterte Analytik + ML Bot | 🔲 Geplant |
| Phase 5 | Live Trading | 🔲 Geplant (nach Phase 4) |

---

*Hinweis: `projektplan.md` ist der Master-Plan; `projektplan_heute.md` ist nur Tageslog/Arbeitsjournal.*
