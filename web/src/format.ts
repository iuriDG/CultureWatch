import type { Lang } from './strings'

export const DASH = '—'

// The active language is set once per render by App (setFormatLang) so every formatter follows it.
let LANG: Lang = 'en'
export function setFormatLang(lang: Lang): void {
  LANG = lang
}

const NBSP = ' '

function dec(x: number, digits: number): string {
  return x.toLocaleString(LANG === 'fi' ? 'fi-FI' : 'en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 0.197 -> '19.7%' (en) / '19,7 %' (fi) */
export function pct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return DASH
  return LANG === 'fi' ? `${dec(x * 100, digits)}${NBSP}%` : `${dec(x * 100, digits)}%`
}

/** Signed percentage-point change: '+3.2 pp' / '+3,2 %-yks.' */
export function pp(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || Number.isNaN(x)) return DASH
  const sign = x > 0 ? '+' : x < 0 ? '−' : ''
  return `${sign}${dec(Math.abs(x), digits)}${NBSP}${LANG === 'fi' ? '%-yks.' : 'pp'}`
}

export function num(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || Number.isNaN(x)) return DASH
  return dec(x, digits)
}

export function pValue(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return DASH
  return p < 0.001 ? `<${dec(0.001, 3)}` : dec(p, 3)
}

/** 'p < 0.001' or 'p = 0.046', for use in sentences */
export function pText(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return 'p —'
  return p < 0.001 ? `p < ${dec(0.001, 3)}` : `p = ${dec(p, 3)}`
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FI = ['tammi', 'helmi', 'maalis', 'huhti', 'touko', 'kesä', 'heinä', 'elo', 'syys', 'loka', 'marras', 'joulu']

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}

/** '2026-09-27' -> '27 Sep 2026' (en) / '27.9.2026' (fi); parsed as a calendar date, no timezone shift */
export function date(iso: string, withYear = true): string {
  const [y, m, d] = parts(iso)
  if (LANG === 'fi') return withYear ? `${d}.${m}.${y}` : `${d}.${m}.`
  return `${d} ${MONTHS_EN[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** '2026-02-09' -> 'Feb' / 'helmi' (short month for chart axes) */
export function monthShort(iso: string): string {
  const [, m] = parts(iso)
  return LANG === 'fi' ? MONTHS_FI[m - 1] : MONTHS_EN[m - 1]
}

/** '2027-04-12' -> 'Apr 2027' / 'huhtikuu 2027' */
export function monthYear(iso: string): string {
  const [y, m] = parts(iso)
  return LANG === 'fi' ? `${MONTHS_FI[m - 1]}kuu ${y}` : `${MONTHS_EN[m - 1]} ${y}`
}

export function dateRange([a, b]: [string, string]): string {
  return `${date(a, a.slice(0, 4) !== b.slice(0, 4))} – ${date(b)}`
}

/** pandas weekly period '2026-09-21/2026-09-27' -> its start date */
export function weekStart(period: string): string {
  return period.slice(0, 10)
}

/** 'Escherichia coli' -> 'E. coli' */
export function shortOrg(name: string): string {
  const [genus, ...rest] = name.split(' ')
  return rest.length ? `${genus[0]}. ${rest.join(' ')}` : name
}

/** One CSV cell: quoted when needed, and prefixed with ' when it could run as a spreadsheet formula
 *  (cells starting with = + - @ tab or CR), so an exported file is safe to open in Excel. */
export function csvCell(v: unknown): string {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const PHENOTYPE_LABEL: Record<string, string> = { esbl: 'ESBL', mrsa: 'MRSA', vre: 'VRE', cpe: 'CPE' }

/** The six % resistant bands of the European surveillance maps (ECDC EARS-Net and WHO CAESAR):
 *  0 = <1%, 1 = 1–<5%, 2 = 5–<10%, 3 = 10–<25%, 4 = 25–<50%, 5 = ≥50%. */
export function resistanceBand(p: number): number {
  return [0.01, 0.05, 0.1, 0.25, 0.5].filter(edge => p >= edge).length
}

/** Above this share resistant an antibiotic is usually not started before the test result (guideline expiry uses it too). */
export const EMPIRICAL_LIMIT = 0.2
