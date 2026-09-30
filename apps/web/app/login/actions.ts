'use server'

import { clearFailedLogins, isLoginThrottled, memberLocale, recordFailedLogin } from '@pv/db'
import { redirect } from 'next/navigation'
import { createAuthClient } from '../../lib/auth/server.ts'
import { getDb } from '../../lib/db.ts'
import { getEnv } from '../../lib/env.ts'
import { setLocaleCookie } from '../../lib/locale-cookie.ts'
import { safeNextPath } from '../../lib/safe-next.ts'

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim()

export async function signIn(form: FormData) {
  const email = text(form, 'email')
  const db = getDb()
  if (await isLoginThrottled(db, email)) redirect('/login?error=too_many_attempts')
  const supabase = await createAuthClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: String(form.get('password') ?? '') })
  if (error) {
    await recordFailedLogin(db, email)
    redirect('/login?error=invalid_credentials')
  }
  await clearFailedLogins(db, email)
  const locale = data.user ? await memberLocale(db, data.user.id) : null
  if (locale) await setLocaleCookie(locale)
  redirect(safeNextPath(text(form, 'next')))
}

export async function signUp(form: FormData) {
  const env = getEnv()
  if (!env.ALLOW_SIGNUP) redirect('/login')
  const password = String(form.get('password') ?? '')
  const next = safeNextPath(text(form, 'next'))
  if (password.length < 8) redirect('/login?mode=signup&error=weak_password')
  const supabase = await createAuthClient()
  const { data, error } = await supabase.auth.signUp({
    email: text(form, 'email'),
    password,
    options: { emailRedirectTo: `${env.PUBLIC_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  })
  if (error) redirect('/login?mode=signup&error=signup_failed')
  redirect(data.session ? next : '/login?notice=check_email')
}

export async function signOut() {
  const supabase = await createAuthClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function requestPasswordReset(form: FormData) {
  const supabase = await createAuthClient()
  await supabase.auth.resetPasswordForEmail(text(form, 'email'), {
    redirectTo: `${getEnv().PUBLIC_URL}/auth/callback?next=/reset-password`,
  })
  redirect('/forgot-password?sent=1')
}

export async function updatePassword(form: FormData) {
  const password = String(form.get('password') ?? '')
  if (password.length < 8) redirect('/reset-password?error=weak_password')
  const supabase = await createAuthClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) redirect('/reset-password?error=generic')
  redirect('/')
}
