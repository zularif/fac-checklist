import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { db } from '../lib/db'

const LABEL_SIZES = {
  'Small (3.5 cm)': { w: 3.5, qr: 30 },
  'Medium (4.5 cm)': { w: 4.5, qr: 40 },
  'Large (5.5 cm)': { w: 5.5, qr: 50 },
}

const CATEGORY_COLOR = { ACMV: '#1d9e75', Electrical: '#1a56db' }

export default function QRLabels() {
  const navigate = useNavigate()
  const [equipment, setEquipment] = useState([])
  const [category, setCategory] = useState('All Categories')
  const [labelSize, setLabelSize] = useState('Large (5.5 cm)')
  const [perRow, setPerRow] = useState(3)
  const [selected, setSelected] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await db
        .from('equipment')
        .select('id, equip_id, equipment_name, qr_code, category, status, area:areas(area_name)')
        .eq('status', 'Active')
        .order('equip_id')
      setEquipment(data || [])
      setLoading(false)
    }
    load()
  }, [])

  const categories = useMemo(() => {
    const set = new Set(equipment.map((e) => e.category).filter(Boolean))
    return ['All Categories', ...set]
  }, [equipment])

  const filtered = useMemo(
    () => (category === 'All Categories' ? equipment : equipment.filter((e) => e.category === category)),
    [equipment, category]
  )

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((e) => e.id)))
  }

  const toPrint = filtered.filter((e) => selected.has(e.id))
  const size = LABEL_SIZES[labelSize] || Object.values(LABEL_SIZES)[0]

  return (
    <div className="screen">
      <div className="no-print">
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate(-1)}>
          <i className="ti ti-arrow-left" aria-hidden="true" />Back
        </button>
        <p className="page-title">QR label generator</p>
        <p className="page-sub">Select equipment and print scannable labels.</p>

        <div className="field"><label>Label size</label>
          <select value={labelSize} onChange={(e) => setLabelSize(e.target.value)}>
            {Object.keys(LABEL_SIZES).map((k) => <option key={k}>{k}</option>)}
          </select>
        </div>
        <div className="field"><label>Labels per row</label>
          <select value={perRow} onChange={(e) => setPerRow(Number(e.target.value))}>
            {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="field"><label>Filter by category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>

        <div className="row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
            Select all — {selected.size} of {filtered.length} selected
          </label>
        </div>

        <button className="btn-primary" style={{ margin: '12px 0' }} disabled={toPrint.length === 0} onClick={() => window.print()}>
          <i className="ti ti-printer" style={{ fontSize: 16 }} aria-hidden="true" />Print {toPrint.length > 0 ? `${toPrint.length} ` : ''}labels
        </button>

        {loading ? (
          <p className="center-msg">Loading equipment…</p>
        ) : (
          filtered.map((e) => (
            <button className="eq-card" key={e.id} onClick={() => toggle(e.id)}>
              <input type="checkbox" style={{ width: 'auto' }} checked={selected.has(e.id)} onChange={() => toggle(e.id)} onClick={(ev) => ev.stopPropagation()} />
              <div className="eq-body">
                <p className="eq-t">{e.equipment_name}</p>
                <p className="eq-s">{e.equip_id} · {e.category}</p>
              </div>
            </button>
          ))
        )}
      </div>

      <div className="print-only label-sheet" style={{ '--label-w': `${size.w}cm`, '--cols': perRow }}>
        {toPrint.map((e) => (
          <div className="qr-label" key={e.id}>
            <div className="qr-label-bar" style={{ background: CATEGORY_COLOR[e.category] || '#64748b' }} />
            <div className="qr-label-inner">
              <QRCodeSVG value={e.qr_code} size={size.qr * 3} />
              <p className="qr-label-name">{e.equipment_name}</p>
              <p className="qr-label-id">{e.equip_id} · {e.area?.area_name}</p>
              <div className="qr-label-hint" style={{ color: CATEGORY_COLOR[e.category] || '#64748b' }}>
                <i className="ti ti-qrcode" aria-hidden="true" />
                <span>SCAN TO INSPECT</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
