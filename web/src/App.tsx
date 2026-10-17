import { useEffect, useMemo, useState } from 'react'
import { hashFor, readHash, replaceHashParams } from './hashParams'
import { AsOfContext, useApi } from './api'
import { SearchBox } from './components/SearchBox'
import { ShareDialog } from './components/ShareDialog'
import { TimeMachine } from './components/TimeMachine'
import { date, setFormatLang } from './format'
import {
  DEFAULT_FILTERS, LangContext, loadLang, loadMyWard, makeMetaHelpers, MetaContext, saveLang, saveMyWard, type Filters,
} from './state'
import { STRINGS, type Lang } from './strings'
import type { Meta } from './types'
import { AlertsView } from './views/AlertsView'
import { AntibiogramView } from './views/AntibiogramView'
import { FindingsView } from './views/FindingsView'
import { HospitalView } from './views/HospitalView'
import { ImportView } from './views/ImportView'
import { MethodsView } from './views/MethodsView'
import { NowView } from './views/NowView'
import { SpreadView } from './views/SpreadView'
import { TreatmentView } from './views/TreatmentView'
import { TrendsView } from './views/TrendsView'
import { WardView } from './views/WardView'
import { WeeklyView } from './views/WeeklyView'

// Share / QR button is hidden for now; set to true to bring it back.
const SHOW_SHARE = false

const ROUTES = ['ward', 'now', 'findings', 'alerts', 'spread', 'weekly', 'hospital', 'antibiogram', 'treatment', 'trends', 'data', 'methods'] as const
type Route = (typeof ROUTES)[number]

// Main tabs, grouped by who uses them; Import and Methods sit apart as small links.
// Infection control opens on "Right now": every ward's last 4 weeks, the unit's first check of the day.
const GROUPS = [
  { id: 'ward', routes: ['ward'] },
  { id: 'control', routes: ['now', 'findings', 'alerts', 'spread', 'weekly'] },
  { id: 'analysis', routes: ['hospital', 'antibiogram', 'treatment', 'trends'] },
] as const satisfies readonly { id: string; routes: readonly Route[] }[]

function readRoute(): Route {
  const id = readHash().route
  return (ROUTES as readonly string[]).includes(id) ? (id as Route) : 'ward'
}

// Views that use the shared filters keep them in the address (#/antibiogram?specimen=urine&time=4w).
const FILTER_ROUTES: readonly Route[] = ['hospital', 'antibiogram', 'treatment', 'trends']
const FILTER_KEYS = ['time', 'from', 'to', 'specimen', 'setting', 'ward', 'sex', 'age_group'] as const

function filtersFromParams(p: URLSearchParams, base: Filters): Filters {
  if (!FILTER_KEYS.some(k => p.has(k))) return base
  const f = { ...DEFAULT_FILTERS }
  for (const k of FILTER_KEYS) if (p.has(k)) f[k] = p.get(k) ?? ''
  return f
}

function filtersToParams(f: Filters): Record<string, string | null> {
  return Object.fromEntries(FILTER_KEYS.map(k => [k, f[k] && f[k] !== DEFAULT_FILTERS[k] ? f[k] : null]))
}

