import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { Byline } from './brand.tsx'
import { SourceFooter } from './source-footer.tsx'
import { Card } from './ui.tsx'

export async function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  const t = await getTranslations('app')
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-10 px-4 py-12">
      <header>
        <p className="font-display text-3xl font-bold tracking-tight">{t('name')}</p>
        <Byline by={t('by')} size="h-12" className="mt-3" />
      </header>
      <Card>
        <h1 className="mb-8 font-display text-2xl font-bold tracking-tight">{title}</h1>
        {children}
      </Card>
      <SourceFooter className="text-center" />
    </main>
  )
}
