import { exportCsv, type ExportRecord } from '@pv/core'
import { exportRecords } from '@pv/db'
import { NextResponse, type NextRequest } from 'next/server'
import { getMember } from '../../../lib/auth/member.ts'
import { getDb } from '../../../lib/db.ts'

export const dynamic = 'force-dynamic'

const EXAMPLE: ExportRecord[] = [
  { date: '2026-01-05', portfolio: 'Main', type: 'buy', isin: 'CA0084741085', symbol: 'AEM', exchange: 'XNYS', quantity: 10, price: 101.5, currency: 'USD', fees: 4.9, taxes: 0, amount: null, note: 'example', fxRate: null, splitRatio: null, link: null },
]

/** All of the member's transactions as CSV (`?template=1`: the column layout with one example row). */
export async function GET(request: NextRequest) {
  const member = await getMember()
  if (!member) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const template = request.nextUrl.searchParams.get('template') === '1'
  const records = template ? EXAMPLE : await exportRecords(getDb(), member.id)
  const name = template ? 'portfolio-viewer-template.csv' : `portfolio-viewer-${new Date().toISOString().slice(0, 10)}.csv`
  return new NextResponse(exportCsv(records), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
