import { useEffect, useRef, useState } from 'react'
import { DataTable } from '../components/DataTable'
import { Status } from '../components/Status'
import { date, dateRange, num } from '../format'
import { useMeta, useT } from '../state'
import type { ImportReport, ImportStatus, StagedFile } from '../types'

type Mode = 'append' | 'replace'

// File name -> table (English names from the dataset, plus common Finnish names)
const ALIASES: [string, string][] = [
  ['susceptib', 'susceptibility'], ['herkkyy', 'susceptibility'],
  ['isolate', 'isolates'], ['isolaat', 'isolates'],
  ['culture', 'cultures'], ['viljely', 'cultures'], ['naytte', 'cultures'], ['näytte', 'cultures'],
  ['patient', 'patients'], ['potilaa', 'patients'],
  ['ward', 'wards'], ['osasto', 'wards'],
  ['antibiotic', 'antibiotics'], ['antibioot', 'antibiotics'],
]

function tableFor(fileName: string): string | null {
  const n = fileName.toLowerCase()
  return ALIASES.find(([key]) => n.includes(key))?.[1] ?? null
}

async function call<T>(method: string, url: string, body?: BodyInit): Promise<T> {
  // X-CultureWatch: the API only accepts data changes carrying the app's own header (blocks cross-site requests)
  const headers: Record<string, string> = { 'X-CultureWatch': '1', ...(body ? { 'Content-Type': 'text/csv' } : {}) }
  const r = await fetch(url, { method, body, headers })
  const data = await r.json().catch(() => null)
  if (!r.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `${r.status} ${r.statusText}`)
  return data as T
}

