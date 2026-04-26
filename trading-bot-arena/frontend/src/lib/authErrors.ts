import type { AuthError } from '@supabase/supabase-js'

function isNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: string }).name
    if (
      name === 'AuthRetryableFetchError' ||
      name === 'TypeError' ||
      name === 'NetworkError'
    ) {
      return true
    }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message: string }).message)
    if (message.includes('Network') || message.includes('Failed to fetch')) {
      return true
    }
  }
  return false
}

function getMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as AuthError).message)
  }
  return String(error)
}

const NETWORK_MESSAGE =
  'Connection error. Please check your internet and try again.'

const INVALID_LOGIN_MESSAGE =
  'Incorrect email or password. Please try again.'

const WEAK_PASSWORD_MESSAGE = 'Password must be at least 8 characters.'

/**
 * User-facing string for failed login. Maps common Supabase cases; otherwise returns raw message.
 */
export function getLoginAuthMessage(error: unknown): string {
  if (isNetworkError(error)) {
    return NETWORK_MESSAGE
  }
  const message = getMessage(error)
  if (
    /invalid.*credentials/i.test(message) ||
    /invalid login credentials/i.test(message)
  ) {
    return INVALID_LOGIN_MESSAGE
  }
  return message
}

export type SignUpErrorDisplay =
  | { type: 'already_registered' }
  | { type: 'message'; text: string }

/**
 * Resolves what to show after a failed sign-up (and whether to render the "sign in" link).
 */
export function getSignUpErrorDisplay(error: unknown): SignUpErrorDisplay {
  if (isNetworkError(error)) {
    return { type: 'message', text: NETWORK_MESSAGE }
  }
  const message = getMessage(error)
  if (message === 'User already registered' || /already registered/i.test(message)) {
    return { type: 'already_registered' }
  }
  if (
    /Password should be at least/i.test(message) ||
    /password is too short/i.test(message) ||
    /weak.*password/i.test(message) ||
    /Password.*6.*characters/.test(message)
  ) {
    return { type: 'message', text: WEAK_PASSWORD_MESSAGE }
  }
  return { type: 'message', text: message }
}
