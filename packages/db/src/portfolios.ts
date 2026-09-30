import { createPortfolioSchema, portfolioNameSchema } from '@pv/core'
import { and, asc, eq, isNull, max } from 'drizzle-orm'
import type { Db } from './client.ts'
import { assertId, NotFoundError, parseInput } from './errors.ts'
import { portfolios } from './schema.ts'

export type Portfolio = typeof portfolios.$inferSelect

const owned = (memberId: string, portfolioId: string) => {
  assertId(portfolioId, 'Portfolio')
  return and(eq(portfolios.id, portfolioId), eq(portfolios.memberId, memberId))
}

export async function listPortfolios(db: Db, memberId: string): Promise<Portfolio[]> {
  return db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.memberId, memberId), isNull(portfolios.archivedAt)))
    .orderBy(asc(portfolios.position), asc(portfolios.createdAt))
}

export async function getPortfolio(db: Db, memberId: string, portfolioId: string): Promise<Portfolio> {
  const [row] = await db.select().from(portfolios).where(owned(memberId, portfolioId))
  if (!row) throw new NotFoundError('Portfolio')
  return row
}

export async function createPortfolio(db: Db, memberId: string, raw: unknown): Promise<Portfolio> {
  const input = parseInput(createPortfolioSchema, raw)
  const [last] = await db.select({ position: max(portfolios.position) }).from(portfolios).where(eq(portfolios.memberId, memberId))
  const [row] = await db
    .insert(portfolios)
    .values({ memberId, name: input.name, color: input.color, position: (last?.position ?? -1) + 1 })
    .returning()
  return row!
}

export async function renamePortfolio(db: Db, memberId: string, portfolioId: string, name: unknown): Promise<Portfolio> {
  const value = parseInput(portfolioNameSchema, name)
  const [row] = await db.update(portfolios).set({ name: value }).where(owned(memberId, portfolioId)).returning()
  if (!row) throw new NotFoundError('Portfolio')
  return row
}

export async function archivePortfolio(db: Db, memberId: string, portfolioId: string): Promise<void> {
  const rows = await db.update(portfolios).set({ archivedAt: new Date() }).where(owned(memberId, portfolioId)).returning({ id: portfolios.id })
  if (rows.length === 0) throw new NotFoundError('Portfolio')
}

export async function deletePortfolio(db: Db, memberId: string, portfolioId: string): Promise<void> {
  const rows = await db.delete(portfolios).where(owned(memberId, portfolioId)).returning({ id: portfolios.id })
  if (rows.length === 0) throw new NotFoundError('Portfolio')
}
