import { useState } from 'react'
import { useApi } from '../api'
import { DataTable } from '../components/DataTable'
import { DateRange, defaultRange, type Range } from '../components/DateRange'
import { Status } from '../components/Status'
import { csvCell, date, dateRange, num, shortOrg } from '../format'
import { useMeta, useT } from '../state'
import type { CheckCategory, ChecksResp } from '../types'

const CATEGORIES: CheckCategory[] = ['contradiction', 'impossible', 'confirm']

export function ChecksView() {
  const { meta, wardName, specimenName } = useMeta()
  const { t } = useT()
  const [period, setPeriod] = useState<'4w' | '12m' | ''>('12m')
  const [range, setRange] = useState<Range | null>(null)
  const { data, error, loading } = useApi<ChecksResp>('/api/checks', range ? { date_from: range[0], date_to: range[1] } : { window: period })

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">{t.app.loading}</p>

  const serious = data.counts.contradiction + data.counts.impossible
  const kind = (c: CheckCategory) => (c === 'confirm' ? 'muted' : 'critical') as 'muted' | 'critical'

  const exportCsv = () => {
    const head = ['date', 'isolate_id', 'patient_id', 'ward', 'specimen', 'organism', 'category', 'check', 'antibiotic', 'result']
    const rows = data.flagged.map(f => [f.sample_date, f.isolate_id, f.patient_id, f.ward_code, f.specimen, f.organism, f.category,
      t.checks.rules[f.rule] ?? f.rule, f.antibiotic_code, f.result ?? ''].map(csvCell).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: `result-checks-${data.end}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.checks.title}</h1>
        <span className="sub">{t.checks.sub}</span>
      </div>

      <div className="filter-bar">
        <div className="field">
          <span>{t.filters.time}</span>
          <div className="segmented">
            <button type="button" aria-pressed={!range && period === '4w'} onClick={() => { setRange(null); setPeriod('4w') }}>{t.filters.last4w}</button>
            <button type="button" aria-pressed={!range && period === '12m'} onClick={() => { setRange(null); setPeriod('12m') }}>{t.filters.last12m}</button>
            <button type="button" aria-pressed={!range && period === ''} onClick={() => { setRange(null); setPeriod('') }}>{t.filters.allTime}</button>
            <button type="button" aria-pressed={!!range} onClick={() => setRange(range ?? defaultRange(meta))}>{t.filters.custom}</button>
          </div>
        </div>
        {range && <DateRange value={range} onChange={setRange} />}
        <span className="ignored-note">{dateRange([data.start, data.end])}</span>
      </div>

      {serious ? (
        <div className="banner critical" role="status"><Status kind="critical">{t.status.alert}</Status><span>{t.checks.needAttention(serious)}</span></div>
      ) : (
        <div className="banner good"><Status kind="good">{t.status.normal}</Status><span>{t.checks.allClear}</span></div>
      )}

      <div className="tiles">
        <div className="tile">
          <span className="tile-label">{t.checks.checked}</span>
          <span className="tile-value">{num(data.counts.checked)}</span>
          <span className="tile-sub">{t.checks.checkedSub}</span>
        </div>
        {CATEGORIES.map(c => (
          <div key={c} className={`tile${data.counts[c] && c !== 'confirm' ? ' alert' : ''}`}>
            <span className="tile-label">{t.checks.cat[c]}</span>
            <span className="tile-value">{num(data.counts[c])}</span>
            <span className="tile-sub">{t.checks.catHelp[c]}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t.checks.flaggedTitle}</h3>
          <button type="button" className="btn" onClick={exportCsv} disabled={!data.flagged.length}>{t.checks.exportCsv}</button>
        </div>
        <DataTable
          rows={data.flagged}
          rowKey={r => r.isolate_id + r.rule + r.antibiotic_code}
          search={r => [r.isolate_id, r.patient_id, wardName(r.ward_code), r.ward_code, r.organism, specimenName(r.specimen), r.antibiotic_code, t.checks.rules[r.rule] ?? r.rule].join(' ')}
          highlight={r => r.category !== 'confirm'}
          empty={t.checks.noneFlagged}
          columns={[
            { key: 'd', header: t.findings.date, render: r => date(r.sample_date), sort: r => r.sample_date },
            { key: 'i', header: t.checks.isolate, render: r => <span className="num">{r.isolate_id}</span>, sort: r => r.isolate_id },
            { key: 'p', header: t.findings.patient, render: r => <span className="num">{r.patient_id}</span> },
            { key: 'w', header: t.common.ward, render: r => wardName(r.ward_code), sort: r => wardName(r.ward_code) },
            { key: 's', header: t.filters.specimen, render: r => specimenName(r.specimen) },
            { key: 'o', header: t.common.organism, render: r => <span className="italic">{shortOrg(r.organism)}</span>, sort: r => r.organism },
            { key: 'r', header: t.checks.result, render: r => <span className="num">{r.antibiotic_code} {r.result ?? '–'}</span> },
            { key: 'c', header: t.checks.rule, render: r => <span title={t.checks.rules[r.rule] ?? r.rule}><Status kind={kind(r.category)}>{t.checks.rulesShort[r.rule] ?? t.checks.rules[r.rule] ?? r.rule}</Status></span>, sort: r => r.category },
          ]}
        />
      </div>

      <div className="card">
        <div className="card-head"><h3>{t.checks.rulesTitle}</h3></div>
        <DataTable
          rows={data.rules}
          rowKey={r => r.rule}
          highlight={r => r.flagged > 0 && r.category !== 'confirm'}
          columns={[
            { key: 'r', header: t.checks.rule, render: r => t.checks.rules[r.rule] ?? r.rule },
            { key: 'c', header: t.common.type, render: r => <Status kind={kind(r.category)}>{t.checks.catOne[r.category]}</Status>, sort: r => r.category },
            { key: 'b', header: t.checks.basis, render: r => <span className="small secondary">{t.checks.basisText[r.rule] ?? r.basis}</span> },
            { key: 'k', header: t.checks.checkedCol, numeric: true, render: r => num(r.checked), sort: r => r.checked },
            { key: 'f', header: t.checks.flaggedCol, numeric: true, render: r => <strong>{num(r.flagged)}</strong>, sort: r => r.flagged },
          ]}
        />
      </div>
    </div>
  )
}
