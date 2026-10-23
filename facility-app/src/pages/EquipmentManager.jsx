import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

const CATEGORIES = ['Electrical', 'ACMV']
const CYCLES = ['Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'Bi-monthly', 'Quarterly', 'Semi-annual', 'Yearly']

function nextCode(list, field, prefix) {
  let max = 0
  for (const e of list) {
    const m = String(e[field] || '').match(/(\d+)$/)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

export default function EquipmentManager() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [equipment, setEquipment] = useState([])
  const [areas, setAreas] = useState([])
  const [plants, setPlants] = useState([])
  const [newArea, setNewArea] = useState(null) // { name, plant_id } when adding inline
  const [newCat, setNewCat] = useState('') // inline new category text (empty = not adding)
  const [extraCats, setExtraCats] = useState([]) // categories added this session
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('Active')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // equipment row or 'new'
  const [form, setForm] = useState({})
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const { data: eq } = await db
      .from('equipment')
      .select('*, area:areas(area_name), inspection_headers(count)')
      .order('equip_id')
    setEquipment(eq || [])
    const { data: ar } = await db.from('areas').select('id, area_id, area_name, plant_id').order('area_name')
    setAreas(ar || [])
    const { data: pl } = await db.from('plants').select('id, plant_name').order('plant_name')
    setPlants(pl || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    return equipment.filter((e) => {
      if (statusFilter !== 'All' && (e.status || 'Active') !== statusFilter) return false
      if (search) {
        const s = search.toLowerCase()
        return e.equipment_name?.toLowerCase().includes(s) || e.equip_id?.toLowerCase().includes(s) || e.asset_tag?.toLowerCase().includes(s)
      }
      return true
    })
  }, [equipment, search, statusFilter])

  const categoryOptions = useMemo(() => {
    const set = new Set(CATEGORIES)
    for (const e of equipment) if (e.category) set.add(e.category)
    for (const c of extraCats) set.add(c)
    return [...set].sort()
  }, [equipment, extraCats])

  function startAdd() {
    setForm({
      equipment_name: '', area_id: areas[0]?.id || '', category: 'Electrical', inspection_cycle: 'Daily',
      equip_id: nextCode(equipment, 'equip_id', 'EQ'),
      qr_code: nextCode(equipment, 'qr_code', 'QR-EQ'),
      asset_tag: nextCode(equipment, 'asset_tag', 'AT-EQ'),
    })
    setEditing('new')
    setMsg('')
  }

  async function createArea() {
    if (!newArea.name?.trim()) { setMsg('Area name is required.'); return }
    try {
      // generate next area_id like A021
      let max = 0
      for (const a of areas) {
        const m = String(a.area_id || a.id || '').match(/A(\d+)/)
        if (m) max = Math.max(max, parseInt(m[1], 10))
      }
      const area_id = `A${String(max + 1).padStart(3, '0')}`
      const { data, error } = await db
        .from('areas')
        .insert({ area_id, area_name: newArea.name.trim(), plant_id: newArea.plant_id, status: 'Active' })
        .select('id, area_name, plant_id')
        .single()
      if (error) throw error
      const updated = [...areas, data].sort((a, b) => a.area_name.localeCompare(b.area_name))
      setAreas(updated)
      setForm({ ...form, area_id: data.id })
      setNewArea(null)
      setMsg('')
    } catch (err) {
      setMsg(`Couldn't create area: ${err.message}`)
    }
  }

  function startEdit(e) {
    setForm({ ...e, area_id: e.area_id })
    setEditing(e)
    setMsg('')
  }

  async function save() {
    if (!form.equipment_name?.trim()) { setMsg('Equipment name is required.'); return }
    const payload = {
      equipment_name: form.equipment_name.trim(),
      area_id: form.area_id,
      category: form.category,
      inspection_cycle: form.inspection_cycle,
      qr_code: form.qr_code,
      asset_tag: form.asset_tag,
    }
    try {
      if (editing === 'new') {
        const { data, error } = await db
          .from('equipment')
          .insert({ ...payload, equip_id: form.equip_id, status: 'Active' })
          .select('id, equip_id')
          .single()
        if (error) throw error
        setEditing(null)
        await load()
        // Offer to jump straight into building its checklist
        if (window.confirm('Equipment added. Set up its inspection checklist now?')) {
          navigate(`/admin/checklist/${data.equip_id}`)
        }
        return
      } else {
        const { error } = await db.from('equipment').update(payload).eq('id', editing.id)
        if (error) throw error
      }
      setEditing(null)
      await load()
    } catch (err) {
      setMsg(`Couldn't save: ${err.message}`)
    }
  }

  async function retire(e) {
    if (!window.confirm(`Retire "${e.equipment_name}"? It will be hidden from active lists but its history is kept.`)) return
    await db.from('equipment').update({ status: 'Retired' }).eq('id', e.id)
    load()
  }

  async function reactivate(e) {
    await db.from('equipment').update({ status: 'Active' }).eq('id', e.id)
    load()
  }

  async function remove(e) {
    const count = e.inspection_headers?.[0]?.count || 0
    if (count > 0) {
      window.alert(`Can't permanently delete "${e.equipment_name}" — it has ${count} inspection record(s). Retire it instead to keep the history.`)
      return
    }
    if (!window.confirm(`Permanently delete "${e.equipment_name}"? This cannot be undone. (It has no inspection history.)`)) return
    // remove its checklist templates first, then the equipment
    await db.from('checklist_templates').delete().eq('equipment_id', e.id)
    const { error } = await db.from('equipment').delete().eq('id', e.id)
    if (error) { window.alert(`Couldn't delete: ${error.message}`); return }
    load()
  }

  if (!isAdmin) {
    return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>
  }

  if (editing) {
    const isNew = editing === 'new'
    return (
      <div className="screen">
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => setEditing(null)}>
          <i className="ti ti-arrow-left" aria-hidden="true" />Cancel
        </button>
        <p className="page-title">{isNew ? 'Add equipment' : 'Edit equipment'}</p>

        <div className="field"><label>Equipment name</label>
          <input value={form.equipment_name} onChange={(e) => setForm({ ...form, equipment_name: e.target.value })} placeholder="e.g. Chiller 3" />
        </div>
        <div className="field"><label>Area</label>
          <select
            value={form.area_id}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setNewArea({ name: '', plant_id: plants[0]?.id || '' })
              } else {
                setForm({ ...form, area_id: e.target.value })
              }
            }}
          >
            {areas.map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}
            <option value="__new__">+ Add new area…</option>
          </select>
        </div>

        {newArea && (
          <div className="card" style={{ borderColor: 'var(--blue)' }}>
            <p className="eq-t" style={{ marginBottom: 8 }}>New area</p>
            <div className="field"><label>Area name</label>
              <input value={newArea.name} onChange={(e) => setNewArea({ ...newArea, name: e.target.value })} placeholder="e.g. Compressor Room P1" />
            </div>
            <div className="field"><label>Plant</label>
              <select value={newArea.plant_id} onChange={(e) => setNewArea({ ...newArea, plant_id: e.target.value })}>
                {plants.map((p) => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
              </select>
            </div>
            <div className="btn-row">
              <button className="btn-secondary" onClick={() => setNewArea(null)}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={createArea}>Create area</button>
            </div>
          </div>
        )}
        <div className="field"><label>Category</label>
          <select
            value={newCat !== '' ? '__new__' : form.category}
            onChange={(e) => {
              if (e.target.value === '__new__') setNewCat(' ')
              else { setNewCat(''); setForm({ ...form, category: e.target.value }) }
            }}
          >
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="__new__">+ Add new category…</option>
          </select>
        </div>

        {newCat !== '' && (
          <div className="card" style={{ borderColor: 'var(--blue)' }}>
            <div className="field"><label>New category name</label>
              <input autoFocus value={newCat.trim()} onChange={(e) => setNewCat(e.target.value || ' ')} placeholder="e.g. Mechanical" />
            </div>
            <div className="btn-row">
              <button className="btn-secondary" onClick={() => setNewCat('')}>Cancel</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={() => {
                const c = newCat.trim()
                if (!c) { setMsg('Category name is required.'); return }
                if (!extraCats.includes(c) && !CATEGORIES.includes(c)) setExtraCats([...extraCats, c])
                setForm({ ...form, category: c })
                setNewCat('')
                setMsg('')
              }}>Use category</button>
            </div>
          </div>
        )}
        <div className="field"><label>Inspection cycle</label>
          <select value={form.inspection_cycle} onChange={(e) => setForm({ ...form, inspection_cycle: e.target.value })}>
            {CYCLES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="card" style={{ marginTop: 4 }}>
          <p className="eq-s" style={{ marginBottom: 6 }}>Auto-generated codes {isNew ? '(next in sequence)' : ''}</p>
          <div className="field"><label>Equipment ID</label><input value={form.equip_id} readOnly={!isNew} onChange={(e) => setForm({ ...form, equip_id: e.target.value })} /></div>
          <div className="field"><label>QR code</label><input value={form.qr_code} onChange={(e) => setForm({ ...form, qr_code: e.target.value })} /></div>
          <div className="field"><label>Asset tag</label><input value={form.asset_tag} onChange={(e) => setForm({ ...form, asset_tag: e.target.value })} /></div>
        </div>

        {msg && <p className="error-text">{msg}</p>}
        <button className="btn-primary" onClick={save} style={{ marginTop: 8 }}>
          <i className="ti ti-device-floppy" aria-hidden="true" />{isNew ? 'Add equipment' : 'Save changes'}
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/admin')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p className="page-title">Equipment manager</p>
          <p className="page-sub" style={{ margin: 0 }}>{filtered.length} shown · {equipment.filter((e) => (e.status || 'Active') === 'Active').length} active total</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ width: 'auto', padding: '9px 14px' }} onClick={() => navigate('/admin/areas')}>
            <i className="ti ti-map-2" aria-hidden="true" />Manage areas
          </button>
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={startAdd}>
            <i className="ti ti-plus" aria-hidden="true" />Add equipment
          </button>
        </div>
      </div>

      <input placeholder="Search name, ID, or tag" value={search} onChange={(e) => setSearch(e.target.value)} style={{ margin: '12px 0 8px', maxWidth: 420 }} />
      <div className="chip-row">
        {['Active', 'Retired', 'All'].map((s) => (
          <button key={s} className={statusFilter === s ? 'chip active' : 'chip'} onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
      </div>

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : (
        <div className="card-grid">
          {filtered.map((e) => {
            const count = e.inspection_headers?.[0]?.count || 0
            const retired = (e.status || 'Active') === 'Retired'
            return (
              <div className={'list-card' + (retired ? ' warn-border' : '')} key={e.id} style={{ cursor: 'default' }}>
                <div className="list-card-head">
                  <div className="eq-ic" style={{ width: 28, height: 28, borderRadius: 7 }}>
                    <i className={'ti ' + (e.category === 'ACMV' ? 'ti-air-conditioning' : 'ti-bolt')} style={{ fontSize: 15 }} aria-hidden="true" />
                  </div>
                  <p className="list-card-title">{e.equipment_name}</p>
                  {retired && <span className="pill pill-warn">Retired</span>}
                </div>
                <p className="list-card-meta">{e.equip_id} · {e.area?.area_name}</p>
                <p className="list-card-meta" style={{ marginTop: 2 }}>{e.category} · <b>{count}</b> inspection(s)</p>

                <div className="list-card-actions">
                  <button className="btn-secondary" onClick={() => navigate(`/admin/checklist/${e.equip_id}`)}><i className="ti ti-list-check" aria-hidden="true" />Checklist</button>
                  <button className="btn-secondary" onClick={() => startEdit(e)}><i className="ti ti-edit" aria-hidden="true" />Edit</button>
                </div>
                <div className="list-card-actions">
                  {retired ? (
                    <button className="btn-secondary" onClick={() => reactivate(e)}><i className="ti ti-refresh" aria-hidden="true" />Reactivate</button>
                  ) : (
                    <button className="btn-secondary" onClick={() => retire(e)}><i className="ti ti-archive" aria-hidden="true" />Retire</button>
                  )}
                  <button className="btn-secondary" style={{ color: count > 0 ? 'var(--text-muted)' : 'var(--danger)' }} onClick={() => remove(e)}>
                    <i className="ti ti-trash" aria-hidden="true" />Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
