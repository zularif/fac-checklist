import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

const ROLES = ['Tech', 'Supervisor', 'Admin']
const empty = { tech_id: '', name: '', role: 'Tech', pin: '' }

export default function StaffManager() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(empty)
  const [editing, setEditing] = useState(null)   // { id, name, role }
  const [pinReset, setPinReset] = useState(null) // { id, name, pin }

  async function load() {
    setLoading(true)
    const { data } = await db
      .from('technicians')
      .select('id, tech_id, name, role, status')
      .order('tech_id')
    setStaff(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const onlyDigits = (v) => v.replace(/\D/g, '').slice(0, 4)

  async function call(action, payload) {
    setBusy(true); setMsg('')
    const { data, error } = await db.functions.invoke('manage-tech', { body: { action, ...payload } })
    setBusy(false)
    if (error) {
      // try to surface the function's message
      let detail = error.message
      try { const ctx = await error.context?.json?.(); if (ctx?.error) detail = ctx.error } catch { /* */ }
      setMsg(detail || 'Something went wrong.')
      return false
    }
    if (data?.error) { setMsg(data.error); return false }
    return true
  }

  async function submitAdd() {
    if (!form.tech_id.trim() || !form.name.trim()) { setMsg('Staff ID and name are required.'); return }
    if (form.pin.length !== 4) { setMsg('PIN must be exactly 4 digits.'); return }
    const ok = await call('add', form)
    if (ok) { setAdding(false); setForm(empty); setMsg(''); load() }
  }
  async function submitEdit() {
    const ok = await call('edit', { id: editing.id, name: editing.name.trim(), role: editing.role })
    if (ok) { setEditing(null); load() }
  }
  async function submitReset() {
    if (pinReset.pin.length !== 4) { setMsg('PIN must be exactly 4 digits.'); return }
    const ok = await call('reset_pin', { id: pinReset.id, pin: pinReset.pin })
    if (ok) { setPinReset(null); setMsg('PIN reset.'); }
  }
  async function toggleStatus(t) {
    const next = t.status === 'Active' ? 'Inactive' : 'Active'
    const verb = next === 'Inactive' ? 'Deactivate' : 'Reactivate'
    if (!window.confirm(`${verb} ${t.name}? ${next === 'Inactive' ? 'They will no longer be able to sign in, but their history is kept.' : ''}`)) return
    const ok = await call('set_status', { id: t.id, status: next })
    if (ok) load()
  }

  const visible = useMemo(() => staff.filter((t) => {
    if (!showInactive && t.status !== 'Active') return false
    if (search) {
      const s = search.toLowerCase()
      return t.name?.toLowerCase().includes(s) || t.tech_id?.toLowerCase().includes(s)
    }
    return true
  }), [staff, search, showInactive])

  const roleColor = (r) => r === 'Admin' ? 'pill-danger' : r === 'Supervisor' ? 'pill-warn' : 'pill-blue'

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/admin')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p className="page-title">Manage staff</p>
          <p className="page-sub" style={{ margin: 0 }}>{staff.filter((s) => s.status === 'Active').length} active</p>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => { setAdding(true); setForm(empty); setMsg('') }}>
          <i className="ti ti-user-plus" aria-hidden="true" />Add staff
        </button>
      </div>

      {msg && <div className={msg.includes('reset') || msg.includes('added') ? 'banner-ok' : 'banner-warn'} style={{ marginTop: 10 }}>{msg}</div>}

      <input placeholder="Search name or staff ID" value={search} onChange={(e) => setSearch(e.target.value)} style={{ margin: '10px 0 8px', maxWidth: 420 }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginBottom: 10 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show deactivated staff
      </label>

      {loading ? <p className="center-msg">Loading…</p> : (
        <div className="card-grid">
          {visible.map((t) => (
            <div className={'list-card' + (t.status !== 'Active' ? ' dim' : '')} key={t.id}>
              <div className="list-card-head">
                <div className="eq-ic" style={{ width: 28, height: 28, borderRadius: 7 }}>
                  <i className="ti ti-user" style={{ fontSize: 15 }} aria-hidden="true" />
                </div>
                <p className="list-card-title">{t.name}</p>
                <span className={'pill ' + roleColor(t.role)}>{t.role}</span>
                {t.status !== 'Active' && <span className="pill" style={{ background: '#e2e8f0', color: '#64748b' }}>Inactive</span>}
              </div>
              <p className="list-card-meta">Staff ID: {t.tech_id}</p>
              <div className="list-card-actions" style={{ flexWrap: 'wrap' }}>
                <button className="btn-secondary" onClick={() => { setEditing({ id: t.id, name: t.name, role: t.role }); setMsg('') }}>
                  <i className="ti ti-edit" aria-hidden="true" />Edit
                </button>
                <button className="btn-secondary" onClick={() => { setPinReset({ id: t.id, name: t.name, pin: '' }); setMsg('') }}>
                  <i className="ti ti-key" aria-hidden="true" />Reset PIN
                </button>
                <button className="btn-secondary" style={{ color: t.status === 'Active' ? 'var(--danger)' : 'var(--success)' }} onClick={() => toggleStatus(t)}>
                  <i className={'ti ' + (t.status === 'Active' ? 'ti-user-off' : 'ti-user-check')} aria-hidden="true" />
                  {t.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
          {visible.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No staff match.</div>}
        </div>
      )}

      {/* ADD modal */}
      {adding && (
        <div className="fe-modal-overlay" onClick={() => setAdding(false)}>
          <div className="fe-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div className="fe-modal-head">
              <p className="fe-modal-code" style={{ flex: 1 }}>Add staff</p>
              <button className="icon-btn" aria-label="Close" onClick={() => setAdding(false)}><i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" /></button>
            </div>
            <div className="fe-modal-body">
              <div className="field"><label>Staff ID (e.g. T035)</label>
                <input value={form.tech_id} onChange={(e) => setForm({ ...form, tech_id: e.target.value.toUpperCase() })} placeholder="T035" />
              </div>
              <div className="field"><label>Full name</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ahmad bin Ali" />
              </div>
              <div className="field"><label>Role</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              <div className="field"><label>Starting PIN (4 digits)</label>
                <input inputMode="numeric" value={form.pin} onChange={(e) => setForm({ ...form, pin: onlyDigits(e.target.value) })} placeholder="1234" />
              </div>
              {msg && <div className="banner-warn">{msg}</div>}
            </div>
            <div className="fe-modal-foot">
              <button className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn-primary" onClick={submitAdd} disabled={busy}>{busy ? 'Adding…' : 'Add staff'}</button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT modal */}
      {editing && (
        <div className="fe-modal-overlay" onClick={() => setEditing(null)}>
          <div className="fe-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="fe-modal-head">
              <p className="fe-modal-code" style={{ flex: 1 }}>Edit staff</p>
              <button className="icon-btn" aria-label="Close" onClick={() => setEditing(null)}><i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" /></button>
            </div>
            <div className="fe-modal-body">
              <div className="field"><label>Full name</label>
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="field"><label>Role</label>
                <select value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
              </div>
              {msg && <div className="banner-warn">{msg}</div>}
            </div>
            <div className="fe-modal-foot">
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {/* RESET PIN modal */}
      {pinReset && (
        <div className="fe-modal-overlay" onClick={() => setPinReset(null)}>
          <div className="fe-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
            <div className="fe-modal-head">
              <p className="fe-modal-code" style={{ flex: 1 }}>Reset PIN — {pinReset.name}</p>
              <button className="icon-btn" aria-label="Close" onClick={() => setPinReset(null)}><i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" /></button>
            </div>
            <div className="fe-modal-body">
              <div className="field"><label>New PIN (4 digits)</label>
                <input inputMode="numeric" value={pinReset.pin} onChange={(e) => setPinReset({ ...pinReset, pin: onlyDigits(e.target.value) })} placeholder="1234" autoFocus />
              </div>
              <p className="list-card-meta">Give this PIN to the technician. They can change it themselves later.</p>
              {msg && <div className="banner-warn">{msg}</div>}
            </div>
            <div className="fe-modal-foot">
              <button className="btn-secondary" onClick={() => setPinReset(null)}>Cancel</button>
              <button className="btn-primary" onClick={submitReset} disabled={busy}>{busy ? 'Resetting…' : 'Reset PIN'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
