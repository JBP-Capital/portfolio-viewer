import { getTranslations } from 'next-intl/server'
import { AuthShell } from '../../components/auth-shell.tsx'
import { Alert, Button, Field, Input } from '../../components/ui.tsx'
import { requestPasswordReset } from '../login/actions.ts'

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const { sent } = await searchParams
  const t = await getTranslations('auth')
  return (
    <AuthShell title={t('forgotTitle')}>
      <form action={requestPasswordReset} className="flex flex-col gap-4">
        {sent ? <Alert tone="info">{t('forgotSent')}</Alert> : null}
        <Field label={t('email')} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Button type="submit">{t('forgotButton')}</Button>
      </form>
    </AuthShell>
  )
}
