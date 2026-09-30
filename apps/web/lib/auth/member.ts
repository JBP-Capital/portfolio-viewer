import { resolveAccess, type Member } from '@pv/db'
import { getDb } from '../db.ts'
import { getEnv } from '../env.ts'
import { getSessionUser } from './session.ts'

/** The current member, or null — for JSON routes that answer 401 instead of redirecting. */
export async function getMember(): Promise<Member | null> {
  const user = await getSessionUser()
  if (!user) return null
  const access = await resolveAccess(getDb(), user, { linkInvitesByEmail: getEnv().TRUST_EMAIL_FOR_INVITES })
  return access.kind === 'ok' ? access.member : null
}
