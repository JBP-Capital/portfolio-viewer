import { expect, test, type Page } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD } from './accounts.ts'

// Runs after 01-selfhost.spec.ts on the same instance, with MARKET_DATA_PROVIDER=demo.
test.describe.configure({ mode: 'serial' })

async function openMainDepot(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.getByRole('link', { name: /Main depot/ }).click()
  await expect(page.getByRole('heading', { name: 'Main depot' })).toBeVisible()
}

test('records, corrects and removes transactions', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept())
  await openMainDepot(page)

  // Buy 10 Agnico at 100 USD with an exchange rate typed in.
  await page.getByRole('button', { name: 'Add transaction' }).click()
  await page.getByLabel('Security').fill('Agnico')
  await page.getByRole('option', { name: /Agnico Eagle Mines/ }).click()
  await page.getByLabel('Date').fill('2026-01-05')
  await page.getByLabel('Quantity').fill('10')
  await page.getByLabel(/^Price/).fill('100')
  await page.getByLabel(/Exchange rate/).fill('0.85')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name: /Agnico Eagle Mines/ })).toBeVisible()

  // Selling more than held is refused in the form; four shares go through.
  await page.getByRole('button', { name: 'Add transaction' }).click()
  await page.getByRole('tab', { name: 'Sell' }).click()
  await expect(page.getByText('You currently hold 10.')).toBeVisible()
  await page.getByLabel('Date').fill('2026-02-02')
  await page.getByLabel('Quantity').fill('20')
  await page.getByLabel(/^Price/).fill('110')
  await page.getByLabel(/Exchange rate/).fill('0.85')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('You hold only 10 shares on that date.')).toBeVisible()
  await page.getByLabel('Quantity').fill('4')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The position shows 6 shares; deleting the sell restores 10.
  await page.getByRole('link', { name: /Agnico Eagle Mines/ }).click()
  await expect(page.getByTestId('position-quantity')).toHaveText('6')
  await page.getByRole('row', { name: /Sell/ }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByTestId('position-quantity')).toHaveText('10')
})

test('saving right after choosing a new security waits until it has been added', async ({ page }) => {
  await openMainDepot(page)
  await page.getByRole('button', { name: 'Add transaction' }).click()
  await page.getByLabel('Security').fill('SAP')
  await page.getByRole('option', { name: /SAP SE/ }).click()
  await page.getByLabel('Date').fill('2025-03-03')
  await page.getByLabel('Quantity').fill('15')
  await page.getByLabel(/^Price/).fill('185.40')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('link', { name: /SAP SE/ })).toBeVisible()
})

test('an exchange rate typed per pound values a London position in pence correctly', async ({ page }) => {
  await openMainDepot(page)
  await page.getByRole('button', { name: 'Add transaction' }).click()
  await page.getByLabel('Security').fill('Fresnillo')
  await page.getByRole('option', { name: /Fresnillo/ }).click()
  await page.getByLabel('Date').fill('2025-06-02')
  await page.getByLabel('Quantity').fill('100')
  await page.getByLabel(/^Price/).fill('1500')
  await page.getByLabel('Exchange rate (EUR per GBP)').fill('1.16')
  await page.getByRole('button', { name: 'Save' }).click()
  // 100 × 1,500 pence × 1.16 EUR per pound = 1,740 EUR, not 174,000.
  await page.getByRole('link', { name: /Fresnillo/ }).click()
  await expect(page.getByText('€1,740.00')).toBeVisible()
})

test('shows a value once prices have arrived', async ({ page }) => {
  // The worker's backfill runs every minute; allow a few rounds.
  test.setTimeout(180_000)
  await openMainDepot(page)
  await expect
    .poll(
      async () => {
        await page.reload()
        return page.getByTestId('portfolio-value').textContent()
      },
      { timeout: 150_000, intervals: [10_000] },
    )
    .toMatch(/\d/)
})
