import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getEnv } from '../env.ts'
import { getAnonKey } from './anon-key.ts'
import { authClientOptions } from './client-options.ts'

/** Auth client for Server Components, Server Actions and Route Handlers. */
export async function createAuthClient() {
  const cookieStore = await cookies()
  return createServerClient(getEnv().AUTH_URL, await getAnonKey(), {
    ...authClientOptions(),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) cookieStore.set(name, value, options)
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session on the next request.
        }
      },
    },
  })
}
