'use client'

import type { ImportIssue } from '@pv/db'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useState, useTransition, type FormEvent } from 'react'
import { confirmImport, previewImport } from '../../app/import/actions.ts'
import type { ImportPreview } from '../../lib/import-preview.ts'
import { formatDate, formatQuantity } from '../../lib/format.ts'
import { Alert, Button, Card, Field } from '../ui.tsx'

const MAX_BYTES = 2 * 1024 * 1024

export function ImportForm() {
  const t = useTranslations('import')
  const tx = useTranslations('tx')
  const locale = useLocale()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ transactions: number; portfolios: number } | null>(null)
  const [pending, startTransition] = useTransition()

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    setDone(null)
    const file = form.get('file')
    if (file instanceof File && file.size > MAX_BYTES) {
      setPreview(null)
      setError(t('error_too_large'))
      return
    }
    startTransition(async () => {
      const result = await previewImport(form)
      if (result.ok) setPreview(result.preview)
      else {
        setPreview(null)
        setError(t(`error_${result.error}`))
      }
    })
  }

  function confirm() {
    if (!preview?.draftId) return
    const draftId = preview.draftId
    startTransition(async () => {
      const result = await confirmImport(draftId)
      if (result.ok) {
        setPreview(null)
        setDone({ transactions: result.transactions, portfolios: result.portfolios })
      } else if (result.error === 'rejected') setPreview(result.preview)
      else setError(t('error_expired'))
    })
  }

  function issueText(issue: ImportIssue): string {
    const column = issue.column ?? ''
    const params = { column, ...issue.params }
    const key =
      issue.code === 'oversell' && issue.params?.held !== undefined ? 'issue_oversell_held' : issue.code === 'invalid' && !issue.column ? 'issue_invalid_row' : `issue_${issue.code}`
    const message = t(key, issue.code === 'oversell' && issue.params?.held ? { held: formatQuantity(Number(issue.params.held), locale) } : params)
    return issue.line > 1 ? `${t('line', { line: issue.line })}: ${message}` : message
  }

  const number = (value: number | null) => (value === null ? '' : formatQuantity(value, locale))

  return (
    <div className="flex flex-col gap-8">
      <Card>
        <form onSubmit={check} className="flex flex-col gap-6">
          <Field label={t('file')} htmlFor="import-file" hint={t('fileHint')}>
            <input id="import-file" name="file" type="file" accept=".csv,text/csv" required className="py-2 text-sm file:mr-4 file:border-0 file:bg-surface-highest file:px-4 file:py-2 file:text-gold" />
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={pending}>
              {t('check')}
            </Button>
            <a href="/api/export?template=1" className="text-sm text-muted underline-offset-4 hover:text-text hover:underline">
              {t('template')}
            </a>
            <a href="/api/export" className="text-sm text-muted underline-offset-4 hover:text-text hover:underline">
              {t('exportAll')}
            </a>
          </div>
        </form>
      </Card>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {done ? (
        <Alert tone="info">
          {t('done', done)}{' '}
          <Link href="/" className="text-gold underline-offset-4 hover:underline">
            {t('toPortfolios')}
          </Link>
        </Alert>
      ) : null}

      {preview ? (
        <section className="flex flex-col gap-6" aria-label={t('preview')}>
          {preview.issues.length > 0 ? (
            <ul className="flex flex-col gap-px bg-bg">
              {preview.issues.map((issue, i) => (
                <li key={i} role={issue.warning ? undefined : 'alert'} className={`bg-surface-low px-4 py-3 text-sm ${issue.warning ? 'text-muted' : 'text-loss'}`}>
                  {issueText(issue)}
                </li>
              ))}
            </ul>
          ) : null}
          {preview.newPortfolios.length > 0 ? <p className="text-sm text-muted">{t('newPortfolios', { names: preview.newPortfolios.join(', ') })}</p> : null}
          {preview.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-px text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
                    <th className="px-3 py-2 font-medium">{t('lineHeader')}</th>
                    <th className="px-3 py-2 font-medium">{tx('date')}</th>
                    <th className="px-3 py-2 font-medium">{t('portfolio')}</th>
                    <th className="px-3 py-2 font-medium">{tx('type')}</th>
                    <th className="px-3 py-2 font-medium">{tx('security')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tx('quantity')}</th>
                    <th className="px-3 py-2 text-right font-medium">{tx('price')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.line} className={r.status === 'error' ? 'bg-surface-high text-loss' : 'bg-surface-low'}>
                      <td className="px-3 py-2 text-muted">{r.line}</td>
                      <td className="whitespace-nowrap px-3 py-2">{formatDate(r.date, locale)}</td>
                      <td className="px-3 py-2">{r.portfolio}</td>
                      <td className="px-3 py-2">{tx(`type_${r.type}`)}</td>
                      <td className="px-3 py-2">{r.security ?? <span className="text-loss">{t('notFound')}</span>}</td>
                      <td className="px-3 py-2 text-right">{number(r.quantity)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {number(r.price ?? r.amount)} {r.price !== null || r.amount !== null ? r.currency : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div>
            <Button type="button" onClick={confirm} disabled={pending || preview.blocked || !preview.draftId}>
              {t('confirm', { count: preview.count })}
            </Button>
            {preview.blocked ? <p className="mt-2 text-sm text-muted">{t('blocked')}</p> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
