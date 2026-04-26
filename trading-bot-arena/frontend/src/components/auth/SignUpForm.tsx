import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { getSignUpErrorDisplay } from '../../lib/authErrors'

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

function validateConfirmValue(password: string, confirm: string): string {
  if (password !== confirm) {
    return 'Passwords do not match.'
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

export function SignUpForm() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailError, setEmailError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [confirmPasswordError, setConfirmPasswordError] = useState('')
  const [authError, setAuthError] = useState('')
  const [alreadyRegistered, setAlreadyRegistered] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  function handleEmailBlur() {
    setEmailError(validateEmailValue(email))
  }

  function handlePasswordBlur() {
    setPasswordError(validatePasswordValue(password))
    setConfirmPasswordError(
      validateConfirmValue(password, confirmPassword)
    )
  }

  function handleConfirmBlur() {
    setConfirmPasswordError(
      validateConfirmValue(password, confirmPassword)
    )
  }

  function validateForm(): boolean {
    const e = validateEmailValue(email)
    const p = validatePasswordValue(password)
    const c = validateConfirmValue(password, confirmPassword)
    setEmailError(e)
    setPasswordError(p)
    setConfirmPasswordError(c)
    return !e && !p && !c
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setAlreadyRegistered(false)
    if (!validateForm()) {
      return
    }

    setLoading(true)
    setAuthError('')
    try {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) {
        const display = getSignUpErrorDisplay(error)
        if (display.type === 'already_registered') {
          setAlreadyRegistered(true)
        } else {
          setAuthError(display.text)
        }
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const display = getSignUpErrorDisplay(err)
      if (display.type === 'already_registered') {
        setAlreadyRegistered(true)
      } else {
        setAuthError(display.text)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label
          htmlFor="signup-email"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setEmailError('')
            setAuthError('')
            setAlreadyRegistered(false)
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
          htmlFor="signup-password"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Password
        </label>
        <div className="relative">
          <input
            id="signup-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setPasswordError('')
              setAuthError('')
              setAlreadyRegistered(false)
            }}
            onBlur={handlePasswordBlur}
            className="w-full bg-slate-700 border border-slate-600 text-white placeholder:text-slate-400 rounded-lg pl-3 pr-11 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
            autoComplete="new-password"
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

      <div>
        <label
          htmlFor="confirmPassword"
          className="block text-sm font-medium text-slate-300 mb-1"
        >
          Confirm Password
        </label>
        <div className="relative">
          <input
            id="confirmPassword"
            name="confirmPassword"
            type={showConfirm ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setConfirmPasswordError('')
              setAuthError('')
              setAlreadyRegistered(false)
            }}
            onBlur={handleConfirmBlur}
            className="w-full bg-slate-700 border border-slate-600 text-white placeholder:text-slate-400 rounded-lg pl-3 pr-11 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="••••••••"
            autoComplete="new-password"
          />
          <button
            type="button"
            className="absolute right-0 top-1/2 -translate-y-1/2 p-2 rounded-md hover:bg-slate-600/50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            onClick={() => setShowConfirm((s) => !s)}
            aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
          >
            <PasswordToggleIcon visible={showConfirm} />
          </button>
        </div>
        {confirmPasswordError && (
          <p className="text-red-400 text-sm mt-1" role="alert">
            {confirmPasswordError}
          </p>
        )}
      </div>

      {alreadyRegistered && (
        <p className="text-amber-400 text-sm" role="alert">
          An account with this email already exists.{' '}
          <Link
            to="/login"
            className="text-blue-400 hover:text-blue-300 underline font-medium"
          >
            Sign in instead
          </Link>
        </p>
      )}

      {authError && !alreadyRegistered && (
        <p className="text-red-400 text-sm" role="alert">
          {authError}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-50"
      >
        {loading ? 'Creating account...' : 'Create Account'}
      </button>

      <p className="text-center text-slate-400 text-sm">
        Already have an account?{' '}
        <Link to="/login" className="text-blue-400 hover:text-blue-300">
          Sign in
        </Link>
      </p>
    </form>
  )
}