export function ImportView() {
  const { meta } = useMeta()
  const { t, lang } = useT()
  const [status, setStatus] = useState<ImportStatus | null>(null)
  const [mode, setMode] = useState<Mode>('append')
  const [staged, setStaged] = useState<StagedFile[]>([])
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState<'' | 'upload' | 'check' | 'import' | 'restore'>('')
  const [messages, setMessages] = useState<string[]>([])
  const [done, setDone] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    call<ImportStatus>('GET', '/api/import/status')
      .then(s => { setStatus(s); setStaged(s.staged) })
      .catch(e => setMessages([t.imp.error(String(e.message ?? e))]))
  }, []) // load once

  const disabled = !status?.can_import || busy !== '' || done
  const fail = (e: unknown) => setMessages([t.imp.error(e instanceof Error ? e.message : String(e))])

  const upload = async (files: FileList | File[]) => {
    setBusy('upload'); setReport(null)
    const notes: string[] = []
    let next = [...staged]
    for (const file of Array.from(files)) {
      const table = tableFor(file.name)
      if (!table) { notes.push(t.imp.unknownFile(file.name)); continue }
      try {
        const res = await call<StagedFile>('PUT', `/api/import/staging/${table}`, file)
        next = [...next.filter(s => s.table !== table), { table, rows: res.rows, missing: res.missing }]
      } catch (e) {
        notes.push(t.imp.error(e instanceof Error ? e.message : String(e)))
      }
    }
    setStaged(next); setMessages(notes); setBusy('')
  }

  const clear = async () => {
    try { await call('DELETE', '/api/import/staging'); setStaged([]); setReport(null); setMessages([]) } catch (e) { fail(e) }
  }

  const check = async () => {
    setBusy('check'); setMessages([])
    try { setReport(await call<ImportReport>('POST', `/api/import/check?mode=${mode}`)) } catch (e) { fail(e) }
    setBusy('')
  }

  const doImport = async () => {
    setBusy('import'); setMessages([])
    try {
      const r = await call<ImportReport>('POST', `/api/import/apply?mode=${mode}`)
      setReport(r)
      if (r.applied) { setDone(true); setTimeout(() => window.location.reload(), 1500) }
    } catch (e) { fail(e) }
    setBusy('')
  }

  const restore = async () => {
    setBusy('restore')
    try { await call('POST', '/api/import/reset'); setDone(true); setTimeout(() => window.location.reload(), 800) } catch (e) { fail(e) }
    setBusy('')
  }

  const imported = status?.imported
  const when = imported ? `${date(imported.imported_at)} ${new Date(imported.imported_at).toLocaleTimeString(lang === 'fi' ? 'fi-FI' : 'en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''
  const checkedThisMode = report && report.mode === mode && !report.applied

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="view-head">
        <h1>{t.imp.title}</h1>
        <span className="sub">{t.imp.sub}</span>
      </div>

      <div className="card">
        <div className="card-head"><h3>{t.imp.inUse}</h3>
          {imported && <button type="button" className="btn" onClick={restore} disabled={disabled}>{busy === 'restore' ? t.imp.restoring : t.imp.restore}</button>}
        </div>
        <p>
          <strong>{imported ? t.imp.imported(when, imported.mode === 'append' ? t.imp.append : t.imp.replace) : t.imp.original}</strong>
          {imported && <span className="secondary"> · {t.imp.addedCultures(num(imported.added.cultures ?? 0))}</span>}
        </p>
        <p className="secondary">{t.imp.range(dateRange([meta.date_min, meta.date_max]))}</p>
      </div>

      {status && !status.can_import && (
        <div className="banner warning"><Status kind="muted">{t.imp.title}</Status><span>{t.imp.notLocal}</span></div>
      )}

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h3>{t.imp.step1}</h3>
        <div className="field">
          <span>{t.imp.mode}</span>
          <div className="segmented">
            {(['append', 'replace'] as const).map(m => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setReport(null) }} disabled={disabled}>
                {m === 'append' ? t.imp.append : t.imp.replace}
              </button>
            ))}
          </div>
          <span className="small muted">{mode === 'append' ? t.imp.appendHelp : t.imp.replaceHelp}</span>
        </div>

        <div
          className={`dropzone${dragging ? ' over' : ''}${disabled ? ' off' : ''}`}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onClick={() => !disabled && input.current?.click()}
          onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); input.current?.click() } }}
          onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled) upload(e.dataTransfer.files) }}
        >
          <strong>{busy === 'upload' ? t.app.loading : t.imp.drop}</strong>
          <span className="small muted">{t.imp.dropSub}</span>
          <input ref={input} type="file" accept=".csv,text/csv" multiple hidden onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} />
        </div>

        {messages.map(m => <p key={m} className="error small">{m}</p>)}

        {staged.length > 0 && (
          <>
            <DataTable rows={staged} rowKey={r => r.table} columns={[
              { key: 't', header: t.imp.table, render: r => t.imp.tableNames[r.table] ?? r.table },
              { key: 'n', header: t.imp.rows, numeric: true, render: r => num(r.rows) },
              { key: 's', header: t.common.status, render: r => r.missing.length
                ? <Status kind="critical">{t.imp.missing(r.missing.join(', '))}</Status>
                : <Status kind="good">{t.imp.ready}</Status> },
            ]} />
            <div><button type="button" className="btn" onClick={clear} disabled={disabled}>{t.imp.clear}</button></div>
          </>
        )}

        <p className="small secondary">
          {t.imp.templates}{' '}
          {(status?.tables ?? []).map((tb, i) => (
            <span key={tb}>{i > 0 && ' · '}<a href={`/api/import/template/${tb}`} download={`${tb}.csv`}>{tb}.csv</a></span>
          ))}
        </p>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h3>{t.imp.step2}</h3>
        <div><button type="button" className="btn primary" onClick={check} disabled={disabled || staged.length === 0}>{busy === 'check' ? t.imp.checking : t.imp.check}</button></div>
        {report && (report.ok ? (
          <div className="banner good"><Status kind="good">{t.imp.valid}</Status><span>{t.imp.passed(report.passed ?? '')}</span></div>
        ) : (
          <div className="banner critical">
            <Status kind="critical">{t.imp.invalid}</Status>
            <div><strong>{t.imp.failed}</strong><ul>{report.errors.map(e => <li key={e}>{e}</li>)}</ul></div>
          </div>
        ))}
        {report && report.warnings.length > 0 && (
          <div className="banner warning"><Status kind="muted">{t.imp.warnings}</Status><ul>{report.warnings.map(w => <li key={w}>{w}</li>)}</ul></div>
        )}
        {report && report.tables.length > 0 && (
          <>
            <DataTable rows={report.tables.filter(r => r.added > 0 || r.table in (status?.imported?.rows ?? {}) || status?.required.includes(r.table))} rowKey={r => r.table} columns={[
              { key: 't', header: t.imp.table, render: r => t.imp.tableNames[r.table] ?? r.table },
              { key: 'a', header: t.imp.adding, numeric: true, render: r => (r.added ? `+${num(r.added)}` : '–') },
              { key: 'r', header: t.imp.after, numeric: true, render: r => num(r.rows) },
            ]} />
            {report.date_min && report.date_max && <p className="small secondary">{t.imp.newRange(dateRange([report.date_min, report.date_max]))}</p>}
          </>
        )}
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <h3>{t.imp.step3}</h3>
        <div>
          <button type="button" className="btn primary" onClick={doImport} disabled={disabled || !checkedThisMode || !report?.ok}>
            {busy === 'import' ? t.imp.importing : t.imp.importBtn}
          </button>
        </div>
        {report && report.mode !== mode && !report.applied && <p className="small muted">{t.imp.recheck}</p>}
        {done && <div className="banner good"><Status kind="good">{t.imp.valid}</Status><span>{t.imp.done}</span></div>}
      </div>
    </div>
  )
}
