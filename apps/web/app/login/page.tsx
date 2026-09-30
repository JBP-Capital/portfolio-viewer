import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthShell } from '../../components/auth-shell.tsx'
import { Alert, Button, Field, Input } from '../../components/ui.tsx'
import { getEnv } from '../../lib/env.ts'
import { safeNextPath } from '../../lib/safe-next.ts'
import { signIn, signUp } from './actions.ts'

const ERRORS = ['invalid_credentials', 'signup_failed', 'link_invalid', 'weak_password', 'too_many_attempts'] as const
type ErrorKey = (typeof ERRORS)[number] | 'generic'
const errorKey = (value: string): ErrorKey => ((ERRORS as readonly string[]).includes(value) ? (value as ErrorKey) : 'generic')

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error, notice, mode, next: rawNext } = await searchParams
  const next = safeNextPath(rawNext)
  const withNext = (path: string) => (next === '/' ? path : `${path}${path.includes('?') ? '&' : '?'}next=${encodeURIComponent(next)}`)
  const t = await getTranslations('auth')
  const signup = getEnv().ALLOW_SIGNUP && mode === 'signup'
  return (
    <AuthShell title={signup ? t('signupTitle') : t('loginTitle')}>
      <form action={signup ? signUp : signIn} className="flex flex-col gap-4">
        {error ? <Alert tone="error">{t(`errors.${errorKey(error)}`)}</Alert> : null}
        {notice === 'check_email' ? <Alert tone="info">{t('checkEmail')}</Alert> : null}
        {notice === 'account_deleted' ? <Alert tone="info">{t('accountDeleted')}</Alert> : null}
        <input type="hidden" name="next" value={next} />
        <Field label={t('email')} htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label={t('password')} htmlFor="password" hint={signup ? t('passwordHint') : undefined}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={signup ? 'new-password' : 'current-password'}
            minLength={signup ? 8 : undefined}
            required
          />
        </Field>
        <Button type="submit">{signup ? t('signupButton') : t('loginButton')}</Button>
        <div className="flex flex-col gap-2 text-center text-sm text-muted">
          {signup ? <Link href={withNext('/login')}>{t('toLogin')}</Link> : null}
          {!signup && getEnv().ALLOW_SIGNUP ? <Link href={withNext('/login?mode=signup')}>{t('toSignup')}</Link> : null}
          {!signup ? <Link href="/forgot-password">{t('forgot')}</Link> : null}
        </div>
      </form>
    </AuthShell>
  )
}