export function App() {
  const [lang, setLangState] = useState<Lang>(loadLang)
  setFormatLang(lang) // formatters (numbers, dates) follow the language on this render
  const t = STRINGS[lang]
  const meta = useApi<Meta>('/api/meta')
  const [route, setRoute] = useState<Route>(readRoute)
  const [params, setParams] = useState(() => readHash().params)
  const helpers = useMemo(() => (meta.data ? makeMetaHelpers(meta.data, lang) : null), [meta.data, lang])
  const [myWard, setMyWardState] = useState<string | null>(loadMyWard)
  // Only the analysis views read the shared filters from the address (#/findings?ward=ICU must not filter them)
  const [filters, setFiltersState] = useState<Filters>(() =>
    FILTER_ROUTES.includes(readRoute()) ? filtersFromParams(readHash().params, DEFAULT_FILTERS) : DEFAULT_FILTERS)
  const [copied, setCopied] = useState(false)
  const [asOf, setAsOf] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    const onHash = () => {
      const { params: p } = readHash()
      const r = readRoute()
      setRoute(r)
      setParams(p)
      if (FILTER_ROUTES.includes(r)) setFiltersState(f => filtersFromParams(p, f))
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Filtered views show their filters in the address, so the exact view can be bookmarked or shared.
  useEffect(() => {
    if (FILTER_ROUTES.includes(route)) replaceHashParams(filtersToParams(filters))
  }, [route, filters])
  const setFilters = (f: Filters) => setFiltersState(f)
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked: the address bar still shows the link */ }
  }

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  const setLang = (l: Lang) => {
    setLangState(l)
    saveLang(l)
  }
  const setMyWard = (code: string | null) => {
    setMyWardState(code)
    saveMyWard(code)
  }
  const go = (r: Route) => { window.location.hash = `/${r}` }

  if (meta.error) {
    return (
      <main>
        <h1>CultureWatch</h1>
        <p className="error">{t.app.apiDown} {meta.error}</p>
        <p className="secondary">{t.app.apiStart} <code>uvicorn api.main:app --port 8000</code></p>
      </main>
    )
  }
  if (!helpers) return <main><p className="muted">{t.app.loading}</p></main>
  const known = myWard && helpers.meta.wards.some(w => w.ward_code === myWard) ? myWard : null
  // A link or search can open any ward (#/ward?code=ICU) without changing "my ward".
  const linked = params.get('code')
  const shownWard = linked && helpers.meta.wards.some(w => w.ward_code === linked) ? linked : known
  const org = params.get('org'), ab = params.get('ab')
  const trendPair = org && ab && helpers.meta.organisms.includes(org) ? { organism: org, antibiotic: ab } : undefined
  const weeks = helpers.meta.replay_weeks
  const group = GROUPS.find(g => (g.routes as readonly Route[]).includes(route))

  return (
    <LangContext.Provider value={lang}>
      <MetaContext.Provider value={helpers}>
        <AsOfContext.Provider value={asOf}>
          <div className={`top${asOf ? ' replaying' : ''}`}>
            <header className="app-header">
              <a className="brand" href="#/ward" title={t.nav.ward}><span className="brand-mark" aria-hidden="true" />CultureWatch</a>
              <span className="muted small header-date">{asOf ? t.app.replaying(date(asOf)) : t.app.dataThrough(date(helpers.meta.date_max))}</span>
              <SearchBox />
              <span className="header-spacer" />
              <button type="button" className="btn" onClick={copyLink} title={window.location.href}>{copied ? t.app.copied : t.app.copyLink}</button>
              <button type="button" className={`btn${asOf ? '' : ' primary'}`} aria-pressed={asOf !== null}
                onClick={() => setAsOf(asOf ? null : weeks[weeks.length - 1])}
                title={t.app.timeMachineTitle}>
                {asOf ? t.app.exitTimeMachine : t.app.timeMachine}
              </button>
              <div className="my-ward">
                <label htmlFor="my-ward">{t.app.myWard}</label>
                <select id="my-ward" value={known ?? ''} onChange={e => { setMyWard(e.target.value || null); go('ward') }}>
                  <option value="">{t.app.choose}</option>
                  {helpers.meta.wards.map(w => <option key={w.ward_code} value={w.ward_code}>{helpers.wardName(w.ward_code)} ({w.ward_code})</option>)}
                </select>
              </div>
              <div className="segmented" role="group" aria-label={t.lang.label}>
                {(['fi', 'en'] as const).map(l => (
                  <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)} title={STRINGS[l].lang[l]}>
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
              {SHOW_SHARE && <button type="button" className="btn" onClick={() => setSharing(true)}>{t.app.share}</button>}
              <span className="synthetic" title={t.app.syntheticTitle}>{t.app.synthetic}</span>
            </header>
            <nav className="nav" aria-label="Views">
              {GROUPS.map(g => (
                <a key={g.id} href={`#/${g.routes[0]}`} aria-current={g === group ? 'page' : undefined}>
                  {g.id === 'ward' && known ? helpers.wardName(known) : t.navGroup[g.id]}
                </a>
              ))}
              <span className="header-spacer" />
              <a href="#/data" className="nav-minor" aria-current={route === 'data' ? 'page' : undefined}>{t.nav.data}</a>
              <a href="#/methods" className="nav-minor" aria-current={route === 'methods' ? 'page' : undefined}>{t.nav.methods}</a>
            </nav>
            {group && group.routes.length > 1 && (
              <nav className="subnav" aria-label={t.navGroup[group.id]}>
                {group.routes.map(r => (
                  <a key={r} href={`#/${r}`} aria-current={route === r ? 'page' : undefined}>{t.nav[r]}</a>
                ))}
              </nav>
            )}
            {asOf && <TimeMachine asOf={asOf} setAsOf={setAsOf} myWard={known} onExit={() => setAsOf(null)} />}
          </div>
          <main>
            {/* Front page: my ward, or (no ward chosen yet) the whole hospital with a ward picker */}
            {route === 'ward' && (shownWard
              ? <WardView key={shownWard} code={shownWard} />
              : <NowView picker onPick={setMyWard} />)}
            {route === 'now' && <NowView onPick={code => { window.location.hash = hashFor('ward', { code }) }} />}
            {route === 'findings' && <FindingsView key={params.toString()} initialQuery={params.get('q') ?? ''} allTime={params.get('all') === '1'}
              initialWard={params.get('ward') ?? ''} initialDays={params.get('days') === '28' ? 28 : 7} />}
            {route === 'alerts' && <AlertsView key={params.get('type') ?? ''} myWard={known} initialPhenotype={params.get('type')} />}
            {route === 'spread' && <SpreadView />}
            {route === 'weekly' && <WeeklyView />}
            {route === 'hospital' && <HospitalView filters={filters} setFilters={setFilters} onOpenWard={c => { setMyWard(c); go('ward') }} />}
            {route === 'antibiogram' && <AntibiogramView filters={filters} setFilters={setFilters} />}
            {route === 'treatment' && <TreatmentView filters={filters} setFilters={setFilters} />}
            {route === 'trends' && <TrendsView key={trendPair ? trendPair.organism + trendPair.antibiotic : ''} filters={filters} setFilters={setFilters} initialPair={trendPair} />}
            {route === 'data' && <ImportView />}
            {route === 'methods' && <MethodsView />}
          </main>
          {sharing && <ShareDialog onClose={() => setSharing(false)} />}
        </AsOfContext.Provider>
      </MetaContext.Provider>
    </LangContext.Provider>
  )
}
