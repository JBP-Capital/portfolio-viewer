import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { PairingScreen } from '../../components/tv/pairing-screen.tsx'
import { TvApp } from '../../components/tv/tv-app.tsx'
import { getDeviceMember } from '../../lib/auth/device.ts'
import { getSessionMember } from '../../lib/auth/session.ts'
import { getEnv } from '../../lib/env.ts'
import { loadTvSnapshot } from '../../lib/tv-data.ts'

export const metadata: Metadata = { title: 'Portfolio Viewer TV' }

/** A paired TV (or a signed-in member's own screen) shows TV mode; any other browser shows a pairing code. */
export default async function TvPage() {
  const member = (await getDeviceMember()) ?? (await getSessionMember())
  if (!member) {
    const locale = await getLocale()
    const t = await getTranslations({ locale, namespace: 'tv' })
    const app = await getTranslations({ locale, namespace: 'app' })
    const pairUrl = `${new URL(getEnv().PUBLIC_URL).host}/pair`
    return (
      <PairingScreen
        pairUrl={pairUrl}
        labels={{
          by: app('by'),
          title: t('pairTitle'),
          step1: t('pairStep1'),
          step2: t('pairStep2'),
          validFor: t('pairValidFor', { time: '{time}' }),
          readOnly: t('pairReadOnly'),
          connecting: t('pairConnecting'),
          busy: t('pairBusy'),
        }}
      />
    )
  }
  // The TV speaks the member's language, whatever the TV's browser is set to.
  const [tv, messages] = await Promise.all([loadTvSnapshot(member), getMessages({ locale: member.locale })])
  const { app, tv: tvMessages, dashboard } = messages as Record<string, Record<string, unknown>>
  return (
    <NextIntlClientProvider locale={member.locale} timeZone={member.timezone} messages={{ app, tv: tvMessages, dashboard } as never}>
      <TvApp tv={tv} locale={member.locale} timeZone={member.timezone} />
    </NextIntlClientProvider>
  )
}
