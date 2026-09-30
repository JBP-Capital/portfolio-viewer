import { getTranslations } from 'next-intl/server'
import { AppShell } from '../../components/app-shell.tsx'
import { ImportForm } from '../../components/import/import-form.tsx'
import { Overline } from '../../components/ui.tsx'
import { requireMember } from '../../lib/auth/session.ts'

export default async function ImportPage() {
  await requireMember()
  const t = await getTranslations('import')
  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Overline>{t('overline')}</Overline>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{t('title')}</h1>
          <p className="max-w-2xl text-muted">{t('intro')}</p>
        </header>
        <ImportForm />
      </div>
    </AppShell>
  )
}
