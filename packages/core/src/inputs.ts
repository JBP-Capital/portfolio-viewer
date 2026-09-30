import { z } from 'zod'

export const portfolioNameSchema = z.string().trim().min(1).max(60)

export const createPortfolioSchema = z.object({
  name: portfolioNameSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
})

const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code such as EUR')
const positive = z.number().positive()

const common = {
  portfolioId: z.uuid(),
  instrumentId: z.uuid(),
  listingId: z.uuid().nullable().default(null),
  tradeDate: z.iso.date(),
  currency,
  fxRate: positive.nullable().default(null),
  fees: z.number().nonnegative().default(0),
  taxes: z.number().nonnegative().default(0),
  note: z.string().trim().max(500).nullable().default(null),
}

// Transfers and splits move no money, so fees or taxes entered on them would silently be lost.
const noCosts = {
  fees: z.literal(0, 'No fees on this type of transaction').default(0),
  taxes: z.literal(0, 'No taxes on this type of transaction').default(0),
}

export const transactionInputSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('buy'), quantity: positive, price: z.number().nonnegative() }),
  z.object({ ...common, type: z.literal('sell'), quantity: positive, price: z.number().nonnegative() }),
  z.object({ ...common, ...noCosts, type: z.literal('transfer_in'), quantity: positive, price: z.number().nonnegative() }),
  z.object({ ...common, ...noCosts, type: z.literal('transfer_out'), quantity: positive, price: z.number().nonnegative().nullable().default(null) }),
  z.object({ ...common, type: z.literal('dividend'), amount: positive, quantity: positive.nullable().default(null) }),
  z.object({ ...common, ...noCosts, type: z.literal('split'), splitRatio: positive.refine((r) => r !== 1, 'A split ratio of 1 changes nothing') }),
])
export type TransactionInput = z.infer<typeof transactionInputSchema>

export const exchangeInputSchema = z
  .object({
    portfolioId: z.uuid(),
    tradeDate: z.iso.date(),
    fromInstrumentId: z.uuid(),
    fromQuantity: positive,
    toInstrumentId: z.uuid(),
    toListingId: z.uuid().nullable().default(null),
    toQuantity: positive,
    note: z.string().trim().max(500).nullable().default(null),
  })
  .refine((v) => v.fromInstrumentId !== v.toInstrumentId, {
    message: 'An exchange needs two different securities',
    path: ['toInstrumentId'],
  })
export type ExchangeInput = z.infer<typeof exchangeInputSchema>
