import { expect, test, type Page } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD, STRANGER_EMAIL } from './accounts.ts'

// Needs a fresh instance: `docker compose down -v && docker compose up -d --build` in deploy/.
test.describe.configure({ mode: 'serial' })

const run = process.env.E2E_RUN ?? 'local'

async function signUp(page: Page, email: string) {
  await page.goto('/login?mode=signup')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create account' }).click()
}

test('every page links to the source code', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('link', { name: /Source code \(AGPL-3\.0\)/ })).toHaveAttribute('href', 'https://github.com/JBP-Capital/portfolio-viewer')
})

test('the first account becomes admin and can create a portfolio', async ({ page, context }) => {
  await signUp(page, ADMIN_EMAIL)
  await expect(page.getByText('Admin', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
  const sessionCookies = (await context.cookies()).filter((c) => c.name.startsWith('pv-auth'))
  expect(sessionCookies.length).toBeGreaterThan(0)
  expect(sessionCookies.every((c) => c.httpOnly)).toBe(true)
  await page.getByLabel('Portfolio name').fill('Main depot')
  await page.getByRole('button', { name: 'Create portfolio' }).click()
  await expect(page.getByRole('listitem').filter({ hasText: 'Main depot' })).toBeVisible()
})

test('an account that was not invited sees the no-access page', async ({ page }) => {
  await signUp(page, STRANGER_EMAIL)
  await expect(page.getByRole('heading', { name: 'No access yet' })).toBeVisible()
  await expect(page.getByText('Main depot')).toHaveCount(0)
})

test('the login service is not reachable from outside except for e-mail links', async ({ request }) => {
  const signup = await request.post('/auth/v1/signup', { data: { email: `direct-${run}@example.com`, password: PASSWORD } })
  expect(signup.status()).toBe(404)
  const token = await request.post('/auth/v1/token?grant_type=password', { data: { email: ADMIN_EMAIL, password: 'x' } })
  expect(token.status()).toBe(404)
})

test('password guessing is stopped after 10 failed attempts', async ({ page }) => {
  // A separate address: the throttle must not lock the admin out of the following specs.
  for (let attempt = 0; attempt < 11; attempt += 1) {
    await page.goto('/login')
    await page.getByLabel('Email').fill(`guessed-${run}@example.com`)
    await page.getByLabel('Password').fill(`wrong-guess-${attempt}`)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/error=/)
  }
  await expect(page.getByText('Too many failed attempts for this address')).toBeVisible()
})

test('the health endpoint identifies the app', async ({ request }) => {
  const response = await request.get('/api/health')
  expect(response.ok()).toBe(true)
  expect(await response.json()).toMatchObject({ app: 'portfolio-viewer', database: 'ok' })
})
