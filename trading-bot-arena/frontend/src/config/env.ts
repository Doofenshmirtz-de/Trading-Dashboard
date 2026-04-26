/**
 * Vite ersetzt nur Variablen mit Präfix VITE_ aus der passenden .env-Datei
 * (liegt neben package.json, Dev-Server nach Änderung neu starten).
 */
function asTrimmedString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value.trim()
}

export function isSupabaseEnvConfigured(): boolean {
  const url = asTrimmedString(import.meta.env.VITE_SUPABASE_URL)
  const key = asTrimmedString(import.meta.env.VITE_SUPABASE_ANON_KEY)
  return url.length > 0 && key.length > 0
}
