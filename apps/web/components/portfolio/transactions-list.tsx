import { getLocale, getTranslations } from 'next-intl/server'
import { formatDate, formatMoney, formatPrice, formatQuantity } from '../../lib/format.ts'
import type { EditableTransaction, HeldOption } from '../../lib/portfolio-types.ts'
import { DeleteTransactionButton } from './row-actions.tsx'
import { TransactionSheet } from './transaction-sheet.tsx'

interface Props {
  portfolioId: string
  baseCurrency: string
  held: HeldOption[]
  today: string
  transactions: EditableTransaction[]
  showSecurity?: boolean
}

export async function TransactionsList({ portfolioId, baseCurrency, held, today, transactions, showSecurity = true }: Props) {
  const t = await getTranslations('tx')
  const p = await getTranslations('portfolio')
  const locale = await getLocale()
  if (transactions.length === 0) return <p className="bg-surface-low px-6 py-5 text-muted">{p('noTransactions')}</p>

  function detail(tx: EditableTransaction): string {
    if (tx.type === 'dividend' && tx.amount !== null) return formatMoney(tx.amount, tx.currency, locale)
    if (tx.type === 'split' && tx.splitRatio !== null) {
      return tx.splitRatio >= 1 ? `${formatQuantity(tx.splitRatio, locale)} : 1` : `1 : ${formatQuantity(1 / tx.splitRatio, locale)}`
    }
    if (tx.price !== null) return formatPrice(tx.price, tx.currency, locale)
    return ''
  }

  function compact(tx: EditableTransaction): string {
    const amount = detail(tx)
    return tx.quantity === null ? amount : [formatQuantity(tx.quantity, locale), amount].filter(Boolean).join(' × ')
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-y-px text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted">
            <th className="px-3 py-2 font-medium sm:px-4">{t('date')}</th>
            <th className="hidden px-4 py-2 font-medium sm:table-cell">{t('type')}</th>
            {showSecurity ? <th className="px-3 py-2 font-medium sm:px-4">{t('security')}</th> : <th className="px-3 py-2 font-medium sm:hidden">{t('quantity')}</th>}
            <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">{t('quantity')}</th>
            <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">{t('price')}</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <tr key={tx.id} className="bg-surface-low">
              <td className="px-3 py-3 sm:whitespace-nowrap sm:px-4">
                <span className="whitespace-nowrap">{formatDate(tx.tradeDate, locale)}</span>
                {/* Phones show one compact row: type under the date, amounts under the security. */}
                <span className="block text-xs text-muted sm:hidden">{t(`type_${tx.type}`)}</span>
              </td>
              <td className="hidden whitespace-nowrap px-4 py-3 sm:table-cell">{t(`type_${tx.type}`)}</td>
              <td className={`px-3 py-3 sm:px-4 ${showSecurity ? '' : 'sm:hidden'}`}>
                {showSecurity ? tx.security.name : null}
                <span className={`text-xs text-muted sm:hidden ${showSecurity ? 'block' : ''}`}>{compact(tx)}</span>
              </td>
              <td className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell">{tx.quantity === null ? '' : formatQuantity(tx.quantity, locale)}</td>
              <td className="hidden whitespace-nowrap px-4 py-3 text-right sm:table-cell">{detail(tx)}</td>
              <td className="whitespace-nowrap px-0 py-1 text-right sm:px-2">
                <div className="flex flex-col items-end sm:flex-row sm:justify-end">
                  {tx.linkId ? null : (
                    <TransactionSheet
                      portfolioId={portfolioId}
                      baseCurrency={baseCurrency}
                      held={held}
                      today={today}
                      initial={tx}
                      label={t('edit')}
                      variant="ghost"
                      className="h-9 px-2"
                    />
                  )}
                  <DeleteTransactionButton portfolioId={portfolioId} transactionId={tx.id} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
