import { useState, type FormEvent } from 'react'
import {
  useNavigate,
  Link,
  useLocation,
  type Location,
} from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getLoginAuthMessage } from '../../lib/authErrors'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validateEmailValue(email: string): string {
  if (!EMAIL_REGEX.test(email)) {
    return 'Please enter a valid email address.'
  }
  return ''
}

function validatePasswordValue(password: string): string {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.'
  }
  return ''
}

function PasswordToggleIcon({ visible }: { visible: boolean }) {
  if (visible) {
    return (
      <svg
        className="w-5 h-5 text-slate-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.29 3.29m0 0L3 3m3.29 3.29L3 3m0 0l18 18m-1.59-1.59L3 3"
        />
      </svg>
    )
  }
  return (
    <svg
      className="w-5 h-5 text-slate-400"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  )
}

export function LoginForm() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  function navigateAfterLogin() {
    const from = (location.state as { from?: Location } | null | undefined)
      ?.from
    if (
      from &&
      from.pathname &&
      from.pathname !== '/login' &&
      from.pathname !== '/signup'
    ) {
      navigate(
        { pathname: from.pathname, search: from.search, hash: from.hash },
        { replace: true }
      )
    } else {
      navigate('/dashboard', { replace: true })
    }
  }

  function handleEmailBlur() {
    setEmailError(validateEmailValue(email))
  }

  function handlePasswordBlur() {
    setPasswordError(validatePasswordValue(password))
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEmailError(validateEmailValue(email))
    setPasswordError(validatePasswordValue(password))
    if (!EMAIL_REGEX.test(email) || password.length < 8) {
      return
    }

    setLoading(true)
    setAuthError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        setAuthError(getLoginAuthMessage(error))
        return
      }
      navigateAfterLogin()
    } catch (err) {
      setAuthError(getLoginAuthMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setEmailError('')
            setAuthError('')
          }}
          onBlur={handleEmailBlur}
          className="w-full bg-slate-700 border border-slate-600 text-white placeholder:text-slate-400 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="you@example.com"
          autoComplete="email"
        />
        {emailError && (
          <p className="text-red-400 text-sm mt-1" role="alert">
            {emailError}
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setPasswordError('')
              setAuthError('')
            }}
            onBlur={handlePasswordBlur}
            className="w-full bg-slate-700 border border-slate-600 text-white placeholder:text-slate-400 rounded-lg pl-3 pr-11 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
            autoComplete="current-password"
          />
          <button
            type="button"
            className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            <PasswordToggleIcon visible={showPassword} />
          </button>
        </div>
        {passwordError && (
          <p className="text-red-400 text-sm mt-1" role="alert">
            {passwordError}
          </p>
        )}
      </div>

      {authError && (
        <p className="text-red-400 text-sm" role="alert">
          {authError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign In'}
      </button>

      <p className="text-center text-slate-400 text-sm">
        Don&apos;t have an account?{' '}
        <Link to="/signup" className="text-blue-400 hover:text-blue-300">
          Sign up
        </Link>
      </p>
    </form>
  )
}
