import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

// Vendor work permit applications submitted from /vendor-permit.html.
// Staff can read them, download the uploaded documents and set a status.
const STATUSES = ['New', 'Reviewing', 'Approved', 'Rejected', 'Closed']
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const when = (s) => (s ? new Date(s).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' }) : '')

async function downloadFile(file) {
  const { data: { session } } = await db.auth.getSession()
  const res = await fetch('/files/permits/' + file.key.split('/').map(encodeURIComponent).join('/'), { headers: { Authorization: `Bearer ${session?.access_token}` } })
  if (!res.ok) throw new Error(res.status === 404 ? 'File not found.' : `Could not download (${res.status}).`)
  let blob = await res.blob()
  // The browser normally unzips automatically; this is a fallback if it did not.
  if (file.encoding === 'gzip' && typeof DecompressionStream !== 'undefined') {
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    if (head[0] === 0x1f && head[1] === 0x8b) blob = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).blob()
  }
  const url = URL.createObjectURL(new Blob([blob], { type: file.type || 'application/octet-stream' }))
  const a = document.createElement('a')
  a.href = url; a.download = file.name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function Row({ label, value }) {
  if (!value) return null
  return <p style={{ margin: '2px 0', fontSize: 13 }}><b>{label}:</b> {value}</p>
}

export default function Permits() {
  const isAdmin = useIsAdmin()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(null)
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    const { data, error } = await db.from('permits').select('*').order('created_at', { ascending: false })
    if (error) setMsg(error.message)
    setRows(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => (filter === 'All' || r.status === filter) &&
      (!q || [r.ref, r.title, r.requestor_company, r.requestor_name, r.plant].some((v) => String(v || '').toLowerCase().includes(q))))
  }, [rows, filter, search])

  async function setStatus(r, status) {
    setBusy(true); setMsg('')
    const { error } = await db.rpc('permit_set_status', { id: r.id, status })
    setBusy(false)
    if (error) setMsg(error.message); else setRows((all) => all.map((x) => (x.id === r.id ? { ...x, status } : x)))
  }
  async function remove(r) {
    if (!window.confirm(`Delete application ${r.ref} and its uploaded files? This cannot be undone.`)) return
    setBusy(true); setMsg('')
    const { error } = await db.rpc('permit_delete', { id: r.id })
    setBusy(false)
    if (error) setMsg(error.message); else { setOpen(null); load() }
  }
  async function get(f) {
    setMsg('')
    try { await downloadFile(f) } catch (e) { setMsg(e.message) }
  }

  const link = `${location.origin}/vendor-permit.html`

  return (
    <div className="screen">
      <p className="page-title">Vendor work permits</p>
      <p className="page-sub" style={{ margin: '0 0 8px' }}>
        Vendor link: <a href="/vendor-permit.html" target="_blank" rel="noreferrer">{link}</a>
      </p>
      <input type="search" placeholder="Search reference, company, title…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
      <div className="chip-row">
        {['All', ...STATUSES].map((s) => (
          <button key={s} type="button" className={'chip' + (filter === s ? ' active' : '')} onClick={() => setFilter(s)}>
            {s}{s !== 'All' ? ` (${rows.filter((r) => r.status === s).length})` : ` (${rows.length})`}
          </button>
        ))}
      </div>
      {msg && <p className="error-text" role="alert">{msg}</p>}
      {loading ? <p className="center-msg">Loading…</p> : shown.length === 0 ? <p className="center-msg">No applications found.</p> : (
        <div className="card-grid">
          {shown.map((r) => {
            const d = r.data || {}
            const isOpen = open === r.id
            return (
              <div key={r.id} className="card" style={{ cursor: 'default' }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <b>{r.title}</b><span className="chip active" style={{ cursor: 'default' }}>{r.status}</span>
                  </div>
                  <p style={{ margin: '3px 0 0', fontSize: 12.5 }}>{r.requestor_company} · {r.plant} · {r.request_type} · {r.total_workers} workers</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.7 }}>{r.ref} · {when(r.created_at)}</p>
                </button>
                {isOpen && (
                  <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <Row label="Requestor" value={`${r.requestor_name} (${r.requestor_position}) · ${r.requestor_contact}`} />
                    <Row label="Work" value={r.description} />
                    <Row label="Dates" value={`${r.start_date} to ${r.target_date}`} />
                    <Row label="Category / location" value={[r.work_category, r.work_location].filter(Boolean).join(' / ')} />
                    <Row label="PO number" value={r.po_number} />
                    <Row label="Permits" value={r.permit_types} />
                    <Row label="Machines" value={(d.machines || []).map((x) => `${x.name} ×${x.qty}`).join(', ')} />
                    <Row label="Equipment" value={(d.equipment || []).map((x) => `${x.name} ×${x.qty}`).join(', ')} />
                    <Row label="Chemicals" value={(d.chemicals || []).map((x) => `${x.name} (${x.qty})`).join(', ')} />
                    <Row label="Maincon safety" value={d.mainconSafety?.name ? `${d.mainconSafety.name} · ${d.mainconSafety.company} · DOSH ${d.mainconSafety.dosh}` : ''} />
                    <Row label="Sub-contractors" value={(d.subcontractors || []).map((x) => `${x.company} / ${x.safetyName} / DOSH ${x.dosh}`).join('; ')} />
                    <p style={{ margin: '10px 0 4px', fontWeight: 700, fontSize: 13 }}>Documents</p>
                    {(r.files || []).map((f) => (
                      <button key={f.key} type="button" className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', margin: '0 6px 6px 0' }} onClick={() => get(f)}>
                        <i className="ti ti-download" aria-hidden="true" />{f.label} <span style={{ opacity: 0.6 }}>({kb(f.size)})</span>
                      </button>
                    ))}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 13 }}>Status{' '}
                        <select value={r.status} disabled={busy} onChange={(e) => setStatus(r, e.target.value)} style={{ width: 'auto' }}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </label>
                      {isAdmin && <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', color: 'var(--danger)' }} disabled={busy} onClick={() => remove(r)}><i className="ti ti-trash" aria-hidden="true" />Delete</button>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
