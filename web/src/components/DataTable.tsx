import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { num } from '../format'
import { useT } from '../state'

const PAGE_SIZE = 25

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** value used for sorting; omit to make the column unsortable */
  sort?: (row: T) => number | string | null | undefined
  numeric?: boolean
  title?: string
}

/**
 * Sortable table that stays usable at real-hospital volumes: rows are paged (sorting and search
 * run over all rows, not just the visible page), and `search` adds a text filter box.
 */
export function DataTable<T>({ rows, columns, rowKey, initialSort, highlight, empty, search, initialQuery = '', pageSize = PAGE_SIZE }: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  initialSort?: { key: string; desc?: boolean }
  highlight?: (row: T) => boolean
  empty?: string
  /** text a row can be found by; enables the search box */
  search?: (row: T) => string
  /** search text to start with (e.g. from a link) */
  initialQuery?: string
  pageSize?: number
}) {
  const { t } = useT()
  const [sort, setSort] = useState(initialSort)
  const [query, setQuery] = useState(initialQuery)
  const [page, setPage] = useState(0)

  const matched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!search || !q) return rows
    const terms = q.split(/\s+/)
    return rows.filter(r => { const text = search(r).toLowerCase(); return terms.every(w => text.includes(w)) })
  }, [rows, search, query])

  const sorted = useMemo(() => {
    const col = columns.find(c => c.key === sort?.key)
    if (!col?.sort) return matched
    const get = col.sort
    const dir = sort?.desc ? -1 : 1
    return [...matched].sort((a, b) => {
      const va = get(a), vb = get(b)
      if (va === null || va === undefined) return 1 // missing values always last
      if (vb === null || vb === undefined) return -1
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir
    })
  }, [matched, columns, sort])

  // Back to the first page whenever the rows, search or order change.
  useEffect(() => setPage(0), [rows.length, query, sort])

  if (!rows.length) return <p className="muted">{empty ?? t.common.noRows}</p>

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = sorted.slice(current * pageSize, (current + 1) * pageSize)
  const from = sorted.length ? current * pageSize + 1 : 0
  const to = current * pageSize + visible.length

  return (
    <div className="data-table">
      {search && (
        <input type="search" className="table-search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder={t.common.search} aria-label={t.common.search} />
      )}
      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map(c => {
              const active = sort?.key === c.key
              return (
                <th
                  key={c.key}
                  className={`${c.numeric ? 'r ' : ''}${c.sort ? 'sortable' : ''}`}
                  title={c.title}
                  aria-sort={active ? (sort?.desc ? 'descending' : 'ascending') : undefined}
                  onClick={c.sort ? () => setSort({ key: c.key, desc: active ? !sort?.desc : !!c.numeric }) : undefined}
                >
                  {c.header}
                  {active ? (sort?.desc ? ' ↓' : ' ↑') : ''}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {visible.map(r => (
            <tr key={rowKey(r)} className={highlight?.(r) ? 'highlight' : undefined}>
              {columns.map(c => (
                <td key={c.key} className={c.numeric ? 'r' : undefined}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!sorted.length && <p className="muted" style={{ padding: '10px' }}>{t.common.noMatch}</p>}
      </div>
      {(pages > 1 || matched.length !== rows.length) && (
        <div className="pager">
          <span className="small muted">
            {t.common.showing(num(from), num(to), num(sorted.length))}
            {matched.length !== rows.length && ` ${t.common.filteredFrom(num(rows.length))}`}
          </span>
          {pages > 1 && (
            <span className="pager-buttons">
              <button type="button" className="btn" onClick={() => setPage(current - 1)} disabled={current === 0}>{t.common.prev}</button>
              <span className="small">{t.common.pageOf(current + 1, pages)}</span>
              <button type="button" className="btn" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>{t.common.next}</button>
            </span>
          )}
        </div>
      )}
    </div>
  )
}
