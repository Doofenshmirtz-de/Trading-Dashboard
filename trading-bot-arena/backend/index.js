import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { createClient } from '@supabase/supabase-js'

const app = express()
const PORT = process.env.PORT || 8000

// ── Supabase (service role – nur serverseitig!) ────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }))
app.use(express.json())

// JWT aus dem Authorization-Header extrahieren und validieren
function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const token = header.slice(7)
  try {
    const decoded = jwt.verify(token, process.env.SUPABASE_JWT_SECRET)
    req.userId = decoded.sub
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Bots ───────────────────────────────────────────────────────────────────

// GET /bots – alle Bots des eingeloggten Users
app.get('/bots', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('bots')
    .select('*')
    .eq('user_id', req.userId)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /bots – neuen Bot erstellen
app.post('/bots', requireAuth, async (req, res) => {
  const { name, strategy, config } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const { data, error } = await supabase
    .from('bots')
    .insert({ user_id: req.userId, name, strategy: strategy ?? 'manual', config: config ?? {} })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

// GET /bots/:id – einzelnen Bot
app.get('/bots/:id', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('bots')
    .select('*')
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .single()

  if (error) return res.status(404).json({ error: 'Bot not found' })
  res.json(data)
})

// PATCH /bots/:id – Bot aktualisieren
app.patch('/bots/:id', requireAuth, async (req, res) => {
  const allowed = ['name', 'strategy', 'status', 'config', 'pnl']
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  )
  updates.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('bots')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.userId)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// DELETE /bots/:id – Bot löschen
app.delete('/bots/:id', requireAuth, async (req, res) => {
  const { error } = await supabase
    .from('bots')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId)

  if (error) return res.status(500).json({ error: error.message })
  res.status(204).send()
})

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Trading Bot Arena API running on port ${PORT}`)
})
