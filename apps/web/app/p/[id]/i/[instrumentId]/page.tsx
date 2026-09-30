import { downsample } from '@pv/core'
import { listingPrices, NotFoundError } from '@pv/db'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { AppShell } from '../../../../../components/app-shell.tsx'
import { LineChart, type ChartMarker } from '../../../../../components/charts/line-chart.tsx'
import { RangeTabs } from '../../../../../components/charts/range-tabs.tsx'
import { Figure, Signed } from '../../../../../components/portfolio/figures.tsx'
import { TransactionSheet } from '../../../../../components/portfolio/transaction-sheet.tsx'
import { TransactionsList } from '../../../../../components/portfolio/transactions-list.tsx'
import { Overline } from '../../../../../components/ui.tsx'
import { requireMember } from '../../../../../lib/auth/session.ts'
import { seriesColor } from '../../../../../lib/chart-palette.ts'
import { getDb } from '../../../../../lib/db.ts'
import { formatDate, formatMoney, formatPrice, formatQuantity } from '../../../../../lib/format.ts'
import { loadPortfolioPage } from '../../../../../lib/portfolio-data.ts'
import { parseRange, RANGES, rangeStart, type Range } from '../../../../../lib/ranges.ts'

export default async function PositionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; instrumentId: string }>
  searchParams: Promise<{ range?: string }>
}) {
  const member = await requireMember()
  const { id, instrumentId } = await params
  const range = parseRange((await searchParams).range)
  const data = await loadPortfolioPage(member, id).catch((e: unknown) => {
    if (e instanceof NotFoundError) notFound()
    throw e
  })
  const { portfolio, valuation, transactions, held, today } = data
  const position = [...valuation.holdings, ...valuation.closed].find((h) => h.instrumentId === instrumentId)
  if (!position) notFound()
  const t = await getTranslations('portfolio')
  const locale = await getLocale()
  const base = valuation.baseCurrency
  const own = transactions.filter((x) => x.security.instrumentId === instrumentId)
  const d = await getTranslations('dashboard')
  const from = range === 'MAX' ? '1900-01-01' : rangeStart(range, today, null)
  const prices = downsample(
    (await listingPrices(getDb(), position.listingId, from, today)).map((c) => ({ date: c.date, value: c.close })),
    400,
  )
  const markers: ChartMarker[] = own.flatMap((x) =>
    (x.type === 'buy' || x.type === 'sell') && x.tradeDate >= from && x.quantity !== null && x.price !== null
      ? [
          {
            date: x.tradeDate,
            label: d(x.type === 'buy' ? 'markerBuy' : 'markerSell', { quantity: formatQuantity(x.quantity, locale), price: formatPrice(x.price, x.currency, locale) }),
          },
        ]
      : [],
  )
  const rangeLabels = Object.fromEntries(RANGES.map((r) => [r, d(`range.${r}`)])) as Record<Range, string>

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <Link href={`/p/${portfolio.id}`} className="text-[11px] uppercase tracking-[0.12em] text-muted hover:text-text">
              ← {t('back', { name: portfolio.name })}
            </Link>
            <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{position.name}</h1>
            <Overline>
              {position.symbol} · {position.mic} · {position.currency}
            </Overline>
          </div>
          <TransactionSheet
            portfolioId={portfolio.id}
            baseCurrency={base}
            held={held}
            today={today}
            label={t('add')}
            preset={{ type: position.quantity > 0 ? 'sell' : 'buy', instrumentId }}
          />
        </header>

        <section className="grid gap-px bg-bg sm:grid-cols-4">
          <div className="flex flex-col gap-2 bg-surface-low p-6 sm:col-span-2 sm:p-8">
            <Overline>{t('value')}</Overline>
            <p className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{position.value === null ? '–' : formatMoney(position.value, base, locale)}</p>
            {position.priceDate ? <p className="text-xs text-muted">{t('priceDate', { date: formatDate(position.priceDate, locale) })}</p> : null}
          </div>
          <Figure label={t('shares')}>
            <span data-testid="position-quantity">{formatQuantity(position.quantity, locale)}</span>
          </Figure>
          <Figure label={t('price')}>{position.price === null ? '–' : formatPrice(position.price, position.currency, locale)}</Figure>
          <Figure label={t('avgCost')}>{position.averageCost === null ? '–' : formatPrice(position.averageCost, base, locale)}</Figure>
          <Figure label={t('costBasis')}>{formatMoney(position.costBasis, base, locale)}</Figure>
          <Figure label={t('unrealized')}>
            <Signed value={position.unrealizedGain} currency={base} locale={locale} base={position.costBasis} />
          </Figure>
          <Figure label={t('realized')}>
            <Signed value={position.realizedGain} currency={base} locale={locale} />
          </Figure>
          <Figure label={t('dividends')} className="sm:col-span-4">
            <Signed value={position.dividendsNet} currency={base} locale={locale} />
          </Figure>
        </section>

        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Overline>{d('priceHistory')}</Overline>
            <RangeTabs current={range} basePath={`/p/${portfolio.id}/i/${instrumentId}`} label={d('rangeLabel')} labels={rangeLabels} />
          </div>
          <div className="bg-surface-low p-6">
            <LineChart
              series={[{ id: 'price', label: d('priceHistory'), color: seriesColor(0), points: prices }]}
              format={{ kind: 'price', currency: position.currency }}
              locale={locale}
              label={d('priceChartLabel', { name: position.name })}
              emptyText={d('noChartData')}
              markers={markers}
              area
            />
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <Overline>{t('transactions')}</Overline>
          <TransactionsList portfolioId={portfolio.id} baseCurrency={base} held={held} today={today} transactions={own} showSecurity={false} />
        </section>
      </div>
    </AppShell>
  )
}
