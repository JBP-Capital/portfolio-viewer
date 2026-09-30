import { NextResponse, type NextRequest } from 'next/server'
import { createAuthClient } from '../../../lib/auth/server.ts'
import { getEnv } from '../../../lib/env.ts'
import { safeNextPath } from '../../../lib/safe-next.ts'

/** Target of e-mail links using the PKCE code flow (sign-up confirmation, password reset). */
export async function GET(request: NextRequest) {
  const base = getEnv().PUBLIC_URL
  const code = request.nextUrl.searchParams.get('code')
  const next = safeNextPath(request.nextUrl.searchParams.get('next'))
  if (code) {
    const supabase = await createAuthClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, base))
  }
  return NextResponse.redirect(new URL('/login?error=link_invalid', base))
}
