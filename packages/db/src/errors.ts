import type { z } from 'zod'

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Ids come from URLs and forms; one that is not even a UUID names nothing (and must not reach Postgres). */
export function isId(id: string): boolean {
  return UUID.test(id)
}

export function assertId(id: string, what: string): void {
  if (!isId(id)) throw new NotFoundError(what)
}

export class ValidationError extends Error {
  readonly issues: readonly { path: string; message: string }[]

  constructor(message: string, issues: readonly { path: string; message: string }[] = []) {
    super(message)
    this.name = 'ValidationError'
    this.issues = issues
  }
}

/** Too many failed attempts in a short time (e.g. guessed pairing codes). */
export class ThrottledError extends Error {
  constructor() {
    super('Too many attempts')
    this.name = 'ThrottledError'
  }
}

export class FxRateMissingError extends Error {
  readonly currency: string
  readonly date: string

  constructor(currency: string, date: string) {
    super(`No exchange rate for ${currency} within 7 days before ${date}; enter the rate manually`)
    this.name = 'FxRateMissingError'
    this.currency = currency
    this.date = date
  }
}

export function parseInput<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
  throw new ValidationError(issues.map((i) => `${i.path}: ${i.message}`).join('; '), issues)
}
