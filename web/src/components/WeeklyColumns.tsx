import { date, monthShort, weekStart } from '../format'
import { useT } from '../state'
import { useTooltip } from './Tooltip'
import { useWidth } from './useWidth'

/** Column path with a 4px rounded data-end and a square baseline. */
function colPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h}V${y + rr}A${rr},${rr} 0 0 1 ${x + rr},${y}H${x + w - rr}A${rr},${rr} 0 0 1 ${x + w},${y + rr}V${y + h}Z`
}

/**
 * Weekly case counts as columns. The last `emphasizeLast` weeks (the window the alert test looks at)
 * carry the series colour; earlier weeks are de-emphasized. `usualPerWeek` draws the ward's baseline.
 * Weeks inside `alertWeeks` get a critical tick under the axis.
 */
export function WeeklyColumns({ values, weeks, emphasizeLast = 4, usualPerWeek, alertWeeks, height = 160, compact = false, label }: {
  values: number[]
  weeks: string[]
  emphasizeLast?: number
  usualPerWeek?: number
  alertWeeks?: Set<string>
  height?: number
  compact?: boolean
  label: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>(compact ? 200 : 700)
  const { t } = useT()
  const tip = useTooltip()
  const m = compact ? { t: 4, r: 0, b: 2, l: 0 } : { t: 10, r: 8, b: 26, l: 30 }
  const iw = Math.max(width - m.l - m.r, 10)
  const ih = height - m.t - m.b
  const n = values.length
  const maxV = Math.max(...values, usualPerWeek ?? 0, compact ? 1 : 3)
  const top = compact ? maxV : Math.ceil(maxV)
  const y = (v: number) => m.t + ih - (v / top) * ih
  const band = iw / Math.max(n, 1)
  const gap = band > 6 ? 2 : band > 3 ? 1 : 0
  const bw = Math.min(24, Math.max(band - gap, 1))
  const ticks = compact ? [] : niceTicks(top)
  const months = compact ? [] : monthTicks(weeks, band)

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label={label}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} shapeRendering="crispEdges" />
            <text x={m.l - 6} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
          </g>
        ))}
        {compact && <line x1={0} x2={iw} y1={m.t + ih} y2={m.t + ih} stroke="var(--axis)" strokeWidth={1} shapeRendering="crispEdges" />}
        {values.map((v, i) => {
          const x = m.l + i * band + (band - bw) / 2
          const h = m.t + ih - y(v)
          const recent = i >= n - emphasizeLast
          return v > 0 ? (
            <path key={i} d={colPath(x, y(v), bw, h)} fill={recent ? 'var(--series-1)' : 'var(--de-emph)'} />
          ) : null
        })}
        {usualPerWeek !== undefined && usualPerWeek > 0 && (
          <g>
            <line x1={m.l} x2={m.l + iw} y1={y(usualPerWeek)} y2={y(usualPerWeek)} stroke="var(--text-2)" strokeWidth={1} strokeDasharray="3 3" />
          </g>
        )}
        {alertWeeks && weeks.map((w, i) => alertWeeks.has(w) ? (
          <rect key={`a${i}`} x={m.l + i * band} y={m.t + ih + 2} width={Math.max(band, 2)} height={3} fill="var(--critical)" />
        ) : null)}
        {months.map(({ i, text }) => (
          <text key={`l${i}`} x={m.l + i * band} y={height - 6} textAnchor="start">{text}</text>
        ))}
        {/* hit targets: the full band, bigger than the mark */}
        {values.map((v, i) => (
          <rect
            key={`h${i}`}
            x={m.l + i * band}
            y={m.t}
            width={band}
            height={ih}
            fill="transparent"
            onPointerMove={e => tip.show(e, (
              <>
                <div className="tt-title">{t.charts.weekOf(date(weekStart(weeks[i])))}</div>
                <div className="tt-value">{v} {t.common.caseWord(v)}</div>
                {alertWeeks?.has(weeks[i]) && <div className="error">{t.charts.alertWeek}</div>}
              </>
            ))}
            onPointerLeave={tip.hide}
          />
        ))}
      </svg>
      {tip.node}
    </div>
  )
}

/** Where each month's weeks start on the axis: the year where a year starts (and on the first label), the short
 *  month elsewhere; labels too close together are skipped, never the year ones. */
function monthTicks(weeks: string[], band: number, minGap = 44): { i: number; text: string }[] {
  const out: { i: number; text: string; year: boolean }[] = []
  let prev = ''
  weeks.forEach((w, i) => {
    const start = weekStart(w)
    if (start.slice(0, 7) === prev) return
    prev = start.slice(0, 7)
    const first = out.length === 0, january = start.slice(5, 7) === '01'
    const tick = { i, year: first || january, text: first && !january ? `${monthShort(start)} ${start.slice(0, 4)}` : january ? start.slice(0, 4) : monthShort(start) }
    const last = out[out.length - 1]
    if (last && (i - last.i) * band < minGap) {
      if (tick.year && !last.year) out[out.length - 1] = tick // keep the year, drop the month before it
      return
    }
    out.push(tick)
  })
  return out
}

function niceTicks(top: number): number[] {
  const step = top <= 4 ? 1 : top <= 10 ? 2 : top <= 25 ? 5 : Math.ceil(top / 5 / 5) * 5
  const out: number[] = []
  for (let t = 0; t <= top + 1e-9; t += step) out.push(t)
  return out
}
