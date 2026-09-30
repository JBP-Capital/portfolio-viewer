import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { AppShell } from '../../components/app-shell.tsx'
import { Alert, Button, Card, Field, Input, Overline } from '../../components/ui.tsx'
import { getSessionUser, requireMember } from '../../lib/auth/session.ts'
import { pairTv } from './actions.ts'

const ERRORS = ['not_found', 'throttled', 'name'] as const

export default async function PairPage({ searchParams }: { searchParams: Promise<{ error?: string; paired?: string }> }) {
  // Someone who types the address on a phone comes back here after signing in, before the code expires.
  if (!(await getSessionUser())) redirect('/login?next=%2Fpair')
  await requireMember()
  const { error, paired } = await searchParams
  const t = await getTranslations('pair')
  const known = ERRORS.find((e) => e === error)
  return (
    <AppShell>
      <div className="flex max-w-xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Overline>{t('overline')}</Overline>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{t('title')}</h1>
          <p className="text-muted">{t('intro')}</p>
          <p className="text-sm text-muted">{t('warning')}</p>
        </header>
        {paired === '1' ? <Alert tone="info">{t('paired')}</Alert> : null}
        {error ? <Alert tone="error">{t(`error_${known ?? 'not_found'}`)}</Alert> : null}
        <Card>
          <form action={pairTv} className="flex flex-col gap-6">
            <Field label={t('code')} htmlFor="code">
              <Input
                id="code"
                name="code"
                required
                maxLength={9}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-display text-3xl font-bold uppercase tracking-[0.3em]"
              />
            </Field>
            <Field label={t('name')} htmlFor="name" hint={t('nameHint')}>
              <Input id="name" name="name" required maxLength={40} defaultValue={t('nameDefault')} />
            </Field>
            <Button type="submit">{t('submit')}</Button>
          </form>
        </Card>
        <Link href="/settings" className="text-sm text-muted hover:text-text">
          {t('manage')}
        </Link>
      </div>
    </AppShell>
  )
}
