import { pollPairing, startPairing, ThrottledError } from '@pv/db'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { DEVICE_COOKIE, deviceCookieOptions, PAIRING_COOKIE, pairingCookieOptions } from '../../../../lib/auth/device-cookie.ts'
import { getDb } from '../../../../lib/db.ts'
import { getEnv } from '../../../../lib/env.ts'

// The TV's only way in without a sign-in: it asks for a code, then polls until a member claims it.
const NO_STORE = { 'Cache-Control': 'no-store' }
// TVs often run on a wrong clock, so the page counts down from the server's figure.
const secondsLeft = (expiresAt: Date) => Math.max(0, Math.round((expiresAt.getTime() - Date.now()) / 1000))

export async function POST() {
  try {
    const { code, pollSecret, expiresAt } = await startPairing(getDb())
    const response = NextResponse.json({ status: 'waiting', code, secondsLeft: secondsLeft(expiresAt) }, { headers: NO_STORE })
    response.cookies.set(PAIRING_COOKIE, pollSecret, pairingCookieOptions(getEnv().PUBLIC_URL))
    return response
  } catch (error) {
    if (error instanceof ThrottledError) return NextResponse.json({ status: 'busy' }, { status: 503, headers: { ...NO_STORE, 'Retry-After': '60' } })
    throw error
  }
}

export async function GET() {
  const secret = (await cookies()).get(PAIRING_COOKIE)?.value
  const poll = secret ? await pollPairing(getDb(), secret) : ({ status: 'expired' } as const)
  if (poll.status === 'paired') {
    const publicUrl = getEnv().PUBLIC_URL
    const response = NextResponse.json({ status: 'paired' }, { headers: NO_STORE })
    response.cookies.set(DEVICE_COOKIE, poll.token, deviceCookieOptions(publicUrl))
    response.cookies.set(PAIRING_COOKIE, '', { ...pairingCookieOptions(publicUrl), maxAge: 0 })
    return response
  }
  const body = poll.status === 'waiting' ? { status: 'waiting', code: poll.code, secondsLeft: secondsLeft(poll.expiresAt) } : { status: 'expired' }
  return NextResponse.json(body, { headers: NO_STORE })
}
