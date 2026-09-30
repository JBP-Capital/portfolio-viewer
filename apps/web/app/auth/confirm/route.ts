import type { EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createAuthClient } from '../../../lib/auth/server.ts'
import { getEnv } from '../../../lib/env.ts'
import { safeNextPath } from '../../../lib/safe-next.ts'

const TYPES: EmailOtpType[] = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email']

/** Target of e-mail templates that link with `token_hash` (e.g. invites). */
export async function GET(request: NextRequest) {
  const base = getEnv().PUBLIC_URL
  const tokenHash = request.nextUrl.searchParams.get('token_hash')
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null
  const fallback = type === 'recovery' || type === 'invite' ? '/reset-password' : '/'
  const next = safeNextPath(request.nextUrl.searchParams.get('next'), fallback)
  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createAuthClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(new URL(next, base))
  }
  return NextResponse.redirect(new URL('/login?error=link_invalid', base))
}
