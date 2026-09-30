import { resolveAccess, type Member } from '@pv/db'
import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getDb } from '../db.ts'
import { getEnv } from '../env.ts'
import { createAuthClient } from './server.ts'

export interface SessionUser {
  id: string
  email: string
}

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createAuthClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub || typeof claims.email !== 'string') return null
  return { id: claims.sub, email: claims.email }
})

/** The member behind the current request; redirects to /login or /no-access otherwise. */
export const requireMember = cache(async (): Promise<Member> => {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const access = await resolveAccess(getDb(), user, { linkInvitesByEmail: getEnv().TRUST_EMAIL_FOR_INVITES })
  if (access.kind !== 'ok') redirect(`/no-access?reason=${access.kind}`)
  return access.member
})

/** The current member if they are an administrator; everyone else is sent to the portfolio list. */
export const requireAdmin = cache(async (): Promise<Member> => {
  const member = await requireMember()
  if (member.role !== 'admin') redirect('/')
  return member
})

/** The signed-in member, or null without redirecting (for pages a paired TV can also open). */
export const getSessionMember = cache(async (): Promise<Member | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const access = await resolveAccess(getDb(), user, { linkInvitesByEmail: getEnv().TRUST_EMAIL_FOR_INVITES })
  return access.kind === 'ok' ? access.member : null
})
