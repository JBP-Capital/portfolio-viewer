'use server'

import { createInvite, removeMember, revokeInvite, setMemberRole, setMemberStatus, ValidationError } from '@pv/db'
import { revalidatePath } from 'next/cache'
import { removeLogin } from '../../lib/auth/admin.ts'
import { requireAdmin } from '../../lib/auth/session.ts'
import { getDb } from '../../lib/db.ts'
import { getEnv } from '../../lib/env.ts'

export type InviteResult = { ok: true; link: string; email: string } | { ok: false; error: 'exists' | 'invalid' }

/** Creates a one-time invite link; it is shown once and never stored in plain text. */
export async function inviteMember(form: FormData): Promise<InviteResult> {
  const admin = await requireAdmin()
  const email = String(form.get('email') ?? '')
  try {
    const { token } = await createInvite(getDb(), admin.id, email)
    revalidatePath('/admin')
    return { ok: true, link: `${getEnv().PUBLIC_URL}/invite/${token}`, email: email.trim().toLowerCase() }
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    return { ok: false, error: error.issues[0]?.message === 'exists' ? 'exists' : 'invalid' }
  }
}

export async function changeStatus(memberId: string, status: 'active' | 'disabled') {
  const admin = await requireAdmin()
  await setMemberStatus(getDb(), admin.id, memberId, status)
  revalidatePath('/admin')
}

export async function changeRole(memberId: string, role: 'admin' | 'member') {
  const admin = await requireAdmin()
  await setMemberRole(getDb(), admin.id, memberId, role)
  revalidatePath('/admin')
}

export async function withdrawInvite(memberId: string) {
  const admin = await requireAdmin()
  await revokeInvite(getDb(), admin.id, memberId)
  revalidatePath('/admin')
}

/** Deletes another member with all their data, and their login account. */
export async function deleteMemberAction(memberId: string) {
  const admin = await requireAdmin()
  const { userId } = await removeMember(getDb(), admin.id, memberId)
  await removeLogin(userId)
  revalidatePath('/admin')
}
