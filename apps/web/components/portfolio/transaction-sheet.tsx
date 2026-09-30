'use client'

import { parseDecimalInput, ratePerMajorUnit } from '@pv/core'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent } from 'react'
import { removeTransaction, saveExchange, saveTransaction } from '../../app/p/[id]/actions.ts'
import type { ActionError } from '../../lib/action-result.ts'
import { formatInputNumber, formatMoney, formatQuantity } from '../../lib/format.ts'
import type { EditableTransaction, HeldOption, SelectedInstrument } from '../../lib/portfolio-types.ts'
import { changeField } from '../../lib/transaction-form.ts'
import { Alert, Button, Field, Input, Select } from '../ui.tsx'
import { InstrumentPicker } from './instrument-picker.tsx'

type TxType = 'buy' | 'sell' | 'dividend' | 'transfer_in' | 'transfer_out' | 'split' | 'exchange'
const TYPES: TxType[] = ['buy', 'sell', 'dividend', 'transfer_in', 'transfer_out', 'split', 'exchange']
/** Types that act on a security already held: chosen from a list instead of searched. */
const HELD_TYPES = new Set<TxType>(['sell', 'dividend', 'transfer_out', 'split', 'exchange'])
const MINOR: Record<string, string> = { GBX: 'GBP', ZAC: 'ZAR', ILA: 'ILS' }

type FieldName = 'tradeDate' | 'quantity' | 'price' | 'amount' | 'fees' | 'taxes' | 'fxRate' | 'splitNew' | 'splitOld' | 'fromQuantity' | 'toQuantity' | 'note'
type Values = Record<FieldName, string>

function initialValues(initial: EditableTransaction | undefined, today: string, locale: string): Values {
  const n = (v: number | null) => formatInputNumber(v, locale)
  const ratio = initial?.splitRatio ?? null
  return {
    tradeDate: initial?.tradeDate ?? today,
    quantity: n(initial?.quantity ?? null),
    price: n(initial?.price ?? null),
    amount: n(initial?.amount ?? null),
    fees: initial && initial.fees !== 0 ? n(initial.fees) : '',
    taxes: initial && initial.taxes !== 0 ? n(initial.taxes) : '',
    fxRate: initial && initial.fxRate !== null && initial.fxRate !== 1 ? n(ratePerMajorUnit(initial.fxRate, initial.currency)) : '',
    splitNew: ratio === null ? '' : ratio >= 1 ? n(ratio) : '1',
    splitOld: ratio === null ? '' : ratio >= 1 ? '1' : n(1 / ratio),
    fromQuantity: '',
    toQuantity: '',
    note: initial?.note ?? '',
  }
}

export interface TransactionSheetProps {
  portfolioId: string
  baseCurrency: string
  held: HeldOption[]
  today: string
  label: string
  initial?: EditableTransaction
  preset?: { type?: TxType; instrumentId?: string }
  variant?: 'primary' | 'secondary' | 'ghost'
  className?: string
}

