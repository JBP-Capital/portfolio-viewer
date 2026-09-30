import { expect, test } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD } from './accounts.ts'

// Runs after 03-import.spec.ts: the admin has transactions by now.
test('switches the language and keeps the base currency fixed once transactions exist', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('link', { name: 'Settings' }).click()

  await expect(page.getByLabel('Base currency')).toBeDisabled()
  await page.getByLabel('Name').fill('Jim')
  await page.getByLabel('Language').selectOption('de')
  await page.getByRole('button', { name: 'Save settings' }).click()
  await expect(page.getByText('Einstellungen gespeichert.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Depots' })).toBeVisible()

  await page.getByLabel('Sprache').selectOption('en')
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click()
  await expect(page.getByText('Settings saved.')).toBeVisible()
  await expect(page.getByLabel('Name')).toHaveValue('Jim')
})
