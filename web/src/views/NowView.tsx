import { useApi } from '../api'
import { Status } from '../components/Status'
import { date, num, PHENOTYPE_LABEL } from '../format'
import { useMeta, useT } from '../state'
import type { NowResp, NowWard, Phenotype } from '../types'

const ORDER: Phenotype[] = ['mrsa', 'esbl', 'vre', 'cpe']

// Guideline warnings for the ward page: already over 20%, or projected to cross within 2 years
export const soon = (e: NowResp['expiry'][number]) => e.status === 'crossed' || (e.months_left ?? Infinity) <= 24
const total = (c: Record<Phenotype, number>) => ORDER.reduce((s, ph) => s + c[ph], 0)
const breakdown = (c: Record<Phenotype, number>) => ORDER.filter(ph => c[ph] > 0).map(ph => `${PHENOTYPE_LABEL[ph]} ${c[ph]}`).join(', ')
// Most urgent wards first: cluster alerts, then CPE/VRE cases, then new carriers
const urgency = (w?: NowWard) => (w ? w.alerts.length * 100 + w.rare.length * 10 + (total(w.new_carriers) > 0 ? 1 : 0) : 0)

/**
 * The whole hospital at a glance, for the infection unit's morning check and for a first visit: every ward's
 * last 4 weeks (cluster alerts, new carriers, any CPE or VRE case), busiest wards first.
 * Choosing a ward calls onPick: on the start page it becomes "my ward", on Right now it just opens.
 */
export function NowView({ onPick }: { onPick: (code: string) => void }) {
  const { meta } = useMeta()
  const { t, lang } = useT()
  const { data, error, loading } = useApi<NowResp>('/api/now')

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">{t.now.loading}</p>

  const byCode = new Map(data.wards.map(w => [w.ward_code, w]))
  const groups = [
    { title: t.picker.inpatient, items: meta.wards.filter(w => w.ward_type === 'in') },
    { title: t.picker.outpatient, items: meta.wards.filter(w => w.ward_type === 'out') },
  ]

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 20 }}>
      <div className="view-head">
        <h1>{t.now.title}</h1>
      </div>

      <section style={{ display: 'grid', gap: 16 }}>
        {groups.map(g => (
          <div key={g.title} style={{ display: 'grid', gap: 8 }}>
            <h2 className="group-title">{g.title}</h2>
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
    </div>
  )
}
