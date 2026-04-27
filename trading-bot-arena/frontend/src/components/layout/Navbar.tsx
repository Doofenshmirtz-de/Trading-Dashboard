import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

const NAV_LINKS = [
  { to: '/dashboard', label: 'Overview' },
  { to: '/bots', label: 'Bots' },
  { to: '/markets', label: 'Markets' },
  { to: '/debug', label: '🛠', title: 'Debug' },
]

export function Navbar() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-slate-900 border-b border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-white font-bold text-lg tracking-tight shrink-0">
            Trading Bot Arena
          </Link>
          {user && (
            <div className="hidden sm:flex items-center gap-1">
              {NAV_LINKS.map(({ to, label, title }) => (
                <NavLink
                  key={to}
                  to={to}
                  title={title}
                  className={({ isActive }) =>
                    `px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-700 text-white'
                        : to === '/debug'
                          ? 'text-slate-600 hover:text-slate-400 hover:bg-slate-800'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4">
          {user ? (
            <>
              <span className="text-slate-400 text-sm truncate max-w-[200px] hidden sm:block">
                {user.email}
              </span>
              <button
                onClick={handleSignOut}
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <Link to="/login" className="text-slate-300 hover:text-white text-sm transition-colors">
                Login
              </Link>
              <Link
                to="/signup"
                className="bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2 text-sm transition-colors"
              >
                Sign Up
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
