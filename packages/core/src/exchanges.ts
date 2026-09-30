import { todayInTimeZone } from './dates.ts'

export interface Exchange {
  mic: string
  name: string
  country: string
  timezone: string
  /** Local opening time, HH:MM. */
  open: string
  /** Local closing time, HH:MM. */
  close: string
}

function exchange(mic: string, name: string, country: string, timezone: string, open: string, close: string): [string, Exchange] {
  return [mic, { mic, name, country, timezone, open, close }]
}

const NY = 'America/New_York'
const TORONTO = 'America/Toronto'
const BERLIN = 'Europe/Berlin'

export const EXCHANGES: Record<string, Exchange> = Object.fromEntries([
  exchange('XNYS', 'New York Stock Exchange', 'US', NY, '09:30', '16:00'),
  exchange('XNAS', 'Nasdaq', 'US', NY, '09:30', '16:00'),
  exchange('XASE', 'NYSE American', 'US', NY, '09:30', '16:00'),
  exchange('ARCX', 'NYSE Arca', 'US', NY, '09:30', '16:00'),
  exchange('BATS', 'Cboe BZX', 'US', NY, '09:30', '16:00'),
  exchange('OTCM', 'OTC Markets', 'US', NY, '09:30', '16:00'),
  exchange('XTSE', 'Toronto Stock Exchange', 'CA', TORONTO, '09:30', '16:00'),
  exchange('XTSX', 'TSX Venture Exchange', 'CA', TORONTO, '09:30', '16:00'),
  exchange('XCNQ', 'Canadian Securities Exchange', 'CA', TORONTO, '09:30', '16:00'),
  exchange('NEOE', 'Cboe Canada', 'CA', TORONTO, '09:30', '16:00'),
  exchange('XLON', 'London Stock Exchange', 'GB', 'Europe/London', '08:00', '16:30'),
  exchange('XETR', 'Xetra', 'DE', BERLIN, '09:00', '17:30'),
  exchange('XFRA', 'Frankfurt', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XSTU', 'Stuttgart', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XMUN', 'Munich', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XBER', 'Berlin', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XDUS', 'Düsseldorf', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XHAM', 'Hamburg', 'DE', BERLIN, '08:00', '22:00'),
  exchange('XPAR', 'Euronext Paris', 'FR', 'Europe/Paris', '09:00', '17:30'),
  exchange('XAMS', 'Euronext Amsterdam', 'NL', 'Europe/Amsterdam', '09:00', '17:30'),
  exchange('XBRU', 'Euronext Brussels', 'BE', 'Europe/Brussels', '09:00', '17:30'),
  exchange('XLIS', 'Euronext Lisbon', 'PT', 'Europe/Lisbon', '08:00', '16:30'),
  exchange('XDUB', 'Euronext Dublin', 'IE', 'Europe/Dublin', '08:00', '16:30'),
  exchange('XMIL', 'Borsa Italiana', 'IT', 'Europe/Rome', '09:00', '17:30'),
  exchange('XMAD', 'Bolsa de Madrid', 'ES', 'Europe/Madrid', '09:00', '17:30'),
  exchange('XWBO', 'Wiener Börse', 'AT', 'Europe/Vienna', '09:00', '17:30'),
  exchange('XSWX', 'SIX Swiss Exchange', 'CH', 'Europe/Zurich', '09:00', '17:30'),
  exchange('XSTO', 'Nasdaq Stockholm', 'SE', 'Europe/Stockholm', '09:00', '17:30'),
  exchange('XOSL', 'Oslo Børs', 'NO', 'Europe/Oslo', '09:00', '16:20'),
  exchange('XCSE', 'Nasdaq Copenhagen', 'DK', 'Europe/Copenhagen', '09:00', '17:00'),
  exchange('XHEL', 'Nasdaq Helsinki', 'FI', 'Europe/Helsinki', '10:00', '18:30'),
  exchange('XASX', 'Australian Securities Exchange', 'AU', 'Australia/Sydney', '10:00', '16:00'),
  exchange('XNZE', 'NZX', 'NZ', 'Pacific/Auckland', '10:00', '16:45'),
  exchange('XHKG', 'Hong Kong Exchange', 'HK', 'Asia/Hong_Kong', '09:30', '16:00'),
  exchange('XTKS', 'Tokyo Stock Exchange', 'JP', 'Asia/Tokyo', '09:00', '15:30'),
  exchange('XJSE', 'Johannesburg Stock Exchange', 'ZA', 'Africa/Johannesburg', '09:00', '17:00'),
])

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

function localWeekdayAndMinutes(timeZone: string, now: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { weekday: get('weekday'), minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

/**
 * True on weekdays between the local open and the close plus a grace period, so the final prices of
 * the day are still picked up. Holidays are not modelled (a few extra requests are harmless).
 */
export function isExchangeOpen(mic: string, now: Date, graceMinutes = 30): boolean {
  const ex = EXCHANGES[mic]
  if (!ex) return true
  const local = localWeekdayAndMinutes(ex.timezone, now)
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return false
  return local.minutes >= minutes(ex.open) && local.minutes <= minutes(ex.close) + graceMinutes
}

/**
 * True when the exchange's session of its current local date is over (after the close, or a
 * weekend). Unknown exchanges count as still running, so their price of the day is never taken
 * for a close too early.
 */
export function hasSessionEnded(mic: string, now: Date): boolean {
  const ex = EXCHANGES[mic]
  if (!ex) return false
  const local = localWeekdayAndMinutes(ex.timezone, now)
  if (local.weekday === 'Sat' || local.weekday === 'Sun') return true
  return local.minutes >= minutes(ex.close)
}

/** The trading date of an exchange at a moment (its local calendar date). */
export function exchangeDate(mic: string, at: Date): string {
  return todayInTimeZone(EXCHANGES[mic]?.timezone ?? 'UTC', at)
}
