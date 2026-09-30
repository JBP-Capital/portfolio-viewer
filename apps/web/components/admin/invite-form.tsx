'use client'

import { useTranslations } from 'next-intl'
import { useState, useTransition, type FormEvent } from 'react'
import { inviteMember, type InviteResult } from '../../app/admin/actions.ts'
import { Alert, Button, Field, Input } from '../ui.tsx'

export function InviteForm() {
  const t = useTranslations('admin')
  const [result, setResult] = useState<InviteResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const element = event.currentTarget
    setCopied(false)
    startTransition(async () => {
      const outcome = await inviteMember(form)
      setResult(outcome)
      if (outcome.ok) element.reset()
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-6 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label={t('inviteEmail')} htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required autoComplete="off" />
          </Field>
        </div>
        <Button type="submit" disabled={pending}>
          {t('invite')}
        </Button>
      </form>
      {result && !result.ok ? <Alert tone="error">{t(`inviteError_${result.error}`)}</Alert> : null}
      {result?.ok ? (
        <div className="flex flex-col gap-3 bg-surface-high px-4 py-4">
          <p className="text-sm">{t('inviteCreated', { email: result.email })}</p>
          <code data-testid="invite-link" className="break-all text-sm text-gold">
            {result.link}
          </code>
          <div>
            <Button
              type="button"
              variant="secondary"
              className="h-9"
              onClick={() => {
                void navigator.clipboard?.writeText(result.link).then(() => setCopied(true))
              }}
            >
              {copied ? t('copied') : t('copy')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
