import { BASE_CURRENCIES, todayInTimeZone } from '@pv/core'
import { hasTransactions, listDevices } from '@pv/db'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { AppShell } from '../../components/app-shell.tsx'
import { ConfirmSubmit } from '../../components/portfolio/row-actions.tsx'
import { Alert, Button, Card, Field, Input, Overline, Select } from '../../components/ui.tsx'
import { requireMember } from '../../lib/auth/session.ts'
import { getDb } from '../../lib/db.ts'
import { formatDate } from '../../lib/format.ts'
import { deleteAccount, removeDevice, saveSettings } from './actions.ts'

const TIME_ZONES = Intl.supportedValuesOf('timeZone')

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string; removed?: string }> }) {
  const member = await requireMember()
  const { saved, error, removed } = await searchParams
  const t = await getTranslations('settings')
  const locale = await getLocale()
  const [locked, devices] = await Promise.all([hasTransactions(getDb(), member.id), listDevices(getDb(), member.id)])
  const day = (date: Date) => formatDate(todayInTimeZone(member.timezone, date), locale)
  const errorKey = error ? `error_${error.replace(':', '_')}` : null
  const knownErrors = ['error_baseCurrency_has_transactions', 'error_confirm_mismatch', 'error_delete_last_admin']
  return (
    <AppShell>
      <div className="flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Overline>{member.email}</Overline>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{t('title')}</h1>
        </header>
        {saved ? <Alert tone="info">{t('saved')}</Alert> : null}
        {removed ? <Alert tone="info">{t('deviceRemoved')}</Alert> : null}
        {errorKey ? <Alert tone="error">{knownErrors.includes(errorKey) ? t(errorKey) : t('error_invalid')}</Alert> : null}

        <Card>
          <form action={saveSettings} className="flex flex-col gap-6">
            <Field label={t('displayName')} htmlFor="displayName">
              <Input id="displayName" name="displayName" maxLength={80} defaultValue={member.displayName ?? ''} autoComplete="name" />
            </Field>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label={t('language')} htmlFor="locale">
                <Select id="locale" name="locale" defaultValue={member.locale}>
                  <option value="en">English</option>
                  <option value="de">Deutsch</option>
                </Select>
              </Field>
              <Field label={t('baseCurrency')} htmlFor="baseCurrency" hint={locked ? t('baseCurrencyLocked') : t('baseCurrencyHint')}>
                <Select id="baseCurrency" name="baseCurrency" defaultValue={member.baseCurrency} disabled={locked}>
                  {BASE_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t('timezone')} htmlFor="timezone" hint={t('timezoneHint')}>
              <Select id="timezone" name="timezone" defaultValue={member.timezone}>
                {TIME_ZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replaceAll('_', ' ')}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <Button type="submit">{t('save')}</Button>
            </div>
          </form>
        </Card>

        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">{t('data')}</h2>
            <p className="text-sm text-muted">{t('dataHint')}</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <a href="/api/export" className="text-gold underline-offset-4 hover:underline">
                {t('export')}
              </a>
              <Link href="/import" className="text-gold underline-offset-4 hover:underline">
                {t('import')}
              </Link>
            </div>
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">{t('devices')}</h2>
            <p className="text-sm text-muted">{t('devicesHint')}</p>
            {devices.length === 0 ? (
              <p className="text-sm text-muted">{t('devicesEmpty')}</p>
            ) : (
              <ul className="flex flex-col gap-px bg-bg">
                {devices.map((device) => (
                  <li key={device.id} className="flex flex-wrap items-center justify-between gap-4 bg-surface px-4 py-3">
                    <span className="flex flex-col">
                      <span className="font-semibold">{device.name}</span>
                      <span className="text-xs text-muted">
                        {t('devicePaired', { date: day(device.createdAt) })} ·{' '}
                        {device.lastSeenAt ? t('deviceSeen', { date: day(device.lastSeenAt) }) : t('deviceNeverSeen')}
                      </span>
                    </span>
                    <form action={removeDevice.bind(null, device.id)}>
                      <ConfirmSubmit label={t('deviceRemove')} confirm={t('deviceRemoveConfirm', { name: device.name })} className="hover:text-loss" />
                    </form>
                  </li>
                ))}
              </ul>
            )}
            <div className="text-sm">
              <Link href="/pair" className="text-gold underline-offset-4 hover:underline">
                {t('pairTv')}
              </Link>
            </div>
          </div>
        </Card>

        <Card>
          <form action={deleteAccount} className="flex flex-col gap-6">
            <h2 className="font-display text-2xl font-bold tracking-tight">{t('deleteTitle')}</h2>
            <p className="text-sm text-muted">{t('deleteHint')}</p>
            <Field label={t('confirmEmail', { email: member.email })} htmlFor="confirmEmail">
              <Input id="confirmEmail" name="confirmEmail" type="email" autoComplete="off" required />
            </Field>
            <div>
              <Button type="submit" variant="secondary" className="text-loss">
                {t('delete')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  )
}
