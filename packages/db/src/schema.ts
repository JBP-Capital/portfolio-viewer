import { INSTRUMENT_TYPES, TRANSACTION_TYPES, type ImportRow } from '@pv/core'
import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const amount = (name: string) => numeric(name, { mode: 'number' })

export const memberRole = pgEnum('member_role', ['admin', 'member'])
export const memberStatus = pgEnum('member_status', ['invited', 'active', 'disabled'])
export const instrumentType = pgEnum('instrument_type', INSTRUMENT_TYPES)
export const transactionType = pgEnum('transaction_type', TRANSACTION_TYPES)
export const transactionSource = pgEnum('transaction_source', ['manual', 'import'])

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').unique(),
    email: text('email').notNull().unique(),
    role: memberRole('role').notNull().default('member'),
    status: memberStatus('status').notNull().default('invited'),
    displayName: text('display_name'),
    locale: text('locale').notNull().default('en'),
    baseCurrency: char('base_currency', { length: 3 }).notNull().default('EUR'),
    timezone: text('timezone').notNull().default('Europe/Berlin'),
    createdAt: createdAt(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (t) => [check('members_email_lowercase', sql`${t.email} = lower(${t.email})`)],
)

export const portfolios = pgTable(
  'portfolios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('portfolios_member_idx').on(t.memberId)],
)

export const instruments = pgTable('instruments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  isin: text('isin').unique(),
  type: instrumentType('type').notNull().default('stock'),
  sector: text('sector'),
  country: text('country'),
  logoUrl: text('logo_url'),
  defaultListingId: uuid('default_listing_id').references((): AnyPgColumn => listings.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    mic: text('mic').notNull(),
    symbol: text('symbol').notNull(),
    currency: char('currency', { length: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('listings_mic_symbol_idx').on(t.mic, t.symbol)],
)

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'restrict' }),
    listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'set null' }),
    type: transactionType('type').notNull(),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(),
    quantity: amount('quantity'),
    price: amount('price'),
    currency: char('currency', { length: 3 }).notNull(),
    fxRate: amount('fx_rate').notNull(),
    fees: amount('fees').notNull().default(0),
    taxes: amount('taxes').notNull().default(0),
    amount: amount('amount'),
    splitRatio: amount('split_ratio'),
    linkId: uuid('link_id'),
    note: text('note'),
    source: transactionSource('source').notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('transactions_portfolio_idx').on(t.portfolioId, t.tradeDate), index('transactions_link_idx').on(t.linkId)],
)

/** Failed password logins per address, for throttling guessing attempts. */
export const loginAttempts = pgTable(
  'login_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('login_attempts_email_idx').on(t.email, t.attemptedAt)],
)

export const quotes = pgTable('quotes', {
  listingId: uuid('listing_id')
    .primaryKey()
    .references(() => listings.id, { onDelete: 'cascade' }),
  price: amount('price').notNull(),
  previousClose: amount('previous_close'),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Real (unadjusted) closes in the listing currency. */
export const dailyPrices = pgTable(
  'daily_prices',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    close: amount('close').notNull(),
    source: text('source').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.date] })],
)

export const intradayPrices = pgTable(
  'intraday_prices',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    price: amount('price').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.ts] })],
)

export const fxLatest = pgTable('fx_latest', {
  currency: char('currency', { length: 3 }).primaryKey(),
  perEur: amount('per_eur').notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
})

export const referenceDividends = pgTable(
  'reference_dividends',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    exDate: date('ex_date', { mode: 'string' }).notNull(),
    amount: amount('amount').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.exDate] })],
)

/**
 * Price adjustments the provider reports as splits. Spin-offs appear here too (e.g. 1281:1000);
 * only ratios passing `isRegularSplit` may be offered as split bookings, never booked automatically.
 */
export const referenceSplits = pgTable(
  'reference_splits',
  {
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    numerator: amount('numerator').notNull(),
    denominator: amount('denominator').notNull(),
    ratio: amount('ratio').notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.date] })],
)

/** Split suggestions a member chose not to book (e.g. already entered with post-split quantities). */
export const dismissedSplits = pgTable(
  'dismissed_splits',
  {
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    instrumentId: uuid('instrument_id')
      .notNull()
      .references(() => instruments.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.portfolioId, t.instrumentId, t.date] })],
)

/** TVs paired with a member: read-only access through a device token, stored as its SHA-256 hash. */
export const tvDevices = pgTable('tv_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  memberId: uuid('member_id')
    .notNull()
    .references(() => members.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Null until the TV has fetched its token. */
  tokenHash: text('token_hash').unique(),
  createdAt: createdAt(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
})

/** Codes a TV shows while it waits to be paired; only the browser holding the poll secret gets the token. */
export const pairingCodes = pgTable('pairing_codes', {
  code: char('code', { length: 6 }).primaryKey(),
  pollSecretHash: text('poll_secret_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  deviceId: uuid('device_id').references(() => tvDevices.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
})

/** Comparison lines for returns (ETFs that track an index), instance-wide, priced like held securities. */
export const benchmarks = pgTable('benchmarks', {
  listingId: uuid('listing_id')
    .primaryKey()
    .references(() => listings.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  position: integer('position').notNull().default(0),
})

export const jobStatus = pgTable('job_status', {
  job: text('job').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
})

/** Daily reference rates: units of `currency` per one euro (ECB convention). */
export const fxRates = pgTable(
  'fx_rates',
  {
    currency: char('currency', { length: 3 }).notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    perEur: amount('per_eur').notNull(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })],
)

/** Checked CSV rows between the import preview and its confirmation (15 minutes). */
export const importDrafts = pgTable(
  'import_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    rows: jsonb('rows').$type<ImportRow[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('import_drafts_member_idx').on(t.memberId)],
)

/** One-time invite links for self-hosted instances: 32 random bytes, stored as SHA-256, valid 7 days. */
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => members.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('invites_member_idx').on(t.memberId)],
)
