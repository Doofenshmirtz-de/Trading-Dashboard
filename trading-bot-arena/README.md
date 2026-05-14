# Trading Bot Arena

A crypto trading bot testing platform built with React, TypeScript, Vite, Tailwind CSS, and Supabase.

## Projektplan (Main Bauplan)

Der zentrale Fortschritts- und Maßnahmenplan liegt im Repository-Root:

- `../projektplan.md`

Bitte bei jeder größeren Änderung den Plan mit aktualisieren (Status, offene Punkte, nächste Schritte).

## Stack

- **Frontend**: Vite + React 18 + TypeScript (strict)
- **Styling**: Tailwind CSS v3
- **Auth & Database**: Supabase
- **Routing**: React Router v6
- **Deployment**: Vercel

## Getting Started

```bash
cd frontend
npm install
cp .env.example .env.local   # then fill in your Supabase credentials
npm run dev
```

## Environment Variables

See `frontend/.env.example` for required variables.

Get your credentials from: [Supabase Dashboard](https://supabase.com/dashboard) → Project Settings → API
