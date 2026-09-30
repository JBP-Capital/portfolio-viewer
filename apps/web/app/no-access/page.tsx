import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { AuthShell } from '../../components/auth-shell.tsx'
import { Button } from '../../components/ui.tsx'
import { getSessionUser } from '../../lib/auth/session.ts'
import { signOut } from '../login/actions.ts'

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const { reason } = await searchParams
  const t = await getTranslations('noAccess')
  const auth = await getTranslations('auth')
  return (
    <AuthShell title={t('title')}>
      <p className="mb-6 text-muted">{reason === 'disabled' ? t('disabled') : t('body', { email: user.email })}</p>
      <form action={signOut}>
        <Button type="submit" className="w-full">
          {auth('signOut')}
        </Button>
      </form>
    </AuthShell>
  )
}
