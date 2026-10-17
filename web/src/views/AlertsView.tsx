import { useState } from 'react'
import { useApi } from '../api'
import { DataTable } from '../components/DataTable'
import { Status } from '../components/Status'
import { WeeklyColumns } from '../components/WeeklyColumns'
import { date, num, PHENOTYPE_LABEL, pValue } from '../format'
import { useMeta, useT } from '../state'
import type { AlertsResp, Phenotype } from '../types'

const PHENOTYPES: Phenotype[] = ['mrsa', 'esbl', 'vre', 'cpe']
const SHOWN_WEEKS = 56 // what the alert test looks at: the ward's previous 52 weeks and the latest 4

export function AlertsView({ myWard, initialPhenotype }: { myWard: string | null; initialPhenotype?: string | null }) {
  const { meta, wardName, specimenName } = useMeta()
  const { t } = useT()
  const [phenotype, setPhenotype] = useState<Phenotype>(
    (['mrsa', 'esbl', 'vre', 'cpe'] as const).find(p => p === initialPhenotype) ?? 'mrsa')
  const [specimen, setSpecimen] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const { data, error, loading } = useApi<AlertsResp>('/api/alerts', { phenotype, specimen })

  if (error) return <p className="error">{t.alerts.loadError} {error}</p>
  if (!data) return <p className="muted">{t.alerts.loading}</p>

  const active = data.status.filter(s => s.alert)
  const ward = picked ?? active[0]?.ward_code ?? myWard ?? data.status[0]?.ward_code
  const wardStatus = data.status.find(s => s.ward_code === ward)
  const alertWeeks = new Set(data.alerts.filter(a => a.ward_code === ward).map(a => a.window_end))
  const label = PHENOTYPE_LABEL[phenotype]

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 20 }}>
      <div className="view-head">
        <h1>{t.alerts.title}</h1>
      </div>

      <div className="filter-bar">
        <div className="field">
          <span>{t.alerts.type}</span>
          <div className="segmented">
            {PHENOTYPES.map(p => (
              <button key={p} type="button" aria-pressed={phenotype === p} onClick={() => setPhenotype(p)} title={t.phenotypeHelp[p]}>{PHENOTYPE_LABEL[p]}</button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t.filters.specimen}</span>
          <select value={specimen} onChange={e => setSpecimen(e.target.value)}>
            <option value="">{t.filters.all}</option>
            {meta.specimens.map(s => <option key={s} value={s}>{specimenName(s)}</option>)}
          </select>
        </label>
      </div>

      {active.length ? (
        <div className="banner critical" role="alert">
          <Status kind="critical">{t.status.alert}</Status>
          <div>
            <strong>{t.alerts.now(label, active.map(a => wardName(a.ward_code)).join(', '), active.length)}</strong>
            <span className="secondary">{t.alerts.lookInto}</span>
          </div>
        </div>
      ) : (
        <div className="banner good">
          <Status kind="good">{t.status.normal}</Status>
          <span>{t.alerts.none(label)}</span>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>{t.alerts.latest}</h3><p>{t.alerts.latestSub}</p></div>
          <DataTable
            rows={data.status}
            rowKey={r => r.ward_code}
            initialSort={{ key: 'p', desc: false }}
            highlight={r => r.alert}
            columns={[
              { key: 'ward', header: t.common.ward, sort: r => wardName(r.ward_code), render: r => (
                <button type="button" className="link-btn" onClick={() => setPicked(r.ward_code)} aria-pressed={r.ward_code === ward}>
                  {wardName(r.ward_code)}{r.ward_code === myWard ? t.common.myWardSuffix : ''}
                </button>
              ) },
              { key: 'obs', header: t.common.cases, numeric: true, render: r => r.observed, sort: r => r.observed },
              { key: 'exp', header: t.common.usual, numeric: true, render: r => num(r.expected, 1), sort: r => r.expected },
              { key: 'p', header: t.common.p, title: t.common.pHelp, numeric: true, render: r => pValue(r.p_value), sort: r => r.p_value },
              { key: 's', header: t.common.status, render: r => r.alert ? <Status kind="critical">{t.status.alert}</Status> : <Status kind="good">{t.status.normal}</Status>, sort: r => (r.alert ? 0 : 1) },
            ]}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <h3>{t.alerts.history}</h3>
            <p>{t.alerts.historySub(data.alerts.length)}</p>
          </div>
          <DataTable
            rows={data.alerts}
            rowKey={r => r.ward_code + r.window_end}
            initialSort={{ key: 'week', desc: true }}
            empty={t.alerts.noHistory(label)}
            columns={[
              { key: 'ward', header: t.common.ward, render: r => wardName(r.ward_code), sort: r => r.ward_code },
              { key: 'week', header: t.alerts.windowEnding, render: r => date(r.window_end.slice(11, 21)), sort: r => r.window_end },
              { key: 'obs', header: t.common.cases, numeric: true, render: r => r.observed, sort: r => r.observed },
              { key: 'exp', header: t.common.usual, numeric: true, render: r => num(r.expected, 1), sort: r => r.expected },
              { key: 'p', header: t.common.p, title: t.common.pHelp, numeric: true, render: r => pValue(r.p_value), sort: r => r.p_value },
            ]}
          />
        </div>
      </div>

      {ward && (
        <div className="card">
          <div className="card-head">
            <h3>{t.alerts.weekly(label, wardName(ward))}</h3>
            <div className="legend">
              <span><span className="sw" style={{ background: 'var(--series-1)' }} />{t.alerts.keyRecent}</span>
              <span><span className="line-key" style={{ borderTopStyle: 'dashed', borderTopWidth: 1.5, color: 'var(--text-2)' }} />{t.alerts.keyUsual}</span>
              <span><span className="sw" style={{ background: 'var(--critical)', height: 4 }} />{t.alerts.keyAlert}</span>
            </div>
          </div>
          <WeeklyColumns
            values={(data.counts[ward] ?? []).slice(-SHOWN_WEEKS)}
            weeks={data.weeks.slice(-SHOWN_WEEKS)}
            alertWeeks={alertWeeks}
            usualPerWeek={wardStatus ? wardStatus.expected / 4 : undefined}
            height={200}
            label={t.alerts.weekly(label, wardName(ward))}
          />
        </div>
      )}

    </div>
  )
}
