import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider, useToast } from './components/ui/Toast'
import { queryClient } from './lib/queryClient'
import { registerToastCallback } from './lib/api'

function AppWithToast() {
  const { show } = useToast()
  registerToastCallback(show)
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <AppWithToast />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
)
