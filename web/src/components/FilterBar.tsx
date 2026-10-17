import { useState } from 'react'
import { ALL, useMeta, useT, type FilterKey, type Filters } from '../state'
import { DateRange, defaultRange } from './DateRange'

const MORE: FilterKey[] = ['setting', 'ward', 'sex', 'age_group']

/**
 * One filter row above everything it scopes: time and specimen up front, the rest behind
 * "More filters". Filters a view ignores are not shown.
 */
export function FilterBar({ filters, onChange, ignore = [] }: {
  filters: Filters
  onChange: (f: Filters) => void
  ignore?: FilterKey[]
}) {
  const { meta, wardName, specimenName } = useMeta()
  const { t } = useT()
  const set = (k: FilterKey, v: string) => onChange({ ...filters, [k]: v })
  const cls = () => 'field'
  const shown = (k: FilterKey) => !ignore.includes(k)
  const active = MORE.filter(k => shown(k) && filters[k] !== ALL)
  const [open, setOpen] = useState(active.length > 0)
  const clearMore = () => onChange({ ...filters, ...Object.fromEntries(active.map(k => [k, ALL])) })

  const times = [
    { value: '4w', label: t.filters.last4w },
    { value: '12m', label: t.filters.last12m },
    ...meta.periods.map(p => ({ value: p, label: p.split(' ')[0] })),
    { value: 'all', label: t.filters.allTime },
    { value: 'custom', label: t.filters.custom },
  ]
  const pickTime = (value: string) => {
    if (value !== 'custom') return set('time', value)
    const [from, to] = filters.from && filters.to ? [filters.from, filters.to] : defaultRange(meta)
    onChange({ ...filters, time: 'custom', from, to })
  }

  return (
    <div className="filter-bar" role="group" aria-label="Filters">
      {shown('time') && <div className={cls()}>
        <span>{t.filters.time}</span>
        <div className="segmented">
          {times.map(o => (
            <button
              key={o.value}
              type="button"
              aria-pressed={filters.time === o.value}
              title={meta.periods.includes(o.value) ? t.filters.year(o.value) : undefined}
              onClick={() => pickTime(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>}
      {shown('time') && filters.time === 'custom' && (
        <DateRange value={[filters.from, filters.to]} onChange={([from, to]) => onChange({ ...filters, from, to })} />
      )}
      {shown('specimen') && <Select label={t.filters.specimen} all={t.filters.all} cls={cls()} value={filters.specimen} onChange={v => set('specimen', v)}
        options={meta.specimens.map(s => ({ value: s, label: specimenName(s) }))} />}
      <div className="field">
        <span aria-hidden="true">&nbsp;</span>
        <button type="button" className="btn" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {t.filters.more}{active.length ? ` (${active.length})` : ''} {open ? '▴' : '▾'}
        </button>
      </div>
      {active.length > 0 && <button type="button" className="link-btn small" style={{ alignSelf: 'center' }} onClick={clearMore}>{t.filters.clear}</button>}
      {open && <div className="filter-more">
      {shown('setting') && <Select label={t.filters.setting} all={t.filters.all} cls={cls()} value={filters.setting} onChange={v => set('setting', v)}
        options={Object.entries(t.filters.settings).map(([value, label]) => ({ value, label }))} />}
      {shown('ward') && <Select label={t.filters.ward} all={t.filters.all} cls={cls()} value={filters.ward} onChange={v => set('ward', v)}
        options={meta.wards.map(w => ({ value: w.ward_code, label: `${wardName(w.ward_code)} (${w.ward_code})` }))} />}
      {shown('sex') && <Select label={t.filters.sex} all={t.filters.all} cls={cls()} value={filters.sex} onChange={v => set('sex', v)}
        options={[{ value: 'F', label: t.filters.female }, { value: 'M', label: t.filters.male }]} />}
      {shown('age_group') && <Select label={t.filters.age} all={t.filters.all} cls={cls()} value={filters.age_group} onChange={v => set('age_group', v)}
        options={meta.age_groups.map(a => ({ value: a, label: a }))} />}
      </div>}
    </div>
  )
}

function Select({ label, all, cls, value, onChange, options }: {
  label: string
  all: string
  cls: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <label className={cls}>
      <span>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value={ALL}>{all}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
