import { useEffect, useState } from 'react'
import { replaceHashParams } from '../hashParams'
import { useApi } from '../api'
import { DataTable } from '../components/DataTable'
import { ExpiryWatch } from '../components/ExpiryWatch'
import { FilterBar } from '../components/FilterBar'
import { Status } from '../components/Status'
import { TrendChart } from '../components/TrendChart'
import { pct, pText, pValue, shortOrg } from '../format'
import { filterParams, useMeta, useT, type Filters } from '../state'
import type { ExpiryResp, TrendResp, TrendSummaryRow } from '../types'

export function TrendsView({ filters, setFilters, initialPair }: {
  filters: Filters
  setFilters: (f: Filters) => void
  initialPair?: { organism: string; antibiotic: string }
}) {
  const { meta, abLabel } = useMeta()
  const { t } = useT()
  const [pair, setPair] = useState(initialPair ?? { organism: 'Escherichia coli', antibiotic: 'TMP' })
  // Keep the chosen pair in the address, so this trend can be bookmarked or shared.
  useEffect(() => replaceHashParams({ org: pair.organism, ab: pair.antibiotic }), [pair])
  const params = filterParams(filters, ['time'])
  const trend = useApi<TrendResp>('/api/trend', { ...params, ...pair })
  const summary = useApi<TrendSummaryRow[]>('/api/trend-summary', params)
  const expiry = useApi<ExpiryResp>('/api/expiry', params)
  const sig = trend.data && trend.data.p_value < 0.05
  const show = (organism: string, antibiotic: string) => {
    setPair({ organism, antibiotic })
    document.getElementById('trend-chart')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.trends.title}</h1>
        <span className="sub">{t.trends.sub}</span>
      </div>
      <FilterBar filters={filters} onChange={setFilters} ignore={['time']} />

      <div className="filter-bar" id="trend-chart">
        <label className="field">
          <span>{t.common.organism}</span>
          <select value={pair.organism} onChange={e => setPair(p => ({ ...p, organism: e.target.value }))} style={{ minWidth: 220 }}>
            {meta.organisms.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="field">
          <span>{t.common.antibiotic}</span>
          <select value={pair.antibiotic} onChange={e => setPair(p => ({ ...p, antibiotic: e.target.value }))} style={{ minWidth: 220 }}>
            {meta.ab_order.map(a => <option key={a} value={a}>{abLabel(a)}</option>)}
          </select>
        </label>
      </div>

      <div className={`card${trend.loading ? ' loading' : ''}`}>
        <div className="card-head">
          <h3><span className="italic">{pair.organism}</span> · {abLabel(pair.antibiotic)}: {t.trends.chartTitle}</h3>
          {trend.data && trend.data.points.length >= 2 && (
            sig ? <Status kind="critical">{t.trends.sig(t.trends.dir[trend.data.direction] ?? trend.data.direction, pText(trend.data.p_value))}</Status>
              : <Status kind="muted">{t.trends.noSig(pText(trend.data.p_value))}</Status>
          )}
        </div>
        {trend.error && <p className="error">{trend.error}</p>}
        {trend.data && (trend.data.points.length >= 2 ? (
          <>
            <TrendChart points={trend.data.points} quarters={trend.data.quarters} projection={trend.data.projection}
              threshold={trend.data.limit} minN={meta.min_isolates} label={`${pair.organism} ${pair.antibiotic}`} />
            <div className="legend" style={{ marginTop: 8 }}>
              <span><span className="line-key" style={{ borderColor: 'var(--series-1)' }} />{t.trends.legendLine}</span>
              <span><span className="line-key" style={{ borderColor: 'var(--text-2)' }} />{t.trends.legendTrend}</span>
              <span>{t.trends.legendHollow(meta.min_isolates)}</span>
              <span><span className="line-key" style={{ borderColor: 'var(--critical)', borderTopStyle: 'dashed' }} />{t.trends.legendLimit}</span>
            </div>
          </>
        ) : <p className="muted">{t.trends.notEnough}</p>)}
      </div>

      {expiry.data && (
        <div className={expiry.loading ? 'loading' : undefined} style={{ display: 'grid', gap: 12 }}>
          <ExpiryWatch data={expiry.data} onShow={show} />
        </div>
      )}

      <div className={`card${summary.loading ? ' loading' : ''}`}>
        <div className="card-head"><h3>{t.trends.keyPairs}</h3><p>{t.trends.keyPairsSub}</p></div>
        {summary.data && (
          <DataTable
            rows={summary.data}
            rowKey={r => r.organism + r.antibiotic_code}
            highlight={r => r.significant && r.direction === 'increasing'}
            initialSort={{ key: 'p', desc: false }}
            columns={[
              { key: 'o', header: t.trends.pair, sort: r => r.organism, render: r => (
                <button type="button" className="link-btn" onClick={() => show(r.organism, r.antibiotic_code)}>
                  <span className="italic">{shortOrg(r.organism)}</span> · {r.antibiotic_code}
                </button>
              ) },
              { key: 'f', header: t.trends.firstQ, numeric: true, render: r => pct(r.first) },
              { key: 'l', header: t.trends.lastQ, numeric: true, render: r => pct(r.last) },
              { key: 'd', header: t.trends.direction, render: r => t.trends.dir[r.direction] ?? r.direction },
              { key: 'p', header: t.common.p, title: t.common.pHelp, numeric: true, sort: r => r.p_value, render: r => r.significant ? <Status kind="critical">{pValue(r.p_value)}</Status> : pValue(r.p_value) },
            ]}
          />
        )}
      </div>
    </div>
  )
}
