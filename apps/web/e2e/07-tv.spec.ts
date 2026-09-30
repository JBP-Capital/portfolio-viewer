import { expect, test, type Page } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD } from './accounts.ts'

// Runs after 02-input.spec.ts: the admin holds priced securities. The TV is a second browser
// without a sign-in.
async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Portfolios' })).toBeVisible()
}

test('a TV pairs with a code, shows the portfolios read-only and stops once removed', async ({ page, browser }) => {
  const tvContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
  const tv = await tvContext.newPage()
  await tv.goto('/tv')
  const shownCode = tv.getByTestId('pairing-code')
  await expect(shownCode).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)
  const code = (await shownCode.textContent())!
  const name = `Living room ${Date.now() % 100_000}`

  await signIn(page)
  await page.goto('/pair')
  // Typed the way people type it: lower case, with the dash.
  await page.getByLabel('Code on the TV').fill(code.toLowerCase())
  await page.getByLabel('Device name').fill(name)
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.getByText('The TV is paired.')).toBeVisible()

  await expect(tv.getByTestId('tv-scene')).toHaveText('Overview', { timeout: 20_000 })
  await expect(tv.locator('[data-ready="true"]')).toBeVisible()
  await expect(tv.getByTestId('tv-total')).toHaveText(/\d/)
  await tv.keyboard.press('ArrowRight')
  await expect(tv.getByTestId('tv-scene')).not.toHaveText('Overview')
  // After a key the screen holds for a minute, and the progress bar runs over that whole minute.
  const duration = () => tv.locator('.tv-progress').evaluate((bar) => (bar as HTMLElement).style.animationDuration)
  // The new scene can paint once with the previous step's bar before the new step starts.
  await expect.poll(async () => Number.parseInt(await duration())).toBeGreaterThanOrEqual(59_000)
  const first = await duration()
  await tv.waitForTimeout(2500)
  expect(await duration()).toBe(first)
  await tv.keyboard.press('1')
  await expect(tv.getByTestId('tv-scene')).toHaveText('Overview')
  await tv.keyboard.press('0')
  await expect(tv.getByTestId('tv-private')).toBeVisible()
  await expect(tv.getByTestId('tv-total')).toHaveText('•••')
  await tv.keyboard.press('0')

  // On a card scene OK marks a card and opens its detail; OK goes back to the card, Back to the running scene.
  for (let i = 0; i < 6 && !(await tv.getByTestId('tv-scene').textContent())?.startsWith('Holdings'); i += 1) await tv.keyboard.press('ArrowRight')
  await expect(tv.getByTestId('tv-scene')).toHaveText(/^Holdings/)
  const marked = tv.getByTestId('tv-marked')
  await tv.keyboard.press('Enter')
  await expect(marked).toBeVisible()
  await tv.keyboard.press('Escape')
  await expect(marked).toHaveCount(0)
  await tv.keyboard.press('Enter')
  const security = (await marked.locator('p').first().textContent())!
  await tv.keyboard.press('Enter')
  const detail = tv.getByTestId('tv-detail')
  await expect(detail.getByRole('heading', { name: security })).toBeVisible()
  await expect(detail.getByRole('img', { name: 'Price over one year' })).toBeVisible()
  await tv.keyboard.press('Enter')
  await expect(detail).toHaveCount(0)
  await expect(marked).toBeVisible()
  await tv.keyboard.press('Enter')
  await expect(detail).toBeVisible()
  // The Android app asks the page before Back leaves the app: the first Back closes the detail, the second leaves.
  const back = () => tv.evaluate(() => (window as { pvTvBack?: () => boolean }).pvTvBack?.() ?? null)
  expect(await back()).toBe(true)
  await expect(detail).toHaveCount(0)
  await expect(marked).toHaveCount(0)
  expect(await back()).toBe(false)

  await page.goto('/settings')
  const device = page.getByRole('listitem').filter({ hasText: name })
  await expect(device).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await device.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('The TV was removed.')).toBeVisible()

  await tv.reload()
  await expect(tv.getByTestId('pairing-code')).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)
  await tvContext.close()
})

test('a code that no TV shows is refused', async ({ page }) => {
  await signIn(page)
  await page.goto('/pair')
  await page.getByLabel('Code on the TV').fill('ZZZ-ZZZ')
  await page.getByRole('button', { name: 'Pair', exact: true }).click()
  await expect(page.getByText('This code is unknown or has expired.')).toBeVisible()
})

test('the pair page takes neither a code nor a device name from the address', async ({ page }) => {
  await signIn(page)
  await page.goto('/pair?code=ABCDEF')
  await expect(page.getByLabel('Code on the TV')).toHaveValue('')
  await page.goto('/pair?paired=Hacked')
  await expect(page.getByText('Hacked')).toHaveCount(0)
})
