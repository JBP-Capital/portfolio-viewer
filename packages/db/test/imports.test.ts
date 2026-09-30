import type { ImportRow } from '@pv/core'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { applyImport, applyImportDraft, defaultSecurityResolver, deleteImportDraft, exportRecords, getImportDraft, ImportRejectedError, planImport, saveImportDraft, type ImportProvider } from '../src/imports.ts'
import { instruments } from '../src/schema.ts'
import { upsertListing } from '../src/instruments.ts'
import { archivePortfolio, createPortfolio, listPortfolios } from '../src/portfolios.ts'
import { createExchange, createTransaction, listTransactions } from '../src/transactions.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

let line = 1
function row(extra: Partial<ImportRow>): ImportRow {
  line += 1
  return {
    line, date: '2026-01-05', portfolio: 'Main', type: 'buy', isin: 'CA0084741085', symbol: null, exchange: null,
    quantity: 10, price: 100, currency: 'USD', fees: 0, taxes: 0, amount: null, fxRate: 0.9, splitRatio: null, note: null, link: null, ...extra,
  }
}

async function setup() {
  const member = await makeMember(db, 'owner@example.com')
  const main = await createPortfolio(db, member.id, { name: 'Main' })
  const aem = await upsertListing(db, { name: 'Agnico Eagle Mines', isin: 'CA0084741085', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
  const sap = await upsertListing(db, { name: 'SAP SE', mic: 'XETR', symbol: 'SAP', currency: 'EUR' })
  return { member, main, aem, sap, resolve: defaultSecurityResolver(db, null) }
}

describe('planImport / applyImport', () => {
  it('stores the rows as imported transactions and creates missing portfolios', async () => {
    const { member, main, resolve } = await setup()
    const rows = [row({}), row({ portfolio: 'new depot', isin: null, symbol: 'SAP', exchange: 'XETR', currency: 'EUR', fxRate: null })]
    const plan = await planImport(db, member.id, rows, resolve)
    expect(plan.issues).toEqual([])
    expect(plan.newPortfolios).toEqual(['new depot'])
    expect(await applyImport(db, member.id, rows, resolve)).toEqual({ transactions: 2, portfolios: 1 })
    const stored = await listTransactions(db, member.id, main.id)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ type: 'buy', quantity: 10, price: 100, fxRate: 0.9, source: 'import' })
    expect((await listPortfolios(db, member.id)).map((p) => p.name).sort()).toEqual(['Main', 'new depot'])
  })

  it('matches portfolio names regardless of case and accepts a sell listed before its buy', async () => {
    const { member, main, resolve } = await setup()
    const rows = [row({ portfolio: 'MAIN', type: 'sell', date: '2026-02-02', quantity: 4 }), row({ portfolio: 'main' })]
    expect((await planImport(db, member.id, rows, resolve)).issues).toEqual([])
    await applyImport(db, member.id, rows, resolve)
    expect(await listTransactions(db, member.id, main.id)).toHaveLength(2)
  })

  it('stores nothing when a row sells more than is held, and names the row', async () => {
    const { member, main, resolve } = await setup()
    await createTransaction(db, member.id, { portfolioId: main.id, instrumentId: (await setupIds()).aem, type: 'buy', tradeDate: '2026-01-02', currency: 'USD', quantity: 5, price: 90, fxRate: 0.9 })
    const sell = row({ type: 'sell', date: '2026-01-10', quantity: 8 })
    const rows = [row({ portfolio: 'Other', isin: null, symbol: 'SAP', exchange: 'XETR', currency: 'EUR', fxRate: null }), sell]
    const plan = await planImport(db, member.id, rows, resolve)
    expect(plan.issues).toEqual([{ line: sell.line, column: 'quantity', code: 'oversell', params: { held: '5' } }])
    await expect(applyImport(db, member.id, rows, resolve)).rejects.toBeInstanceOf(ImportRejectedError)
    expect(await listTransactions(db, member.id, main.id)).toHaveLength(1)
    expect((await listPortfolios(db, member.id)).map((p) => p.name)).toEqual(['Main'])
  })

  it('reports unknown securities, missing exchange rates and future dates', async () => {
    const { member, resolve } = await setup()
    const unknown = row({ isin: 'DE0007164600' })
    const noRate = row({ fxRate: null })
    const future = row({ date: '2999-01-01' })
    const plan = await planImport(db, member.id, [unknown, noRate, future], resolve)
    expect(plan.issues).toEqual([
      { line: unknown.line, column: 'isin', code: 'security' },
      { line: noRate.line, column: 'fx_rate', code: 'fx_missing', params: { currency: 'USD', date: '2026-01-05' } },
      { line: future.line, column: 'date', code: 'future' },
    ])
  })

  it('never uses another member’s portfolio of the same name', async () => {
    const { member, resolve } = await setup()
    const other = await makeMember(db, 'other@example.com')
    const plan = await planImport(db, other.id, [row({})], resolve)
    expect(plan.newPortfolios).toEqual(['Main'])
    await applyImport(db, other.id, [row({})], resolve)
    expect(await listPortfolios(db, other.id)).toHaveLength(1)
    const [mine] = await listPortfolios(db, member.id)
    expect(await listTransactions(db, member.id, mine!.id)).toHaveLength(0)
  })

  it('warns about rows that are already stored, without blocking', async () => {
    const { member, resolve } = await setup()
    const first = row({})
    await applyImport(db, member.id, [first], resolve)
    const again = { ...first, line: 7 }
    const plan = await planImport(db, member.id, [again], resolve)
    expect(plan.issues).toEqual([{ line: 7, column: null, code: 'duplicate', warning: true }])
    await applyImport(db, member.id, [again], resolve)
  })

  it('never leaves an oversold ledger when an import and a manual sell run at the same time', async () => {
    const { member, main, aem, resolve } = await setup()
    await createTransaction(db, member.id, { portfolioId: main.id, instrumentId: aem.instrumentId, type: 'buy', tradeDate: '2026-01-02', currency: 'USD', quantity: 8, price: 90, fxRate: 0.9 })
    const results = await Promise.allSettled([
      applyImport(db, member.id, [row({ type: 'sell', date: '2026-01-10', quantity: 5 })], resolve),
      createTransaction(db, member.id, { portfolioId: main.id, instrumentId: aem.instrumentId, type: 'sell', tradeDate: '2026-01-11', currency: 'USD', quantity: 5, price: 95, fxRate: 0.9 }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await listTransactions(db, member.id, main.id)).toHaveLength(2)
  })

  it('adds a security found at the provider', async () => {
    const { member } = await setup()
    const provider: ImportProvider = {
      describe: async (ref) => (ref.symbol === 'FRES' ? { mic: 'XLON', symbol: 'FRES', name: 'Fresnillo plc', currency: 'GBX', type: 'stock' } : null),
      search: async (query) => (query === 'GB00B2QPKJ12' ? [{ mic: 'XLON', symbol: 'FRES', name: 'Fresnillo plc', type: 'stock' }] : []),
    }
    const resolve = defaultSecurityResolver(db, provider)
    const plan = await planImport(db, member.id, [row({ isin: 'GB00B2QPKJ12', currency: 'GBX', fxRate: 0.0116 })], resolve)
    expect(plan.issues).toEqual([])
    expect(plan.rows[0]!.security).toMatchObject({ name: 'Fresnillo plc', currency: 'GBX' })
  })
})

async function setupIds() {
  const aem = await upsertListing(db, { name: 'Agnico Eagle Mines', isin: 'CA0084741085', mic: 'XNYS', symbol: 'AEM', currency: 'USD' })
  return { aem: aem.instrumentId }
}

describe('import drafts and export', () => {
  it('keeps a draft for its member only, for 15 minutes', async () => {
    const { member } = await setup()
    const other = await makeMember(db, 'other@example.com')
    const rows = [row({})]
    const id = await saveImportDraft(db, member.id, rows)
    expect(await getImportDraft(db, other.id, id)).toBeNull()
    expect(await getImportDraft(db, member.id, id)).toEqual(rows)
    expect(await getImportDraft(db, member.id, id, new Date(Date.now() + 16 * 60_000))).toBeNull()
    await deleteImportDraft(db, member.id, id)
    expect(await getImportDraft(db, member.id, id)).toBeNull()
    expect(await getImportDraft(db, member.id, 'not-a-uuid')).toBeNull()
  })

  it('exports all transactions of the member, archived portfolios and merger legs included', async () => {
    const { member, main, aem, sap, resolve } = await setup()
    await applyImport(db, member.id, [row({}), row({ isin: null, symbol: 'SAP', exchange: 'XETR', currency: 'EUR', fxRate: null, type: 'buy', portfolio: 'Old' })], resolve)
    const old = (await listPortfolios(db, member.id)).find((p) => p.name === 'Old')!
    await archivePortfolio(db, member.id, old.id)
    await createExchange(db, member.id, { portfolioId: main.id, tradeDate: '2026-02-02', fromInstrumentId: aem.instrumentId, fromQuantity: 10, toInstrumentId: sap.instrumentId, toQuantity: 3 })
    const other = await makeMember(db, 'other@example.com')
    await applyImport(db, other.id, [row({})], resolve)

    const records = await exportRecords(db, member.id)
    expect(records.map((r) => [r.portfolio, r.type, r.symbol])).toEqual([
      ['Main', 'buy', 'AEM'],
      ['Old', 'buy', 'SAP'],
      ['Main', 'exchange_out', 'AEM'],
      ['Main', 'exchange_in', 'SAP'],
    ])
    expect(records[0]).toMatchObject({ date: '2026-01-05', isin: 'CA0084741085', exchange: 'XNYS', quantity: 10, price: 100, currency: 'USD', fxRate: 0.9, link: null })
    expect(records[2]!.link).toBe(records[3]!.link)
    expect(records[2]!.link).not.toBeNull()
  })
})

describe('import review fixes', () => {
  it('reads fx_rate per major unit like the form (per pound for pence) and exports it the same way', async () => {
    const { member, main, resolve } = await setup()
    await upsertListing(db, { name: 'Fresnillo plc', mic: 'XLON', symbol: 'FRES', currency: 'GBX' })
    await applyImport(db, member.id, [row({ isin: null, symbol: 'FRES', exchange: 'XLON', currency: 'GBX', quantity: 100, price: 1500, fxRate: 1.16 })], resolve)
    const [stored] = await listTransactions(db, member.id, main.id)
    expect(stored!.fxRate).toBeCloseTo(0.0116, 12)
    expect((await exportRecords(db, member.id))[0]!.fxRate).toBeCloseTo(1.16, 12)
  })

  it('imports merger legs paired by their link and refuses a leg without its partner', async () => {
    const { member, main, sap, resolve } = await setup()
    await applyImport(db, member.id, [row({})], resolve)
    const legs = [
      row({ type: 'exchange_out', date: '2026-02-02', quantity: 10, price: null, fxRate: null, link: 'm1' }),
      row({ type: 'exchange_in', date: '2026-02-02', isin: null, symbol: 'SAP', exchange: 'XETR', currency: 'EUR', quantity: 3, price: null, fxRate: null, link: 'm1' }),
    ]
    expect((await planImport(db, member.id, legs, resolve)).issues).toEqual([])
    await applyImport(db, member.id, legs, resolve)
    const stored = await listTransactions(db, member.id, main.id)
    const out = stored.find((t) => t.type === 'exchange_out')!
    const into = stored.find((t) => t.type === 'exchange_in')!
    expect(out.linkId).not.toBeNull()
    expect(into).toMatchObject({ linkId: out.linkId, instrumentId: sap.instrumentId, quantity: 3 })
    const lonely = row({ type: 'exchange_in', date: '2026-03-02', quantity: 1, price: null, fxRate: null, link: 'm2' })
    expect((await planImport(db, member.id, [lonely], resolve)).issues).toEqual([{ line: lonely.line, column: 'link', code: 'unpaired' }])
  })

  it('refuses a portfolio name that matches two portfolios', async () => {
    const { member, resolve } = await setup()
    await createPortfolio(db, member.id, { name: 'main' })
    const r = row({})
    expect((await planImport(db, member.id, [r], resolve)).issues).toEqual([{ line: r.line, column: 'portfolio', code: 'ambiguous' }])
  })

  it('does not store an ISIN on a security the provider found by its symbol', async () => {
    const { member } = await setup()
    const provider: ImportProvider = {
      describe: async (ref) => (ref.symbol === 'FRES' ? { mic: 'XLON', symbol: 'FRES', name: 'Fresnillo plc', currency: 'GBX', type: 'stock' } : null),
      search: async () => [],
    }
    await planImport(db, member.id, [row({ isin: 'US0378331005', symbol: 'FRES', exchange: 'XLON', currency: 'GBX' })], defaultSecurityResolver(db, provider))
    const [fres] = await db.select().from(instruments).where(eq(instruments.name, 'Fresnillo plc'))
    expect(fres!.isin).toBeNull()
  })

  it('confirms a draft once, even when it is confirmed twice at the same time', async () => {
    const { member, resolve } = await setup()
    const draftId = await saveImportDraft(db, member.id, [row({ portfolio: 'Fresh' })])
    const results = await Promise.all([applyImportDraft(db, member.id, draftId, resolve), applyImportDraft(db, member.id, draftId, resolve)])
    expect(results.filter((r) => r !== null)).toEqual([{ transactions: 1, portfolios: 1 }])
    expect((await listPortfolios(db, member.id)).filter((p) => p.name === 'Fresh')).toHaveLength(1)
    expect(await getImportDraft(db, member.id, draftId)).toBeNull()
  })
})

