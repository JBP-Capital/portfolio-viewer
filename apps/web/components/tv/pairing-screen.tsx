'use client'

import { useEffect, useState } from 'react'
import { Byline } from '../brand.tsx'

type Answer = { status: 'waiting'; code: string; secondsLeft: number } | { status: 'paired' } | { status: 'expired' } | { status: 'busy' }
type Shown = { status: 'waiting'; code: string; deadline: number } | { status: 'connecting' } | { status: 'busy' }

const POLL_MS = 3000
const BUSY_MS = 60_000

export interface PairingLabels {
  by: string
  title: string
  step1: string
  step2: string
  validFor: string
  readOnly: string
  connecting: string
  busy: string
}

const formatCode = (code: string) => `${code.slice(0, 3)}-${code.slice(3)}`
const formatRemaining = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Shows a code to type on `/pair`, keeps asking whether it was claimed, and reloads into TV mode once it was. */
export function PairingScreen({ pairUrl, labels }: { pairUrl: string; labels: PairingLabels }) {
  const [shown, setShown] = useState<Shown>({ status: 'connecting' })
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let stopped = false
    let timer = 0
    const show = (answer: Answer) => {
      if (answer.status === 'waiting') setShown({ status: 'waiting', code: answer.code, deadline: Date.now() + answer.secondsLeft * 1000 })
      else if (answer.status === 'busy') setShown({ status: 'busy' })
    }
    // One request at a time: the next one is planned only after the previous one answered.
    const step = async (method: 'POST' | 'GET') => {
      let next: 'POST' | 'GET' = 'GET'
      let wait = POLL_MS
      try {
        const response = await fetch('/api/tv/pairing', { method, cache: 'no-store' })
        const answer = (await response.json()) as Answer
        if (stopped) return
        if (answer.status === 'paired') {
          window.location.reload()
          return
        }
        show(answer)
        if (answer.status === 'expired') [next, wait] = ['POST', 0]
        if (answer.status === 'busy') [next, wait] = ['POST', BUSY_MS]
      } catch {
        next = method
      }
      if (!stopped) timer = window.setTimeout(() => void step(next), wait)
    }
    void step('POST')
    const ticking = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      window.clearInterval(ticking)
    }
  }, [])

  const waiting = shown.status === 'waiting' ? shown : null
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-[4vh] px-[6vw] text-center">
      <div className="flex items-center gap-[1vw] text-[clamp(1rem,1.6vw,2rem)]">
        <span className="font-display font-bold tracking-tight">Portfolio Viewer</span>
        <Byline by={labels.by} size="h-[2.4em]" />
      </div>
      <h1 className="font-display text-[clamp(2rem,3.4vw,4rem)] font-bold tracking-tight">{labels.title}</h1>
      <p className="text-[clamp(1.25rem,1.8vw,2.25rem)] text-muted">
        {labels.step1} <span className="font-semibold text-text">{pairUrl}</span> {labels.step2}
      </p>
      <p aria-live="polite" data-testid="pairing-code" className="font-display text-[clamp(4rem,11vw,12rem)] font-bold leading-none tracking-[0.12em] text-gold">
        {waiting ? formatCode(waiting.code) : '———'}
      </p>
      <p className="text-[clamp(1rem,1.4vw,1.75rem)] text-muted">
        {waiting ? labels.validFor.replace('{time}', formatRemaining(waiting.deadline - now)) : shown.status === 'busy' ? labels.busy : labels.connecting}
      </p>
      <p className="max-w-[60ch] text-[clamp(0.9rem,1.1vw,1.4rem)] text-muted">{labels.readOnly}</p>
    </main>
  )
}
