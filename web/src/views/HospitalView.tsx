import { useApi } from '../api'
import { BarList } from '../components/BarList'
import { DataTable } from '../components/DataTable'
import { ExpiryHeadline } from '../components/ExpiryWatch'
import { FilterBar } from '../components/FilterBar'
import { Status } from '../components/Status'
import { num, pct, pp, pValue, shortOrg } from '../format'
import { filterParams, useMeta, useT, type Filters } from '../state'
import type { ExpiryResp, HomeAreaRow, OverviewResp, Rate, SettingComparison, WardProfileRow } from '../types'

export function HospitalView({ filters, setFilters, onOpenWard }: {
  filters: Filters
  setFilters: (f: Filters) => void
  onOpenWard: (code: string) => void
}) {
  const { meta, abLabel, wardName } = useMeta()
  const { t } = useT()
  const params = filterParams(filters)
  const ov = useApi<OverviewResp>('/api/overview', params)
  const comp = useApi<SettingComparison[]>('/api/hospital-vs-community', params)
  const wp = useApi<WardProfileRow[]>('/api/ward-profile', params)
  const areas = useApi<{ areas: HomeAreaRow[] }>('/api/home-areas', params)
  const expiry = useApi<ExpiryResp>('/api/expiry', filterParams(filters, ['time', 'ward']))
  const minN = meta.min_isolates
  const small = <span className="muted">{t.common.nLow(minN)}</span>

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.hosp.title}</h1>
      </div>
      <FilterBar filters={filters} onChange={setFilters} />
      {expiry.data && <ExpiryHeadline data={expiry.data} />}
      {ov.error && <p className="error">{ov.error}</p>}

      {ov.data && (
        <div className={ov.loading ? 'loading' : undefined} style={{ display: 'grid', gap: 16 }}>
          <div className="tiles">
            <div className="tile">
              <span className="tile-label">{t.ward.firstIsolates}</span>
              <span className="tile-value">{num(ov.data.kpis.first_isolates)}</span>
            </div>
            <RateTile label={t.ward.esblLabel} r={ov.data.kpis.esbl} minN={minN} />
            <RateTile label={t.ward.mrsaLabel} r={ov.data.kpis.mrsa} minN={minN} />
            <div className="tile"><span className="tile-label">{t.hosp.vre}</span><span className="tile-value">{ov.data.kpis.vre_cases}</span></div>
            <div className="tile"><span className="tile-label">{t.hosp.cpe}</span><span className="tile-value">{ov.data.kpis.cpe_cases}</span></div>
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>{t.hosp.mix}</h3><p>{t.hosp.mixSub}</p></div>
              <BarList ariaLabel={t.hosp.mix} items={ov.data.organism_mix.slice(0, 10).map(o => ({
                key: o.organism, label: <span className="italic">{shortOrg(o.organism)}</span>, value: o.n, display: num(o.n),
              }))} />
            </div>
            <div className="card">
              <div className="card-head">
                <h3>{t.hosp.changes}</h3>
                <p>{t.hosp.changesSub(ov.data.change_periods.join(' → ') || t.hosp.needTwo)}</p>
              </div>
              <DataTable
                rows={ov.data.changes}
                rowKey={r => r.organism + r.antibiotic_code}
                empty={t.hosp.noChanges(minN)}
                columns={[
                  { key: 'o', header: t.common.organism, render: r => <span className="italic">{shortOrg(r.organism)}</span> },
                  { key: 'a', header: t.common.antibiotic, render: r => abLabel(r.antibiotic_code) },
                  { key: 'p', header: t.hosp.before, numeric: true, render: r => pct(r.pct_prev) },
                  { key: 'l', header: t.hosp.now, numeric: true, render: r => pct(r.pct_last) },
                  { key: 'c', header: t.common.change, numeric: true, render: r => <strong>{pp(r.change_pp)}</strong> },
                ]}
              />
            </div>
          </div>
        </div>
      )}

      <div className={`card${wp.loading ? ' loading' : ''}`}>
        <div className="card-head">
          <h3>{t.hosp.hotspots}</h3>
          <p>{t.hosp.hotspotsSub}</p>
        </div>
        {wp.error && <p className="error">{wp.error}</p>}
        {wp.data && (
          <DataTable
            rows={wp.data}
            rowKey={r => r.ward_code}
            initialSort={{ key: 'esbl', desc: true }}
            highlight={r => (r.esbl_p_above ?? 1) < 0.05 || (r.mrsa_p_above ?? 1) < 0.05}
            columns={[
              { key: 'w', header: t.common.ward, sort: r => wardName(r.ward_code), render: r => (
                <button type="button" className="link-btn" onClick={() => onOpenWard(r.ward_code)}>{wardName(r.ward_code)}</button>
              ) },
              { key: 'n', header: t.ward.firstIsolates, numeric: true, render: r => num(r.first_isolates), sort: r => r.first_isolates },
              { key: 'ho', header: t.hosp.hoCol, numeric: true, render: r => pct(r.hospital_onset_share, 0), sort: r => r.hospital_onset_share },
              { key: 'esbl', header: 'ESBL %', numeric: true, render: r => r.esbl_pct === null ? small : pct(r.esbl_pct), sort: r => r.esbl_pct },
              { key: 'esblp', header: t.common.pAbove, title: t.common.pHelp, numeric: true, render: r => <PFlag p={r.esbl_p_above} />, sort: r => r.esbl_p_above },
              { key: 'mrsa', header: 'MRSA %', numeric: true, render: r => r.mrsa_pct === null ? small : pct(r.mrsa_pct), sort: r => r.mrsa_pct },
              { key: 'mrsap', header: t.common.pAbove, title: t.common.pHelp, numeric: true, render: r => <PFlag p={r.mrsa_p_above} />, sort: r => r.mrsa_p_above },
              { key: 'vre', header: 'VRE', numeric: true, render: r => r.vre_n, sort: r => r.vre_n },
              { key: 'cpe', header: 'CPE', numeric: true, render: r => r.cpe_n, sort: r => r.cpe_n },
            ]}
          />
        )}
      </div>

      <div className={`card${areas.loading ? ' loading' : ''}`}>
        <div className="card-head"><h3>{t.areas.title}</h3><p>{t.areas.sub}</p></div>
        {areas.error && <p className="error">{areas.error}</p>}
        {areas.data && (
          <DataTable
            rows={areas.data.areas}
            rowKey={r => r.home_area}
            initialSort={{ key: 'n', desc: true }}
            columns={[
              { key: 'a', header: t.areas.area, render: r => t.findings.areas[r.home_area] ?? r.home_area, sort: r => r.home_area },
              { key: 'n', header: t.areas.isolates, numeric: true, render: r => num(r.first_isolates), sort: r => r.first_isolates },
              { key: 'esbl', header: 'ESBL %', numeric: true, render: r => r.esbl.pct === null ? small : pct(r.esbl.pct), sort: r => r.esbl.pct },
              { key: 'mrsa', header: 'MRSA %', numeric: true, render: r => r.mrsa.pct === null ? small : pct(r.mrsa.pct), sort: r => r.mrsa.pct },
              { key: 'vre', header: 'VRE', numeric: true, render: r => num(r.vre_cases), sort: r => r.vre_cases },
              { key: 'cpe', header: 'CPE', numeric: true, render: r => num(r.cpe_cases), sort: r => r.cpe_cases },
            ]}
          />
        )}
      </div>

      <div className={`card${comp.loading ? ' loading' : ''}`}>
        <div className="card-head">
          <h3>{t.hosp.settings}</h3>
          <p>{t.hosp.settingsSub}</p>
        </div>
        {comp.error && <p className="error">{comp.error}</p>}
        {comp.data && (
          <DataTable
            rows={comp.data}
            rowKey={r => r.organism + r.antibiotic_code}
            highlight={r => r.significant}
            empty={t.hosp.noSettings}
            columns={[
              { key: 'o', header: t.common.organism, render: r => <span className="italic">{shortOrg(r.organism)}</span>, sort: r => r.organism },
              { key: 'a', header: t.common.antibiotic, render: r => abLabel(r.antibiotic_code), sort: r => r.antibiotic_code },
              { key: 'c', header: t.hosp.community, numeric: true, render: r => r.pct_community === null ? small : pct(r.pct_community), sort: r => r.pct_community },
              { key: 'nc', header: t.common.n, numeric: true, render: r => num(r.n_community) },
              { key: 'h', header: t.hosp.hoCol, numeric: true, render: r => r.pct_hospital === null ? small : pct(r.pct_hospital), sort: r => r.pct_hospital },
              { key: 'nh', header: t.common.n, numeric: true, render: r => num(r.n_hospital) },
              { key: 'd', header: t.hosp.difference, numeric: true, render: r => pp(r.diff_pp), sort: r => r.diff_pp },
              { key: 'p', header: t.common.p, title: t.common.pHelp, numeric: true, render: r => <PFlag p={r.p_value} />, sort: r => r.p_value },
            ]}
          />
        )}
      </div>
    </div>
  )
}

function PFlag({ p }: { p: number | null }) {
  if (p === null) return <span className="muted">—</span>
  return p < 0.05 ? <Status kind="critical">{pValue(p)}</Status> : <>{pValue(p)}</>
}

function RateTile({ label, r, minN }: { label: string; r: Rate; minN: number }) {
  const { t } = useT()
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{r.pct === null ? <span className="muted">{t.common.nLow(minN)}</span> : pct(r.pct)}</span>
      <span className="tile-sub">
        {t.common.ofIsolates(num(r.cases), num(r.n))}{r.ci_low !== null && r.ci_high !== null && <> · {t.common.ci(pct(r.ci_low, 0), pct(r.ci_high, 0))}</>}
      </span>
    </div>
  )
}
