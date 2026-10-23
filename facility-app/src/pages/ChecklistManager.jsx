import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

const emptyParam = { parameter_name: '', type: 'numeric', unit: '', min_value: '', max_value: '', options: '', pass_value: '', fail_value: '', required: true }

export default function ChecklistManager() {
  const { equipId } = useParams()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [equipment, setEquipment] = useState(null)
  const [params, setParams] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState(null) // editing param or new
  const [msg, setMsg] = useState('')

  async function load() {
    setLoading(true)
    const { data: eq } = await db.from('equipment').select('id, equip_id, equipment_name').eq('equip_id', equipId).single()
    setEquipment(eq || null)
    if (eq) {
      const { data: tpl } = await db.from('checklist_templates').select('*').eq('equipment_id', eq.id).order('sort_order')
      setParams(tpl || [])
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [equipId])

  function startAdd() {
    setForm({ ...emptyParam, sort_order: (params.length + 1) })
    setMsg('')
  }
  function startEdit(p) {
    setForm({ ...p, min_value: p.min_value ?? '', max_value: p.max_value ?? '', options: p.options ?? '', pass_value: p.pass_value ?? '', fail_value: p.fail_value ?? '', unit: p.unit ?? '' })
    setMsg('')
  }

  async function save() {
    if (!form.parameter_name?.trim()) { setMsg('Parameter name is required.'); return }
    const payload = {
      equipment_id: equipment.id,
      parameter_name: form.parameter_name.trim(),
      type: form.type,
      unit: form.unit || null,
      min_value: form.type === 'numeric' && form.min_value !== '' ? Number(form.min_value) : null,
      max_value: form.type === 'numeric' && form.max_value !== '' ? Number(form.max_value) : null,
      options: form.type === 'multichoice' ? form.options : null,
      pass_value: form.type === 'multichoice' ? form.pass_value : null,
      fail_value: form.type === 'multichoice' ? form.fail_value : null,
      sort_order: Number(form.sort_order) || params.length + 1,
      required: form.required !== false,
    }
    try {
      if (form.id) {
        const { error } = await db.from('checklist_templates').update(payload).eq('id', form.id)
        if (error) throw error
      } else {
        const template_id = `TPL-${equipment.equip_id}-${Date.now()}`
        const { error } = await db.from('checklist_templates').insert({ ...payload, template_id })
        if (error) throw error
      }
      setForm(null)
      await load()
    } catch (err) {
      setMsg(`Couldn't save: ${err.message}`)
    }
  }

  async function remove(p) {
    if (!window.confirm(`Remove parameter "${p.parameter_name}"?`)) return
    await db.from('checklist_templates').delete().eq('id', p.id)
    load()
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>
  if (loading) return <div className="screen"><p className="center-msg">Loading…</p></div>
  if (!equipment) return <div className="screen"><p className="center-msg">Equipment "{equipId}" not found.</p></div>

  if (form) {
    const isChoice = form.type === 'multichoice'
    return (
      <div className="screen">
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => setForm(null)}>
          <i className="ti ti-arrow-left" aria-hidden="true" />Cancel
        </button>
        <p className="page-title">{form.id ? 'Edit parameter' : 'Add parameter'}</p>
        <p className="page-sub">{equipment.equipment_name}</p>

        <div className="field"><label>Parameter name</label>
          <input value={form.parameter_name} onChange={(e) => setForm({ ...form, parameter_name: e.target.value })} placeholder="e.g. Voltage L1" />
        </div>
        <div className="field"><label>Type</label>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="numeric">Numeric (with range)</option>
            <option value="multichoice">Choice (e.g. GOOD/NG)</option>
          </select>
        </div>

        {!isChoice ? (
          <>
            <div className="field"><label>Unit (optional)</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="kV, bar, °C" /></div>
            <div className="btn-row">
              <div className="field" style={{ flex: 1 }}><label>Min value</label><input type="number" step="any" value={form.min_value} onChange={(e) => setForm({ ...form, min_value: e.target.value })} /></div>
              <div className="field" style={{ flex: 1 }}><label>Max value</label><input type="number" step="any" value={form.max_value} onChange={(e) => setForm({ ...form, max_value: e.target.value })} /></div>
            </div>
          </>
        ) : (
          <>
            <div className="field"><label>Options (comma separated)</label><input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="GOOD,NG" /></div>
            <div className="btn-row">
              <div className="field" style={{ flex: 1 }}><label>Pass value</label><input value={form.pass_value} onChange={(e) => setForm({ ...form, pass_value: e.target.value })} placeholder="GOOD" /></div>
              <div className="field" style={{ flex: 1 }}><label>Fail value</label><input value={form.fail_value} onChange={(e) => setForm({ ...form, fail_value: e.target.value })} placeholder="NG" /></div>
            </div>
          </>
        )}

        <div className="field"><label>Sort order</label><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={form.required !== false} onChange={(e) => setForm({ ...form, required: e.target.checked })} />
          Required field
        </label>

        {msg && <p className="error-text">{msg}</p>}
        <button className="btn-primary" onClick={save}><i className="ti ti-device-floppy" aria-hidden="true" />Save parameter</button>
      </div>
    )
  }

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/admin/equipment')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="page-title">Checklist</p>
        <button className="btn-primary" style={{ width: 'auto', padding: '8px 14px' }} onClick={startAdd}><i className="ti ti-plus" aria-hidden="true" />Add</button>
      </div>
      <p className="page-sub">{equipment.equipment_name} · {params.length} parameter(s)</p>

      {params.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No parameters yet. Add the first one.</div>}
      {params.map((p) => (
        <div className="card" key={p.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p className="eq-t">{p.sort_order}. {p.parameter_name} {p.required === false && <span className="pill pill-blue">optional</span>}</p>
              <p className="eq-s">
                {p.type === 'numeric'
                  ? `Numeric${p.min_value != null ? ` · range ${p.min_value}–${p.max_value}` : ''}${p.unit ? ` ${p.unit}` : ''}`
                  : `Choice · ${p.options} (pass: ${p.pass_value || '—'}, fail: ${p.fail_value || '—'})`}
              </p>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => startEdit(p)}><i className="ti ti-edit" aria-hidden="true" />Edit</button>
            <button className="btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => remove(p)}><i className="ti ti-trash" aria-hidden="true" />Remove</button>
          </div>
        </div>
      ))}
    </div>
  )
}
