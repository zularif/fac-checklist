import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { publicFloorplanUrl } from '../../lib/feHelpers'

const FE_TYPES = ['CO2', 'ABC', 'Water']

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return []
  const split = (line) => {
    const out = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (inQ && line[i + 1] === '"') { cur += '"'; i++ } else inQ = !inQ }
      else if (c === ',' && !inQ) { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    return out.map((s) => s.trim())
  }
  const headers = split(lines[0]).map((h) => h.toLowerCase())
  return lines.slice(1).map((l) => {
    const cells = split(l)
    const row = {}
    headers.forEach((h, i) => { row[h] = cells[i] ?? '' })
    return row
  })
}

export default function FEAdmin() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const csvRef = useRef(null)

  const [floors, setFloors] = useState([])
  const [feCount, setFeCount] = useState(0)
  const [newFloor, setNewFloor] = useState({ building: 'P1', floor_name: '' })
  const [uploadingFor, setUploadingFor] = useState(null)
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState('')
  const [importResult, setImportResult] = useState(null)

  async function load() {
    const { data } = await db.from('fe_floors').select('*').order('building').order('sort_order')
    setFloors(data || [])
    const { count } = await db.from('fire_extinguishers').select('*', { count: 'exact', head: true })
    setFeCount(count || 0)
  }
  useEffect(() => { load() }, [])

  async function addFloor() {
    if (!newFloor.floor_name.trim()) { setMsg('Floor name is required.'); return }
    const { error } = await db.from('fe_floors').insert({
      building: newFloor.building.trim(),
      floor_name: newFloor.floor_name.trim(),
      sort_order: floors.filter((f) => f.building === newFloor.building).length + 1,
    })
    if (error) { setMsg(`Couldn't add floor: ${error.message}`); return }
    setNewFloor({ building: newFloor.building, floor_name: '' })
    setMsg('')
    load()
  }

  async function uploadPlan(floorId, file) {
    if (!file) return
    setUploadingFor(floorId)
    setMsg('')
    try {
      // read the image's natural pixel size — pin coordinates from your
      // existing FE list are in pixels, so we need this to place them.
      const dims = await new Promise((resolve) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = () => resolve({ w: null, h: null })
        img.src = URL.createObjectURL(file)
      })

      const path = `${floorId}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
      const { error: upErr } = await db.storage.from('floorplans').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { error } = await db
        .from('fe_floors')
        .update({ image_path: path, ref_width: dims.w, ref_height: dims.h })
        .eq('id', floorId)
      if (error) throw error
      load()
    } catch (err) {
      setMsg(`Upload failed: ${err.message}`)
    } finally {
      setUploadingFor(null)
    }
  }

  async function deleteFloor(f) {
    if (!window.confirm(`Delete floor "${f.building} ${f.floor_name}"? Extinguishers on it will lose their floor and pin.`)) return
    await db.from('fe_floors').delete().eq('id', f.id)
    load()
  }

  async function importCSV(file) {
    if (!file) return
    setImporting(true)
    setMsg('')
    setImportResult(null)
    try {
      const text = await file.text()
      const rows = parseCSV(text)
      if (!rows.length) throw new Error('No rows found in the file.')

      // map building+floor names to ids
      const floorKey = {}
      for (const f of floors) floorKey[`${f.building.toLowerCase()}|${f.floor_name.toLowerCase()}`] = f.id

      const payload = []
      const skipped = []
      for (const r of rows) {
        const code = r.fe_code || r.code
        if (!code) { skipped.push('(missing fe_code)'); continue }
        const b = (r.building || '').toLowerCase()
        const fl = (r.floor || r.floor_name || '').toLowerCase()
        const floor_id = floorKey[`${b}|${fl}`] || null
        const px = r.x !== '' && r.x != null ? Number(r.x) : null
        const py = r.y !== '' && r.y != null ? Number(r.y) : null
        payload.push({
          fe_code: code,
          fe_type: FE_TYPES.includes(r.fe_type) ? r.fe_type : (r.fe_type || r.type || 'ABC'),
          serial_no: (r.serial_no || r.serial || '').trim() || null,
          location_desc: r.location || r.location_desc || null,
          floor_id,
          map_x: Number.isFinite(px) ? px : null,
          map_y: Number.isFinite(py) ? py : null,
          qr_code: r.qr_code || `QR-${code}`,
          expiry_date: (r.expiry_date || r.expirydate || r.expiry || '').trim() || null,
          status: 'Active',
        })
      }

      // upsert so re-importing updates instead of erroring on duplicates
      const { error } = await db.from('fire_extinguishers').upsert(payload, { onConflict: 'fe_code' })
      if (error) throw error

      const noFloor = payload.filter((p) => !p.floor_id).length
      setImportResult({ imported: payload.length, skipped: skipped.length, noFloor })
      load()
    } catch (err) {
      setMsg(`Import failed: ${err.message}`)
    } finally {
      setImporting(false)
    }
  }

  function downloadTemplate() {
    const csv = 'fe_code,fe_type,serial_no,location,building,floor,x,y,expiry_date,qr_code\nGF-OF-CO2-01,CO2,CO2-2023-88421,GF Office Entrance (West),P1,Ground,920,380,2027-06-30,QR-GF-OF-CO2-01\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'fire-extinguisher-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/fe')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back to map
      </button>
      <p className="page-title">Fire extinguisher admin</p>
      <p className="page-sub">{feCount} extinguisher(s) · {floors.length} floor plan(s)</p>

      {msg && <p className="error-text">{msg}</p>}

      <p className="section-label">Floors</p>
      {floors.map((f) => (
        <div className="card" key={f.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              <p className="eq-t">{f.building} · {f.floor_name}</p>
              <p className="eq-s">{f.image_path ? 'Floor plan uploaded' : 'No floor plan yet'}</p>
            </div>
            {f.image_path && (
              <img src={publicFloorplanUrl(f.image_path)} alt="" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <label className="btn-secondary" style={{ cursor: 'pointer', margin: 0 }}>
              <i className="ti ti-upload" aria-hidden="true" />
              {uploadingFor === f.id ? 'Uploading…' : f.image_path ? 'Replace plan' : 'Upload plan'}
              <input type="file" accept="image/*" hidden onChange={(e) => uploadPlan(f.id, e.target.files?.[0])} />
            </label>
            <button className="btn-secondary" style={{ color: 'var(--danger)' }} onClick={() => deleteFloor(f)}>
              <i className="ti ti-trash" aria-hidden="true" />Delete
            </button>
          </div>
        </div>
      ))}

      <div className="card">
        <p className="eq-t" style={{ marginBottom: 8 }}>Add floor</p>
        <div className="btn-row">
          <div className="field" style={{ flex: 1 }}>
            <label>Building</label>
            <input value={newFloor.building} onChange={(e) => setNewFloor({ ...newFloor, building: e.target.value })} placeholder="P1" />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Floor name</label>
            <input value={newFloor.floor_name} onChange={(e) => setNewFloor({ ...newFloor, floor_name: e.target.value })} placeholder="Ground" />
          </div>
        </div>
        <button className="btn-primary" onClick={addFloor}><i className="ti ti-plus" aria-hidden="true" />Add floor</button>
      </div>

      <p className="section-label">Import extinguishers</p>
      <div className="card">
        <p className="eq-s" style={{ marginBottom: 8 }}>
          CSV columns: <strong>fe_code, fe_type, serial_no, location, building, floor, x, y, expiry_date, qr_code</strong>.
          expiry_date must be YYYY-MM-DD (optional).
          x and y are the pin's pixel position on that floor plan (optional — leave blank to place pins by hand later).
          Building and floor must match a floor above. Re-importing the same fe_code updates it instead of duplicating.
        </p>
        <div className="btn-row">
          <button className="btn-secondary" onClick={downloadTemplate}>
            <i className="ti ti-download" aria-hidden="true" />Template
          </button>
          <label className="btn-primary" style={{ cursor: 'pointer', margin: 0 }}>
            <i className="ti ti-file-upload" aria-hidden="true" />
            {importing ? 'Importing…' : 'Import CSV'}
            <input ref={csvRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCSV(e.target.files?.[0])} />
          </label>
        </div>
        {importResult && (
          <div className="banner-warn" style={{ marginTop: 10 }}>
            Imported {importResult.imported}.
            {importResult.noFloor > 0 && ` ${importResult.noFloor} had no matching building/floor — set their floor later.`}
            {importResult.skipped > 0 && ` ${importResult.skipped} row(s) skipped (missing fe_code).`}
          </div>
        )}
      </div>
    </div>
  )
}
