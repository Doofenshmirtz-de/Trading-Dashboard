import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export interface AuthContextType {
  user: User | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    let subscription: { unsubscribe: () => void } | null = null

    const init = async () => {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (cancelled) {
          return
        }
        if (error) {
          setUser(null)
        } else {
          setUser(data.session?.user ?? null)
        }
      } catch {
        if (!cancelled) {
          setUser(null)
        }
      }

      if (cancelled) {
        return
      }

      try {
        const { data: listener } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (cancelled) {
              return
            }
            setUser(session?.user ?? null)
          }
        )
        subscription = listener.subscription
        if (cancelled) {
          listener.subscription.unsubscribe()
        }
      } catch {
        if (!cancelled) {
          setUser(null)
        }
      }
    }

    void init().finally(() => {
      if (!cancelled) {
        setLoading(false)
      }
    })

    return () => {
      cancelled = true
      subscription?.unsubscribe()
    }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await supabase.auth.signOut()
    } catch {
      // Session-Update folgt über onAuthStateChange
    }
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {loading ? (
        <div
          className="flex items-center justify-center min-h-screen"
          style={{ minHeight: '100vh', backgroundColor: '#0f172a' }}
        >
          <div
            className="w-8 h-8 border-t-2 border-blue-500 rounded-full animate-spin"
            aria-label="Laden"
            role="status"
          />
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
