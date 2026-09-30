/**
 * True for an ordinary or reverse share split (4:1, 3:2, 1:8). Providers also report spin-off
 * price adjustments as "splits" (GE 1281:1000 for the GE HealthCare spin-off); those change no share
 * count and must never be booked as a split.
 */
export function isRegularSplit(numerator: number, denominator: number): boolean {
  const whole = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100
  return whole(numerator) && whole(denominator) && numerator !== denominator
}
