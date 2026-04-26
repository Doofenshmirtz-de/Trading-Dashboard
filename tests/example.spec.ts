import { test, expect } from '@playwright/test'

test('Login-Seite nutzt baseURL', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
})

test('Start leitet unangemeldet zur Anmeldung', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible()
})
