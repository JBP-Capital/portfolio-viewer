import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '../../../components/auth-shell.tsx'
import { Alert, Button } from '../../../components/ui.tsx'
import { getSessionUser } from '../../../lib/auth/session.ts'
import { getEnv } from '../../../lib/env.ts'
import { acceptInvite } from './actions.ts'

export default async function InvitePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ invalid?: string }> }) {
  const { token } = await params
  const { invalid } = await searchParams
  const t = await getTranslations('invite')
  const user = await getSessionUser()
  const next = encodeURIComponent(`/invite/${token}`)
  return (
    <AuthShell title={t('title')}>
      <div className="flex flex-col gap-6">
        {invalid ? <Alert tone="error">{t('invalid')}</Alert> : <p className="text-muted">{t('body')}</p>}
        {invalid ? null : user ? (
          <form action={acceptInvite.bind(null, token)} className="flex flex-col gap-3">
            <p className="text-sm text-muted">{t('signedInAs', { email: user.email })}</p>
            <Button type="submit">{t('accept')}</Button>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {getEnv().ALLOW_SIGNUP ? (
              <Link href={`/login?mode=signup&next=${next}`} className="inline-flex h-11 items-center justify-center bg-[linear-gradient(45deg,var(--gold),var(--gold-deep))] px-5 text-sm font-semibold text-on-gold">
                {t('createAccount')}
              </Link>
            ) : null}
            <Link href={`/login?next=${next}`} className="inline-flex h-11 items-center justify-center bg-surface-highest px-5 text-sm font-semibold text-gold">
              {t('signIn')}
            </Link>
          </div>
        )}
      </div>
    </AuthShell>
  )
}
