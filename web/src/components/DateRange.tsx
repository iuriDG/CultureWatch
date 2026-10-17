import { useMeta, useT } from '../state'
import type { Meta } from '../types'

export type Range = [string, string]

/** Starting point for a custom range: the last 12 months, so switching to custom changes nothing at first. */
export function defaultRange(meta: Meta): Range {
  return [...meta.windows['12m']]
}

/** Two date fields (both days included), limited to the dates in the data. */
export function DateRange({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const { meta } = useMeta()
  const { t } = useT()
  const [from, to] = value
  return (
    <>
      <label className="field">
        <span>{t.filters.from}</span>
        <input type="date" value={from} min={meta.date_min} max={to || meta.date_max} required
          onChange={e => e.target.value && onChange([e.target.value, to])} />
      </label>
      <label className="field">
        <span>{t.filters.to}</span>
        <input type="date" value={to} min={from || meta.date_min} max={meta.date_max} required
          onChange={e => e.target.value && onChange([from, e.target.value])} />
      </label>
    </>
  )
}
