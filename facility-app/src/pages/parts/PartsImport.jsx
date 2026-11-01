import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { parsePartsCsv, FIELD_LABELS, TEMPLATE_CSV } from '../../lib/parts'

const CHUNK = 200

export default function PartsImport() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [parsed, setParsed] = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function pick(file) {
    setError(''); setResult(null); setParsed(null)
    if (!file) return
    setFileName(file.name)
    if (/\.xlsx?$/i.test(file.name)) { setError('Save the sheet as CSV first: in Excel choose File → Save As → "CSV UTF-8 (Comma delimited)", then choose that file here.'); return }
    try { setParsed(parsePartsCsv(await file.text())) } catch (e) { setError(e.message) }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'spare-parts-import-template.csv'; a.click(); URL.revokeObjectURL(url)
  }

  async function run() {
    setBusy(true); setError(''); setResult(null)
    const total = { created: 0, updated: 0, qty_skipped: [] }
    try {
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        setProgress(`Importing ${Math.min(i + CHUNK, parsed.rows.length)} of ${parsed.rows.length}…`)
        const { data, error: e } = await db.rpc('parts_import', { rows: parsed.rows.slice(i, i + CHUNK) })
        if (e) throw new Error(`${e.message}${i ? ` (the first ${i} rows were imported)` : ''}`)
        total.created += data.created; total.updated += data.updated; total.qty_skipped.push(...data.qty_skipped)
      }
      setResult(total)
    } catch (e) { setError(e.message) } finally { setBusy(false); setProgress('') }
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen" style={{ maxWidth: 820 }}>
      <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
      <p className="page-title">Import spare parts</p>
      <p className="page-sub">Load your parts list from Excel. Save the sheet as <b>CSV UTF-8</b> first.</p>

      <div className="work-panel">
        <h2>How it works</h2>
        <ul className="import-notes">
          <li>Each row needs a <b>part code</b> and a <b>name</b>. The app recognises common column names (Part No, Item Code, Description, Quantity in stock, Location, UOM…).</li>
          <li><b>Quantity in stock</b> (or Qty) goes into the <b>P1</b> store. Use a <b>qty_p2</b> column for P2, or move stock later with <b>Transfer</b>.</li>
          <li>The workbook's <b>Balance</b> column is ignored — it is calculated from old usage.</li>
          <li>Importing again updates names and details. Stock is only replaced for parts that have <b>never been used</b> in this app, so real movements are never overwritten.</li>
        </ul>
        <button className="btn-secondary" style={{ width: 'auto' }} onClick={downloadTemplate}><i className="ti ti-download" aria-hidden="true" />Download template</button>
      </div>

      <label className="btn-primary" style={{ cursor: 'pointer', width: 'auto' }}>
        <i className="ti ti-file-import" aria-hidden="true" />{fileName ? `Change file (${fileName})` : 'Choose CSV file'}
        <input type="file" accept=".csv,text/csv,.xlsx,.xls" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      </label>

      {error && <div className="banner-danger" role="alert" style={{ marginTop: 10 }}>{error}</div>}

      {parsed && (
        <div className="work-panel" style={{ marginTop: 12 }}>
          <h2>Check the columns</h2>
          <table className="map-table">
            <thead><tr><th>Your column</th><th>Imported as</th></tr></thead>
            <tbody>{parsed.mapping.map((m) => <tr key={m.column}><td>{m.column}</td><td>{m.field ? FIELD_LABELS[m.field] : <span style={{ color: 'var(--text-secondary)' }}>not used</span>}</td></tr>)}</tbody>
          </table>
          {parsed.missing.length > 0 ? (
            <div className="banner-danger">Missing a column for: {parsed.missing.map((f) => FIELD_LABELS[f]).join(', ')}. Rename that column in Excel (e.g. "part_code", "part_name") and save the CSV again.</div>
          ) : (
            <>
              <p><b>{parsed.rows.length}</b> parts found. First rows:</p>
              <div className="map-preview">
                {parsed.rows.slice(0, 5).map((r, i) => <p key={i}><b>{r.part_code}</b> · {r.part_name}{r.qty_p1 ? ` · P1: ${r.qty_p1}` : ''}{r.qty_p2 ? ` · P2: ${r.qty_p2}` : ''}{r.loc_p1 ? ` · ${r.loc_p1}` : ''}</p>)}
              </div>
              <button className="btn-primary" disabled={busy || !parsed.rows.length} onClick={run}>{busy ? progress || 'Importing…' : `Import ${parsed.rows.length} parts`}</button>
            </>
          )}
        </div>
      )}

      {result && (
        <div className="banner-ok" style={{ marginTop: 12 }}>
          Done: {result.created} new part(s), {result.updated} updated.
          {result.qty_skipped.length > 0 && <> Stock was not changed for {result.qty_skipped.length} part(s) already in use: {result.qty_skipped.slice(0, 10).join(', ')}{result.qty_skipped.length > 10 ? '…' : ''} — use Count on those parts if needed.</>}
          {' '}<Link to="/parts">Open spare parts →</Link>
        </div>
      )}
    </div>
  )
}
