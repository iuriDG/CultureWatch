import { createContext, useContext } from 'react'
import { STRINGS, type Lang, type Strings } from './strings'
import type { Meta } from './types'

// ---------- Language ----------
export const LangContext = createContext<Lang>('en')

export function useT(): { t: Strings; lang: Lang } {
  const lang = useContext(LangContext)
  return { t: STRINGS[lang], lang }
}

const LANG_KEY = 'culturewatch.lang'

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v === 'en' || v === 'fi') return v
  } catch {
    /* storage unavailable: fall back to the browser language */
  }
  return navigator.language?.toLowerCase().startsWith('fi') ? 'fi' : 'en'
}

export function saveLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* not remembered in a private window */
  }
}

// ---------- Meta (loaded once; labels and filter options) ----------
export interface MetaHelpers {
  meta: Meta
  abName: (code: string) => string
  abLabel: (code: string) => string
  wardName: (code: string) => string
  specimenName: (s: string) => string
  scenarioName: (s: string) => string
  tierName: (tier: number) => string
}

export const MetaContext = createContext<MetaHelpers | null>(null)

export function makeMetaHelpers(meta: Meta, lang: Lang): MetaHelpers {
  const t = STRINGS[lang]
  const ab = new Map(meta.antibiotics.map(a => [a.antibiotic_code, lang === 'fi' ? a.antibiotic_fi : a.antibiotic]))
  const wards = new Map(meta.wards.map(w => [w.ward_code, lang === 'fi' ? w.ward_fi : w.ward_en]))
  return {
    meta,
    abName: code => ab.get(code) ?? code,
    abLabel: code => `${code} · ${ab.get(code) ?? code}`,
    wardName: code => wards.get(code) ?? code,
    specimenName: s => t.specimen[s] ?? s,
    scenarioName: s => t.scenario[s] ?? s,
    tierName: tier => t.tier[tier] ?? String(tier),
  }
}

export function useMeta(): MetaHelpers {
  const m = useContext(MetaContext)
  if (!m) throw new Error('useMeta outside MetaContext')
  return m
}

// ---------- Filters (shared by every view; each view says which ones it ignores) ----------
/** time: '4w' | '12m' (rolling windows), a surveillance period label like 'Y3 (2025/26)', or 'all' */
export interface Filters {
  /** '4w' | '12m' | a surveillance year | 'all' | 'custom' (uses from / to) */
  time: string
  from: string
  to: string
  specimen: string
  setting: string
  ward: string
  sex: string
  age_group: string
}

export const ALL = ''

export const DEFAULT_FILTERS: Filters = { time: '12m', from: ALL, to: ALL, specimen: ALL, setting: ALL, ward: ALL, sex: ALL, age_group: ALL }

export type FilterKey = keyof Filters

export function filterParams(f: Filters, ignore: FilterKey[] = []): Record<string, string> {
  const p: Record<string, string> = {}
  const use = (k: FilterKey) => !ignore.includes(k) && f[k] !== ALL
  if (use('time') && f.time !== 'all') {
    if (f.time === 'custom') {
      if (f.from) p.date_from = f.from
      if (f.to) p.date_to = f.to
    } else if (f.time === '4w' || f.time === '12m') p.window = f.time
    else p.period = f.time
  }
  for (const k of ['specimen', 'setting', 'ward', 'sex', 'age_group'] as const) {
    if (use(k)) p[k] = f[k]
  }
  return p
}

// ---------- My ward (remembered per browser) ----------
const WARD_KEY = 'culturewatch.myWard'

export function loadMyWard(): string | null {
  try {
    return localStorage.getItem(WARD_KEY)
  } catch {
    return null
  }
}

export function saveMyWard(code: string | null): void {
  try {
    if (code) localStorage.setItem(WARD_KEY, code)
    else localStorage.removeItem(WARD_KEY)
  } catch {
    /* storage unavailable (private window): the choice just isn't remembered */
  }
}
