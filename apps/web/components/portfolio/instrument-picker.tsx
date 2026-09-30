'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { resolveSearchResult, type SearchResult } from '../../lib/instrument-resolve.ts'
import type { SelectedInstrument } from '../../lib/portfolio-types.ts'
import { Button, Input } from '../ui.tsx'

/** Security search with a suggestion list; unknown securities are added to the instance on selection. */
export function InstrumentPicker({
  id,
  value,
  onSelect,
  onBusyChange,
}: {
  id: string
  value: SelectedInstrument | null
  onSelect: (selected: SelectedInstrument | null) => void
  /** True while a found security is being added; the form must not be submitted meanwhile. */
  onBusyChange?: (busy: boolean) => void
}) {
  const t = useTranslations('tx')
  const listId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const request = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      return
    }
    const ticket = ++request.current
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(q)}`)
        const body = response.ok ? ((await response.json()) as { results: SearchResult[] }) : { results: [] }
        if (ticket === request.current) {
          setResults(body.results)
          setActive(0)
        }
      } finally {
        if (ticket === request.current) setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  async function choose(result: SearchResult) {
    if (adding) return
    setAdding(result.name)
    onBusyChange?.(true)
    setFailed(false)
    const selected = await resolveSearchResult(result)
    setAdding(null)
    onBusyChange?.(false)
    setFailed(selected === null)
    if (selected) {
      onSelect(selected)
      setQuery('')
      setResults([])
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const result = results[active]
      if (result) void choose(result)
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 bg-surface-high px-4 py-3">
        <div>
          <p className="font-semibold">{value.name}</p>
          <p className="text-xs text-muted">
            {value.symbol} · {value.mic} · {value.currency}
          </p>
        </div>
        <Button type="button" variant="ghost" className="h-9 px-2" onClick={() => onSelect(null)}>
          {t('change')}
        </Button>
      </div>
    )
  }

  if (adding) {
    return (
      <p role="status" className="bg-surface-high px-4 py-3 text-sm text-muted">
        {t('adding', { name: adding })}
      </p>
    )
  }

  const open = query.trim().length >= 2
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={t('searchPlaceholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setFailed(false)
        }}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-10 max-h-72 overflow-auto bg-surface-highest shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          {results.map((r, i) => (
            <li
              key={`${r.mic}:${r.symbol}`}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-4 py-3 ${i === active ? 'bg-surface-high' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(event) => {
                event.preventDefault()
                void choose(r)
              }}
            >
              <span className="block font-medium">{r.name}</span>
              <span className="block text-xs text-muted">
                {r.symbol} · {r.exchangeName}
              </span>
            </li>
          ))}
          {failed ? (
            <li role="alert" className="px-4 py-3 text-sm text-loss">
              {t('addFailed')}
            </li>
          ) : null}
          {results.length === 0 ? <li className="px-4 py-3 text-sm text-muted">{loading ? t('searching') : t('nothingFound')}</li> : null}
        </ul>
      ) : null}
    </div>
  )
}
