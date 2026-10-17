import { useState } from 'react'
import { useApi } from '../api'
import { BarList } from '../components/BarList'
import { DataTable, type Column } from '../components/DataTable'
import { GoLink } from '../components/GoLink'
import { Status } from '../components/Status'
import { BandLegend, WardGrid } from '../components/WardGrid'
import { WeeklyColumns } from '../components/WeeklyColumns'
import { date, dateRange, monthYear, num, pct, PHENOTYPE_LABEL, pp, pText, pValue, shortOrg } from '../format'
import { hashFor } from '../hashParams'
import { useMeta, useT } from '../state'
import { soon } from './NowView'
import type { Strings } from '../strings'
import type { Finding, FindingsResp, NowResp, Phenotype, Rate, RateTests, WardPair, WardResp } from '../types'

const SIG = 0.05
const RARE: Phenotype[] = ['cpe', 'vre'] // one case already needs action

const rising = (cur: number | null, prev: number | null, p: number | null) =>
  p !== null && p < SIG && cur !== null && prev !== null && cur > prev
const above = (p: number | null) => p !== null && p < SIG

interface Signal {
  key: string
  what: string
  value: string
  reasons: string[]
  p: number
}

/** Annual anomalies: rates significantly up on the previous 12 months, or above the all-sites rate. */
function annualSignals(data: WardResp, t: Strings, abLabel: (c: string) => string): Signal[] {
  const tm = data.twelve_months
  const out: Signal[] = []
  for (const ph of ['esbl', 'mrsa'] as const) {
    const r = tm.rates.ward[ph], prev = tm.rates.ward_prev[ph], all = tm.rates.all_sites[ph], ts = tm.rates.tests[ph]
    const reasons: string[] = []
    if (rising(r.pct, prev.pct, ts.p_change)) reasons.push(t.ward.upFrom(pct(prev.pct), pText(ts.p_change)))
    if (above(ts.p_above)) reasons.push(t.ward.aboveRate(pct(all.pct), pText(ts.p_above)))
    if (reasons.length) out.push({ key: ph, what: PHENOTYPE_LABEL[ph], value: pct(r.pct), reasons, p: Math.min(ts.p_change ?? 1, ts.p_above ?? 1) })
  }
  for (const r of tm.pairs) {
    if (r.antibiotic_code === 'FOX') continue // the cefoxitin screen is MRSA, already covered above
    const reasons: string[] = []
    if (rising(r.pct_resistant, r.pct_resistant_prev, r.p_change)) reasons.push(t.ward.pairUp(pct(r.pct_resistant_prev), pText(r.p_change)))
    if (above(r.p_above)) reasons.push(t.ward.pairAbove(pct(r.pct_resistant_all), pText(r.p_above)))
    if (reasons.length) out.push({
      key: r.organism + r.antibiotic_code,
      what: `${shortOrg(r.organism)} · ${abLabel(r.antibiotic_code)}`,
      value: t.ward.pctResistantValue(pct(r.pct_resistant)),
      reasons,
      p: Math.min(r.p_change ?? 1, r.p_above ?? 1),
    })
  }
  return out.sort((a, b) => a.p - b.p)
}

/**
 * Own-ward page, ordered by what staff need first: is anything happening right now (clusters, CPE/VRE, new
 * carriers and who they are), which antibiotics still work here, is it getting worse, then the details.
 */
