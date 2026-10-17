import { useState } from 'react'
import { useApi } from '../api'
import { DataTable } from '../components/DataTable'
import { DateRange, defaultRange, type Range } from '../components/DateRange'
import { Status } from '../components/Status'
import { csvCell, date, dateRange, PHENOTYPE_LABEL, shortOrg } from '../format'
import { useMeta, useT } from '../state'
import type { Finding, FindingsResp, Phenotype } from '../types'

type Step = 'iu' | 'ward' | 'muni'
type Notified = Record<string, Partial<Record<Step, string>>>

const NOTIFIED_KEY = 'culturewatch.notified'

function loadNotified(): Notified {
  try {
    return JSON.parse(localStorage.getItem(NOTIFIED_KEY) ?? '{}') as Notified
  } catch {
    return {}
  }
}

/** Notification checkmarks per finding, kept in this browser (a stand-in for writing back to the lab system). */
function useNotified() {
  const [state, setState] = useState<Notified>(loadNotified)
  const toggle = (id: string, step: Step) => {
    setState(prev => {
      const cur = { ...(prev[id] ?? {}) }
      if (cur[step]) delete cur[step]
      else cur[step] = new Date().toISOString()
      const next = { ...prev, [id]: cur }
      try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify(next)) } catch { /* not saved in a private window */ }
      return next
    })
  }
  return [state, toggle] as const
}

const PHENOTYPES: Phenotype[] = ['mrsa', 'esbl', 'vre', 'cpe']

