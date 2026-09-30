'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { reconnectDelay, serverReachable } from '../../lib/tv-refresh.ts'

/** A TV runs unattended: after an error it keeps trying to reconnect instead of waiting for a person. */
export default function TvError() {
  const t = useTranslations('tv')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (await serverReachable().catch(() => false)) window.location.reload()
      else setAttempt((a) => a + 1)
    }, reconnectDelay(attempt))
    return () => window.clearTimeout(timer)
  }, [attempt])
  return (
    <main className="flex min-h-dvh items-center justify-center px-[6vw] text-center text-[clamp(1rem,2vw,2.5rem)] text-muted">
      <p role="status">{t('reconnecting')}</p>
    </main>
  )
}
