import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function Dashboard() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-slate-900 pt-24 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">
          Welcome back, {user?.email}
        </h1>
        <p className="text-slate-400 mb-8">
          Trading Bot Arena — Dashboard coming soon
        </p>
        <button
          onClick={handleSignOut}
          className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2 transition-colors"
        >
          Sign Out
        </button>
      </div>
    </div>
  )
}
