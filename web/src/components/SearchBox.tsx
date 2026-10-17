import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../api'
import { date, monthYear, num, pct, PHENOTYPE_LABEL, shortOrg } from '../format'
import { hashFor } from '../hashParams'
import { useMeta, useT } from '../state'
import type { Rate, SearchResp, SearchResult } from '../types'

const RECENT_KEY = 'culturewatch.recent'
const PAGES = ['ward', 'now', 'findings', 'alerts', 'spread', 'weekly', 'hospital', 'antibiogram', 'treatment', 'trends', 'data', 'methods'] as const

interface Item { key: string; kind: string; title: string; answer?: string; href?: string; fill?: string; italic?: boolean }

function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[] } catch { return [] }
}

function saveRecent(q: string): void {
  try {
    const next = [q, ...loadRecent().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 5)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* not remembered in a private window */ }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return v
}

/**
 * Quick search in the top bar: type a ward, bacterium, antibiotic, resistance type or patient ID and the answer
 * is shown in the list itself (computed by the API with the same rules as the views); Enter opens the full view.
 * Press / or Ctrl+K anywhere to start typing.
 */
export function SearchBox() {
  const { t } = useT()
  const { meta, wardName, abLabel } = useMeta()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const query = useDebounced(q.trim(), 180)
  const { data, loading } = useApi<SearchResp>(query.length >= 2 ? '/api/search' : null, { q: query })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
      if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        input.current?.focus()
        setOpen(true)
      }
    }
    const onClick = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [])

  const rate = (r: Rate) => (r.pct !== null ? pct(r.pct) : t.common.nLow(meta.min_isolates))

  const describe = (r: SearchResult): Item => {
    switch (r.kind) {
      case 'pair': {
        const expiry = r.status === 'crossed' ? (r.cross_date ? t.expiry.crossed(monthYear(r.cross_date)) : t.expiry.crossedNoDate)
          : r.status === 'crossing' && r.cross_date ? t.expiry.crossing(num(r.months_left, 0), monthYear(r.cross_date))
            : r.status === 'rising' ? t.expiry.rising : ''
        const base = r.intrinsic ? t.search.intrinsic : r.pct !== null ? t.search.pairPct(pct(r.pct), num(r.n)) : t.search.pairFew(num(r.n))
        return { key: `p${r.organism}${r.antibiotic_code}`, kind: 'pair', title: `${shortOrg(r.organism)} + ${abLabel(r.antibiotic_code)}`,
          answer: expiry ? `${base} · ${expiry}` : base, href: hashFor('trends', { org: r.organism, ab: r.antibiotic_code }) }
      }
      case 'organism':
        return { key: `o${r.organism}`, kind: 'organism', title: r.organism, italic: true,
          answer: t.search.organism(num(r.first_isolates), r.top.map(x => `${x.antibiotic_code} ${pct(x.pct)}`).join(', ')),
          href: r.top[0] ? hashFor('trends', { org: r.organism, ab: r.top[0].antibiotic_code }) : hashFor('antibiogram') }
      case 'antibiotic':
        return { key: `a${r.antibiotic_code}`, kind: 'antibiotic', title: abLabel(r.antibiotic_code),
          answer: t.search.antibiotic(r.top.map(x => `${shortOrg(x.organism)} ${pct(x.pct)}`).join(', ')),
          href: r.top[0] ? hashFor('trends', { org: r.top[0].organism, ab: r.antibiotic_code }) : hashFor('antibiogram') }
      case 'ward':
        return { key: `w${r.ward_code}`, kind: 'ward', title: `${wardName(r.ward_code)} (${r.ward_code})`,
          answer: `${r.alerts.length ? t.search.alertNow(r.alerts.map(p => PHENOTYPE_LABEL[p]).join(', ')) : t.search.noAlert} · ${t.search.rates12(rate(r.mrsa), rate(r.esbl))}`,
          href: hashFor('ward', { code: r.ward_code }) }
      case 'phenotype':
        return { key: `h${r.phenotype}`, kind: 'phenotype', title: `${PHENOTYPE_LABEL[r.phenotype]} · ${t.phenotypeHelp[r.phenotype] ?? ''}`,
          answer: r.alert_wards.length ? t.search.phAlert(r.alert_wards.map(wardName).join(', ')) : t.search.phCalm(r.cases_4w),
          href: hashFor('alerts', { type: r.phenotype }) }
      case 'patient':
        return { key: `x${r.patient_id}`, kind: 'patient', title: r.patient_id,
          answer: r.findings.length
            ? r.findings.map(f => t.search.patientFinding(t.findings.status[f.status], PHENOTYPE_LABEL[f.phenotype], date(f.sample_date), wardName(f.ward_code))).join(' · ')
            : t.search.patientNone(r.samples, date(r.last_date), wardName(r.last_ward)),
          href: hashFor('findings', { q: r.patient_id, all: '1' }) }
    }
  }

  const items: Item[] = useMemo(() => {
    if (!q.trim()) return loadRecent().map(r => ({ key: `r${r}`, kind: 'recent', title: r, fill: r }))
    const words = q.trim().toLowerCase().split(/\s+/).filter(w => w.length >= 3)
    const pages = PAGES.filter(r => words.some(w => t.nav[r].toLowerCase().split(/\s+/).some(n => n.startsWith(w))))
      .slice(0, 2).map(r => ({ key: `g${r}`, kind: 'page', title: t.nav[r], href: hashFor(r) }))
    return [...(data && data.q === query ? data.results.map(describe) : []), ...pages]
  }, [q, query, data, t])

  useEffect(() => setActive(0), [items.length, q])

  const choose = (it: Item | undefined) => {
    if (!it) return
    if (it.fill !== undefined) { setQ(it.fill); input.current?.focus(); return }
    if (q.trim()) saveRecent(q.trim())
    if (it.href) window.location.hash = it.href
    setOpen(false)
    setQ('')
    input.current?.blur()
  }

  const showList = open && (items.length > 0 || query.length >= 2)
  const waiting = query.length >= 2 && (loading || data?.q !== query)

  return (
    <div className="search-box" ref={box}>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={t.search.label}
        aria-expanded={showList}
        aria-controls="search-list"
        aria-activedescendant={showList && items[active] ? `search-${active}` : undefined}
        placeholder={t.search.placeholder}
        title={t.search.hint}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, items.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); choose(items[active]) }
          else if (e.key === 'Escape') { setOpen(false); input.current?.blur() }
        }}
      />
      {showList && (
        <ul className="search-pop" id="search-list" role="listbox" aria-label={t.search.label}>
          {!q.trim() && items.length > 0 && <li className="search-head" role="presentation">{t.search.recent}</li>}
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`search-${i}`}
              role="option"
              aria-selected={i === active}
              className="search-item"
              onMouseEnter={() => setActive(i)}
              onMouseDown={e => { e.preventDefault(); choose(it) }}
            >
              {it.kind !== 'recent' && <span className="search-kind">{t.search.kind[it.kind]}</span>}
              <span className={`search-title${it.italic ? ' italic' : ''}`}>{it.title}</span>
              {it.answer && <span className="search-answer">{it.answer}</span>}
              {it.href && <span className="search-open">{t.search.open[it.kind]} ↵</span>}
            </li>
          ))}
          {waiting && <li className="search-head" role="presentation">{t.search.searching}</li>}
          {!waiting && q.trim().length >= 2 && items.length === 0 && <li className="search-head" role="presentation">{t.search.none(q.trim())}</li>}
        </ul>
      )}
    </div>
  )
}
