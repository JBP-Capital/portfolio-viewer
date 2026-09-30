import { todayInTimeZone } from '@pv/core'
import { allocation, hypotheticalSeries, listPortfolios, memberSeries, valueMember } from '@pv/db'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { AppShell } from '../components/app-shell.tsx'
import { AllocationBars } from '../components/dashboard/allocation-bars.tsx'
import { Hypothetical } from '../components/dashboard/hypothetical.tsx'
import { Movers } from '../components/dashboard/movers.tsx'
import { Performance } from '../components/dashboard/performance.tsx'
import { Signed } from '../components/portfolio/figures.tsx'
import { Summary } from '../components/portfolio/summary.tsx'
import { Alert, Button, Card, Field, Input, Overline } from '../components/ui.tsx'
import { requireMember } from '../lib/auth/session.ts'
import { getDb } from '../lib/db.ts'
import { allocationLabel } from '../lib/display-names.ts'
import { formatMoney } from '../lib/format.ts'
import { hypotheticalStart, parseRange } from '../lib/ranges.ts'
import { createPortfolioAction } from './actions.ts'

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string; range?: string }> }) {
  const member = await requireMember()
  const { error, range: rawRange } = await searchParams
  const range = parseRange(rawRange)
  const t = await getTranslations('home')
  const p = await getTranslations('portfolio')
  const d = await getTranslations('dashboard')
  const locale = await getLocale()
  const db = getDb()
  const today = todayInTimeZone(member.timezone)
  const [portfolios, total, series, hypothetical] = await Promise.all([
    listPortfolios(db, member.id),
    valueMember(db, member.id),
    memberSeries(db, member.id, null, { to: today }),
    hypotheticalSeries(db, member.id, null, { from: hypotheticalStart(range, today), to: today }),
  ])
  const valuations = new Map(total.portfolios.map((v) => [v.portfolioId, v]))
  const base = total.baseCurrency
  const priced = total.holdings.some((h) => h.value !== null)
  const words = { unknown: d('unknown'), other: d('other') }

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-2">
          <Overline>
            {t('greeting', { email: member.email })} · <span className="text-gold">{member.role === 'admin' ? t('roleAdmin') : t('roleMember')}</span>
          </Overline>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{t('portfolios')}</h1>
        </header>

        {portfolios.length > 0 ? (
          <>
            <Summary valuation={total} />
            <Performance series={series} range={range} basePath="/" />
            <Hypothetical series={hypothetical} />
          </>
        ) : null}

        {priced ? (
          <section className="flex flex-col gap-4">
            <Overline>{d('allocation')}</Overline>
            <div className="grid gap-px bg-bg lg:grid-cols-3">
              <AllocationBars title={d('bySector')} slices={allocation(total.holdings, 'sector')} labelFor={(s) => allocationLabel('sector', s, locale, words)} currency={base} locale={locale} />
              <AllocationBars
                title={d('byCurrency')}
                slices={allocation(total.holdings, 'currency')}
                labelFor={(s) => allocationLabel('currency', s, locale, words)}
                currency={base}
                locale={locale}
              />
              <AllocationBars
                title={d('byCountry')}
                slices={allocation(total.holdings, 'country')}
                labelFor={(s) => allocationLabel('country', s, locale, words)}
                currency={base}
                locale={locale}
              />
            </div>
          </section>
        ) : null}

        {priced ? <Movers holdings={total.holdings} currency={base} /> : null}

        {portfolios.length === 0 ? (
          <p className="text-muted">{t('empty')}</p>
        ) : (
          <section className="flex flex-col gap-4">
            <Overline>{t('portfolios')}</Overline>
            <ul className="grid gap-px bg-bg sm:grid-cols-2">
              {portfolios.map((portfolio) => {
                const v = valuations.get(portfolio.id)
                const hasValue = v?.holdings.some((h) => h.value !== null) ?? false
                return (
                  <li key={portfolio.id}>
                    <Link href={`/p/${portfolio.id}`} className="flex h-full flex-col gap-4 bg-surface-low px-6 py-6 transition hover:bg-surface-high">
                      <span className="font-display text-xl font-semibold">{portfolio.name}</span>
                      <span className="font-display text-3xl font-bold tracking-tight">
                        {v && hasValue ? formatMoney(v.totals.value, v.baseCurrency, locale) : <span className="text-base font-normal text-muted">{t('noValue')}</span>}
                      </span>
                      {v && hasValue ? (
                        <span className="text-sm">
                          {p('dayChange')} <Signed value={v.totals.dayChange} currency={v.baseCurrency} locale={locale} base={v.totals.value - v.totals.dayChange} />
                        </span>
                      ) : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <Card>
          <form action={createPortfolioAction} className="flex flex-col gap-6 sm:flex-row sm:items-end">
            <div className="flex-1">
              <Field label={t('newName')} htmlFor="name">
                <Input id="name" name="name" maxLength={60} required />
              </Field>
            </div>
            <Button type="submit">{t('create')}</Button>
          </form>
          {error === 'name' ? (
            <div className="mt-6">
              <Alert tone="error">{t('nameError')}</Alert>
            </div>
          ) : null}
        </Card>
      </div>
    </AppShell>
  )
}