export function TransactionSheet({ portfolioId, baseCurrency, held, today, label, initial, preset, variant = 'primary', className = '' }: TransactionSheetProps) {
  const t = useTranslations('tx')
  const locale = useLocale()
  const router = useRouter()
  const dialog = useRef<HTMLDialogElement>(null)
  const formId = useId()
  const editing = initial !== undefined
  const startType = (initial?.type as TxType | undefined) ?? preset?.type ?? 'buy'

  const heldChoices = useMemo(() => {
    const list: HeldOption[] = [...held]
    if (initial && !list.some((h) => h.instrumentId === initial.security.instrumentId)) list.push({ ...initial.security, quantity: 0 })
    return list
  }, [held, initial])

  const [type, setType] = useState<TxType>(startType)
  const [picked, setPicked] = useState<SelectedInstrument | null>(initial?.security ?? heldChoices.find((h) => h.instrumentId === preset?.instrumentId) ?? null)
  const [heldId, setHeldId] = useState(initial?.security.instrumentId ?? preset?.instrumentId ?? heldChoices[0]?.instrumentId ?? '')
  const [target, setTarget] = useState<SelectedInstrument | null>(null)
  const [values, setValues] = useState<Values>(() => initialValues(initial, today, locale))
  const [error, setError] = useState<ActionError | null>(null)
  const [pending, startTransition] = useTransition()
  const [resolving, setResolving] = useState(false)
  // The form is only mounted while open: every transaction row has its own sheet, and closed forms
  // would otherwise fill the page with hidden duplicate fields.
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (isOpen && !dialog.current?.open) dialog.current?.showModal()
  }, [isOpen])

  // The held list changes after every save (router.refresh); fall back to its first entry.
  const selectedHeldId = heldChoices.some((h) => h.instrumentId === heldId) ? heldId : (heldChoices[0]?.instrumentId ?? '')
  const security: SelectedInstrument | null = HELD_TYPES.has(type) ? (heldChoices.find((h) => h.instrumentId === selectedHeldId) ?? null) : picked
  const currency = security?.currency ?? baseCurrency
  const major = MINOR[currency] ?? currency
  const showFx = security !== null && major !== baseCurrency && ['buy', 'sell', 'dividend', 'transfer_in'].includes(type)
  // Sells and transfers out show what is held today (not while editing: the stored entry is already deducted).
  const heldNow = heldChoices.find((h) => h.instrumentId === selectedHeldId)
  const availableHint = !editing && heldNow && (type === 'sell' || type === 'transfer_out') ? t('currentlyHeld', { quantity: formatQuantity(heldNow.quantity, locale) }) : undefined
  const prefilledFxRate = useMemo(() => initialValues(initial, today, locale).fxRate, [initial, today, locale])
  const set = (name: FieldName) => (event: { target: { value: string } }) => {
    const value = event.target.value
    setValues((v) => changeField(v, name, value, prefilledFxRate))
  }
  const id = (name: string) => `${formId}-${name}`
  const num = (text: string) => parseDecimalInput(text, locale === 'de' ? 'de' : 'en') ?? 0

  const total = useMemo(() => {
    const gross = num(values.quantity) * num(values.price)
    switch (type) {
      case 'buy':
        return gross + num(values.fees) + num(values.taxes)
      case 'sell':
        return gross - num(values.fees) - num(values.taxes)
      case 'transfer_in':
        return gross
      case 'dividend':
        return num(values.amount) - num(values.taxes)
      default:
        return null
    }
  }, [type, values, locale])

  function open() {
    setError(null)
    // An edit form always starts from the stored transaction (it may have changed since the last opening).
    if (initial) setValues(initialValues(initial, today, locale))
    setIsOpen(true)
  }

  function close() {
    dialog.current?.close()
    setIsOpen(false)
    if (!editing) {
      setValues(initialValues(undefined, today, locale))
      setPicked(null)
      setTarget(null)
    }
    setError(null)
  }

  function errorText(e: ActionError): string {
    if (e.code === 'validation' && e.field === 'tradeDate' && e.params?.reason === 'future') return t('err_future')
    if (e.code === 'validation' && e.field && /instrumentId|listingId/i.test(e.field)) return t('err_security')
    if (e.code === 'oversell' && e.params?.held !== undefined) return t('err_oversell_held', { quantity: formatQuantity(Number(e.params.held), locale) })
    if (e.code === 'fx_missing') return t('err_fx_missing', { currency: e.params?.currency ?? major, date: e.params?.date ?? values.tradeDate })
    return t(`err_${e.code}`)
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (resolving) return
    setError(null)
    if (type === 'exchange') {
      if (!security || !target) return setError({ code: 'validation', field: 'instrumentId' })
      startTransition(async () => {
        const result = await saveExchange({
          portfolioId,
          tradeDate: values.tradeDate,
          fromInstrumentId: security.instrumentId,
          fromQuantity: values.fromQuantity,
          toInstrumentId: target.instrumentId,
          toListingId: target.listingId,
          toQuantity: values.toQuantity,
          note: values.note,
        })
        if (result.ok) {
          close()
          router.refresh()
        } else setError(result.error)
      })
      return
    }
    if (!security) return setError({ code: 'validation', field: 'instrumentId' })
    startTransition(async () => {
      const result = await saveTransaction({
        ...(initial ? { transactionId: initial.id } : {}),
        portfolioId,
        instrumentId: security.instrumentId,
        listingId: security.listingId,
        type,
        tradeDate: values.tradeDate,
        currency,
        quantity: values.quantity,
        price: values.price,
        amount: values.amount,
        splitNew: values.splitNew,
        splitOld: values.splitOld,
        fees: values.fees,
        taxes: values.taxes,
        fxRate: showFx ? values.fxRate : '',
        note: values.note,
      })
      if (result.ok) {
        close()
        router.refresh()
      } else setError(result.error)
    })
  }

  function remove() {
    if (!initial || !window.confirm(t('deleteConfirm'))) return
    startTransition(async () => {
      const result = await removeTransaction(portfolioId, initial.id)
      if (result.ok) {
        close()
        router.refresh()
      } else setError(result.error)
    })
  }

  const numberField = (name: FieldName, labelText: string, hint?: string) => (
    <Field label={labelText} htmlFor={id(name)} hint={hint}>
      <Input id={id(name)} inputMode="decimal" autoComplete="off" value={values[name]} onChange={set(name)} aria-invalid={error?.field === name} />
    </Field>
  )
  const currencyNote = currency === 'GBX' ? `GBX (${t('pence')})` : currency

  return (
    <>
      <Button type="button" variant={variant} className={className} onClick={open}>
        {label}
      </Button>
      <dialog
        ref={dialog}
        onClose={() => {
          setIsOpen(false)
          setError(null)
        }}
        className="m-auto w-full max-w-xl bg-surface-low p-0 text-text backdrop:bg-black/60 sm:max-h-[90dvh]"
        aria-labelledby={id('title')}
      >
        {isOpen ? (
        <form onSubmit={submit} className="flex flex-col gap-6 p-6 sm:p-8">
          <h2 id={id('title')} className="font-display text-2xl font-bold tracking-tight">
            {editing ? t('title_edit') : t('title_new')}
          </h2>

          <div role="tablist" aria-label={t('title_new')} className="flex flex-wrap gap-px bg-bg">
            {TYPES.filter((candidate) => !editing || candidate === type).map((candidate) => (
              <button
                key={candidate}
                type="button"
                role="tab"
                aria-selected={type === candidate}
                onClick={() => {
                  setType(candidate)
                  setError(null)
                }}
                className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] transition ${
                  type === candidate ? 'bg-surface-highest text-gold' : 'bg-surface-high text-muted hover:text-text'
                }`}
              >
                {t(`type_${candidate}`)}
              </button>
            ))}
          </div>

          {error ? <Alert tone="error">{errorText(error)}</Alert> : null}

          {HELD_TYPES.has(type) ? (
            <Field label={type === 'exchange' ? t('fromSecurity') : t('security')} htmlFor={id('held')}>
              {heldChoices.length === 0 ? (
                <p className="py-2 text-sm text-muted">{t('noHoldings')}</p>
              ) : (
                <Select id={id('held')} value={selectedHeldId} onChange={(event) => setHeldId(event.target.value)} disabled={editing}>
                  {heldChoices.map((h) => (
                    <option key={h.instrumentId} value={h.instrumentId}>
                      {h.name} · {h.symbol}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <Field label={t('security')} htmlFor={id('security')}>
              <InstrumentPicker id={id('security')} value={picked} onSelect={editing ? () => {} : setPicked} onBusyChange={setResolving} />
            </Field>
          )}

          <div className="grid gap-6 sm:grid-cols-2">
            <Field label={t('date')} htmlFor={id('tradeDate')}>
              <Input id={id('tradeDate')} type="date" max={today} value={values.tradeDate} onChange={set('tradeDate')} required aria-invalid={error?.field === 'tradeDate'} />
            </Field>

            {type === 'buy' || type === 'sell' ? (
              <>
                {numberField('quantity', t('quantity'), availableHint)}
                {numberField('price', `${t('price')} (${currencyNote})`)}
                {numberField('fees', `${t('fees')} (${currencyNote})`)}
                {numberField('taxes', `${t('taxes')} (${currencyNote})`)}
              </>
            ) : null}
            {type === 'transfer_in' ? (
              <>
                {numberField('quantity', t('quantity'))}
                {numberField('price', `${t('avgPrice')} (${currencyNote})`)}
              </>
            ) : null}
            {type === 'transfer_out' ? numberField('quantity', t('quantity'), availableHint) : null}
            {type === 'dividend' ? (
              <>
                {numberField('amount', `${t('amount')} (${currencyNote})`)}
                {numberField('taxes', `${t('withheldTax')} (${currencyNote})`)}
              </>
            ) : null}
            {type === 'split' ? (
              <>
                {numberField('splitNew', t('splitNew'))}
                {numberField('splitOld', t('splitOld'))}
              </>
            ) : null}
            {type === 'exchange' ? (
              <>
                {numberField('fromQuantity', t('fromQuantity'))}
                <div className="sm:col-span-2">
                  <Field label={t('toSecurity')} htmlFor={id('target')}>
                    <InstrumentPicker id={id('target')} value={target} onSelect={setTarget} onBusyChange={setResolving} />
                  </Field>
                </div>
                {numberField('toQuantity', t('toQuantity'))}
              </>
            ) : null}
            {showFx ? numberField('fxRate', t('fxRate', { base: baseCurrency, currency: major }), t('fxAuto')) : null}
          </div>

          {type === 'exchange' ? <p className="text-sm text-muted">{t('exchangeHint')}</p> : null}

          <Field label={t('note')} htmlFor={id('note')}>
            <Input id={id('note')} maxLength={500} value={values.note} onChange={set('note')} />
          </Field>

          {total !== null && security ? (
            <div className="flex items-baseline justify-between bg-surface-high px-4 py-3">
              <span className="text-[11px] uppercase tracking-[0.12em] text-muted">{t('total')}</span>
              <span className="font-display text-xl font-semibold">{formatMoney(total, currency, locale)}</span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3">
            {editing ? (
              <Button type="button" variant="ghost" onClick={remove} disabled={pending} className="text-loss hover:text-loss">
                {t('delete')}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending || resolving}>
                {t('save')}
              </Button>
            </div>
          </div>
        </form>
        ) : null}
      </dialog>
    </>
  )
}
