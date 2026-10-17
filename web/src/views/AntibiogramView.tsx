import { useApi } from '../api'
import { FilterBar } from '../components/FilterBar'
import { useTooltip } from '../components/Tooltip'
import { BandLegend, bandClass } from '../components/WardGrid'
import { csvCell, date, num, pct } from '../format'
import { hashFor } from '../hashParams'
import { filterParams, useMeta, useT, type Filters } from '../state'
import type { AbCell, AntibiogramResp } from '../types'

/** The six European (EARS-Net / WHO CAESAR) bands; grey when too few isolates or naturally resistant. */
function band(c: AbCell | undefined): string {
  if (!c) return 'empty'
  if (c.pct_resistant === null) return 'grey'
  return bandClass(c.pct_resistant)
}

function toCsv(d: AntibiogramResp, cell: (o: string, a: string) => AbCell | undefined): string {
  const head = ['organism', ...d.antibiotics].join(',')
  const rows = d.organisms.map(o => [o, ...d.antibiotics.map(a => cell(o, a)?.label ?? '')].map(csvCell).join(','))
  return [head, ...rows].join('\n')
}

export function AntibiogramView({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const { meta, abLabel, wardName, specimenName } = useMeta()
  const { t } = useT()
  const { data, error, loading } = useApi<AntibiogramResp>('/api/antibiogram', filterParams(filters))
  const tip = useTooltip()

  const cells = new Map((data?.cells ?? []).map(c => [`${c.organism}|${c.antibiotic_code}`, c]))
  const cell = (o: string, a: string) => cells.get(`${o}|${a}`)
  const urineOnly = new Set(meta.urine_only)

  const timeLabel = filters.time === '4w' ? t.filters.last4w : filters.time === '12m' ? t.filters.last12m
    : filters.time === 'all' ? t.filters.allTime : t.filters.year(filters.time)
  const filterSummary = [
    timeLabel,
    filters.specimen && specimenName(filters.specimen),
    filters.setting && t.filters.settings[filters.setting],
    filters.ward && wardName(filters.ward),
    filters.sex && (filters.sex === 'F' ? t.filters.female : t.filters.male),
    filters.age_group,
  ].filter(Boolean).join(' · ')

  const download = () => {
    if (!data) return
    const url = URL.createObjectURL(new Blob([toCsv(data, cell)], { type: 'text/csv' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'antibiogram.csv' })
    a.click()
    URL.revokeObjectURL(url)
  }

  const tipFor = (c: AbCell) => (
    <>
      <div className="tt-title"><span className="italic">{c.organism}</span> · {abLabel(c.antibiotic_code)}</div>
      {c.intrinsic ? <div className="tt-value">{t.abg.intrinsic}</div>
        : c.pct_resistant === null ? <div className="tt-value">{t.common.tooFew(meta.min_isolates)}</div>
        : <div className="tt-value">{t.charts.resistant(pct(c.pct_resistant))}</div>}
      <div>{t.common.resistedOf(num(c.n_resistant), num(c.n_tested))}</div>
      {c.ci_low !== null && c.ci_high !== null && <div className="secondary">{t.common.ci(pct(c.ci_low), pct(c.ci_high))}</div>}
      {!c.intrinsic && <div className="secondary">{t.abg.clickTip}</div>}
    </>
  )
  // A cell opens its trend over time (the shared filters carry over)
  const open = (c: AbCell) => { window.location.hash = hashFor('trends', { org: c.organism, ab: c.antibiotic_code }) }

  // Cell text: the % without its sign (the column says it), or IR / n<30
  const cellText = (c: AbCell | undefined) =>
    !c ? '' : c.pct_resistant !== null ? num(c.pct_resistant * 100, 1) : c.intrinsic ? 'IR' : t.common.nLow(meta.min_isolates)

  return (
    <div className="printable" style={{ display: 'grid', gap: 16 }}>
      <div className="print-only">
        <h1>{t.print.antibiogramTitle}</h1>
        <p>{t.print.filters}: {filterSummary}</p>
      </div>
      <div className="view-head no-print">
        <h1>{t.abg.title}</h1>
      </div>
      <div className="no-print"><FilterBar filters={filters} onChange={setFilters} /></div>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className={`card${loading ? ' loading' : ''}`}>
          <div className="card-head">
            <BandLegend><span>{t.abg.urineOnly}</span></BandLegend>
            <span className="no-print" style={{ display: 'inline-flex', gap: 8 }}>
              <button type="button" className="btn" onClick={download}>{t.common.downloadCsv}</button>
              <button type="button" className="btn" onClick={() => window.print()}>{t.print.button}</button>
            </span>
          </div>
          {data.organisms.length === 0 ? <p className="muted">{t.abg.none}</p> : (
            <div className="table-wrap">
              <table className="abg">
                <thead>
                  <tr>
                    <th />
                    {data.antibiotics.map(a => (
                      <th key={a} title={abLabel(a)}>{a}{urineOnly.has(a) ? '*' : ''}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.organisms.map(o => (
                    <tr key={o}>
                      <th className="org" scope="row">{o}</th>
                      {data.antibiotics.map(a => {
                        const c = cell(o, a)
                        return (
                          <td
                            key={a}
                            className={c && !c.intrinsic ? `${band(c)} link` : band(c)}
                            tabIndex={c ? 0 : undefined}
                            role={c && !c.intrinsic ? 'link' : undefined}
                            onClick={c && !c.intrinsic ? () => open(c) : undefined}
                            onKeyDown={c && !c.intrinsic ? e => { if (e.key === 'Enter') open(c) } : undefined}
                            onPointerMove={c ? e => tip.show(e, tipFor(c)) : undefined}
                            onPointerLeave={tip.hide}
                            onFocus={c ? e => tip.showAt(e.currentTarget, tipFor(c)) : undefined}
                            onBlur={tip.hide}
                          >
                            {cellText(c)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {tip.node}
        </div>
      )}
      <p className="print-only small">{t.print.generated(date(new Date().toISOString().slice(0, 10)))}</p>
    </div>
  )
}