export function FindingsView() {
  const { meta, wardName, specimenName } = useMeta()
  const { t, lang } = useT()
  const [days, setDays] = useState(7)
  const [range, setRange] = useState<Range | null>(null)
  const [phenotype, setPhenotype] = useState<Phenotype | ''>('')
  const [ward, setWard] = useState('')
  const [notified, toggle] = useNotified()
  const { data, error, loading } = useApi<FindingsResp>('/api/findings', range ? { date_from: range[0], date_to: range[1], phenotype, ward } : { days, phenotype, ward })

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">{t.app.loading}</p>

  const f = data.findings
  const isNew = (r: Finding) => r.status === 'new'
  const pending = f.filter(r => isNew(r) && !notified[r.finding_id]?.iu).length
  const time = (iso: string) => new Date(iso).toLocaleTimeString(lang === 'fi' ? 'fi-FI' : 'en-GB', { hour: '2-digit', minute: '2-digit' })

  const check = (r: Finding, step: Step, label: string) => {
    const at = notified[r.finding_id]?.[step]
    return (
      <label className={`check${at ? ' done' : ''}`} title={at ? `${label} ✓ ${time(at)}` : label}>
        <input type="checkbox" checked={!!at} onChange={() => toggle(r.finding_id, step)} />
        <span>{label}{at ? ` ${time(at)}` : ''}</span>
      </label>
    )
  }

  const exportCsv = () => {
    const head = ['date', 'patient_id', 'sex', 'age', 'ward', 'specimen', 'type', 'organisms', 'carrier_status', 'previous_positive',
      'hospital_onset', 'home_area', 'other_wards_30d', 'infection_unit_notified', 'ward_notified', 'municipality_notified']
    const rows = f.map(r => [r.sample_date, r.patient_id, r.sex, r.age_years, r.ward_code, r.specimen, PHENOTYPE_LABEL[r.phenotype], r.organisms,
      r.status, r.prev_date ?? '', r.hospital_onset, r.home_area, r.recent_wards.join(' '),
      notified[r.finding_id]?.iu ?? '', notified[r.finding_id]?.ward ?? '', notified[r.finding_id]?.muni ?? ''].map(csvCell).join(','))
    const url = URL.createObjectURL(new Blob([[head.join(','), ...rows].join('\n')], { type: 'text/csv' }))
    Object.assign(document.createElement('a'), { href: url, download: `line-list-${data.end}.csv` }).click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.findings.title}</h1>
        <span className="sub">{t.findings.sub}</span>
      </div>

      <div className="filter-bar">
        <div className="field">
          <span>{t.findings.period}</span>
          <div className="segmented">
            <button type="button" aria-pressed={!range && days === 7} onClick={() => { setRange(null); setDays(7) }}>{t.findings.last7}</button>
            <button type="button" aria-pressed={!range && days === 28} onClick={() => { setRange(null); setDays(28) }}>{t.findings.last28}</button>
            <button type="button" aria-pressed={!!range} onClick={() => setRange(range ?? defaultRange(meta))}>{t.filters.custom}</button>
          </div>
        </div>
        {range && <DateRange value={range} onChange={setRange} />}
        <div className="field">
          <span>{t.alerts.type}</span>
          <div className="segmented">
            <button type="button" aria-pressed={phenotype === ''} onClick={() => setPhenotype('')}>{t.findings.allTypes}</button>
            {PHENOTYPES.map(p => (
              <button key={p} type="button" aria-pressed={phenotype === p} onClick={() => setPhenotype(p)} title={t.phenotypeHelp[p]}>{PHENOTYPE_LABEL[p]}</button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>{t.common.ward}</span>
          <select value={ward} onChange={e => setWard(e.target.value)}>
            <option value="">{t.filters.all}</option>
            {meta.wards.map(w => <option key={w.ward_code} value={w.ward_code}>{wardName(w.ward_code)}</option>)}
          </select>
        </label>
        <span className="ignored-note">{dateRange([data.start, data.end])}</span>
      </div>

      {f.some(isNew) && (pending ? (
        <div className="banner critical" role="status">
          <Status kind="critical">{t.status.alert}</Status>
          <span>{t.findings.pending(pending)}</span>
        </div>
      ) : (
        <div className="banner good">
          <Status kind="good">{t.status.normal}</Status>
          <span>{t.findings.allReported}</span>
        </div>
      ))}

      <div className="tiles">
        <div className={`tile${f.some(isNew) ? ' alert' : ''}`}>
          <span className="tile-label">{t.findings.newCarriers}</span>
          <span className="tile-value">{f.filter(isNew).length}</span>
          <span className="tile-sub">{t.findings.newSub}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.findings.hoNew}</span>
          <span className="tile-value">{f.filter(r => isNew(r) && r.hospital_onset).length}</span>
          <span className="tile-sub">{t.findings.hoSub}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.findings.known}</span>
          <span className="tile-value">{f.filter(r => r.status === 'known').length}</span>
          <span className="tile-sub">{t.findings.knownSub}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.findings.repositive}</span>
          <span className="tile-value">{f.filter(r => r.status === 'repositive').length}</span>
          <span className="tile-sub">{t.findings.repSub}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>{t.findings.title}</h3>
          <button type="button" className="btn" onClick={exportCsv} disabled={!f.length}>{t.findings.exportCsv}</button>
        </div>
        <DataTable
          rows={f}
          rowKey={r => r.finding_id}
          search={r => [r.patient_id, wardName(r.ward_code), r.ward_code, r.organisms, PHENOTYPE_LABEL[r.phenotype], specimenName(r.specimen), t.findings.status[r.status]].join(' ')}
          highlight={r => isNew(r) && !notified[r.finding_id]?.iu}
          empty={t.findings.none}
          columns={[
            { key: 'd', header: t.findings.date, render: r => date(r.sample_date), sort: r => r.sample_date },
            { key: 'p', header: t.findings.patient, render: r => <><span className="num">{r.patient_id}</span> <span className="muted small">{t.findings.sexAge(r.sex, r.age_years)}</span></> },
            { key: 'w', header: t.common.ward, render: r => wardName(r.ward_code), sort: r => wardName(r.ward_code) },
            { key: 't', header: t.common.type, render: r => <span title={t.phenotypeHelp[r.phenotype]}>{PHENOTYPE_LABEL[r.phenotype]}</span>, sort: r => r.phenotype },
            { key: 'o', header: t.common.organism, render: r => <span className="italic">{r.organisms.split(', ').map(shortOrg).join(', ')}</span> },
            { key: 'sp', header: t.filters.specimen, render: r => specimenName(r.specimen) },
            { key: 's', header: t.findings.carrier, sort: r => r.status, render: r => (
              <>
                <Status kind={r.status === 'known' ? 'muted' : 'critical'}>{t.findings.status[r.status]}</Status>
                {r.prev_date && <div className="small muted">{t.findings.prev(date(r.prev_date))}</div>}
              </>
            ) },
            { key: 'ho', header: t.findings.ho, render: r => (r.hospital_onset ? <strong>{t.findings.yes}</strong> : <span className="muted">–</span>), sort: r => (r.hospital_onset ? 0 : 1) },
            { key: 'mv', header: t.findings.recent, render: r => r.recent_wards.length ? r.recent_wards.map(wardName).join(', ') : <span className="muted">–</span> },
            { key: 'ha', header: t.findings.homeArea, render: r => t.findings.areas[r.home_area] ?? r.home_area },
            { key: 'n', header: t.findings.notified, render: r => (
              <div className="checks">
                {check(r, 'iu', t.findings.iu)}
                {check(r, 'ward', t.findings.ward)}
                {isNew(r) && check(r, 'muni', t.findings.muni)}
              </div>
            ) },
          ]}
        />
        {!data.history_complete && <p className="small muted" style={{ marginTop: 8 }}>{t.findings.historyNote}</p>}
      </div>
    </div>
  )
}
