import { useApi } from '../api'
import { Status } from '../components/Status'
import { date, dateRange, monthYear, num, PHENOTYPE_LABEL, shortOrg } from '../format'
import { hashFor } from '../hashParams'
import { useMeta, useT } from '../state'
import type { NowResp, NowWard, Phenotype } from '../types'

const ORDER: Phenotype[] = ['mrsa', 'esbl', 'vre', 'cpe']

// Front-page guideline warnings: already over 20%, or projected to cross within 2 years
export const soon = (e: NowResp['expiry'][number]) => e.status === 'crossed' || (e.months_left ?? Infinity) <= 24
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const total = (c: Record<Phenotype, number>) => ORDER.reduce((s, ph) => s + c[ph], 0)
const breakdown = (c: Record<Phenotype, number>) => ORDER.filter(ph => c[ph] > 0).map(ph => `${PHENOTYPE_LABEL[ph]} ${c[ph]}`).join(', ')
// Most urgent wards first: cluster alerts, then CPE/VRE cases, then new carriers
const urgency = (w?: NowWard) => (w ? w.alerts.length * 100 + w.rare.length * 10 + (total(w.new_carriers) > 0 ? 1 : 0) : 0)

/**
 * The whole hospital at a glance, for the infection unit's morning check and for a first visit: every ward's
 * last 4 weeks (cluster alerts, new carriers, any CPE or VRE case) and the first-line antibiotics past the
 * 20% limit. With `picker`, choosing a ward makes it "my ward"; otherwise it just opens the ward's page.
 */
export function NowView({ onPick, picker = false }: { onPick: (code: string) => void; picker?: boolean }) {
  const { meta, wardName, abName } = useMeta()
  const { t, lang } = useT()
  const { data, error, loading } = useApi<NowResp>('/api/now')

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">{t.now.loading}</p>

  const byCode = new Map(data.wards.map(w => [w.ward_code, w]))
  const alerts = data.wards.flatMap(w => w.alerts.map(a => ({ ...a, ward_code: w.ward_code })))
  const rare = data.wards.flatMap(w => w.rare.map(r => ({ ...r, ward_code: w.ward_code })))
  const newCarriers = Object.fromEntries(ORDER.map(ph => [ph, data.wards.reduce((s, w) => s + w.new_carriers[ph], 0)])) as Record<Phenotype, number>

  // In short: only numbers from this page's API answer, written out
  const lines: string[] = []
  if (alerts.length) alerts.forEach(a => lines.push(t.now.alertLine(PHENOTYPE_LABEL[a.phenotype], wardName(a.ward_code), a.observed, num(a.expected, 1))))
  else lines.push(t.now.noAlert)
  lines.push(rare.length
    ? t.now.rareLine(rare.map(r => t.now.rareItem(PHENOTYPE_LABEL[r.phenotype], wardName(r.ward_code), date(r.sample_date))).join('; '))
    : t.now.noRare)
  lines.push(total(newCarriers) ? t.now.newLine(total(newCarriers), breakdown(newCarriers)) : t.now.noNew)
  for (const e of data.expiry.filter(soon).slice(0, 2)) {
    const when = e.cross_date ? monthYear(e.cross_date) : '—'
    lines.push(e.status === 'crossed'
      ? t.expiry.headline(cap(abName(e.antibiotic_code)), shortOrg(e.organism), when)
      : t.expiry.headlineSoon(cap(abName(e.antibiotic_code)), shortOrg(e.organism), num(e.months_left, 0), when))
  }

  const groups = [
    { title: t.picker.inpatient, items: meta.wards.filter(w => w.ward_type === 'in') },
    { title: t.picker.outpatient, items: meta.wards.filter(w => w.ward_type === 'out') },
  ]

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 20 }}>
      <div className="view-head">
        <h1>{t.now.title}</h1>
        <span className="sub">{t.now.sub(dateRange(data.window))}</span>
      </div>

      <section className="summary" aria-label={t.ward.inShort}>
        <h2>{t.ward.inShort}</h2>
        {lines.map((line, i) => <p key={i}>{line}</p>)}
      </section>

      <section style={{ display: 'grid', gap: 12 }}>
        <div className="view-head">
          <h2>{picker ? t.picker.title : t.now.wardsTitle}</h2>
          <span className="sub">{picker ? t.picker.sub : t.now.wardsSub}</span>
        </div>
        {groups.map(g => (
          <div key={g.title} style={{ display: 'grid', gap: 8 }}>
            <h3 className="secondary">{g.title}</h3>
            <div className="ward-grid">
              {[...g.items].sort((a, b) => urgency(byCode.get(b.ward_code)) - urgency(byCode.get(a.ward_code))).map(w => {
                const s = byCode.get(w.ward_code)
                const attention = !!s && (s.alerts.length > 0 || s.rare.length > 0)
                const newN = s ? total(s.new_carriers) : 0
                return (
                  <button key={w.ward_code} type="button" className={`ward-card${attention ? ' attention' : ''}`} onClick={() => onPick(w.ward_code)}>
                    <strong>{lang === 'fi' ? w.ward_fi : w.ward_en}</strong>
                    <span className="code">{w.ward_code} · {lang === 'fi' ? w.ward_en : w.ward_fi}</span>
                    <span className="ward-status">
                      {s?.alerts.map(a => (
                        <Status key={a.phenotype} kind="critical">{t.now.chipAlert(PHENOTYPE_LABEL[a.phenotype], a.observed, num(a.expected, 1))}</Status>
                      ))}
                      {s?.rare.map(r => (
                        <Status key={r.phenotype + r.sample_date} kind="critical">{t.now.chipRare(PHENOTYPE_LABEL[r.phenotype], date(r.sample_date, false))}</Status>
                      ))}
                      {s && newN > 0 && <Status kind="muted">{t.now.chipNew(newN, breakdown(s.new_carriers))}</Status>}
                      {!attention && newN === 0 && <Status kind="good">{t.now.chipCalm}</Status>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <div className="link-row">
        <span className="secondary">{t.now.more}</span>
        <a href={hashFor('findings', { days: '28' })}>{t.nav.findings}</a>
        <a href={hashFor('alerts')}>{t.nav.alerts}</a>
        <a href={hashFor('spread')}>{t.nav.spread}</a>
        <a href={hashFor('weekly')}>{t.nav.weekly}</a>
        <a href={hashFor('trends')}>{t.nav.trends}</a>
      </div>
    </div>
  )
}
