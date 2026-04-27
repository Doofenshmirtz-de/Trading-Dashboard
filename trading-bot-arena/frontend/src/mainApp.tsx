import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider, useToast } from './components/ui/Toast'
import { queryClient } from './lib/queryClient'
import { registerToastCallback, registerUnauthorizedHandler } from './lib/api'
import { supabase } from './lib/supabase'

function AppWithProviders() {
  const { show } = useToast()
  registerToastCallback(show)

  // On 401: soft sign-out → onAuthStateChange fires → user = null
  // → ProtectedRoute redirects to /login (no hard reload, no loop)
  registerUnauthorizedHandler(() => {
    void supabase.auth.signOut()
  })

  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <AppWithProviders />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
