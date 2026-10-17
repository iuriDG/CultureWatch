import { useApi } from '../api'
import { DataTable } from '../components/DataTable'
import { Status } from '../components/Status'
import { date, dateRange, num, PHENOTYPE_LABEL, shortOrg } from '../format'
import { useMeta, useT } from '../state'
import type { WeeklyResp } from '../types'

/** One printable page for the infection unit: the latest 7 days at a glance. */
export function WeeklyView() {
  const { wardName, specimenName } = useMeta()
  const { t } = useT()
  const { data, error } = useApi<WeeklyResp>('/api/weekly')

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">{t.weekly.loading}</p>

  const counts = { new: 0, known: 0, repositive: 0 }
  for (const f of data.findings) counts[f.status] += 1

  return (
    <div className="printable" style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.weekly.title}</h1>
        <span className="sub">{t.weekly.sub(dateRange([data.start, data.end]))}</span>
        <span className="header-spacer" />
        <button type="button" className="btn primary no-print" onClick={() => window.print()}>{t.weekly.print}</button>
      </div>

      <section className="card">
        <div className="card-head"><h3>{t.weekly.alerts}</h3></div>
        {data.alerts.length ? (
          <ul className="weekly-list">
            {data.alerts.map(a => (
              <li key={a.phenotype + a.ward_code}>
                <Status kind="critical">{t.status.alert}</Status>{' '}
                {t.weekly.alertLine(PHENOTYPE_LABEL[a.phenotype], wardName(a.ward_code), a.observed, num(a.expected, 1))}
              </li>
            ))}
          </ul>
        ) : <p><Status kind="good">{t.status.normal}</Status> {t.weekly.noAlerts}</p>}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{t.weekly.newCarriers}</h3>
          <p>{t.findings.status.new}: {counts.new} · {t.findings.status.known}: {counts.known} · {t.findings.status.repositive}: {counts.repositive}</p>
        </div>
        <DataTable
          rows={data.findings}
          rowKey={r => r.finding_id}
          pageSize={500}
          initialSort={{ key: 'd', desc: true }}
          empty={t.weekly.none}
          columns={[
            { key: 'd', header: t.findings.date, render: r => date(r.sample_date), sort: r => r.sample_date },
            { key: 'p', header: t.findings.patient, render: r => <span className="num">{r.patient_id}</span> },
            { key: 'w', header: t.common.ward, render: r => wardName(r.ward_code) },
            { key: 't', header: t.common.type, render: r => PHENOTYPE_LABEL[r.phenotype] },
            { key: 'o', header: t.common.organism, render: r => <span className="italic">{r.organisms.split(', ').map(shortOrg).join(', ')}</span> },
            { key: 's', header: t.filters.specimen, render: r => specimenName(r.specimen) },
            { key: 'st', header: t.findings.carrier, render: r => <Status kind={r.status === 'known' ? 'muted' : 'critical'}>{t.findings.status[r.status]}</Status> },
            { key: 'mv', header: t.findings.recent, render: r => r.recent_wards.length ? r.recent_wards.map(wardName).join(', ') : <span className="muted">–</span> },
          ]}
        />
      </section>


    </div>
  )
}
