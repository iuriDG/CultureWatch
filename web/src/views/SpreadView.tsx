import { useState } from 'react'
import { useApi } from '../api'
import { DataTable } from '../components/DataTable'
import { DateRange, defaultRange, type Range } from '../components/DateRange'
import { useTooltip } from '../components/Tooltip'
import { useWidth } from '../components/useWidth'
import { dateRange, num, pct, PHENOTYPE_LABEL } from '../format'
import { useMeta, useT } from '../state'
import type { Phenotype, SpreadResp } from '../types'

const PHENOTYPES: Phenotype[] = ['mrsa', 'esbl', 'vre', 'cpe']
type Period = '4w' | '12m' | 'all'

interface Route { from: string; to: string; patients: number; types: Phenotype[]; byType: Partial<Record<Phenotype, number>> }

export function SpreadView() {
  const { meta, wardName } = useMeta()
  const { t } = useT()
  const [period, setPeriod] = useState<Period>('12m')
  const [range, setRange] = useState<Range | null>(null)
  const [phenotype, setPhenotype] = useState<Phenotype | ''>('')
  const { data, error, loading } = useApi<SpreadResp>('/api/spread', range ? { date_from: range[0], date_to: range[1], phenotype } : { window: period, phenotype })
  // Colours follow the ward, not the current filter: rank wards by all-time outflow once, 8 slots, the rest grey.
  const allTime = useApi<SpreadResp>('/api/spread', { window: 'all' })

  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">{t.spread.loading}</p>

  // One route per ward pair, summed over resistance types (a patient with two types counts once per type).
  const byPair = new Map<string, Route>()
  for (const m of data.movements) {
    const key = `${m.from_ward}>${m.to_ward}`
    const r = byPair.get(key) ?? { from: m.from_ward, to: m.to_ward, patients: 0, types: [], byType: {} }
    r.patients += m.patients
    r.byType[m.phenotype] = (r.byType[m.phenotype] ?? 0) + m.patients
    if (!r.types.includes(m.phenotype)) r.types.push(m.phenotype)
    byPair.set(key, r)
  }
  const routes = [...byPair.values()].sort((a, b) => b.patients - a.patients)
  const outflow = new Map<string, number>()
  for (const m of allTime.data?.movements ?? []) outflow.set(m.from_ward, (outflow.get(m.from_ward) ?? 0) + m.patients)
  const ranked = [...outflow.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w)
  const colorOf = (ward: string) => {
    const i = ranked.indexOf(ward)
    return i >= 0 && i < 8 ? `var(--cat-${i + 1})` : 'var(--de-emph)'
  }
  const periods: { value: Period; label: string }[] = [
    { value: '4w', label: t.spread.last4w }, { value: '12m', label: t.spread.last12m }, { value: 'all', label: t.spread.all },
  ]

  return (
    <div className={loading ? 'loading' : undefined} style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.spread.title}</h1>
        <span className="sub">{t.spread.sub}</span>
      </div>

      <div className="filter-bar">
        <div className="field">
          <span>{t.spread.period}</span>
          <div className="segmented">
            {periods.map(p => <button key={p.value} type="button" aria-pressed={!range && period === p.value} onClick={() => { setRange(null); setPeriod(p.value) }}>{p.label}</button>)}
            <button type="button" aria-pressed={!!range} onClick={() => setRange(range ?? defaultRange(meta))}>{t.filters.custom}</button>
          </div>
        </div>
        {range && <DateRange value={range} onChange={setRange} />}
        <div className="field">
          <span>{t.spread.type}</span>
          <div className="segmented">
            <button type="button" aria-pressed={phenotype === ''} onClick={() => setPhenotype('')}>{t.spread.allTypes}</button>
            {PHENOTYPES.map(p => <button key={p} type="button" aria-pressed={phenotype === p} onClick={() => setPhenotype(p)}>{PHENOTYPE_LABEL[p]}</button>)}
          </div>
        </div>
        <span className="ignored-note">{dateRange([data.start, data.end])}</span>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile-label">{t.spread.newCarriers}</span>
          <span className="tile-value">{num(data.new_carriers)}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.spread.moved}</span>
          <span className="tile-value">{num(data.moved)}</span>
          <span className="tile-sub">{t.spread.movedSub(data.new_carriers ? pct(data.moved / data.new_carriers, 0) : '–')}</span>
        </div>
        <div className="tile">
          <span className="tile-label">{t.spread.routes}</span>
          <span className="tile-value">{num(routes.length)}</span>
          <span className="tile-sub">{t.spread.routesSub}</span>
        </div>
      </div>

      {routes.length === 0 ? <p className="muted">{t.spread.none}</p> : (
        <>
          <div className="card">
            <div className="card-head"><h3>{t.spread.mapTitle}</h3></div>
            <FlowChart routes={routes} wardName={wardName} colorOf={colorOf} />
          </div>
          <div className="card">
            <div className="card-head"><h3>{t.spread.tableTitle}</h3></div>
            <DataTable
              rows={routes}
              rowKey={r => r.from + r.to}
              initialSort={{ key: 'n', desc: true }}
              search={r => [wardName(r.from), r.from, wardName(r.to), r.to, ...r.types.map(p => PHENOTYPE_LABEL[p])].join(' ')}
              columns={[
                { key: 'f', header: t.spread.from, render: r => wardName(r.from), sort: r => wardName(r.from) },
                { key: 'a', header: '', render: () => <span className="muted">→</span> },
                { key: 't', header: t.spread.to, render: r => wardName(r.to), sort: r => wardName(r.to) },
                { key: 'ty', header: t.common.type, render: r => r.types.map(p => PHENOTYPE_LABEL[p]).join(', ') },
                { key: 'n', header: t.spread.patients, numeric: true, render: r => num(r.patients), sort: r => r.patients },
              ]}
            />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Two-column flow: wards patients were on (left) → wards where they were found as new carriers (right).
 * Ribbon width = patients. Hovering a ward or a ribbon highlights its flows and dims the rest.
 */
function FlowChart({ routes, wardName, colorOf }: { routes: Route[]; wardName: (c: string) => string; colorOf: (w: string) => string }) {
  const { t } = useT()
  const tip = useTooltip()
  const [ref, width] = useWidth<HTMLDivElement>(760)
  const [focus, setFocus] = useState<{ side: 'from' | 'to'; ward: string } | { route: string } | null>(null)

  const total = routes.reduce((n, r) => n + r.patients, 0)
  const side = (key: 'from' | 'to') => {
    const sums = new Map<string, number>()
    for (const r of routes) sums.set(r[key], (sums.get(r[key]) ?? 0) + r.patients)
    return [...sums.entries()].sort((a, b) => b[1] - a[1] || wardName(a[0]).localeCompare(wardName(b[0])))
  }
  const left = side('from'), right = side('to')

  // Real pixel width, so text stays at normal size. Every ward gets at least one label's height of room.
  const W = Math.max(width, 520), LABEL = Math.min(220, W * 0.27), NODE_W = 12, GAP = 10, TOP = 30, MIN = 20
  const k = Math.max(4, Math.min(14, 320 / total))      // px per patient, same on both sides
  const x0 = LABEL, x1 = W - LABEL - NODE_W
  const colH = (nodes: [string, number][]) => nodes.reduce((n, [, v]) => n + Math.max(v * k, MIN), 0) + GAP * (nodes.length - 1)
  const plotH = Math.max(colH(left), colH(right))

  // Node positions (bar centred in its slot); the shorter column is centred.
  const place = (nodes: [string, number][]) => {
    let y = TOP + (plotH - colH(nodes)) / 2
    return new Map(nodes.map(([w, v]) => {
      const slot = Math.max(v * k, MIN), p = { y: y + (slot - v * k) / 2, h: v * k, n: v }
      y += slot + GAP
      return [w, p]
    }))
  }
  const L = place(left), R = place(right)
  const li = new Map(left.map(([w], i) => [w, i])), ri = new Map(right.map(([w], i) => [w, i]))

  // Ribbon ends: stack each ward's flows in the order of the ward on the other side (fewest crossings).
  const outY = new Map(left.map(([w]) => [w, L.get(w)!.y])), inY = new Map(right.map(([w]) => [w, R.get(w)!.y]))
  const ribbons = [...routes]
    .sort((a, b) => (li.get(a.from)! - li.get(b.from)!) || (ri.get(a.to)! - ri.get(b.to)!))
    .map(r => {
      const h = r.patients * k, ya = outY.get(r.from)!
      outY.set(r.from, ya + h)
      return { r, h, ya, yb: 0 }
    })
  for (const rb of [...ribbons].sort((a, b) => (ri.get(a.r.to)! - ri.get(b.r.to)!) || (li.get(a.r.from)! - li.get(b.r.from)!))) {
    rb.yb = inY.get(rb.r.to)!
    inY.set(rb.r.to, rb.yb + rb.h)
  }

  const key = (r: Route) => `${r.from}>${r.to}`
  const lit = (r: Route) => !focus ? null
    : 'route' in focus ? focus.route === key(r)
    : focus.side === 'from' ? r.from === focus.ward : r.to === focus.ward
  const nodeLit = (s: 'from' | 'to', w: string) => !focus ? null
    : 'route' in focus ? routes.some(r => key(r) === focus.route && r[s] === w)
    : focus.side === s ? focus.ward === w
    : routes.some(r => r[focus.side] === focus.ward && r[s] === w)

  const routeTip = (r: Route) => (
    <>
      <div className="tt-title">{wardName(r.from)} → {wardName(r.to)}</div>
      <div className="tt-value">{t.spread.patientsN(r.patients)}</div>
      <div className="secondary">{PHENOTYPES.filter(p => r.byType[p]).map(p => `${PHENOTYPE_LABEL[p]} ${r.byType[p]}`).join(' · ')}</div>
    </>
  )
  const wardTip = (s: 'from' | 'to', w: string, n: number) => (
    <>
      <div className="tt-title">{wardName(w)}</div>
      <div className="tt-value">{t.spread.patientsN(n)}</div>
      <div className="secondary">{s === 'from' ? t.spread.leftThen : t.spread.arrivedFrom}</div>
    </>
  )
  const clear = () => { setFocus(null); tip.hide() }

  const mid = (x0 + NODE_W + x1) / 2
  const H = TOP + plotH + 8
  return (
    <div className="flow" ref={ref} onPointerLeave={clear}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={routes.map(r => `${wardName(r.from)} → ${wardName(r.to)}: ${r.patients}`).join('; ')}>
        <text x={x0 + NODE_W / 2} y={14} textAnchor="middle" className="flow-head">{t.spread.from}</text>
        <text x={x1 + NODE_W / 2} y={14} textAnchor="middle" className="flow-head">{t.spread.to}</text>

        {ribbons.map(({ r, h, ya, yb }) => {
          const a = x0 + NODE_W, b = x1, on = lit(r)
          const d = `M${a},${ya} C${mid},${ya} ${mid},${yb} ${b},${yb} L${b},${yb + h} C${mid},${yb + h} ${mid},${ya + h} ${a},${ya + h} Z`
          return (
            <path key={key(r)} d={d} fill={colorOf(r.from)} className={`flow-ribbon${on === true ? ' on' : on === false ? ' off' : ''}`}
              tabIndex={0} aria-label={`${wardName(r.from)} → ${wardName(r.to)}: ${r.patients}`}
              onPointerMove={e => { setFocus({ route: key(r) }); tip.show(e, routeTip(r)) }}
              onFocus={e => { setFocus({ route: key(r) }); tip.showAt(e.currentTarget, routeTip(r)) }}
              onBlur={clear} />
          )
        })}

        {([['from', L, x0, 'end'], ['to', R, x1, 'start']] as const).map(([s, nodes, x, anchor]) =>
          [...nodes.entries()].map(([w, p]) => {
            const on = nodeLit(s, w)
            const lx = anchor === 'end' ? x - 10 : x + NODE_W + 10
            return (
              <g key={s + w} className={`flow-node${on === false ? ' off' : ''}`}
                onPointerMove={e => { setFocus({ side: s, ward: w }); tip.show(e, wardTip(s, w, p.n)) }}>
                <rect x={x - 4} y={p.y - 2} width={NODE_W + 8} height={p.h + 4} fill="transparent" />
                <rect x={x} y={p.y} width={NODE_W} height={Math.max(p.h, 2)} rx={3} className={`flow-bar ${s}`}
                  fill={s === 'from' ? colorOf(w) : undefined} />
                <text x={lx} y={p.y + p.h / 2} dy="0.35em" textAnchor={anchor} className="flow-label">
                  {anchor === 'end'
                    ? <><tspan className="flow-count">{p.n}</tspan>{'  '}{wardName(w)}</>
                    : <>{wardName(w)}{'  '}<tspan className="flow-count">{p.n}</tspan></>}
                </text>
              </g>
            )
          }))}
      </svg>
      {tip.node}
    </div>
  )
}
