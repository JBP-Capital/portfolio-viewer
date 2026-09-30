import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getAnonKey } from './lib/auth/anon-key.ts'
import { authClientOptions } from './lib/auth/client-options.ts'
import { getEnv } from './lib/env.ts'

/** Refreshes the login session cookie on every page request. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const supabase = createServerClient(getEnv().AUTH_URL, await getAnonKey(), {
    ...authClientOptions(),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value)
        response = NextResponse.next({ request })
        for (const { name, value, options } of list) response.cookies.set(name, value, options)
      },
    },
  })
  await supabase.auth.getClaims()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/v1|api/health|.*\\.(?:svg|png|jpg|jpeg|webp|ico|apk)$).*)'],
}