export function WardView({ code }: { code: string }) {
  const { meta, abLabel, abName, specimenName, wardName } = useMeta()
  const { t, lang } = useT()
  const [specimen, setSpecimen] = useState('')
  const { data, error, loading } = useApi<WardResp>(`/api/ward/${encodeURIComponent(code)}`, { specimen })
  const found = useApi<FindingsResp>('/api/findings', { days: 28, ward: code })
  const now = useApi<NowResp>('/api/now')
  const [showSmall, setShowSmall] = useState(false)

  if (error) return <p className="error">{t.ward.loadError} {error}</p>
  if (!data) return <p className="muted">{t.ward.loading}</p>

  const { ward, four_weeks: fw, twelve_months: tm } = data
  const findings = (found.data?.findings ?? []).filter(f => !specimen || f.specimen === specimen)
  const rare = findings.filter(f => RARE.includes(f.phenotype))
  const alerts = fw.phenotypes.filter(p => p.alert)
  const signals = annualSignals(data, t, abLabel)
  const reportable = tm.pairs.filter(p => p.reportable)
  const small = tm.pairs.filter(p => !p.reportable)
  const pairSignal = (r: WardPair) => rising(r.pct_resistant, r.pct_resistant_prev, r.p_change) || above(r.p_above)
  const nLow = t.common.nLow(meta.min_isolates)
  const name = lang === 'fi' ? ward.name_fi : ward.name_en
  const otherName = lang === 'fi' ? ward.name_en : ward.name_fi
  const expiry = (now.data?.expiry ?? []).filter(soon)

  const pairCols: Column<WardPair>[] = [
    { key: 'org', header: t.common.organism, render: r => <span className="italic">{shortOrg(r.organism)}</span>, sort: r => r.organism },
    { key: 'ab', header: t.common.antibiotic, render: r => abLabel(r.antibiotic_code), sort: r => r.antibiotic_code },
    { key: 'pct', header: t.common.pctResistant, numeric: true, render: r => pct(r.pct_resistant), sort: r => r.pct_resistant },
    { key: 'n', header: t.common.n, numeric: true, render: r => num(r.n_tested), sort: r => r.n_tested },
    { key: 'prev', header: t.ward.colPrev, numeric: true, render: r => r.pct_resistant_prev === null ? <span className="muted">{nLow}</span> : pct(r.pct_resistant_prev), sort: r => r.pct_resistant_prev },
    { key: 'chg', header: t.common.change, numeric: true, render: r => pp(r.change_pp), sort: r => r.change_pp },
    { key: 'all', header: t.ward.colAll, numeric: true, render: r => pct(r.pct_resistant_all), sort: r => r.pct_resistant_all },
    { key: 'sig', header: t.ward.colSignal, sort: r => (pairSignal(r) ? Math.min(r.p_change ?? 1, r.p_above ?? 1) : 2), render: r => {
      const up = rising(r.pct_resistant, r.pct_resistant_prev, r.p_change), hi = above(r.p_above)
      return up || hi ? <Status kind="critical">{[up && t.status.rising, hi && t.status.aboveAll].filter(Boolean).join(' · ')}</Status> : null
    } },
  ]

  const findingCols: Column<Finding>[] = [
    { key: 'd', header: t.findings.date, render: r => date(r.sample_date), sort: r => r.sample_date },
    { key: 'p', header: t.findings.patient, render: r => <><span className="num">{r.patient_id}</span> <span className="muted small">{t.findings.sexAge(r.sex, r.age_years)}</span></> },
    { key: 't', header: t.common.type, render: r => <span title={t.phenotypeHelp[r.phenotype]}>{PHENOTYPE_LABEL[r.phenotype]}</span>, sort: r => r.phenotype },
    { key: 'o', header: t.common.organism, render: r => <span className="italic">{r.organisms.split(', ').map(shortOrg).join(', ')}</span> },
    { key: 's', header: t.findings.carrier, sort: r => r.status, render: r => (
      <>
        <Status kind={r.status === 'known' ? 'muted' : 'critical'}>{t.findings.status[r.status]}</Status>
        {r.prev_date && <div className="small muted">{t.findings.prev(date(r.prev_date))}</div>}
      </>
    ) },
    { key: 'ho', header: t.findings.ho, render: r => (r.hospital_onset ? <strong>{t.findings.yes}</strong> : <span className="muted">–</span>), sort: r => (r.hospital_onset ? 0 : 1) },
    { key: 'mv', header: t.findings.recent, render: r => r.recent_wards.length ? r.recent_wards.map(wardName).join(', ') : <span className="muted">–</span> },
  ]

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 20 }}>
      <div className="view-head">
        <h1>{name}</h1>
        <span className="sub">
          {ward.code} · {otherName} · {ward.ward_type === 'in' ? t.ward.inpatient : t.ward.outpatient} · {t.ward.dataThrough(date(data.latest))}
        </span>
      </div>

      <div className="filter-bar">
        <div className="field">
          <span>{t.filters.specimen}</span>
          <div className="segmented">
            {['', ...meta.specimens].map(s => (
              <button key={s || 'all'} type="button" aria-pressed={specimen === s} onClick={() => setSpecimen(s)}>
                {s ? specimenName(s) : t.specimen.all}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- 1. Right now: last 4 weeks ---------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">
          <h2>{t.ward.rightNow}</h2>
          <span className="range">{dateRange(data.windows['4w'])}</span>
        </div>

        {alerts.length ? (
          <div className="banner critical" role="alert">
            <Status kind="critical">{t.status.alert}</Status>
            <div>
              <strong>{t.ward.alertTitle(alerts.length)}</strong>
              <ul>
                {alerts.map(a => (
                  <li key={a.phenotype}>{t.ward.alertLine(PHENOTYPE_LABEL[a.phenotype], a.observed, num(a.expected, 1), pText(a.p_value))}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="banner good">
            <Status kind="good">{t.status.normal}</Status>
            <span>{t.ward.normal4w}</span>
          </div>
        )}

        {rare.length > 0 && (
          <div className="banner critical" role="alert">
            <Status kind="critical">{t.status.alert}</Status>
            <div>
              <strong>{t.ward.rareTitle}</strong>
              <ul>
                {rare.map(r => (
                  <li key={r.finding_id}>{t.ward.rareItem(PHENOTYPE_LABEL[r.phenotype], r.patient_id, date(r.sample_date), t.findings.status[r.status])}</li>
                ))}
              </ul>
              <span className="secondary">{t.ward.rareText}</span>
            </div>
          </div>
        )}

        {findings.length > 0 && (
          <div className="card">
            <div className="card-head">
              <div>
                <h3>{t.ward.findingsTitle}</h3>
                <p>{t.ward.findingsSub}</p>
              </div>
              <GoLink href={hashFor('findings', { ward: code, days: '28' })}>{t.ward.openFindings}</GoLink>
            </div>
            <DataTable rows={findings} columns={findingCols} rowKey={r => r.finding_id} initialSort={{ key: 'd', desc: true }}
              highlight={r => r.status !== 'known'} pageSize={10} />
          </div>
        )}

        <div className="tiles">
          <div className="tile" title={t.ward.samplesHelp}>
            <span className="tile-label">{t.ward.samples}</span>
            <span className="tile-value">{num(fw.samples.observed)}</span>
            <span className="tile-sub">{t.ward.usuallyIn4w(num(fw.samples.expected, 0))}</span>
            <WeeklyColumns compact height={44} values={fw.samples.weekly} weeks={fw.weeks}
              usualPerWeek={fw.samples.expected / 4} label={t.ward.samples} />
          </div>
          <div className="tile">
            <span className="tile-label">{t.ward.newIsolates}</span>
            <span className="tile-value">{num(fw.isolates.observed)}</span>
            <span className="tile-sub">{t.ward.usuallyIn4w(num(fw.isolates.expected, 0))}</span>
            <WeeklyColumns compact height={44} values={fw.isolates.weekly} weeks={fw.weeks}
              usualPerWeek={fw.isolates.expected / 4} label={t.ward.newIsolates} />
          </div>
          {fw.phenotypes.map(p => (
            <div key={p.phenotype} className={`tile${p.alert ? ' alert' : ''}`} title={t.phenotypeHelp[p.phenotype]}>
              <span className="tile-label">{t.ward.phCases(PHENOTYPE_LABEL[p.phenotype])}</span>
              <span className="tile-value">{p.observed}</span>
              <span className="tile-sub">{t.ward.usuallyIn4w(num(p.expected, 1))}</span>
              {p.alert ? <Status kind="critical">{t.status.alert} · {pText(p.p_value)}</Status> : <Status kind="good">{t.status.normal}</Status>}
              <WeeklyColumns compact height={44} values={p.weekly} weeks={fw.weeks}
                alertWeeks={new Set(p.history.map(h => h.window_end))}
                usualPerWeek={p.expected / 4} label={t.ward.phCases(PHENOTYPE_LABEL[p.phenotype])} />
            </div>
          ))}
        </div>
      </section>

      {/* ---------------- 2. Which antibiotics work here: last 12 months ---------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">
          <h2>{t.ward.worksTitle}</h2>
          <span className="range">{dateRange(data.windows['12m'])}</span>
        </div>
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <p className="small secondary">{t.ward.worksSub(meta.min_isolates)}</p>
          <WardGrid pairs={tm.pairs} intrinsic={tm.intrinsic} organismOrder={tm.organism_mix.map(o => o.organism)} />
          <BandLegend><span>{t.abg.urineOnly}</span></BandLegend>
          {expiry.length > 0 && (
            <div className="link-row">
              <span className="small secondary">{t.ward.acrossHospital}</span>
              {expiry.map(e => (
                <GoLink key={e.organism + e.antibiotic_code} href={hashFor('trends', { org: e.organism, ab: e.antibiotic_code })}>
                  <span><span className="italic">{shortOrg(e.organism)}</span> + {abName(e.antibiotic_code)}</span>
                  <Status kind={e.status === 'crossed' ? 'critical' : 'muted'}>
                    {e.status === 'crossed'
                      ? (e.cross_date ? t.expiry.crossed(monthYear(e.cross_date)) : t.expiry.crossedNoDate)
                      : t.expiry.crossing(num(e.months_left, 0), e.cross_date ? monthYear(e.cross_date) : '—')}
                  </Status>
                </GoLink>
              ))}
            </div>
          )}
          <div className="link-row"><GoLink href={hashFor('treatment')}>{t.ward.treatLink}</GoLink></div>
        </div>
      </section>

      {/* ---------------- 3. Getting worse? Last 12 months vs the year before ---------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <div className="section-title">
          <h2>{t.ward.worseTitle}</h2>
          <span className="range">{t.ward.comparedWith(dateRange(data.windows['12m']), dateRange(data.windows['12m_prev']))}</span>
        </div>

        {signals.length ? (
          <div className="banner critical">
            <Status kind="critical">{t.status.signal}</Status>
            <div>
              <strong>{t.ward.signalTitle}</strong>
              <ul>
                {signals.slice(0, 6).map(s => (
                  <li key={s.key}><strong style={{ display: 'inline' }}>{s.what}: {s.value}</strong>, {s.reasons.join(t.ward.and)}</li>
                ))}
              </ul>
              {signals.length > 6 && <span className="secondary">{t.ward.more(signals.length - 6)}</span>}
            </div>
          </div>
        ) : (
          <div className="banner good">
            <Status kind="good">{t.status.noSignal}</Status>
            <span>{t.ward.noSignal12m}</span>
          </div>
        )}

        <div className="tiles">
          <RateTile label={t.ward.esblLabel} rate={tm.rates.ward.esbl} prev={tm.rates.ward_prev.esbl} all={tm.rates.all_sites.esbl} tests={tm.rates.tests.esbl} minN={meta.min_isolates} />
          <RateTile label={t.ward.mrsaLabel} rate={tm.rates.ward.mrsa} prev={tm.rates.ward_prev.mrsa} all={tm.rates.all_sites.mrsa} tests={tm.rates.tests.mrsa} minN={meta.min_isolates} />
          <div className="tile">
            <span className="tile-label">{t.ward.firstIsolates}</span>
            <span className="tile-value">{num(tm.first_isolates)}</span>
            <span className="tile-sub">{t.ward.firstIsolatesSub}</span>
          </div>
          {ward.ward_type === 'in' && (
            <div className="tile">
              <span className="tile-label">{t.ward.hoShare}</span>
              <span className="tile-value">{pct(tm.hospital_onset_share, 0)}</span>
              <span className="tile-sub">{t.ward.hoSub}</span>
            </div>
          )}
        </div>
      </section>

      {/* ---------------- 4. Details ---------------- */}
      <section style={{ display: 'grid', gap: 12 }}>
        <h2>{t.ward.detailsTitle}</h2>
        <div className="card">
          <div className="card-head">
            <h3>{t.ward.resistanceHere}</h3>
            <p>{t.ward.pairsWithN(reportable.length, meta.min_isolates)}</p>
          </div>
          <DataTable rows={reportable} columns={pairCols} rowKey={r => r.organism + r.antibiotic_code}
            initialSort={{ key: 'n', desc: true }} highlight={pairSignal} empty={t.ward.noPairs(meta.min_isolates)} />
          {small.length > 0 && (
            <div className="more-row">
              <span className="small muted">{t.ward.smallPairs(small.length, meta.min_isolates)}</span>
              <button type="button" className="mini-btn" aria-expanded={showSmall} onClick={() => setShowSmall(s => !s)}>
                {showSmall ? t.common.hide : t.common.showCounts}<span aria-hidden="true">{showSmall ? '▴' : '▾'}</span>
              </button>
            </div>
          )}
          {showSmall && (
            <DataTable rows={small} rowKey={r => r.organism + r.antibiotic_code} initialSort={{ key: 'n', desc: true }} columns={[
              pairCols[0], pairCols[1],
              { key: 'n', header: t.common.nTested, numeric: true, render: r => num(r.n_tested), sort: r => r.n_tested },
              { key: 'r', header: t.common.resistant, numeric: true, render: () => <span className="muted">{nLow}</span> },
            ]} />
          )}
        </div>

        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h3>{t.ward.organismsFound}</h3><p>{t.ward.organismsSub}</p></div>
            <BarList ariaLabel={t.ward.organismsFound} items={tm.organism_mix.slice(0, 10).map(o => ({
              key: o.organism,
              label: <span className="italic">{shortOrg(o.organism)}</span>,
              value: o.n,
              display: num(o.n),
              tooltip: <><div className="tt-title italic">{o.organism}</div><div className="tt-value">{num(o.n)} {t.common.isolates}</div><div>{t.ward.ofWard(pct(o.n / tm.first_isolates))}</div></>,
            }))} />
          </div>

          <section className="card">
            <div className="card-head"><h3>{t.ward.historyTitle}</h3><p>{t.ward.historySub}</p></div>
            <DataTable
              rows={fw.phenotypes.flatMap(p => p.history.map(h => ({ ...h, phenotype: p.phenotype })))}
              rowKey={r => r.phenotype + r.window_end}
              initialSort={{ key: 'week', desc: true }}
              empty={t.ward.noHistory}
              columns={[
                { key: 'ph', header: t.common.type, render: r => PHENOTYPE_LABEL[r.phenotype], sort: r => r.phenotype },
                { key: 'week', header: t.ward.windowEnding, render: r => date(r.window_end.slice(11, 21)), sort: r => r.window_end },
                { key: 'obs', header: t.common.cases, numeric: true, render: r => r.observed, sort: r => r.observed },
                { key: 'exp', header: t.common.usual, numeric: true, render: r => num(r.expected, 1), sort: r => r.expected },
                { key: 'p', header: t.common.p, title: t.common.pHelp, numeric: true, render: r => pValue(r.p_value), sort: r => r.p_value },
              ]}
            />
          </section>
        </div>
      </section>
    </div>
  )
}

function RateTile({ label, rate, prev, all, tests, minN }: {
  label: string; rate: Rate; prev: Rate; all: Rate; tests: RateTests; minN: number
}) {
  const { t } = useT()
  const change = rate.pct !== null && prev.pct !== null ? (rate.pct - prev.pct) * 100 : null
  const up = rising(rate.pct, prev.pct, tests.p_change), hi = above(tests.p_above)
  const nLow = t.common.nLow(minN)
  return (
    <div className={`tile${up || hi ? ' alert' : ''}`}>
      <span className="tile-label">{label}</span>
      <span className="tile-value">{rate.pct === null ? <span className="muted">{nLow}</span> : pct(rate.pct)}</span>
      <span className="tile-sub">
        {t.common.ofIsolates(num(rate.cases), num(rate.n))}
        {rate.pct !== null && rate.ci_low !== null && <> · {t.common.ci(pct(rate.ci_low, 0), pct(rate.ci_high, 0))}</>}
      </span>
      <span className="tile-sub">
        {t.ward.prev12(prev.pct === null ? nLow : pct(prev.pct), change !== null ? ` (${pp(change)})` : '', pct(all.pct))}
      </span>
      {rate.pct !== null && (up || hi
        ? <Status kind="critical">{[up && t.status.rising, hi && t.status.aboveAll].filter(Boolean).join(' · ')}</Status>
        : <Status kind="good">{t.status.noSignal}</Status>)}
    </div>
  )
}
