import { getTranslations } from 'next-intl/server'
import pkg from '../package.json' with { type: 'json' }
import { getEnv } from '../lib/env.ts'

/** Links every page to the source code of this instance, as the AGPL asks of network services. */
export async function SourceFooter({ className = '' }: { className?: string }) {
  const t = await getTranslations('app')
  return (
    <footer className={`text-xs text-muted ${className}`}>
      <a href={getEnv().SOURCE_URL} className="transition hover:text-text">
        {t('sourceCode', { version: pkg.version })}
      </a>
    </footer>
  )
}
