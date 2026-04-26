import { createRoot } from 'react-dom/client'
import './index.css'
import { isSupabaseEnvConfigured } from './config/env'

if (!isSupabaseEnvConfigured()) {
  createRoot(document.getElementById('root')!).render(
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6 flex items-center justify-center">
      <div className="max-w-lg text-center space-y-4">
        <h1 className="text-xl font-bold">Supabase-Konfiguration fehlt</h1>
        <p>
          Lege neben <code className="text-slate-200">package.json</code> (Ordner
          <code className="text-slate-200"> trading-bot-arena/frontend</code>) eine
          Datei <code className="text-amber-300">.env</code> oder{' '}
          <code className="text-amber-300">.env.local</code> an und setze{' '}
          <code className="text-amber-300">VITE_SUPABASE_URL</code> und{' '}
          <code className="text-amber-300">VITE_SUPABASE_ANON_KEY</code> (Vorlage:{' '}
          <code className="text-slate-200">.env.example</code>).
        </p>
        <p className="text-slate-400 text-sm">
          Werte: Supabase → Project Settings → API. Anschließend im Ordner
          <code className="text-slate-300"> frontend</code> den Vite-Dev-Server
          starten: <code className="text-slate-300">npm run dev</code> (nicht
          aus dem Eltern-Ordner, falls du bisher anders startest). Nach jeder
          Änderung an der Env-Datei: Server beenden (Ctrl+C) und neu starten.
        </p>
      </div>
    </div>
  )
} else {
  const root = document.getElementById('root')!
  root.style.minHeight = '100vh'
  root.style.backgroundColor = '#0f172a'

  void import('./mainApp').catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    createRoot(root).render(
      <div
        className="min-h-screen p-6 flex items-center justify-center"
        style={{ minHeight: '100vh', backgroundColor: '#0f172a', color: '#f1f5f9' }}
      >
        <div className="max-w-lg space-y-2 text-center">
          <h1 className="text-lg font-bold text-red-300">Fehler beim Laden der App</h1>
          <p className="text-slate-400 text-sm break-words">
            {message || 'Unbekannter Fehler. Konsole (F12) prüfen.'}
          </p>
          <p className="text-slate-500 text-xs">
            Tipp: Dev-Server mit <code className="text-slate-300">Ctrl+C</code> beenden,{' '}
            <code className="text-slate-300">rm -rf node_modules/.vite</code>, erneut{' '}
            <code className="text-slate-300">npm run dev</code> im Ordner{' '}
            <code className="text-slate-300">frontend</code>. Immer{' '}
            <code className="text-slate-300">http://localhost:5173</code> nutzen, nicht
            file://
          </p>
        </div>
      </div>
    )
  })
}
