import { Navigate } from 'react-router-dom'
import { SignUpForm } from '../components/auth/SignUpForm'
import { useAuth } from '../context/AuthContext'

export function SignUp() {
  const { user, loading } = useAuth()

  if (loading) {
    return null
  }
  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4 pt-16">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6 text-center">Create Account</h1>
        <SignUpForm />
      </div>
    </div>
  )
}
