import { cookies } from 'next/headers'
import { LOCALES, type Locale } from './locale.ts'

/** Remembers the page language in this browser (read by i18n/request.ts). */
export async function setLocaleCookie(locale: string): Promise<void> {
  if (!LOCALES.includes(locale as Locale)) return
  ;(await cookies()).set('locale', locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
}
