'use server'

import { claimPairing, NotFoundError, ThrottledError, ValidationError } from '@pv/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMember } from '../../lib/auth/session.ts'
import { getDb } from '../../lib/db.ts'

/** Links the TV showing the code to the signed-in member; the member comes from the session. */
export async function pairTv(form: FormData) {
  const member = await requireMember()
  const code = String(form.get('code') ?? '')
  let error: 'not_found' | 'throttled' | 'name' | null = null
  try {
    await claimPairing(getDb(), member.id, code, form.get('name'))
  } catch (e) {
    if (e instanceof NotFoundError) error = 'not_found'
    else if (e instanceof ThrottledError) error = 'throttled'
    else if (e instanceof ValidationError) error = 'name'
    else throw e
  }
  if (error) redirect(`/pair?error=${error}`)
  revalidatePath('/settings')
  // The result page names nothing from the address, so a crafted link cannot put text on it.
  redirect('/pair?paired=1')
}
