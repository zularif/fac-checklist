import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { expiryState, daysToExpiry } from '../../lib/feHelpers'

export default function FEExpiryBulk() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [floors, setFloors] = useState([])
  const [building, setBuilding] = useState('')
  const [floorId, setFloorId] = useState('')
  const [units, setUnits] = useState([])
  const [drafts, setDrafts] = useState({}) // id -> date string (unsaved edits)
  const [savedIds, setSavedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const inputs = useRef([])

  useEffect(() => {
    db.from('fe_floors').select('id, building, floor_name').order('building').order('sort_order').then(({ data }) => {
      setFloors(data || [])
      if (data?.length) { setBuilding(data[0].building); setFloorId(data[0].id) }
    })
  }, [])

  const buildings = useMemo(() => [...new Set(floors.map((f) => f.building))], [floors])
  const floorsOfBuilding = useMemo(() => floors.filter((f) => f.building === building), [floors, building])

  async function loadUnits() {
    if (!floorId) return
    setLoading(true)
    setDrafts({})
    setSavedIds(new Set())
    setMsg('')
    const { data } = await db
      .from('fire_extinguishers')
      .select('id, fe_code, fe_type, location_desc, expiry_date')
      .eq('floor_id', floorId).eq('status', 'Active').order('fe_code')
    setUnits(data || [])
    setLoading(false)
  }
  useEffect(() => { loadUnits() }, [floorId])

  const visible = useMemo(
    () => (onlyMissing ? units.filter((u) => !u.expiry_date && !drafts[u.id]) : units),
    [units, onlyMissing, drafts]
  )

  const dirtyCount = Object.keys(drafts).length
  const missingCount = units.filter((u) => !u.expiry_date).length

  function setDraft(id, value) {
    setDrafts((prev) => {
      const next = { ...prev }
      const unit = units.find((u) => u.id === id)
      if (value === (unit?.expiry_date || '')) delete next[id]
      else next[id] = value
      return next
    })
  }

  function onKeyDown(e, idx) {
    if (e.key === 'Enter' && inputs.current[idx + 1]) {
      e.preventDefault()
      inputs.current[idx + 1].focus()
    }
  }

  async function saveAll() {
    const entries = Object.entries(drafts)
    if (!entries.length) return
    setSaving(true)
    setMsg('')
    let ok = 0
    const savedNow = new Set(savedIds)
    for (const [id, value] of entries) {
      const { error } = await db
        .from('fire_extinguishers')
        .update({ expiry_date: value || null })
        .eq('id', id)
      if (!error) {
        ok++
        savedNow.add(id)
        setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, expiry_date: value || null } : u)))
      }
    }
    setSavedIds(savedNow)
    setDrafts({})
    setSaving(false)
    setMsg(`Saved ${ok} date(s).`)
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/fe/list')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back to list
      </button>
      <p className="page-title">Bulk expiry entry</p>
      <p className="page-sub">Pick a floor, then type each extinguisher's expiry date. Press Enter to jump to the next.</p>

      <div className="btn-row">
        <div className="field" style={{ flex: 1 }}><label>Building</label>
          <select value={building} onChange={(e) => { setBuilding(e.target.value); setFloorId(floors.find((f) => f.building === e.target.value)?.id || '') }}>
            {buildings.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}><label>Floor</label>
          <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            {floorsOfBuilding.map((f) => <option key={f.id} value={f.id}>{f.floor_name}</option>)}
          </select>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 10 }}>
        <input type="checkbox" style={{ width: 'auto' }} checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
        Show only those without a date ({missingCount} on this floor)
      </label>

      {msg && <div className="banner-ok">{msg}</div>}

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          {onlyMissing ? 'Every extinguisher on this floor has a date. 🎉' : 'No extinguishers on this floor.'}
        </div>
      ) : (
        <div className="bulk-table">
          {visible.map((u, idx) => {
            const draft = drafts[u.id]
            const value = draft !== undefined ? draft : (u.expiry_date || '')
            const st = expiryState(value)
            const days = daysToExpiry(value)
            const isDirty = draft !== undefined
            const justSaved = savedIds.has(u.id) && !isDirty
            return (
              <div className={'bulk-row' + (isDirty ? ' dirty' : '')} key={u.id}>
                <div className="bulk-info">
                  <p className="bulk-code">{u.fe_code}</p>
                  <p className="bulk-loc">{u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</p>
                </div>
                <div className="bulk-input">
                  <input
                    type="date"
                    ref={(el) => (inputs.current[idx] = el)}
                    value={value}
                    onChange={(e) => setDraft(u.id, e.target.value)}
                    onKeyDown={(e) => onKeyDown(e, idx)}
                  />
                  <span className="bulk-status">
                    {justSaved && <span className="tag-inline"><i className="ti ti-check" style={{ fontSize: 10 }} aria-hidden="true" /> Saved</span>}
                    {isDirty && <span className="pill pill-blue">Unsaved</span>}
                    {!isDirty && !justSaved && st === 'expired' && <span className="pill pill-danger">Expired</span>}
                    {!isDirty && !justSaved && st === 'expiring' && <span className="pill pill-warn">{days}d</span>}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* sticky save bar */}
      {dirtyCount > 0 && (
        <div className="bulk-savebar">
          <span>{dirtyCount} unsaved</span>
          <button className="btn-primary" style={{ width: 'auto', margin: 0 }} onClick={saveAll} disabled={saving}>
            {saving ? 'Saving…' : `Save ${dirtyCount}`}
          </button>
        </div>
      )}
    </div>
  )
}
