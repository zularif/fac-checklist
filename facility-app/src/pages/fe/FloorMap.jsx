import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { startOfMonth, endOfMonth, publicFloorplanUrl, expiryState, daysToExpiry } from '../../lib/feHelpers'
import { useIsAdmin } from '../../lib/useIsAdmin'

const FE_TYPES = ['CO2', 'ABC', 'Water']
const emptyNew = { fe_code: '', fe_type: 'CO2', serial_no: '', location_desc: '', expiry_date: '' }

export default function FloorMap() {
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const imgRef = useRef(null)

  const [floors, setFloors] = useState([])
  const [building, setBuilding] = useState('')
  const [floorId, setFloorId] = useState('')
  const [units, setUnits] = useState([])
  const [inspectedIds, setInspectedIds] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  // edit mode
  const [editMode, setEditMode] = useState(false)
  const [pendingPoint, setPendingPoint] = useState(null)
  const [noFloor, setNoFloor] = useState([])           // active extinguishers with no floor (import didn't match)
  const [quickPlace, setQuickPlace] = useState(false) // click-to-place the list in order
  const [quickSkip, setQuickSkip] = useState([])       // ids skipped during quick place
  const [newUnit, setNewUnit] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [selectedEdit, setSelectedEdit] = useState(null) // pin selected in edit mode
  const [editForm, setEditForm] = useState(null) // details edit form state
  const dragMeta = useRef({ id: null, startX: 0, startY: 0, moved: false })

  // details popup
  const [selected, setSelected] = useState(null)
  const [lastInsp, setLastInsp] = useState(null)
  const [loadingInsp, setLoadingInsp] = useState(false)

  // "view all details" list modal
  const [detailsList, setDetailsList] = useState(null) // { scope, rows } or null
  const [detailsScope, setDetailsScope] = useState('floor')
  const [detailsLoading, setDetailsLoading] = useState(false)

  // view
  const [fullscreen, setFullscreen] = useState(false)
  const [showLabels, setShowLabels] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const gesture = useRef({ dragging: false, startX: 0, startY: 0, originX: 0, originY: 0, pinchDist: 0, startZoom: 1, moved: false })

  useEffect(() => {
    async function load() {
      const { data } = await db.from('fe_floors').select('*').order('building').order('sort_order')
      setFloors(data || [])
      if (data?.length) { setBuilding(data[0].building); setFloorId(data[0].id) }
      setLoading(false)
    }
    load()
  }, [])

  const buildings = useMemo(() => [...new Set(floors.map((f) => f.building))], [floors])
  const floorsOfBuilding = useMemo(() => floors.filter((f) => f.building === building), [floors, building])
  const floor = floors.find((f) => f.id === floorId)

  function pct(u) {
    const rw = floor?.ref_width, rh = floor?.ref_height
    if (rw && rh) return { left: (u.map_x / rw) * 100, top: (u.map_y / rh) * 100 }
    return { left: u.map_x, top: u.map_y }
  }

  // Keep a pin fully on the image with a small margin so the icon isn't
  // half-cut by the border. Works in both pixel and percentage coordinate modes.
  function clampCoords(x, y) {
    const rw = floor?.ref_width, rh = floor?.ref_height
    if (rw && rh) {
      const mx = rw * 0.02, my = rh * 0.02
      return {
        x: Math.min(rw - mx, Math.max(mx, x)),
        y: Math.min(rh - my, Math.max(my, y)),
      }
    }
    return { x: Math.min(98, Math.max(2, x)), y: Math.min(98, Math.max(2, y)) }
  }

  function pointToFloorCoords(clientX, clientY) {
    const rect = imgRef.current.getBoundingClientRect()
    const fx = (clientX - rect.left) / rect.width
    const fy = (clientY - rect.top) / rect.height
    const rw = floor?.ref_width, rh = floor?.ref_height
    const rawX = rw && rh ? fx * rw : fx * 100
    const rawY = rw && rh ? fy * rh : fy * 100
    const { x, y } = clampCoords(rawX, rawY)
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  }

  async function loadUnits() {
    if (!floorId) return
    setLoading(true)
    const { data: fes } = await db
      .from('fire_extinguishers')
      .select('id, fe_code, fe_type, serial_no, location_desc, map_x, map_y, expiry_date')
      .eq('floor_id', floorId).eq('status', 'Active').order('fe_code')

    // Rescue any pins that were previously dragged off the image: snap them
    // back to the nearest edge and persist the corrected position.
    const rescued = []
    const rw = floor?.ref_width, rh = floor?.ref_height
    const upperX = rw && rh ? rw : 100
    const upperY = rw && rh ? rh : 100
    for (const f of fes || []) {
      if (f.map_x == null || f.map_y == null) continue
      const offX = f.map_x < 0 || f.map_x > upperX
      const offY = f.map_y < 0 || f.map_y > upperY
      if (offX || offY) {
        const c = clampCoords(f.map_x, f.map_y)
        f.map_x = Math.round(c.x * 10) / 10
        f.map_y = Math.round(c.y * 10) / 10
        rescued.push({ id: f.id, map_x: f.map_x, map_y: f.map_y })
      }
    }
    setUnits(fes || [])
    const { data: lost } = await db.from('fire_extinguishers')
      .select('id, fe_code, fe_type, location_desc').is('floor_id', null).eq('status', 'Active').order('fe_code')
    setNoFloor(lost || [])
    for (const r of rescued) {
      db.from('fire_extinguishers').update({ map_x: r.map_x, map_y: r.map_y }).eq('id', r.id).then(() => {})
    }

    const ids = (fes || []).map((f) => f.id)
    if (ids.length) {
      const { data: insp } = await db.from('fe_inspections').select('fe_id')
        .in('fe_id', ids).gte('inspection_date', startOfMonth()).lt('inspection_date', endOfMonth())
      setInspectedIds(new Set((insp || []).map((i) => i.fe_id)))
    } else setInspectedIds(new Set())
    setLoading(false)
  }
  useEffect(() => { loadUnits() }, [floorId])

  function pinState(u) {
    const es = expiryState(u.expiry_date)
    if (es === 'expired') return 'expired'
    if (es === 'expiring') return 'expiring'
    return inspectedIds.has(u.id) ? 'ok' : 'pending'
  }

  const placed = units.filter((u) => u.map_x != null && u.map_y != null)
  const unplaced = units.filter((u) => u.map_x == null || u.map_y == null)
  const doneCount = units.filter((u) => inspectedIds.has(u.id)).length
  const expiringCount = units.filter((u) => expiryState(u.expiry_date) === 'expiring').length
  const expiredCount = units.filter((u) => expiryState(u.expiry_date) === 'expired').length

  // ---------- view gestures ----------
  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }) }
  function onPointerDown(e) {
    if (draggingId) return
    gesture.current = { ...gesture.current, dragging: true, startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y, moved: false }
  }
  function onPointerMove(e) {
    if (draggingId) { dragPinMove(e); return }
    if (!gesture.current.dragging) return
    const dx = e.clientX - gesture.current.startX
    const dy = e.clientY - gesture.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) gesture.current.moved = true
    setPan({ x: gesture.current.originX + dx, y: gesture.current.originY + dy })
  }
  function onPointerUp() {
    if (draggingId) { dragPinEnd(); return }
    gesture.current.dragging = false
  }
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      const [a, b] = e.touches
      gesture.current.pinchDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      gesture.current.startZoom = zoom
    }
  }
  function onTouchMove(e) {
    if (e.touches.length === 2 && gesture.current.pinchDist) {
      const [a, b] = e.touches
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      setZoom(Math.min(6, Math.max(1, gesture.current.startZoom * (d / gesture.current.pinchDist))))
    }
  }
  function onWheel(e) {
    if (!fullscreen) return
    e.preventDefault()
    setZoom((z) => Math.min(6, Math.max(1, z - e.deltaY * 0.002)))
  }

  // ---------- pin dragging + selection ----------
  // A press that moves past a small threshold is a drag; a press that barely
  // moves is a tap, which selects the pin (so its details show) instead.
  const DRAG_THRESHOLD = 5

  function dragPinStart(e, u) {
    if (!editMode) return
    e.stopPropagation()
    dragMeta.current = { id: u.id, startX: e.clientX, startY: e.clientY, moved: false }
    setDraggingId(u.id)
  }
  function dragPinMove(e) {
    const meta = dragMeta.current
    if (!meta.id) return
    if (!meta.moved) {
      const dx = e.clientX - meta.startX
      const dy = e.clientY - meta.startY
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
      meta.moved = true
    }
    const { x, y } = pointToFloorCoords(e.clientX, e.clientY)
    setUnits((prev) => prev.map((u) => (u.id === meta.id ? { ...u, map_x: x, map_y: y } : u)))
  }
  async function dragPinEnd() {
    const meta = dragMeta.current
    const id = meta.id
    dragMeta.current = { id: null, startX: 0, startY: 0, moved: false }
    setDraggingId(null)
    if (!id) return

    const u = units.find((x) => x.id === id)
    if (!u) return

    if (!meta.moved) {
      // treat as a tap → select this pin and show its details
      selectForEdit(u)
      return
    }
    // it was a real move → persist the new position
    const { error } = await db.from('fire_extinguishers')
      .update({ map_x: u.map_x, map_y: u.map_y }).eq('id', id)
    if (error) { setMsg(`Couldn't move pin: ${error.message}`); loadUnits() }
  }

  function selectForEdit(u) {
    setSelectedEdit(u)
    setEditForm(null)
  }

  function startEditDetails() {
    setEditForm({
      fe_code: selectedEdit.fe_code,
      fe_type: selectedEdit.fe_type,
      serial_no: selectedEdit.serial_no || '',
      location_desc: selectedEdit.location_desc || '',
      expiry_date: selectedEdit.expiry_date || '',
    })
  }

  async function saveEditDetails() {
    const code = editForm.fe_code.trim()
    if (!code) { setMsg('Code is required.'); return }
    const { error } = await db.from('fire_extinguishers').update({
      fe_code: code,
      fe_type: editForm.fe_type,
      serial_no: editForm.serial_no.trim() || null,
      location_desc: editForm.location_desc.trim() || null,
      expiry_date: editForm.expiry_date || null,
    }).eq('id', selectedEdit.id)
    if (error) { setMsg(`Couldn't save: ${error.message}`); return }
    setMsg('')
    setEditForm(null)
    setSelectedEdit(null)
    loadUnits()
  }

  // ---------- adding / assigning ----------
  function handleMapClick(e) {
    if (!editMode || gesture.current.moved || draggingId) return
    const point = pointToFloorCoords(e.clientX, e.clientY)
    if (quickPlace) { quickPlaceAt(point); return }
    setPendingPoint(point)
    setNewUnit(null)
  }

  // Extinguishers whose building/floor didn't match during import have no floor,
  // so they appear on no map. Move them onto the floor being viewed.
  async function moveToThisFloor(list) {
    if (!list.length) return
    if (list.length > 1 && !window.confirm(`Move ${list.length} extinguishers to ${floor?.building} ${floor?.floor_name}? You can then place them on the plan.`)) return
    const ids = list.map((u) => u.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from('fire_extinguishers').update({ floor_id: floorId }).in('id', ids.slice(i, i + 200))
      if (error) { setMsg(`Couldn't move: ${error.message}`); break }
    }
    loadUnits()
  }

  // ---------- place the whole list ----------
  const quickNext = unplaced.find((u) => !quickSkip.includes(u.id)) || null

  async function quickPlaceAt(point) {
    const u = quickNext
    if (!u) { setQuickPlace(false); return }
    // show it immediately, then save
    setUnits((prev) => prev.map((x) => (x.id === u.id ? { ...x, map_x: point.x, map_y: point.y } : x)))
    const { error } = await db.from('fire_extinguishers').update({ map_x: point.x, map_y: point.y }).eq('id', u.id)
    if (error) { setMsg(`Couldn't place ${u.fe_code}: ${error.message}`); loadUnits() }
  }

  // Put every unplaced extinguisher in a neat grid at the top-left of the plan,
  // so they are all visible and can be dragged to their real spots.
  async function placeAllInGrid() {
    if (!unplaced.length) return
    if (!window.confirm(`Put all ${unplaced.length} extinguishers on this plan in a row at the top? You can then drag each one to its real spot.`)) return
    const rw = floor?.ref_width, rh = floor?.ref_height
    const W = rw && rh ? rw : 100, H = rw && rh ? rh : 100
    const perRow = 12
    const stepX = W * 0.06, stepY = H * 0.07
    const updates = unplaced.map((u, i) => {
      const { x, y } = clampCoords(W * 0.05 + (i % perRow) * stepX, H * 0.06 + Math.floor(i / perRow) * stepY)
      return { id: u.id, map_x: Math.round(x * 10) / 10, map_y: Math.round(y * 10) / 10 }
    })
    setUnits((prev) => prev.map((x) => { const p = updates.find((v) => v.id === x.id); return p ? { ...x, ...p } : x }))
    let failed = 0
    for (let i = 0; i < updates.length; i += 10) {
      const results = await Promise.all(updates.slice(i, i + 10).map((v) => db.from('fire_extinguishers').update({ map_x: v.map_x, map_y: v.map_y }).eq('id', v.id)))
      failed += results.filter((r) => r.error).length
    }
    setMsg(failed ? `${failed} could not be placed — try again.` : '')
    loadUnits()
  }

  async function assignExisting(feId) {
    const { error } = await db.from('fire_extinguishers')
      .update({ map_x: pendingPoint.x, map_y: pendingPoint.y }).eq('id', feId)
    if (error) { setMsg(`Couldn't save: ${error.message}`); return }
    setPendingPoint(null); setMsg(''); loadUnits()
  }

  async function createNew() {
    const code = newUnit.fe_code.trim()
    if (!code) { setMsg('Extinguisher code is required.'); return }
    const { error } = await db.from('fire_extinguishers').insert({
      fe_code: code,
      fe_type: newUnit.fe_type,
      serial_no: newUnit.serial_no.trim() || null,
      location_desc: newUnit.location_desc.trim() || null,
      expiry_date: newUnit.expiry_date || null,
      floor_id: floorId,
      map_x: pendingPoint.x,
      map_y: pendingPoint.y,
      qr_code: `QR-${code}`,
      status: 'Active',
    })
    if (error) { setMsg(`Couldn't add: ${error.message}`); return }
    setNewUnit(null); setPendingPoint(null); setMsg(''); loadUnits()
  }

  async function removePin(u) {
    if (!window.confirm(`Remove ${u.fe_code} from the map? The extinguisher stays in the list.`)) return
    await db.from('fire_extinguishers').update({ map_x: null, map_y: null }).eq('id', u.id)
    setSelectedEdit(null)
    setEditForm(null)
    loadUnits()
  }

  async function openDetailsList(scope) {
    setDetailsScope(scope)
    setDetailsLoading(true)
    setDetailsList({ scope, rows: [] })

    // resolve which floors are in scope
    const scopeFloors = scope === 'plant'
      ? floors.filter((f) => f.building === building)
      : floors.filter((f) => f.id === floorId)
    const idToName = Object.fromEntries(scopeFloors.map((f) => [f.id, `${f.building} · ${f.floor_name}`]))
    const ids = scopeFloors.map((f) => f.id)

    const { data } = await db
      .from('fire_extinguishers')
      .select('fe_code, fe_type, serial_no, location_desc, expiry_date, floor_id')
      .in('floor_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000'])
      .eq('status', 'Active')
      .order('fe_code')

    const rows = (data || []).map((u) => ({ ...u, floorName: idToName[u.floor_id] || '' }))
    setDetailsList({ scope, rows })
    setDetailsLoading(false)
  }

  function exportDetailsCSV() {
    if (!detailsList?.rows?.length) return
    const head = ['Code', 'Type', 'Serial no.', 'Location', 'Floor', 'Expiry date']
    const lines = [head]
    for (const r of detailsList.rows) {
      lines.push([r.fe_code, r.fe_type, r.serial_no || '', r.location_desc || '', r.floorName, r.expiry_date || ''])
    }
    const csv = lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const label = detailsScope === 'plant' ? building : (floor ? `${floor.building}-${floor.floor_name}` : 'floor')
    a.download = `FE-details-${label}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function openDetails(u) {
    setSelected(u)
    setLastInsp(null)
    setLoadingInsp(true)
    const { data } = await db
      .from('fe_inspections')
      .select('id, inspection_date, remarks, technician:technicians(name)')
      .eq('fe_id', u.id)
      .order('inspection_date', { ascending: false })
      .limit(1)
    const insp = data?.[0] || null
    if (insp) {
      const { data: details } = await db
        .from('fe_inspection_details')
        .select('parameter_name, value, computed_status')
        .eq('inspection_id', insp.id)
      insp.defects = (details || []).filter((d) => d.computed_status !== 'Normal')
    }
    setLastInsp(insp)
    setLoadingInsp(false)
  }

  if (loading && !floors.length) return <div className="screen"><p className="center-msg">Loading…</p></div>

  if (!floors.length) {
    return (
      <div className="screen">
        <p className="page-title">Floor map</p>
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          No floor plans yet.{isAdmin && ' Add one from FE admin.'}
        </div>
        {isAdmin && <button className="btn-primary" onClick={() => navigate('/fe/admin')}>Go to FE admin</button>}
      </div>
    )
  }

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <p className="page-title">Fire extinguishers</p>
          <p className="page-sub">
            {doneCount}/{units.length} inspected this month
            {expiringCount > 0 && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{expiringCount} expiring</span>}
            {expiredCount > 0 && <span className="pill pill-danger" style={{ marginLeft: 6 }}>{expiredCount} expired</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span><span className="fe-dot fe-dot-ok" /> Inspected</span>
          <span><span className="fe-dot fe-dot-pending" /> Pending</span>
          <span><span className="fe-dot fe-dot-expiring" /> Expiring</span>
          <span><span className="fe-dot fe-dot-expired" /> Expired</span>
        </div>
      </div>

      <p className="field-label" style={{ marginTop: 8 }}>Building</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {buildings.map((b) => (
          <button key={b} className={building === b ? 'seg active' : 'seg'}
            onClick={() => { setBuilding(b); setFloorId(floors.find((f) => f.building === b)?.id || '') }}>{b}</button>
        ))}
      </div>

      <p className="field-label">Floor</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {floorsOfBuilding.map((f) => (
          <button key={f.id} className={floorId === f.id ? 'seg active' : 'seg'} onClick={() => setFloorId(f.id)}>{f.floor_name}</button>
        ))}
      </div>

      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn-secondary" onClick={() => openDetailsList('floor')}>
          <i className="ti ti-list-details" aria-hidden="true" />View all details
        </button>
      </div>

      {isAdmin && (
        <div className="btn-row" style={{ marginBottom: 10 }}>
          <button className={editMode ? 'btn-primary' : 'btn-secondary'}
            onClick={() => { setEditMode(!editMode); setPendingPoint(null); setNewUnit(null); setSelectedEdit(null); setEditForm(null); setQuickPlace(false); setQuickSkip([]) }}>
            <i className={editMode ? 'ti ti-check' : 'ti ti-edit'} aria-hidden="true" />
            {editMode ? 'Done editing' : 'Edit mode'}
          </button>
          <button className="btn-secondary" onClick={() => navigate('/fe/admin')}>
            <i className="ti ti-settings" aria-hidden="true" />FE admin
          </button>
        </div>
      )}

      {editMode && !pendingPoint && !quickPlace && (
        <div className="banner-warn">Tap a pin to see its details. Press and drag a pin to move it. Tap an empty spot to add an extinguisher.</div>
      )}
      {isAdmin && !quickPlace && noFloor.length > 0 && (
        <div className="banner-warn" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ flex: '1 1 100%' }}>
            <strong>{noFloor.length} extinguisher(s) from your list have no floor</strong>, so they don't show on any map.
            Their building/floor in the import didn't match a floor in FE admin.
          </span>
          <button className="btn-primary" style={{ width: 'auto' }} onClick={() => moveToThisFloor(noFloor)}>
            Move all {noFloor.length} to {floor?.building} {floor?.floor_name}
          </button>
          <details style={{ flex: '1 1 100%' }}>
            <summary>Choose which ones</summary>
            {noFloor.map((u) => (
              <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span>{u.fe_code} · {u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</span>
                <button className="btn-secondary" style={{ width: 'auto' }} onClick={() => moveToThisFloor([u])}>Move here</button>
              </div>
            ))}
          </details>
        </div>
      )}
      {editMode && !pendingPoint && !quickPlace && unplaced.length > 0 && (
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <strong style={{ flex: '1 1 100%' }}>{unplaced.length} extinguisher(s) on this floor are not on the map yet</strong>
          <button className="btn-primary" style={{ width: 'auto' }} onClick={() => { setQuickSkip([]); setQuickPlace(true) }}>
            <i className="ti ti-hand-click" aria-hidden="true" />Place them one by one
          </button>
          <button className="btn-secondary" style={{ width: 'auto' }} onClick={placeAllInGrid}>
            <i className="ti ti-layout-grid" aria-hidden="true" />Put all on the plan, then drag
          </button>
        </div>
      )}
      {editMode && quickPlace && (
        <div className="banner-ok" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          {quickNext ? (
            <>
              <span style={{ flex: '1 1 auto' }}>
                Click on the plan where <strong>{quickNext.fe_code}</strong> is
                {quickNext.location_desc ? ` (${quickNext.location_desc})` : ''} — {unplaced.length} left
              </span>
              <button className="btn-secondary" style={{ width: 'auto' }} onClick={() => setQuickSkip((s) => [...s, quickNext.id])}>Skip</button>
              <button className="btn-secondary" style={{ width: 'auto' }} onClick={() => setQuickPlace(false)}>Stop</button>
            </>
          ) : (
            <>
              <span style={{ flex: '1 1 auto' }}>{unplaced.length ? 'Only skipped extinguishers are left.' : 'All extinguishers on this floor are on the map.'}</span>
              <button className="btn-secondary" style={{ width: 'auto' }} onClick={() => setQuickPlace(false)}>Done</button>
            </>
          )}
        </div>
      )}
      {msg && <p className="error-text">{msg}</p>}

      {floor?.image_path ? (
        <div className={'fe-map-outer' + (fullscreen ? ' fe-map-fullscreen' : '')}>
          <div className="fe-map-tools">
            <button className="fe-tool" onClick={() => { setFullscreen(!fullscreen); resetView() }} aria-label="Toggle fullscreen">
              <i className={fullscreen ? 'ti ti-arrows-minimize' : 'ti ti-arrows-maximize'} aria-hidden="true" />
            </button>
            <button className="fe-tool" onClick={() => setZoom((z) => Math.min(6, z + 0.5))} aria-label="Zoom in"><i className="ti ti-plus" aria-hidden="true" /></button>
            <button className="fe-tool" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Zoom out"><i className="ti ti-minus" aria-hidden="true" /></button>
            <button className="fe-tool" onClick={resetView} aria-label="Reset view"><i className="ti ti-focus-centered" aria-hidden="true" /></button>
            <button className={'fe-tool' + (showLabels ? ' fe-tool-on' : '')} onClick={() => setShowLabels(!showLabels)} aria-label="Toggle labels" title={showLabels ? 'Hide labels' : 'Show labels'}>
              <i className="ti ti-tag" aria-hidden="true" />
            </button>
          </div>

          <div className="fe-map-viewport"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onWheel={onWheel}
          >
            <div className="fe-map-wrap" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center center' }}>
              <img ref={imgRef} src={publicFloorplanUrl(floor.image_path)}
                alt={`${floor.building} ${floor.floor_name} floor plan`} className="fe-map-img"
                onClick={handleMapClick} draggable={false}
                style={{ cursor: editMode ? 'crosshair' : 'grab' }} />

              {placed.map((u) => (
                <button key={u.id}
                  className={'fe-pin fe-pin-' + pinState(u) + (draggingId === u.id ? ' fe-pin-dragging' : '') + (editMode ? ' fe-pin-edit' : '') + (selectedEdit?.id === u.id ? ' fe-pin-selected' : '')}
                  style={{ left: `${pct(u).left}%`, top: `${pct(u).top}%` }}
                  title={`${u.fe_code} · ${u.fe_type}${u.location_desc ? ' · ' + u.location_desc : ''}${u.expiry_date ? ' · expires ' + u.expiry_date : ''}`}
                  onPointerDown={(e) => dragPinStart(e, u)}
                  onContextMenu={(e) => { if (editMode) { e.preventDefault(); removePin(u) } }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (editMode) return
                    openDetails(u)
                  }}
                >
                  <i className="ti ti-fire-extinguisher" aria-hidden="true" />
                  {draggingId === u.id && <span className="fe-drag-chip">{u.fe_code}</span>}
                  {showLabels && draggingId !== u.id && (
                    <span className="fe-pin-label" onClick={(e) => e.stopPropagation()}>
                      <span className="fe-lbl-code">{u.fe_code}</span>
                      <span className={'fe-lbl-exp' + (expiryState(u.expiry_date) === 'expired' ? ' bad' : expiryState(u.expiry_date) === 'expiring' ? ' warn' : '')}>
                        {u.expiry_date ? u.expiry_date : 'no date'}
                      </span>
                      {u.serial_no && <span className="fe-lbl-sn">{u.serial_no}</span>}
                    </span>
                  )}
                </button>
              ))}

              {pendingPoint && (
                <span className="fe-pin fe-pin-new"
                  style={{ left: `${pct({ map_x: pendingPoint.x, map_y: pendingPoint.y }).left}%`, top: `${pct({ map_x: pendingPoint.x, map_y: pendingPoint.y }).top}%` }}>
                  <i className="ti ti-plus" aria-hidden="true" />
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          No floor plan image uploaded for this floor.
        </div>
      )}

      {/* edit-mode selection panel: details + actions for the tapped pin */}
      {editMode && selectedEdit && (() => {
        const u = units.find((x) => x.id === selectedEdit.id) || selectedEdit
        const es = expiryState(u.expiry_date)
        const days = daysToExpiry(u.expiry_date)
        return (
          <div className="fe-edit-panel">
            {!editForm ? (
              <>
                <div className="fe-edit-head">
                  <div className="fe-modal-ic"><i className="ti ti-fire-extinguisher" aria-hidden="true" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="fe-modal-code">{u.fe_code}</p>
                    <p className="fe-modal-sub">{u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</p>
                    {u.serial_no && <p className="fe-modal-sub">S/N: {u.serial_no}</p>}
                  </div>
                  <button className="icon-btn" aria-label="Deselect" onClick={() => setSelectedEdit(null)}>
                    <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
                  </button>
                </div>
                <div className="fe-status-row" style={{ margin: '4px 0 10px' }}>
                  {es === 'expired' && <span className="pill pill-danger">Expired</span>}
                  {es === 'expiring' && <span className="pill pill-warn">Expires in {days}d</span>}
                  {es === 'ok' && <span className="pill pill-ok">In date</span>}
                  {es === 'none' && <span className="pill pill-blue">No expiry date</span>}
                </div>
                <p className="list-card-meta">Drag this pin on the map to reposition it, or use the actions below.</p>
                <div className="btn-row" style={{ marginTop: 10 }}>
                  <button className="btn-secondary" onClick={startEditDetails}>
                    <i className="ti ti-edit" aria-hidden="true" />Edit details
                  </button>
                  <button className="btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => removePin(u)}>
                    <i className="ti ti-map-pin-off" aria-hidden="true" />Remove from map
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="section-label" style={{ marginTop: 0 }}>Edit {u.fe_code}</p>
                <div className="field"><label>Code</label>
                  <input value={editForm.fe_code} onChange={(e) => setEditForm({ ...editForm, fe_code: e.target.value })} />
                </div>
                <div className="field"><label>Type</label>
                  <select value={editForm.fe_type} onChange={(e) => setEditForm({ ...editForm, fe_type: e.target.value })}>
                    {FE_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field"><label>Serial number <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(optional)</span></label>
                  <input value={editForm.serial_no} onChange={(e) => setEditForm({ ...editForm, serial_no: e.target.value })} placeholder="Manufacturer's serial" />
                </div>
                <div className="field"><label>Location</label>
                  <input value={editForm.location_desc} onChange={(e) => setEditForm({ ...editForm, location_desc: e.target.value })} placeholder="Staircase J" />
                </div>
                <div className="field"><label>Expiry date</label>
                  <input type="date" value={editForm.expiry_date} onChange={(e) => setEditForm({ ...editForm, expiry_date: e.target.value })} />
                </div>
                <div className="btn-row">
                  <button className="btn-secondary" onClick={() => setEditForm(null)}>Cancel</button>
                  <button className="btn-primary" style={{ flex: 1 }} onClick={saveEditDetails}>Save changes</button>
                </div>
              </>
            )}
          </div>
        )
      })()}

      {editMode && pendingPoint && !newUnit && (
        <>
          <p className="section-label">Add at this spot</p>
          <button className="btn-primary" onClick={() => setNewUnit({ ...emptyNew })}>
            <i className="ti ti-plus" aria-hidden="true" />New extinguisher
          </button>

          {unplaced.length > 0 && (
            <>
              <p className="section-label">Or place an existing one ({unplaced.length})</p>
              {unplaced.map((u) => (
                <button className="eq-card" key={u.id} onClick={() => assignExisting(u.id)}>
                  <div className="eq-ic"><i className="ti ti-fire-extinguisher" aria-hidden="true" /></div>
                  <div className="eq-body">
                    <p className="eq-t">{u.fe_code}</p>
                    <p className="eq-s">{u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</p>
                  </div>
                  <span className="pill pill-blue">Place</span>
                </button>
              ))}
            </>
          )}
          <button className="btn-secondary" onClick={() => setPendingPoint(null)}>Cancel</button>
        </>
      )}

      {editMode && pendingPoint && newUnit && (
        <>
          <p className="section-label">New extinguisher</p>
          <div className="card">
            <div className="field"><label>Code</label>
              <input value={newUnit.fe_code} onChange={(e) => setNewUnit({ ...newUnit, fe_code: e.target.value })} placeholder="GF-OF-CO2-01" />
            </div>
            <div className="field"><label>Type</label>
              <select value={newUnit.fe_type} onChange={(e) => setNewUnit({ ...newUnit, fe_type: e.target.value })}>
                {FE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="field"><label>Serial number <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>(optional)</span></label>
              <input value={newUnit.serial_no} onChange={(e) => setNewUnit({ ...newUnit, serial_no: e.target.value })} placeholder="Manufacturer's serial" />
            </div>
            <div className="field"><label>Location</label>
              <input value={newUnit.location_desc} onChange={(e) => setNewUnit({ ...newUnit, location_desc: e.target.value })} placeholder="Staircase J" />
            </div>
            <div className="field"><label>Expiry date (optional)</label>
              <input type="date" value={newUnit.expiry_date} onChange={(e) => setNewUnit({ ...newUnit, expiry_date: e.target.value })} />
            </div>
            <p className="eq-s">Placed on {floor?.building} · {floor?.floor_name}. QR code becomes QR-{newUnit.fe_code || '…'}</p>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn-secondary" onClick={() => setNewUnit(null)}>Back</button>
              <button className="btn-primary" style={{ flex: 1 }} onClick={createNew}>Add extinguisher</button>
            </div>
          </div>
        </>
      )}

      {/* view-all-details list modal */}
      {detailsList && (
        <div className="fe-modal-overlay" onClick={() => setDetailsList(null)}>
          <div className="fe-modal fe-list-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fe-modal-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="fe-modal-code">Extinguisher details</p>
                <p className="fe-modal-sub">
                  {detailsScope === 'plant' ? `All of ${building}` : (floor ? `${floor.building} · ${floor.floor_name}` : '')} · {detailsList.rows.length} unit(s)
                </p>
              </div>
              <button className="icon-btn" aria-label="Close" onClick={() => setDetailsList(null)}>
                <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
              </button>
            </div>

            <div style={{ padding: '10px 14px 0' }}>
              <div className="chip-row">
                <button className={detailsScope === 'floor' ? 'chip active' : 'chip'} onClick={() => openDetailsList('floor')}>This floor</button>
                <button className={detailsScope === 'plant' ? 'chip active' : 'chip'} onClick={() => openDetailsList('plant')}>Whole plant ({building})</button>
              </div>
            </div>

            <div className="fe-modal-body" style={{ paddingTop: 4 }}>
              {detailsLoading ? (
                <p className="center-msg">Loading…</p>
              ) : detailsList.rows.length === 0 ? (
                <p className="list-card-meta">No extinguishers in scope.</p>
              ) : (
                <table className="fe-list-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Serial</th>
                      <th>Location</th>
                      {detailsScope === 'plant' && <th>Floor</th>}
                      <th>Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailsList.rows.map((r) => {
                      const es = expiryState(r.expiry_date)
                      return (
                        <tr key={r.fe_code}>
                          <td><b>{r.fe_code}</b><br /><span className="fe-list-type">{r.fe_type}</span></td>
                          <td>{r.serial_no || '—'}</td>
                          <td>{r.location_desc || '—'}</td>
                          {detailsScope === 'plant' && <td>{r.floorName}</td>}
                          <td className={es === 'expired' ? 'fer-bad' : es === 'expiring' ? 'fe-exp-soon' : ''}>
                            {r.expiry_date || '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="fe-modal-foot">
              <button className="btn-secondary" onClick={() => setDetailsList(null)}>Close</button>
              <button className="btn-primary" onClick={exportDetailsCSV} disabled={!detailsList.rows.length}>
                <i className="ti ti-download" aria-hidden="true" />Export CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* details popup */}
      {selected && (() => {
        const es = expiryState(selected.expiry_date)
        const days = daysToExpiry(selected.expiry_date)
        const doneThisMonth = inspectedIds.has(selected.id)
        return (
          <div className="fe-modal-overlay" onClick={() => setSelected(null)}>
            <div className="fe-modal" onClick={(e) => e.stopPropagation()}>
              <div className="fe-modal-head">
                <div className="fe-modal-ic"><i className="ti ti-fire-extinguisher" aria-hidden="true" /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="fe-modal-code">{selected.fe_code}</p>
                  <p className="fe-modal-sub">{selected.fe_type}</p>
                </div>
                <button className="icon-btn" aria-label="Close" onClick={() => setSelected(null)}>
                  <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
                </button>
              </div>

              <div className="fe-modal-body">
                <div className="fe-status-row">
                  <span className={'pill ' + (doneThisMonth ? 'pill-ok' : 'pill-danger')}>
                    {doneThisMonth ? 'Inspected this month' : 'Pending this month'}
                  </span>
                  {es === 'expired' && <span className="pill pill-danger">Expired</span>}
                  {es === 'expiring' && <span className="pill pill-warn">Expires in {days}d</span>}
                  {es === 'ok' && <span className="pill pill-ok">In date</span>}
                </div>

                <div className="fe-detail"><span>Location</span><b>{selected.location_desc || '—'}</b></div>
                {selected.serial_no && <div className="fe-detail"><span>Serial no.</span><b>{selected.serial_no}</b></div>}
                <div className="fe-detail"><span>Floor</span><b>{floor?.building} · {floor?.floor_name}</b></div>
                <div className="fe-detail"><span>Expiry</span><b>{selected.expiry_date || 'Not set'}</b></div>

                <p className="section-label" style={{ margin: '12px 0 6px' }}>Last inspection</p>
                {loadingInsp ? (
                  <p className="list-card-meta">Loading…</p>
                ) : !lastInsp ? (
                  <p className="list-card-meta">Never inspected.</p>
                ) : (
                  <>
                    <div className="fe-detail"><span>Date</span><b>{new Date(lastInsp.inspection_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</b></div>
                    <div className="fe-detail"><span>By</span><b>{lastInsp.technician?.name || '—'}</b></div>
                    <div className="fe-detail">
                      <span>Result</span>
                      <b style={{ color: lastInsp.defects?.length ? 'var(--danger)' : 'var(--success)' }}>
                        {lastInsp.defects?.length ? `${lastInsp.defects.length} defect(s)` : 'All normal'}
                      </b>
                    </div>
                    {lastInsp.defects?.length > 0 && (
                      <ul className="fe-defect-list">
                        {lastInsp.defects.map((d) => (
                          <li key={d.parameter_name}>{d.parameter_name}: <b>{d.value}</b></li>
                        ))}
                      </ul>
                    )}
                    {lastInsp.remarks && <p className="list-card-meta" style={{ marginTop: 6 }}>Remarks: {lastInsp.remarks}</p>}
                  </>
                )}
              </div>

              <div className="fe-modal-foot">
                <button className="btn-secondary" onClick={() => setSelected(null)}>Close</button>
                <button className="btn-primary" onClick={() => navigate(`/fe/checklist/${selected.fe_code}`)}>
                  <i className="ti ti-clipboard-check" aria-hidden="true" />
                  {doneThisMonth ? 'Inspect again' : 'Start inspection'}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {!editMode && unplaced.length > 0 && (
        <>
          <p className="section-label">Not on map ({unplaced.length})</p>
          {unplaced.map((u) => {
            const done = inspectedIds.has(u.id)
            return (
              <button className="eq-card" key={u.id} onClick={() => openDetails(u)}>
                <div className="eq-ic"><i className="ti ti-fire-extinguisher" aria-hidden="true" /></div>
                <div className="eq-body">
                  <p className="eq-t">{u.fe_code}</p>
                  <p className="eq-s">{u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</p>
                </div>
                <span className={'pill ' + (done ? 'pill-ok' : 'pill-danger')}>{done ? 'Done' : 'Pending'}</span>
              </button>
            )
          })}
        </>
      )}
    </div>
  )
}
