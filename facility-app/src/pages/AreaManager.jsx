import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

export default function AreaManager() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [areas, setAreas] = useState([])
  const [plants, setPlants] = useState([])
  const [counts, setCounts] = useState({}) // area_id -> equipment count
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [savingId, setSavingId] = useState(null)
  const [adding, setAdding] = useState(null) // { name, plant_id }
  const [showInactive, setShowInactive] = useState(false)

  async function load() {
    setLoading(true)
    const [{ data: ar }, { data: pl }, { data: eq }] = await Promise.all([
      db.from('areas').select('id, area_id, area_name, plant_id, status').order('area_name'),
      db.from('plants').select('id, plant_name').order('plant_name'),
      db.from('equipment').select('area_id').eq('status', 'Active'),
    ])
    setAreas(ar || [])
    setPlants(pl || [])
    const c = {}
    for (const e of eq || []) c[e.area_id] = (c[e.area_id] || 0) + 1
    setCounts(c)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const plantName = useMemo(() => Object.fromEntries(plants.map((p) => [p.id, p.plant_name])), [plants])

  function setField(id, field, value) {
    setAreas((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)))
  }

  async function saveArea(a) {
    if (!a.area_name?.trim()) { setMsg('Area name cannot be empty.'); load(); return }
    setSavingId(a.id); setMsg('')
    const { error } = await db
      .from('areas')
      .update({ area_name: a.area_name.trim(), plant_id: a.plant_id })
      .eq('id', a.id)
    setSavingId(null)
    if (error) { setMsg(`Couldn't save: ${error.message}`); return }
    setMsg(`Saved "${a.area_name.trim()}".`)
  }

  async function toggleStatus(a) {
    const next = a.status === 'Active' ? 'Inactive' : 'Active'
    const n = counts[a.id] || 0
    if (next === 'Inactive' && n > 0) {
      if (!window.confirm(`${a.area_name} still has ${n} active equipment. Deactivate anyway? The equipment stay but the area is hidden from pickers.`)) return
    }
    const { error } = await db.from('areas').update({ status: next }).eq('id', a.id)
    if (error) { setMsg(error.message); return }
    load()
  }

  async function createArea() {
    if (!adding.name?.trim()) { setMsg('Area name is required.'); return }
    let max = 0
    for (const a of areas) { const m = String(a.area_id || '').match(/A(\d+)/); if (m) max = Math.max(max, +m[1]) }
    const area_id = `A${String(max + 1).padStart(3, '0')}`
    const { error } = await db
      .from('areas')
      .insert({ area_id, area_name: adding.name.trim(), plant_id: adding.plant_id, status: 'Active' })
    if (error) { setMsg(`Couldn't create area: ${error.message}`); return }
    setAdding(null); setMsg('Area added.'); load()
  }

  const visible = areas.filter((a) => showInactive || a.status === 'Active')

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/admin/equipment')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back to equipment
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p className="page-title">Manage areas</p>
          <p className="page-sub" style={{ margin: 0 }}>Rename areas, move them between plants, or deactivate.</p>
        </div>
        <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => { setAdding({ name: '', plant_id: plants[0]?.id || '' }); setMsg('') }}>
          <i className="ti ti-plus" aria-hidden="true" />Add area
        </button>
      </div>

      {msg && <div className={msg.startsWith('Saved') || msg.includes('added') ? 'banner-ok' : 'banner-warn'} style={{ marginTop: 10 }}>{msg}</div>}

      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '12px 0' }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show deactivated areas
      </label>

      {loading ? <p className="center-msg">Loading…</p> : (
        <div className="card-grid">
          {visible.map((a) => (
            <div className={'list-card' + (a.status !== 'Active' ? ' dim' : '')} key={a.id}>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Area name</label>
                <input value={a.area_name} onChange={(e) => setField(a.id, 'area_name', e.target.value)} />
              </div>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Plant</label>
                <select value={a.plant_id} onChange={(e) => setField(a.id, 'plant_id', e.target.value)}>
                  {plants.map((p) => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
                </select>
              </div>
              <p className="list-card-meta" style={{ marginBottom: 8 }}>
                {a.area_id} · {counts[a.id] || 0} equipment{a.status !== 'Active' ? ' · inactive' : ''}
              </p>
              <div className="list-card-actions" style={{ flexWrap: 'wrap' }}>
                <button className="btn-primary" style={{ width: 'auto' }} disabled={savingId === a.id} onClick={() => saveArea(a)}>
                  {savingId === a.id ? 'Saving…' : 'Save'}
                </button>
                <button className="btn-secondary" style={{ color: a.status === 'Active' ? 'var(--danger)' : 'var(--success)' }} onClick={() => toggleStatus(a)}>
                  <i className={'ti ' + (a.status === 'Active' ? 'ti-eye-off' : 'ti-eye')} aria-hidden="true" />
                  {a.status === 'Active' ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            </div>
          ))}
          {visible.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No areas.</div>}
        </div>
      )}

      {/* add area modal */}
      {adding && (
        <div className="fe-modal-overlay" onClick={() => setAdding(null)}>
          <div className="fe-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div className="fe-modal-head">
              <p className="fe-modal-code" style={{ flex: 1 }}>Add area</p>
              <button className="icon-btn" aria-label="Close" onClick={() => setAdding(null)}><i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" /></button>
            </div>
            <div className="fe-modal-body">
              <div className="field"><label>Area name</label>
                <input autoFocus value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder="e.g. Compressor Room P1" />
              </div>
              <div className="field"><label>Plant</label>
                <select value={adding.plant_id} onChange={(e) => setAdding({ ...adding, plant_id: e.target.value })}>
                  {plants.map((p) => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
                </select>
              </div>
              {msg && <div className="banner-warn">{msg}</div>}
            </div>
            <div className="fe-modal-foot">
              <button className="btn-secondary" onClick={() => setAdding(null)}>Cancel</button>
              <button className="btn-primary" onClick={createArea}>Create area</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
