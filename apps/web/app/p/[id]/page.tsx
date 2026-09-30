import { todayInTimeZone } from '@pv/core'
import { hypotheticalSeries, memberSeries, NotFoundError } from '@pv/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { AppShell } from '../../../components/app-shell.tsx'
import { Hypothetical } from '../../../components/dashboard/hypothetical.tsx'
import { Performance } from '../../../components/dashboard/performance.tsx'
import { HoldingsList } from '../../../components/portfolio/holdings-list.tsx'
import { ConfirmSubmit, SplitBanner } from '../../../components/portfolio/row-actions.tsx'
import { Summary } from '../../../components/portfolio/summary.tsx'
import { TransactionSheet } from '../../../components/portfolio/transaction-sheet.tsx'
import { TransactionsList } from '../../../components/portfolio/transactions-list.tsx'
import { Alert, Button, Field, Input, Overline } from '../../../components/ui.tsx'
import { requireMember } from '../../../lib/auth/session.ts'
import { getDb } from '../../../lib/db.ts'
import { formatDate, formatMoney } from '../../../lib/format.ts'
import { loadPortfolioPage } from '../../../lib/portfolio-data.ts'
import { hypotheticalStart, parseRange } from '../../../lib/ranges.ts'
import { archivePortfolioAction, deletePortfolioAction, renamePortfolioAction } from './actions.ts'

export default async function PortfolioPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; range?: string }> }) {
  const member = await requireMember()
  const { id } = await params
  const { error, range: rawRange } = await searchParams
  const range = parseRange(rawRange)
  const asOf = todayInTimeZone(member.timezone)
  const [data, series, hypothetical] = await Promise.all([
    loadPortfolioPage(member, id),
    memberSeries(getDb(), member.id, id, { to: asOf }),
    hypotheticalSeries(getDb(), member.id, id, { from: hypotheticalStart(range, asOf), to: asOf }),
  ]).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound()
    throw e
  })
  const t = await getTranslations('portfolio')
  const home = await getTranslations('home')
  const locale = await getLocale()
  const { portfolio, valuation, suggestions, transactions, held, today } = data

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <Link href="/" className="text-[11px] uppercase tracking-[0.12em] text-muted hover:text-text">
              ← {t('backHome')}
            </Link>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{portfolio.name}</h1>
          </div>
          <TransactionSheet portfolioId={portfolio.id} baseCurrency={valuation.baseCurrency} held={held} today={today} label={t('add')} />
        </header>

        <Summary valuation={valuation} />

        {transactions.length > 0 ? (
          <>
            <Performance series={series} range={range} basePath={`/p/${portfolio.id}`} />
            <Hypothetical series={hypothetical} />
          </>
        ) : null}

        {suggestions.map((s) => (
          <SplitBanner
            key={`${s.instrumentId}:${s.date}`}
            portfolioId={portfolio.id}
            instrumentId={s.instrumentId}
            date={s.date}
            numerator={s.numerator}
            denominator={s.denominator}
            message={t('splitFound', { name: s.name, numerator: s.numerator, denominator: s.denominator, date: formatDate(s.date, locale) })}
          />
        ))}

        <section className="flex flex-col gap-4">
          <Overline>{t('holdings')}</Overline>
          {valuation.holdings.length === 0 ? (
            <p className="bg-surface-low px-6 py-5 text-muted">{t('empty')}</p>
          ) : (
            <HoldingsList portfolioId={portfolio.id} holdings={valuation.holdings} baseCurrency={valuation.baseCurrency} />
          )}
        </section>

        {valuation.closed.length > 0 ? (
          <section className="flex flex-col gap-4">
            <Overline>{t('closed')}</Overline>
            <ul className="flex flex-col gap-px bg-bg">
              {valuation.closed.map((c) => (
                <li key={c.instrumentId}>
                  <Link href={`/p/${portfolio.id}/i/${c.instrumentId}`} className="flex items-center justify-between bg-surface-low px-6 py-4 hover:bg-surface-high">
                    <span>{c.name}</span>
                    <span className="text-sm text-muted">
                      {t('realized')}: {formatMoney(c.realizedGain, valuation.baseCurrency, locale, { signed: true })}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-4">
          <Overline>{t('transactions')}</Overline>
          <TransactionsList portfolioId={portfolio.id} baseCurrency={valuation.baseCurrency} held={held} today={today} transactions={transactions.slice(0, 50)} />
        </section>

        <section className="grid gap-px bg-bg sm:grid-cols-2">
          <form action={renamePortfolioAction.bind(null, portfolio.id)} className="flex items-end gap-4 bg-surface-low p-6">
            <div className="flex-1">
              <Field label={t('renameLabel')} htmlFor="rename">
                <Input id="rename" name="name" defaultValue={portfolio.name} maxLength={60} required />
              </Field>
            </div>
            <Button type="submit" variant="secondary">
              {t('rename')}
            </Button>
          </form>
          <div className="flex flex-wrap items-center justify-end gap-2 bg-surface-low p-6">
            <form action={archivePortfolioAction.bind(null, portfolio.id)}>
              <ConfirmSubmit label={t('archive')} confirm={t('archiveConfirm')} />
            </form>
            <form action={deletePortfolioAction.bind(null, portfolio.id)}>
              <ConfirmSubmit label={t('delete')} confirm={t('deleteConfirm')} className="hover:text-loss" />
            </form>
          </div>
          {error === 'name' ? (
            <div className="sm:col-span-2">
              <Alert tone="error">{home('nameError')}</Alert>
            </div>
          ) : null}
        </section>
      </div>
    </AppShell>
  )
}
