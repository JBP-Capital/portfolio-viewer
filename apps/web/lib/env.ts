import { z } from 'zod'

const DEFAULT_SOURCE_URL = 'https://github.com/JBP-Capital/portfolio-viewer'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  /** Public address of this app, without trailing slash. */
  PUBLIC_URL: z.url(),
  /** Server-side base URL of the Supabase-style auth API; `/auth/v1` is appended by the client. */
  AUTH_URL: z.url(),
  AUTH_ANON_KEY: z.string().min(1).optional(),
  /** Hosted: the auth server's service key (deleting accounts, invite e-mails). Self-host mints it from AUTH_JWT_SECRET. */
  AUTH_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Self-host: GoTrue's signing secret, used to mint the anon key when AUTH_ANON_KEY is not set. */
  AUTH_JWT_SECRET: z.string().min(32).optional(),
  /** Self-host: GoTrue container that `/auth/v1/*` is forwarded to. */
  AUTH_PROXY_TARGET: z.url().optional(),
  ALLOW_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Link invites by e-mail address; set only when the auth server confirms addresses before sign-in. */
  TRUST_EMAIL_FOR_INVITES: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Where users get this instance's source code (AGPL-3.0 §13); set it when running a modified copy. */
  SOURCE_URL: z
    .url({ protocol: /^https?$/ })
    .default(DEFAULT_SOURCE_URL)
    // A mistake in a footer link must not take the whole app down; anything but an http(s) address is ignored.
    .catch(() => DEFAULT_SOURCE_URL),
})

export type Env = z.infer<typeof schema>

let cached: Env | undefined

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(source)
}

/** Parsed on first use, so `next build` runs without runtime configuration. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env)
  return cached
}
