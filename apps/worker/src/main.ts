import { createDb, runJob, seedDefaultBenchmarks } from '@pv/db'
import { Cron } from 'croner'
import { Backoff } from './backoff.ts'
import { backfill, refreshFxDaily, refreshFxLatest, refreshHistory, refreshQuotes, type JobContext } from './jobs.ts'
import { selectProviders } from './providers.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Set DATABASE_URL')
const quoteMinutes = Number(process.env.QUOTE_INTERVAL_MINUTES ?? 5)
if (!Number.isInteger(quoteMinutes) || quoteMinutes < 1 || quoteMinutes > 60) throw new Error('QUOTE_INTERVAL_MINUTES must be a whole number from 1 to 60')

const { db } = createDb(databaseUrl, { max: 4 })
const ctx: JobContext = {
  db,
  ...selectProviders(process.env.MARKET_DATA_PROVIDER),
  now: () => new Date(),
  log: (message) => console.log(`[worker] ${message}`),
  backoff: new Backoff(),
}

// A stray rejection is logged instead of ending the process (and a running backfill with it).
process.on('unhandledRejection', (error) => ctx.log(`unhandled rejection: ${error instanceof Error ? error.message : String(error)}`))

const BERLIN = { timezone: 'Europe/Berlin' }

function schedule(pattern: string, job: string, fn: () => Promise<unknown>, options: { timezone?: string } = {}) {
  new Cron(pattern, { ...options, protect: true, catch: (error) => ctx.log(`${job}: ${error instanceof Error ? error.message : String(error)}`) }, async () => {
    await runJob(db, job, fn)
  })
}

schedule(`*/${quoteMinutes} * * * *`, 'quotes', () => refreshQuotes(ctx))
schedule('*/15 * * * *', 'fx-latest', () => refreshFxLatest(ctx))
// The ECB publishes its reference rates around 16:00 CET on working days.
schedule('40 16 * * 1-5', 'fx-daily', () => refreshFxDaily(ctx), BERLIN)
schedule('* * * * *', 'backfill', () => backfill(ctx))
schedule('30 2 * * *', 'history', () => refreshHistory(ctx), BERLIN)
// Benchmarks the provider could not describe at start are tried again once a day.
schedule('20 2 * * *', 'benchmarks', () => seedDefaultBenchmarks(db, (ref) => ctx.provider.describe(ref)), BERLIN)

ctx.log(`started with provider ${ctx.provider.id}, quotes every ${quoteMinutes} min`)
await runJob(db, 'benchmarks', () => seedDefaultBenchmarks(db, (ref) => ctx.provider.describe(ref)))
await runJob(db, 'backfill', () => backfill(ctx))
await runJob(db, 'fx-daily', () => refreshFxDaily(ctx))
await runJob(db, 'quotes', () => refreshQuotes(ctx))
