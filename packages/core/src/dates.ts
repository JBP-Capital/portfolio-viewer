const DAY_MS = 86_400_000

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Date.UTC(y!, m! - 1, d!)
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS)
}

/** Adds calendar months; the day is clamped to the last day of the target month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const total = y! * 12 + (m! - 1) + months
  const year = Math.floor(total / 12)
  const month = total - year * 12
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return fromUtc(Date.UTC(year, month, Math.min(d!, lastDay)))
}

export function endOfPreviousMonth(date: string): string {
  return addDays(`${date.slice(0, 7)}-01`, -1)
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = []
  for (let t = toUtc(from), end = toUtc(to); t <= end; t += DAY_MS) days.push(fromUtc(t))
  return days
}

/** The calendar date (YYYY-MM-DD) at `now` in the given IANA time zone. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
