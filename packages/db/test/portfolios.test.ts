import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors.ts'
import { archivePortfolio, createPortfolio, deletePortfolio, listPortfolios, renamePortfolio } from '../src/portfolios.ts'
import { makeMember, useTestDb } from './helpers.ts'

const { db } = useTestDb()

describe('portfolios', () => {
  it('creates portfolios in order and lists them', async () => {
    const m = await makeMember(db, 'owner@example.com')
    await createPortfolio(db, m.id, { name: 'Hartmut' })
    await createPortfolio(db, m.id, { name: 'Heike' })
    expect((await listPortfolios(db, m.id)).map((p) => p.name)).toEqual(['Hartmut', 'Heike'])
  })

  it('rejects an empty name', async () => {
    const m = await makeMember(db, 'owner@example.com')
    await expect(createPortfolio(db, m.id, { name: '  ' })).rejects.toBeInstanceOf(ValidationError)
    const p = await createPortfolio(db, m.id, { name: 'Main' })
    await expect(renamePortfolio(db, m.id, p.id, '')).rejects.toBeInstanceOf(ValidationError)
  })

  it('hides archived portfolios and deletes portfolios', async () => {
    const m = await makeMember(db, 'owner@example.com')
    const a = await createPortfolio(db, m.id, { name: 'A' })
    const b = await createPortfolio(db, m.id, { name: 'B' })
    await archivePortfolio(db, m.id, a.id)
    await deletePortfolio(db, m.id, b.id)
    expect(await listPortfolios(db, m.id)).toEqual([])
  })
})
