import { expect, test, type Page } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD } from './accounts.ts'

// Runs after 02-input.spec.ts: the admin holds priced securities and the worker has loaded the
// benchmark prices (demo provider).
async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Portfolios' })).toBeVisible()
}

test('the dashboard shows the total, returns against the benchmarks and the allocation', async ({ page }) => {
  await signIn(page)
  await expect(page.getByTestId('portfolio-value')).toHaveText(/\d/)
  const returns = page.getByRole('table', { name: 'Returns' })
  await expect(returns.getByRole('columnheader')).toHaveText(['Period', 'Portfolio', 'MSCI World', 'S&P 500', 'DAX', 'Gold'])
  await expect(returns.getByRole('rowheader')).toHaveText(['1 month', 'Year to date', '1 year', '3 years', '5 years', 'Since first trade'])
  // The benchmarks have ten years of prices, so their five-year return is known.
  await expect(returns.getByRole('row', { name: /5 years/ }).getByRole('cell').nth(1)).toHaveText(/%$/)
  await expect(page.getByText('By currency')).toBeVisible()
  await expect(page.getByText("Today's movers")).toBeVisible()
})

test('the range tabs scope the charts, and a chart answers to the keyboard', async ({ page }) => {
  await signIn(page)
  const ranges = page.getByRole('navigation', { name: 'Time range' })
  await ranges.getByRole('link', { name: '5Y' }).click()
  await expect(page).toHaveURL(/\?range=5Y$/)
  await expect(ranges.getByRole('link', { name: '5Y' })).toHaveAttribute('aria-current', 'page')

  const chart = page.getByRole('img', { name: 'Value over the selected time range' })
  await chart.focus()
  await page.keyboard.press('Home')
  await expect(page.locator('[aria-live=polite]').first()).toHaveText(/^\d{2}\/\d{2}\/\d{4}, /)
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('[aria-live=polite]').first()).toHaveText(/^\d{2}\/\d{2}\/\d{4}, /)
})

test("the hypothetical chart values today's holdings over the whole range, before the first trade", async ({ page }) => {
  await signIn(page)
  await page.goto('/?range=5Y')
  const hypothetical = page.getByRole('region', { name: "Hypothetical: today's holdings at past prices" })
  await expect(hypothetical.getByText(/Buys, sells and dividends in between are left out/)).toBeVisible()
  await hypothetical.getByRole('img', { name: "Value of today's holdings at past closing prices over the selected time range" }).focus()
  await page.keyboard.press('Home')
  // The securities were bought during this test run, but their prices go back ten years.
  await expect(hypothetical.locator('[aria-live=polite]')).toHaveText(new RegExp(`^\\d{2}/\\d{2}/${new Date().getFullYear() - 5}, `))
})

test('a position shows its price history', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: /Main depot/ }).click()
  await page.getByRole('link', { name: /Agnico Eagle/ }).click()
  await expect(page.getByRole('img', { name: 'Price history of Agnico Eagle Mines' })).toBeVisible()
  await expect(page.getByText('No price history yet')).toHaveCount(0)
})

test('a portfolio id that is not the member’s own is not found', async ({ page }) => {
  await signIn(page)
  const response = await page.goto('/p/00000000-0000-4000-8000-000000000000?range=MAX')
  expect(response?.status()).toBe(404)
})
