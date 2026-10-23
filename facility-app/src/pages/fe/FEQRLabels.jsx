import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { db } from '../../lib/db'
import { FE_TYPE_COLOR } from '../../lib/feHelpers'

const LABEL_SIZES = {
  'Small (3.5 cm)': { w: 3.5, qr: 30 },
  'Medium (4.5 cm)': { w: 4.5, qr: 40 },
  'Large (5.5 cm)': { w: 5.5, qr: 50 },
}

export default function FEQRLabels() {
  const navigate = useNavigate()
  const [units, setUnits] = useState([])
  const [floors, setFloors] = useState([])
  const [building, setBuilding] = useState('All')
  const [floorId, setFloorId] = useState('All')
  const [feType, setFeType] = useState('All')
  const [labelSize, setLabelSize] = useState('Medium (4.5 cm)')
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data: fl } = await db.from('fe_floors').select('id, building, floor_name').order('building').order('sort_order')
      setFloors(fl || [])
      const { data } = await db
        .from('fire_extinguishers')
        .select('id, fe_code, fe_type, serial_no, location_desc, qr_code, floor_id')
        .eq('status', 'Active')
        .order('fe_code')
      setUnits(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const floorLabel = useMemo(() => {
    const m = {}
    for (const f of floors) m[f.id] = { building: f.building, name: f.floor_name }
    return m
  }, [floors])

  const buildings = useMemo(() => ['All', ...new Set(floors.map((f) => f.building))], [floors])
  const types = useMemo(() => ['All', ...new Set(units.map((u) => u.fe_type).filter(Boolean))], [units])
  const floorsOfBuilding = useMemo(
    () => (building === 'All' ? floors : floors.filter((f) => f.building === building)),
    [floors, building]
  )

  const filtered = useMemo(() => {
    return units.filter((u) => {
      const fl = floorLabel[u.floor_id]
      if (building !== 'All' && fl?.building !== building) return false
      if (floorId !== 'All' && u.floor_id !== floorId) return false
      if (feType !== 'All' && u.fe_type !== feType) return false
      return true
    })
  }, [units, building, floorId, feType, floorLabel])

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((u) => u.id)))
  }

  const toPrint = filtered.filter((u) => selected.has(u.id))
  const size = LABEL_SIZES[labelSize] || Object.values(LABEL_SIZES)[0]

  return (
    <div className="screen">
      <div className="no-print">
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/fe')}>
          <i className="ti ti-arrow-left" aria-hidden="true" />Back
        </button>
        <p className="page-title">FE QR labels</p>
        <p className="page-sub">Print scannable labels for fire extinguishers.</p>

        <div className="field"><label>Label size</label>
          <select value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
            {Object.keys(LABEL_SIZES).map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="field"><label>Building</label>
          <select value={building} onChange={(e) => { setBuilding(e.target.value); setFloorId('All') }}>
            {buildings.map((b) => <option key={b}>{b}</option>)}
          </select>
        </div>
        <div className="field"><label>Floor</label>
          <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
            <option value="All">All floors</option>
            {floorsOfBuilding.map((f) => <option key={f.id} value={f.id}>{f.building} · {f.floor_name}</option>)}
          </select>
        </div>
        <div className="field"><label>Type</label>
          <select value={feType} onChange={(e) => setFeType(e.target.value)}>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>

        <div className="row" style={{ marginTop: 4 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
            Select all — {selected.size} of {filtered.length} selected
          </label>
        </div>

        <button className="btn-primary" style={{ margin: '12px 0' }} disabled={toPrint.length === 0} onClick={() => window.print()}>
          <i className="ti ti-printer" style={{ fontSize: 16 }} aria-hidden="true" />
          Print {toPrint.length > 0 ? `${toPrint.length} ` : ''}labels
        </button>

        {loading ? (
          <p className="center-msg">Loading extinguishers…</p>
        ) : filtered.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No extinguishers match these filters.</div>
        ) : (
          <div className="card-grid">
            {filtered.map((u) => {
              const fl = floorLabel[u.floor_id]
              return (
                <div className="list-card" key={u.id} onClick={() => toggle(u.id)}>
                  <div className="list-card-head">
                    <input type="checkbox" style={{ width: 'auto' }} checked={selected.has(u.id)} onChange={() => toggle(u.id)} onClick={(ev) => ev.stopPropagation()} />
                    <p className="list-card-title">{u.fe_code}</p>
                    <span className="pill pill-blue">{u.fe_type}</span>
                  </div>
                  <p className="list-card-meta">{u.location_desc || '—'}</p>
                  {u.serial_no && <p className="list-card-meta" style={{ marginTop: 2 }}>S/N: {u.serial_no}</p>}
                  <p className="list-card-meta" style={{ marginTop: 2 }}>{fl ? `${fl.building} · ${fl.name}` : 'No floor'}</p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* printed labels */}
      <div className="print-only label-sheet" style={{ '--label-w': `${size.w}cm` }}>
        {toPrint.map((u) => {
          const fl = floorLabel[u.floor_id]
          const color = FE_TYPE_COLOR[u.fe_type] || '#64748b'
          return (
            <div className="qr-label" key={u.id}>
              <div className="qr-label-bar" style={{ background: color }} />
              <div className="qr-label-inner">
                <QRCodeSVG value={u.qr_code || `QR-${u.fe_code}`} size={size.qr * 3} />
                <p className="qr-label-name">{u.fe_code}</p>
                <p className="qr-label-id">{u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</p>
                {u.serial_no && <p className="qr-label-id" style={{ fontWeight: 400 }}>S/N: {u.serial_no}</p>}
                <p className="qr-label-id" style={{ fontWeight: 400 }}>{fl ? `${fl.building} · ${fl.name}` : ''}</p>
                <div className="qr-label-hint" style={{ color }}>
                  <i className="ti ti-qrcode" aria-hidden="true" />
                  <span>SCAN TO INSPECT</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
