import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginForm } from './LoginForm'

const { signInWithPassword } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
}))

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { signInWithPassword },
  },
}))

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginForm />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('LoginForm', () => {
  beforeEach(() => {
    signInWithPassword.mockReset()
    signInWithPassword.mockResolvedValue({ data: { user: {} }, error: null })
  })

  it('zeigt Validierungsfehler bei leerem Formular', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(
      await screen.findByText('Please enter a valid email address.')
    ).toBeInTheDocument()
    expect(
      await screen.findByText('Password must be at least 8 characters.')
    ).toBeInTheDocument()
  })

  it('ruft signInWithPassword mit gültigen Daten auf', async () => {
    const user = userEvent.setup()
    renderForm()
    await user.type(screen.getByLabelText('Email', { exact: true }), 'a@b.com')
    await user.type(
      screen.getByLabelText('Password', { exact: true }),
      'password1'
    )
    await user.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'a@b.com',
      password: 'password1',
    })
  })
})
