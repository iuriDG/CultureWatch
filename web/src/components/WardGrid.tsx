import type { ReactNode } from 'react'
import { EMPIRICAL_LIMIT, num, pct, pp, resistanceBand } from '../format'
import { hashFor } from '../hashParams'
import { useMeta, useT } from '../state'
import type { WardPair } from '../types'
import { useTooltip } from './Tooltip'

const MAX_ORGANISMS = 6

/** Cell class for a % resistant: one of the six European (EARS-Net / WHO CAESAR) bands, bold over the 20% limit. */
export function bandClass(p: number): string {
  return `b${resistanceBand(p)}${p > EMPIRICAL_LIMIT ? ' over' : ''}`
}

/** Colour key shared by the antibiogram and the ward page. */
export function BandLegend({ children }: { children?: ReactNode }) {
  const { meta } = useMeta()
  const { t } = useT()
  return (
    <div className="legend">
      <span>{t.abg.bandsTitle}</span>
      {t.abg.bands.map((b, i) => <span key={b}><span className="sw" style={{ background: `var(--band-${i})` }} />{b}</span>)}
      <span><span className="sw" style={{ background: 'var(--surface-2)' }} />{t.abg.grey(meta.min_isolates)}</span>
      <span>{t.abg.over}</span>
      {children}
    </div>
  )
}

/**
 * Which antibiotics work on this ward: % resistant for its most common bacteria (rows) and every antibiotic
 * with a reliable result for them (columns). The numbers are the ward page's own 12-month pairs; a cell opens
 * the pair's trend for the whole hospital.
 */
export function WardGrid({ pairs, intrinsic, organismOrder }: {
  pairs: WardPair[]
  intrinsic: [string, string][]
  organismOrder: string[]
}) {
  const { meta, abLabel } = useMeta()
  const { t } = useT()
  const tip = useTooltip()
  const byKey = new Map(pairs.map(p => [`${p.organism}|${p.antibiotic_code}`, p]))
  const ir = new Set(intrinsic.map(([o, a]) => `${o}|${a}`))
  const urineOnly = new Set(meta.urine_only)
  // FOX is the MRSA screening test, not a treatment
  const reliable = pairs.filter(p => p.reportable && p.antibiotic_code !== 'FOX')
  const orgs = organismOrder.filter(o => reliable.some(p => p.organism === o)).slice(0, MAX_ORGANISMS)
  const abs = meta.ab_order.filter(a => reliable.some(p => p.antibiotic_code === a && orgs.includes(p.organism)))
  if (!orgs.length) return <p className="muted">{t.ward.worksNone(meta.min_isolates)}</p>

  const nLow = t.common.nLow(meta.min_isolates)
  const open = (o: string, a: string) => { window.location.hash = hashFor('trends', { org: o, ab: a }) }
  const tipFor = (p: WardPair) => (
    <>
      <div className="tt-title"><span className="italic">{p.organism}</span> · {abLabel(p.antibiotic_code)}</div>
      {p.pct_resistant === null ? <div className="tt-value">{t.common.tooFew(meta.min_isolates)}</div>
        : <div className="tt-value">{t.charts.resistant(pct(p.pct_resistant))}</div>}
      <div>{t.common.resistedOf(num(p.n_resistant), num(p.n_tested))}</div>
      <div className="secondary">
        {t.ward.prev12(p.pct_resistant_prev === null ? nLow : pct(p.pct_resistant_prev),
          p.change_pp !== null ? ` (${pp(p.change_pp)})` : '', p.pct_resistant_all === null ? nLow : pct(p.pct_resistant_all))}
      </div>
      <div className="secondary">{t.ward.gridTip}</div>
    </>
  )

  return (
    <div className="table-wrap">
      <table className="abg">
        <thead>
          <tr>
            <th />
            {abs.map(a => <th key={a} title={abLabel(a)}>{a}{urineOnly.has(a) ? '*' : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {orgs.map(o => (
            <tr key={o}>
              <th className="org" scope="row">{o}</th>
              {abs.map(a => {
                const key = `${o}|${a}`
                const p = byKey.get(key)
                if (ir.has(key)) return <td key={a} className="grey" title={t.abg.intrinsic}>IR</td>
                if (!p) return <td key={a} className="empty" />
                const cls = p.pct_resistant === null ? 'grey link' : `${bandClass(p.pct_resistant)} link`
                return (
                  <td
                    key={a}
                    className={cls}
                    tabIndex={0}
                    role="link"
                    onClick={() => open(o, a)}
                    onKeyDown={e => { if (e.key === 'Enter') open(o, a) }}
                    onPointerMove={e => tip.show(e, tipFor(p))}
                    onPointerLeave={tip.hide}
                    onFocus={e => tip.showAt(e.currentTarget, tipFor(p))}
                    onBlur={tip.hide}
                  >
                    {p.pct_resistant === null ? nLow : num(p.pct_resistant * 100, 1)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tip.node}
    </div>
  )
}
