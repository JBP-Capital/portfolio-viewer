import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { AuthShell } from '../../components/auth-shell.tsx'
import { Alert, Button, Field, Input } from '../../components/ui.tsx'
import { getSessionUser } from '../../lib/auth/session.ts'
import { updatePassword } from '../login/actions.ts'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!(await getSessionUser())) redirect('/login?error=link_invalid')
  const { error } = await searchParams
  const t = await getTranslations('auth')
  return (
    <AuthShell title={t('resetTitle')}>
      <form action={updatePassword} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{t(error === 'weak_password' ? 'errors.weak_password' : 'errors.generic')}</Alert> : null}
        <Field label={t('newPassword')} htmlFor="password" hint={t('passwordHint')}>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Button type="submit">{t('resetButton')}</Button>
      </form>
    </AuthShell>
  )
}
