import { expect, test, type Page } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD } from './accounts.ts'

const FRIEND = `friend-${process.env.E2E_RUN ?? 'local'}@example.com`

test.describe.configure({ mode: 'serial' })

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

let link = ''

test('an administrator creates a one-time invite link', async ({ page }) => {
  await signIn(page, ADMIN_EMAIL)
  await page.getByRole('link', { name: 'Admin' }).click()
  await page.getByLabel('E-mail address').fill(FRIEND)
  await page.getByRole('button', { name: 'Create invite link' }).click()
  link = (await page.getByTestId('invite-link').textContent()) ?? ''
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/)
  await expect(page.getByTestId('member-row').filter({ hasText: FRIEND })).toContainText('Invited')
})

test('a new account joins through the link, which then no longer works', async ({ page, browser }) => {
  await page.goto(link)
  await page.getByRole('link', { name: 'Create account' }).click()
  await page.getByLabel('Email').fill(FRIEND)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page.getByRole('heading', { name: 'Portfolios' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0)

  // A member who is not an administrator is sent away from /admin.
  await page.goto('/admin')
  await expect(page).toHaveURL(/\/$/)

  // The same link a second time, by someone else.
  const other = await browser.newContext()
  const stranger = await other.newPage()
  await stranger.goto(link)
  await stranger.getByRole('link', { name: 'Create account' }).click()
  await stranger.getByLabel('Email').fill(`late-${process.env.E2E_RUN ?? 'local'}@example.com`)
  await stranger.getByLabel('Password').fill(PASSWORD)
  await stranger.getByRole('button', { name: 'Create account' }).click()
  await stranger.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(stranger.getByText('This invite link is invalid or has expired. Ask for a new one.')).toBeVisible()
  await stranger.goto('/')
  await expect(stranger).toHaveURL(/no-access/)
  await other.close()
})

test('a member deletes their own account', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept())
  await signIn(page, FRIEND)
  await page.getByRole('link', { name: 'Settings' }).click()
  await page.getByLabel(`Type ${FRIEND} to confirm`).fill(FRIEND)
  await page.getByRole('button', { name: 'Delete account for good' }).click()
  await expect(page.getByText('Your account and all its data have been deleted.')).toBeVisible()

  // The login is gone too.
  await signIn(page, FRIEND)
  await expect(page.getByText('Email or password is wrong.')).toBeVisible()

  await signIn(page, ADMIN_EMAIL)
  await page.getByRole('link', { name: 'Admin' }).click()
  await expect(page.getByTestId('member-row').filter({ hasText: FRIEND })).toHaveCount(0)
})
