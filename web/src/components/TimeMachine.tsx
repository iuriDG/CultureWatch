import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi, useInflight } from '../api'
import { date, PHENOTYPE_LABEL } from '../format'
import { useMeta, useT } from '../state'
import type { TimelineAlert } from '../types'
import { Status } from './Status'

const STEP_MS = 900

/**
 * Replays the data week by week: the whole app shows what it would have shown on `asOf`.
 * Playing pauses by itself when an alert fires on your ward (any ward if none is chosen),
 * so a demo can start a few weeks early and let the detector "catch" the cluster live.
 */
export function TimeMachine({ asOf, setAsOf, myWard, onExit }: {
  asOf: string
  setAsOf: (d: string) => void
  myWard: string | null
  onExit: () => void
}) {
  const { meta, wardName } = useMeta()
  const { t } = useT()
  const weeks = meta.replay_weeks
  const timeline = useApi<TimelineAlert[]>('/api/alert-timeline', {}, { live: true })
  const [playing, setPlaying] = useState(false)
  const busy = useInflight() > 0
  const positioned = useRef(false)
  const idx = Math.max(0, weeks.indexOf(asOf))

  const relevant = (a: TimelineAlert) => !myWard || a.ward_code === myWard
  const byWeek = useMemo(() => {
    const m = new Map<string, TimelineAlert[]>()
    for (const a of timeline.data ?? []) m.set(a.week_end, [...(m.get(a.week_end) ?? []), a])
    return m
  }, [timeline.data])
  const mine = (timeline.data ?? []).filter(relevant)

  // On opening, start 3 weeks before the latest alert that matters, ready to press play.
  useEffect(() => {
    if (positioned.current || !timeline.data) return
    positioned.current = true
    const last = mine[mine.length - 1] ?? timeline.data[timeline.data.length - 1]
    if (last) {
      const i = weeks.indexOf(last.week_end)
      if (i >= 0) setAsOf(weeks[Math.max(0, i - 3)])
    }
  }, [timeline.data])

  // Step only once the current week has finished loading, so every week is actually shown.
  useEffect(() => {
    if (!playing) return
    if (idx >= weeks.length - 1) { setPlaying(false); return }
    if (busy) return
    const t = setTimeout(() => {
      const next = weeks[idx + 1]
      setAsOf(next)
      if ((byWeek.get(next) ?? []).some(relevant)) setPlaying(false)
    }, STEP_MS)
    return () => clearTimeout(t)
  }, [playing, idx, busy])

  const go = (i: number) => { setPlaying(false); setAsOf(weeks[Math.max(0, Math.min(weeks.length - 1, i))]) }
  const nextAlert = mine.find(a => weeks.indexOf(a.week_end) > idx)
  const here = byWeek.get(asOf) ?? []
  const pos = (week: string) => `${(weeks.indexOf(week) / Math.max(weeks.length - 1, 1)) * 100}%`

  return (
    <div className="replay-bar" role="region" aria-label={t.machine.region}>
      <div className="replay-when">
        <span className="replay-kicker">{t.machine.kicker}</span>
        <span className="replay-date">{date(asOf)}</span>
      </div>

      <div className="replay-controls">
        <button type="button" className="btn" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label={t.machine.prev}>◀</button>
        <button type="button" className="btn primary" onClick={() => setPlaying(p => !p)} disabled={idx >= weeks.length - 1}>
          {playing ? t.machine.pause : t.machine.play}
        </button>
        <button type="button" className="btn" onClick={() => go(idx + 1)} disabled={idx >= weeks.length - 1} aria-label={t.machine.next}>▶</button>
        <button type="button" className="btn" onClick={() => nextAlert && go(weeks.indexOf(nextAlert.week_end))} disabled={!nextAlert}>
          {myWard ? t.machine.nextWardAlert : t.machine.nextAlert}
        </button>
      </div>

      <div className="replay-track">
        <input
          type="range"
          min={0}
          max={weeks.length - 1}
          value={idx}
          onChange={e => go(Number(e.target.value))}
          aria-label={t.machine.week}
          aria-valuetext={date(asOf)}
        />
        <div className="replay-marks">
          {(timeline.data ?? []).map(a => (
            <button
              key={a.phenotype + a.ward_code + a.week_end}
              type="button"
              className={`replay-mark${relevant(a) ? ' mine' : ''}`}
              style={{ left: pos(a.week_end) }}
              title={`${date(a.week_end)}: ${t.machine.alertOn(PHENOTYPE_LABEL[a.phenotype], wardName(a.ward_code))}`}
              aria-label={t.machine.jump(PHENOTYPE_LABEL[a.phenotype], wardName(a.ward_code), date(a.week_end))}
              onClick={() => go(weeks.indexOf(a.week_end))}
            />
          ))}
        </div>
        <div className="replay-ends small muted">
          <span>{date(weeks[0])}</span>
          <span>{myWard ? t.machine.marksMine(wardName(myWard)) : t.machine.marksAll}</span>
          <span>{date(weeks[weeks.length - 1])}</span>
        </div>
      </div>

      <div className="replay-now" aria-live="polite">
        {here.length ? (
          <Status kind="critical">
            {here.map(a => t.machine.alertOn(PHENOTYPE_LABEL[a.phenotype], wardName(a.ward_code))).join(' · ')}
          </Status>
        ) : <span className="small muted">{t.machine.noneThisWeek}</span>}
      </div>

      <button type="button" className="btn" onClick={onExit}>{t.machine.back}</button>
    </div>
  )
}
