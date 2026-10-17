import { useEffect, useState } from 'react'
import { useApi } from '../api'
import { BarList } from '../components/BarList'
import { DataTable } from '../components/DataTable'
import { FilterBar } from '../components/FilterBar'
import { Status } from '../components/Status'
import { num, pct, shortOrg } from '../format'
import { filterParams, useMeta, useT, type Filters } from '../state'
import type { TreatmentResp } from '../types'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setV(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return v
}

export function TreatmentView({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { meta, abLabel, scenarioName, tierName } = useMeta()
  const { t } = useT()
  const [scenario, setScenario] = useState(meta.scenarios[0]?.name ?? 'custom')
  const preset = meta.scenarios.find(s => s.name === scenario)
  const [target, setTarget] = useState(preset?.target ?? 0.85)
  const debTarget = useDebounced(target, 250)
  const custom = scenario === 'custom'
  const { data, error, loading } = useApi<TreatmentResp>('/api/treatment', {
    scenario,
    target: debTarget,
    ...(custom ? filterParams(filters) : {}),
  })

  const pickScenario = (name: string) => {
    setScenario(name)
    const p = meta.scenarios.find(s => s.name === name)
    if (p) setTarget(p.target)
  }
  const regimenLabel = (r: string) => r.split(' + ').map(abLabel).join(' + ')
  const picked = data?.single.find(r => r.regimen === data.recommended) ?? data?.combos.find(r => r.regimen === data.recommended)

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.treat.title}</h1>
        <span className="sub">{t.treat.sub}</span>
      </div>

      <div className="filter-bar">
        <label className="field">
          <span>{t.treat.scenario}</span>
          <select value={scenario} onChange={e => pickScenario(e.target.value)} style={{ minWidth: 260 }}>
            {meta.scenarios.map(s => <option key={s.name} value={s.name}>{scenarioName(s.name)}</option>)}
            <option value="custom">{t.treat.custom}</option>
          </select>
        </label>
        <label className="field">
          <span>{t.treat.target}: <strong className="num">{pct(target, 0)}</strong></span>
          <input type="range" min={0.5} max={0.99} step={0.01} value={target} onChange={e => setTarget(Number(e.target.value))} style={{ width: 200, height: 32 }} />
        </label>
      </div>
      {custom && <FilterBar filters={filters} onChange={setFilters} />}

      {error && <p className="error">{error}</p>}
      {data && (
        <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 16 }}>
          {!data.reportable ? (
            <div className="banner warning">
              <Status kind="muted">{t.status.notEnough}</Status>
              <span>{t.treat.tooFew(data.n_isolates, meta.min_isolates)}</span>
            </div>
          ) : picked ? (
            <div className="banner good">
              <Status kind="good">{t.status.suggested}</Status>
              <div>
                <strong>{regimenLabel(picked.regimen)}</strong>
                <span>{t.treat.covers(pct(picked.coverage, 0), pct(picked.ci_low, 0), pct(picked.ci_high, 0), tierName(picked.tier), num(data.n_isolates))}</span>
              </div>
            </div>
          ) : (
            <div className="banner warning">
              <Status kind="critical">{t.status.noMatch}</Status>
              <span>{t.treat.noneReaches(pct(data.target, 0))}</span>
            </div>
          )}

          {data.reportable && (
            <div className="grid-3-2">
              <div className="card">
                <div className="card-head">
                  <h3>{t.treat.singleTitle}</h3>
                  <p>{t.treat.singleSub}</p>
                </div>
                <BarList
                  ariaLabel={t.treat.singleTitle}
                  labelWidth="50%"
                  max={1}
                  target={data.target}
                  items={[...data.single].sort((a, b) => b.coverage - a.coverage).map(r => ({
                    key: r.regimen,
                    label: <>{abLabel(r.regimen)}<span className="chip">{tierName(r.tier)}</span></>,
                    value: r.coverage,
                    display: pct(r.coverage, 0),
                    ciLow: r.ci_low,
                    ciHigh: r.ci_high,
                    deEmph: !r.meets_target,
                    picked: r.regimen === data.recommended,
                    tooltip: (
                      <>
                        <div className="tt-title">{abLabel(r.regimen)} · {tierName(r.tier)}</div>
                        <div className="tt-value">{t.treat.covered(pct(r.coverage))}</div>
                        <div>{t.common.ofIsolates(num(r.n_covered), num(r.n_isolates))}</div>
                        <div className="secondary">{t.common.ci(pct(r.ci_low), pct(r.ci_high))}</div>
                      </>
                    ),
                  }))}
                />
              </div>
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                <div className="card">
                  <div className="card-head"><h3>{t.treat.causes}</h3><p>{t.treat.firstIsolates(num(data.n_isolates))}</p></div>
                  <BarList ariaLabel={t.treat.causes} max={1} items={data.organism_mix.slice(0, 8).map(o => ({
                    key: o.organism,
                    label: <span className="italic">{shortOrg(o.organism)}</span>,
                    value: o.share,
                    display: pct(o.share, 0),
                  }))} />
                </div>
                <div className="card">
                  <div className="card-head"><h3>{t.treat.combos}</h3><p>{t.treat.combosSub}</p></div>
                  <DataTable rows={data.combos} rowKey={r => r.regimen} columns={[
                    { key: 'r', header: t.treat.regimen, render: r => r.regimen },
                    { key: 'c', header: t.treat.coverage, numeric: true, render: r => pct(r.coverage, 0) },
                    { key: 't', header: t.treat.tier, render: r => tierName(r.tier) },
                  ]} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
