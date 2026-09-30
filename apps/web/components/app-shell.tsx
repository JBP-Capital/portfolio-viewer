import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { signOut } from '../app/login/actions.ts'
import { requireMember } from '../lib/auth/session.ts'
import { Byline } from './brand.tsx'
import { SourceFooter } from './source-footer.tsx'
import { Button } from './ui.tsx'

export async function AppShell({ children }: { children: ReactNode }) {
  const member = await requireMember()
  const t = await getTranslations('shell')
  const app = await getTranslations('app')
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-8">
          <Link href="/" className="group flex items-center gap-3">
            <span className="font-display text-lg font-bold tracking-tight">{app('name')}</span>
            <Byline by={app('by')} className="group-hover:text-text" />
          </Link>
          <nav className="-mx-3 flex flex-wrap items-center gap-x-1 text-sm sm:mx-0">
            <Link href="/" className="px-3 py-2 text-muted transition hover:text-text">
              {t('portfolios')}
            </Link>
            <Link href="/import" className="px-3 py-2 text-muted transition hover:text-text">
              {t('import')}
            </Link>
            <Link href="/settings" className="px-3 py-2 text-muted transition hover:text-text">
              {t('settings')}
            </Link>
            {member.role === 'admin' ? (
              <Link href="/admin" className="px-3 py-2 text-muted transition hover:text-text">
                {t('admin')}
              </Link>
            ) : null}
            <form action={signOut}>
              <Button type="submit" variant="ghost" className="h-9 px-3">
                {t('signOut')}
              </Button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-8">{children}</main>
      <SourceFooter className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-8" />
    </div>
  )
}
