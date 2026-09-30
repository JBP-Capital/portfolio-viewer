'use server'

import { deleteMember, NotFoundError, revokeDevice, updateMemberSettings, ValidationError } from '@pv/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { removeLogin } from '../../lib/auth/admin.ts'
import { createAuthClient } from '../../lib/auth/server.ts'
import { requireMember } from '../../lib/auth/session.ts'
import { getDb } from '../../lib/db.ts'
import { setLocaleCookie } from '../../lib/locale-cookie.ts'

const text = (form: FormData, key: string) => {
  const value = form.get(key)
  return typeof value === 'string' ? value : undefined
}

/** Saves the member's own settings; the member comes from the session, never from the form. */
export async function saveSettings(form: FormData) {
  const member = await requireMember()
  const input = {
    displayName: text(form, 'displayName'),
    locale: text(form, 'locale'),
    timezone: text(form, 'timezone'),
    // A disabled select is not sent: the base currency then stays as it is.
    baseCurrency: text(form, 'baseCurrency'),
  }
  try {
    const saved = await updateMemberSettings(getDb(), member.id, input)
    await setLocaleCookie(saved.locale)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    const issue = error.issues[0]
    redirect(`/settings?error=${encodeURIComponent(`${issue?.path ?? 'form'}:${issue?.message === 'has_transactions' ? 'has_transactions' : 'invalid'}`)}`)
  }
  revalidatePath('/', 'layout')
  redirect('/settings?saved=1')
}

/** Deletes the account after the member typed their e-mail address, then signs out. */
export async function deleteAccount(form: FormData) {
  const member = await requireMember()
  if ((text(form, 'confirmEmail') ?? '').trim().toLowerCase() !== member.email) redirect('/settings?error=confirm:mismatch')
  try {
    const { userId } = await deleteMember(getDb(), member.id)
    await removeLogin(userId)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    redirect('/settings?error=delete:last_admin')
  }
  const supabase = await createAuthClient()
  await supabase.auth.signOut()
  redirect('/login?notice=account_deleted')
}

/** Unpairs one of the member's TVs; it shows the pairing screen again on its next refresh. */
export async function removeDevice(deviceId: string) {
  const member = await requireMember()
  try {
    await revokeDevice(getDb(), member.id, deviceId)
  } catch (error) {
    // Already removed (a second tab, a double click): the result is the same.
    if (!(error instanceof NotFoundError)) throw error
  }
  revalidatePath('/settings')
  redirect('/settings?removed=1')
}
