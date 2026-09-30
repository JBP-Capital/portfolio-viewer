'use server'

import { claimInvite } from '@pv/db'
import { redirect } from 'next/navigation'
import { getSessionUser } from '../../../lib/auth/session.ts'
import { getDb } from '../../../lib/db.ts'

/** Links the signed-in account to the invite behind this one-time link. */
export async function acceptInvite(token: string) {
  const user = await getSessionUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)
  const result = await claimInvite(getDb(), token, user)
  if (result.kind === 'invalid') redirect(`/invite/${encodeURIComponent(token)}?invalid=1`)
  redirect('/')
}
