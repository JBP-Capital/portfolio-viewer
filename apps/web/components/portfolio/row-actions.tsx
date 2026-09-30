'use client'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'
import { bookSplit, ignoreSplit, removeTransaction } from '../../app/p/[id]/actions.ts'
import type { ActionError, ActionResult } from '../../lib/action-result.ts'
import { Button } from '../ui.tsx'

export function DeleteTransactionButton({ portfolioId, transactionId }: { portfolioId: string; transactionId: string }) {
  const t = useTranslations('tx')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-9 px-2 hover:text-loss"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(t('deleteConfirm'))) return
        startTransition(async () => {
          const result = await removeTransaction(portfolioId, transactionId)
          if (result.ok) router.refresh()
          else window.alert(t(`err_${result.error.code}`))
        })
      }}
    >
      {t('delete')}
    </Button>
  )
}

export function SplitBanner(props: { portfolioId: string; instrumentId: string; message: string; date: string; numerator: number; denominator: number }) {
  const t = useTranslations('portfolio')
  const tx = useTranslations('tx')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<ActionError | null>(null)
  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        setError(null)
        router.refresh()
      } else setError(result.error)
    })
  return (
    <div role="status" className="flex flex-col gap-4 border-l-2 border-gold bg-surface-high px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-2">
        <p className="text-sm">{props.message}</p>
        {error ? <p role="alert" className="text-sm text-loss">{tx(`err_${error.code}`)}</p> : null}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" className="h-9" disabled={pending} onClick={() => run(() => bookSplit(props.portfolioId, props.instrumentId, props.date, props.numerator, props.denominator))}>
          {t('splitBook')}
        </Button>
        <Button type="button" variant="ghost" className="h-9" disabled={pending} onClick={() => run(() => ignoreSplit(props.portfolioId, props.instrumentId, props.date))}>
          {t('splitIgnore')}
        </Button>
      </div>
    </div>
  )
}

export function ConfirmSubmit({ label, confirm, className = '' }: { label: string; confirm: string; className?: string }) {
  return (
    <Button
      type="submit"
      variant="ghost"
      className={className}
      onClick={(event) => {
        if (!window.confirm(confirm)) event.preventDefault()
      }}
    >
      {label}
    </Button>
  )
}
