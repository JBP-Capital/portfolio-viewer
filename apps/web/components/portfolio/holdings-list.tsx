import type { Holding } from '@pv/db'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { formatMoney, formatPercent, formatPrice, formatQuantity } from '../../lib/format.ts'
import { Signed } from './figures.tsx'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase()
}

export async function HoldingsList({ portfolioId, holdings, baseCurrency }: { portfolioId: string; holdings: Holding[]; baseCurrency: string }) {
  const t = await getTranslations('portfolio')
  const locale = await getLocale()
  return (
    <ul className="flex flex-col gap-px bg-bg">
      {holdings.map((h) => {
        const dayPercent = h.price !== null && h.previousClose ? (h.price - h.previousClose) / h.previousClose : null
        return (
          <li key={h.instrumentId}>
            <Link
              href={`/p/${portfolioId}/i/${h.instrumentId}`}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-4 bg-surface-low px-4 py-4 transition hover:bg-surface-high sm:grid-cols-[auto_2fr_1fr_1fr_1.2fr] sm:px-6"
            >
              <span aria-hidden className="flex size-11 items-center justify-center bg-surface-highest font-display text-sm font-bold text-gold">
                {initials(h.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{h.name}</span>
                <span className="block text-xs text-muted">
                  {h.symbol} · {h.mic} · {formatQuantity(h.quantity, locale)} {t('shares')}
                </span>
              </span>
              <span className="hidden text-right sm:block">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">{t('price')}</span>
                <span className="block">{h.price === null ? '–' : formatPrice(h.price, h.currency, locale)}</span>
                <span className={`block text-xs ${dayPercent === null ? 'text-muted' : dayPercent >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {dayPercent === null ? t('noPrice') : formatPercent(dayPercent, locale, { signed: true })}
                </span>
              </span>
              <span className="hidden text-right sm:block">
                <span className="block text-[11px] uppercase tracking-[0.12em] text-muted">{t('avgCost')}</span>
                <span className="block">{h.averageCost === null ? '–' : formatPrice(h.averageCost, baseCurrency, locale)}</span>
              </span>
              <span className="text-right">
                <span className="block font-display text-lg font-semibold">{h.value === null ? '–' : formatMoney(h.value, baseCurrency, locale)}</span>
                <span className="block text-xs">
                  <Signed value={h.unrealizedGain} currency={baseCurrency} locale={locale} base={h.costBasis} />
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
