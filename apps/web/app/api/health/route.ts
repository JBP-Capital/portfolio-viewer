import { sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import pkg from '../../../package.json' with { type: 'json' }
import { getDb } from '../../../lib/db.ts'

export const dynamic = 'force-dynamic'

export async function GET() {
  const body = { app: 'portfolio-viewer', version: pkg.version }
  try {
    await getDb().execute(sql`select 1`)
    return NextResponse.json({ ...body, database: 'ok' })
  } catch {
    return NextResponse.json({ ...body, database: 'unavailable' }, { status: 503 })
  }
}
