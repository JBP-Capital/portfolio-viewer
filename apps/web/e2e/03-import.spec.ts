import { expect, test, type Page } from '@playwright/test'
import { ADMIN_EMAIL, PASSWORD } from './accounts.ts'

// Runs after 02-input.spec.ts on the same instance, with MARKET_DATA_PROVIDER=demo.
test.describe.configure({ mode: 'serial' })

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(ADMIN_EMAIL)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Portfolios' })).toBeVisible()
}

async function upload(page: Page, name: string, content: string) {
  await page.goto('/import')
  await page.getByLabel('CSV file').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content, 'utf8') })
  await page.getByRole('button', { name: 'Check file' }).click()
}

// A German spreadsheet: semicolons, decimal commas, day.month.year; one security new to the instance.
const GERMAN = `date;portfolio;type;symbol;exchange;quantity;price;currency;fx_rate
05.01.2026;Rente;buy;LG;XTSX;39.900;0,21;CAD;0,66
06.01.2026;Rente;buy;SAP;XETR;2;180,5;EUR;
10.02.2026;Rente;sell;SAP;XETR;1;190;EUR;
`

test('imports a German CSV after a preview and creates the portfolio', async ({ page }) => {
  await signIn(page)
  await upload(page, 'depot.csv', GERMAN)
  await expect(page.getByText('New portfolios will be created: Rente')).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Lahontan Gold' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '39,900' })).toBeVisible()
  await page.getByRole('button', { name: 'Import 3 transactions' }).click()
  await expect(page.getByText('3 transactions imported, 1 new portfolio.')).toBeVisible()

  await page.getByRole('link', { name: 'Go to your portfolios' }).click()
  await page.getByRole('link', { name: /Rente/ }).click()
  await expect(page.getByRole('link', { name: /Lahontan Gold/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /SAP SE/ })).toBeVisible()
})

test('stores nothing when a row sells more than is held, and names the line', async ({ page }) => {
  await signIn(page)
  await upload(page, 'oversell.csv', 'date,portfolio,type,symbol,exchange,quantity,price,currency\n2026-03-02,Rente,buy,SAP,XETR,1,185,EUR\n2026-03-03,Rente,sell,SAP,XETR,5,190,EUR\n')
  await expect(page.getByText('Line 3: This sells more shares than are held on that date (held: 2).')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Import 2 transactions' })).toBeDisabled()
})

test('exports every transaction as CSV that names portfolio and security', async ({ page }) => {
  await signIn(page)
  const response = await page.request.get('/api/export')
  expect(response.status()).toBe(200)
  expect(response.headers()['content-type']).toContain('text/csv')
  const lines = (await response.text()).trim().split('\n')
  expect(lines[0]).toBe('date,portfolio,type,isin,symbol,exchange,quantity,price,currency,fees,taxes,amount,note,fx_rate,split_ratio,link')
  expect(lines).toContain('2026-02-10,Rente,sell,,SAP,XETR,1,190,EUR,0,0,,,1,,')
  expect(lines.some((line) => line.startsWith('2026-01-05,Rente,buy,,LG,XTSX,39900,0.21,CAD,0,0,,,0.66,,'))).toBe(true)
})
