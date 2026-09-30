/**
 * Waiting times per key after failures: 5 minutes, doubling up to 1 day; a success resets the key.
 * Short at first so a network blip does not leave a new holding without prices for long.
 */
export class Backoff {
  private readonly initialMs: number
  private readonly maxMs: number
  private readonly waits = new Map<string, { until: number; delay: number }>()

  constructor(initialMs = 5 * 60_000, maxMs = 24 * 60 * 60_000) {
    this.initialMs = initialMs
    this.maxMs = maxMs
  }

  ready(key: string, now: Date): boolean {
    const wait = this.waits.get(key)
    return !wait || now.getTime() >= wait.until
  }

  failed(key: string, now: Date): void {
    const previous = this.waits.get(key)
    const delay = previous ? Math.min(previous.delay * 2, this.maxMs) : this.initialMs
    this.waits.set(key, { until: now.getTime() + delay, delay })
  }

  succeeded(key: string): void {
    this.waits.delete(key)
  }
}
