import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { pickLocale } from '../lib/locale.ts'

export default getRequestConfig(async () => {
  const locale = pickLocale((await cookies()).get('locale')?.value, (await headers()).get('accept-language') ?? '')
  return { locale, messages: (await import(`../messages/${locale}.json`)).default }
})
