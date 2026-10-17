import { monthYear, num, pct, pp, shortOrg } from '../format'
import { useMeta, useT } from '../state'
import type { ExpiryPair, ExpiryResp } from '../types'
import { DataTable } from './DataTable'
import { Status } from './Status'

const WATCH = new Set(['crossing', 'crossed', 'rising'])

/** The single most urgent expiry: a first-choice drug about to cross, then one that crossed most recently. */
export function mostUrgent(pairs: ExpiryPair[]): ExpiryPair | undefined {
  const firstChoice = pairs.filter(p => p.tier === 1)
  const pool = firstChoice.some(p => p.status === 'crossing' || p.status === 'crossed') ? firstChoice : pairs
  return pool.find(p => p.status === 'crossing')
    ?? [...pool].filter(p => p.status === 'crossed').sort((a, b) => (b.cross_date ?? '').localeCompare(a.cross_date ?? ''))[0]
}

export function ExpiryHeadline({ data }: { data: ExpiryResp }) {
  const { t } = useT()
  const { abName } = useMeta()
  const p = mostUrgent(data.pairs)
  if (!p) return null
  const drug = abName(p.antibiotic_code)
  const Drug = drug[0].toUpperCase() + drug.slice(1)
  const org = shortOrg(p.organism)
  return (
    <div className="banner critical" role="status">
      <Status kind="critical">{t.expiry.title}</Status>
      <span>
        {p.status === 'crossing' && p.cross_date
          ? t.expiry.headlineSoon(Drug, org, num(p.months_left, 0), monthYear(p.cross_date))
          : t.expiry.headline(Drug, org, p.cross_date ? monthYear(p.cross_date) : '—')}
      </span>
    </div>
  )
}

export function ExpiryWatch({ data, onShow }: { data: ExpiryResp; onShow: (organism: string, antibiotic: string) => void }) {
  const { t } = useT()
  const { abLabel, tierName } = useMeta()
  const rows = data.pairs.filter(p => WATCH.has(p.status))
  const above = data.pairs.filter(p => p.status === 'above').length

  const outlook = (p: ExpiryPair) => {
    if (p.status === 'crossing' && p.cross_date) return <Status kind="critical">{t.expiry.crossing(num(p.months_left, 0), monthYear(p.cross_date))}</Status>
    if (p.status === 'crossed') return <Status kind="critical">{p.cross_date ? t.expiry.crossed(monthYear(p.cross_date)) : t.expiry.crossedNoDate}</Status>
    return <Status kind="muted">{t.expiry.rising}</Status>
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{t.expiry.title}</h3>
      </div>
      <DataTable
        rows={rows}
        rowKey={r => r.organism + r.antibiotic_code}
        highlight={r => r.status !== 'rising'}
        empty={t.expiry.none}
        columns={[
          { key: 'pair', header: t.trends.pair, render: r => (
            <>
              <button type="button" className="link-btn" onClick={() => onShow(r.organism, r.antibiotic_code)} title={t.expiry.show}>
                <span className="italic">{shortOrg(r.organism)}</span> · {abLabel(r.antibiotic_code)}
              </button>
              {r.tier === 1 && <span className="chip">{tierName(1)}</span>}
            </>
          ) },
          { key: 'now', header: t.expiry.now, numeric: true, render: r => pct(r.pct_now) },
          { key: 'slope', header: t.expiry.perYear, numeric: true, render: r => pp(r.slope_pp_per_year) },
          { key: 'n', header: t.common.n, numeric: true, render: r => num(r.n_tested) },
          { key: 'out', header: t.expiry.outlook, render: outlook },
        ]}
      />
      {above > 0 && <p className="small muted" style={{ marginTop: 8 }}>{t.expiry.aboveCount(above)}</p>}
      <p className="small muted" style={{ marginTop: 4 }}>{t.expiry.note}</p>
    </div>
  )
}
