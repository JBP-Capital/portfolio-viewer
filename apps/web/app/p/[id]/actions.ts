'use server'

import { parseDecimalInput, ratePerListingUnit } from '@pv/core'
import {
  archivePortfolio,
  createExchange,
  createTransaction,
  deletePortfolio,
  deleteTransaction,
  dismissSplit,
  renamePortfolio,
  updateTransaction,
} from '@pv/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { toActionError, type ActionResult } from '../../../lib/action-result.ts'
import { requireMember } from '../../../lib/auth/session.ts'
import { getDb } from '../../../lib/db.ts'

export interface TransactionFormValues {
  transactionId?: string
  portfolioId: string
  instrumentId: string
  listingId?: string
  type: string
  tradeDate: string
  currency: string
  quantity?: string
  price?: string
  amount?: string
  splitNew?: string
  splitOld?: string
  fees?: string
  taxes?: string
  fxRate?: string
  note?: string
}

export interface ExchangeFormValues {
  portfolioId: string
  tradeDate: string
  fromInstrumentId: string
  fromQuantity: string
  toInstrumentId: string
  toListingId?: string
  toQuantity: string
  note?: string
}

class InvalidNumber extends Error {
  readonly field: string

  constructor(field: string) {
    super(`invalid number in ${field}`)
    this.field = field
  }
}

async function numbers() {
  const locale = (await getLocale()) === 'de' ? 'de' : 'en'
  return {
    required(field: string, text: string | undefined): number {
      const value = parseDecimalInput(text ?? '', locale)
      if (value === null) throw new InvalidNumber(field)
      return value
    },
    optional(field: string, text: string | undefined): number | null {
      if (!text || text.trim() === '') return null
      const value = parseDecimalInput(text, locale)
      if (value === null) throw new InvalidNumber(field)
      return value
    },
  }
}

function fail(error: unknown): ActionResult {
  if (error instanceof InvalidNumber) return { ok: false, error: { code: 'invalid_number', field: error.field } }
  return { ok: false, error: toActionError(error) }
}

const refresh = (portfolioId: string) => revalidatePath(`/p/${portfolioId}`, 'layout')

export async function saveTransaction(values: TransactionFormValues): Promise<ActionResult> {
  const member = await requireMember()
  const n = await numbers()
  try {
    // The form asks for the rate per major unit ("EUR per GBP"); London prices are in pence.
    const typedRate = n.optional('fxRate', values.fxRate)
    const common = {
      portfolioId: values.portfolioId,
      instrumentId: values.instrumentId,
      listingId: values.listingId || null,
      type: values.type,
      tradeDate: values.tradeDate,
      currency: values.currency,
      fees: n.optional('fees', values.fees) ?? 0,
      taxes: n.optional('taxes', values.taxes) ?? 0,
      fxRate: typedRate === null ? null : ratePerListingUnit(typedRate, values.currency),
      note: values.note?.trim() || null,
    }
    const byType: Record<string, () => Record<string, unknown>> = {
      buy: () => ({ quantity: n.required('quantity', values.quantity), price: n.required('price', values.price) }),
      sell: () => ({ quantity: n.required('quantity', values.quantity), price: n.required('price', values.price) }),
      transfer_in: () => ({ quantity: n.required('quantity', values.quantity), price: n.required('price', values.price) }),
      transfer_out: () => ({ quantity: n.required('quantity', values.quantity), price: null }),
      dividend: () => ({ amount: n.required('amount', values.amount), quantity: null }),
      split: () => ({ splitRatio: n.required('splitNew', values.splitNew) / n.required('splitOld', values.splitOld) }),
    }
    const specific = byType[values.type]
    if (!specific) return { ok: false, error: { code: 'validation', field: 'type' } }
    const input = { ...common, ...specific() }
    const db = getDb()
    if (values.transactionId) await updateTransaction(db, member.id, values.transactionId, input)
    else await createTransaction(db, member.id, input)
  } catch (error) {
    return fail(error)
  }
  refresh(values.portfolioId)
  return { ok: true }
}

export async function saveExchange(values: ExchangeFormValues): Promise<ActionResult> {
  const member = await requireMember()
  const n = await numbers()
  try {
    await createExchange(getDb(), member.id, {
      portfolioId: values.portfolioId,
      tradeDate: values.tradeDate,
      fromInstrumentId: values.fromInstrumentId,
      fromQuantity: n.required('fromQuantity', values.fromQuantity),
      toInstrumentId: values.toInstrumentId,
      toListingId: values.toListingId || null,
      toQuantity: n.required('toQuantity', values.toQuantity),
      note: values.note?.trim() || null,
    })
  } catch (error) {
    return fail(error)
  }
  refresh(values.portfolioId)
  return { ok: true }
}

export async function removeTransaction(portfolioId: string, transactionId: string): Promise<ActionResult> {
  const member = await requireMember()
  try {
    await deleteTransaction(getDb(), member.id, transactionId)
  } catch (error) {
    return fail(error)
  }
  refresh(portfolioId)
  return { ok: true }
}

export async function bookSplit(portfolioId: string, instrumentId: string, date: string, numerator: number, denominator: number): Promise<ActionResult> {
  const member = await requireMember()
  try {
    await createTransaction(getDb(), member.id, {
      portfolioId,
      instrumentId,
      type: 'split',
      tradeDate: date,
      currency: 'EUR',
      fxRate: 1,
      splitRatio: numerator / denominator,
    })
  } catch (error) {
    return fail(error)
  }
  refresh(portfolioId)
  return { ok: true }
}

export async function ignoreSplit(portfolioId: string, instrumentId: string, date: string): Promise<ActionResult> {
  const member = await requireMember()
  try {
    await dismissSplit(getDb(), member.id, portfolioId, instrumentId, date)
  } catch (error) {
    return fail(error)
  }
  refresh(portfolioId)
  return { ok: true }
}

export async function renamePortfolioAction(portfolioId: string, form: FormData) {
  const member = await requireMember()
  let failed = false
  try {
    await renamePortfolio(getDb(), member.id, portfolioId, String(form.get('name') ?? ''))
  } catch {
    failed = true
  }
  if (failed) redirect(`/p/${portfolioId}?error=name`)
  refresh(portfolioId)
}

export async function archivePortfolioAction(portfolioId: string) {
  const member = await requireMember()
  await archivePortfolio(getDb(), member.id, portfolioId)
  redirect('/')
}

export async function deletePortfolioAction(portfolioId: string) {
  const member = await requireMember()
  await deletePortfolio(getDb(), member.id, portfolioId)
  redirect('/')
}
