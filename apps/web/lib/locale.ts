export const LOCALES = ['en', 'de'] as const
export type Locale = (typeof LOCALES)[number]

const isLocale = (value: string | undefined): value is Locale => LOCALES.includes(value as Locale)

/** Cookie first, then the browser's languages in order, then English. */
export function pickLocale(cookie: string | undefined, acceptLanguage: string): Locale {
  if (isLocale(cookie)) return cookie
  for (const part of acceptLanguage.split(',')) {
    const language = part.split(';')[0]?.trim().slice(0, 2).toLowerCase()
    if (isLocale(language)) return language
  }
  return 'en'
}
