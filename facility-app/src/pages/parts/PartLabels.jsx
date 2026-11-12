import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { loadParts, stockOf, photoUrl, partQrValue, categoryColor } from '../../lib/parts'

const SIZES = {
  'Standard (6.3 × 3.8 cm, 3 across A4)': { w: 6.3, h: 3.8 },
  'Large (9 × 5 cm, 2 across A4)': { w: 9, h: 5 },
}

// Printable labels: photo, QR, part name and details. The QR opens the part in the app.
export default function PartLabels() {
  const navigate = useNavigate()
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const [size, setSize] = useState(Object.keys(SIZES)[0])
  const [selected, setSelected] = useState(new Set())
  const [showStore, setShowStore] = useState('both') // which shelf locations to print

  useEffect(() => { loadParts().then(setParts).finally(() => setLoading(false)) }, [])

  const categories = useMemo(() => ['All', ...[...new Set(parts.map((p) => p.category).filter(Boolean))].sort()], [parts])
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    return parts.filter((p) => (category === 'All' || p.category === category) && (!s || `${p.part_code} ${p.part_name}`.toLowerCase().includes(s)))
  }, [parts, search, category])
  const toPrint = parts.filter((p) => selected.has(p.id))
  const dims = SIZES[size]

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allOn = filtered.length > 0 && filtered.every((p) => selected.has(p.id))
  const toggleAll = () => setSelected((s) => { const n = new Set(s); filtered.forEach((p) => (allOn ? n.delete(p.id) : n.add(p.id))); return n })

  return (
    <div className="screen">
      <div className="no-print">
        <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
        <p className="page-title">Spare part QR labels</p>
        <p className="page-sub">Each label shows the photo, name and details. Scanning it opens the part to take out or receive stock.</p>

        <div className="form-grid">
          <label className="work-field">Label size<select value={size} onChange={(e) => setSize(e.target.value)}>{Object.keys(SIZES).map((k) => <option key={k}>{k}</option>)}</select></label>
          <label className="work-field">Shelf shown<select value={showStore} onChange={(e) => setShowStore(e.target.value)}>
            <option value="both">P1 and P2</option><option value="P1">P1 only</option><option value="P2">P2 only</option>
          </select></label>
        </div>
        <div className="hist-search-row">
          <input placeholder="Search code or name" value={search} onChange={(e) => setSearch(e.target.value)} />
          {categories.length > 2 && <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: 'auto', margin: 0 }}>{categories.map((c) => <option key={c} value={c}>{c === 'All' ? 'All categories' : c}</option>)}</select>}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 10px' }}>
          <input type="checkbox" style={{ width: 'auto' }} checked={allOn} onChange={toggleAll} />Select all shown — {selected.size} selected
        </label>
        <button className="btn-primary" disabled={!toPrint.length} onClick={() => window.print()}>
          <i className="ti ti-printer" aria-hidden="true" />Print {toPrint.length || ''} label{toPrint.length === 1 ? '' : 's'}
        </button>

        {loading ? <p className="center-msg">Loading parts…</p> : (
          <div className="parts-list" style={{ marginTop: 10 }}>
            {filtered.map((p) => (
              <button type="button" className="part-row" key={p.id} onClick={() => toggle(p.id)} aria-pressed={selected.has(p.id)}>
                <input type="checkbox" tabIndex={-1} style={{ width: 'auto' }} checked={selected.has(p.id)} readOnly />
                <div className="part-thumb">{p.photo_path ? <img src={photoUrl(p.photo_path)} alt="" loading="lazy" /> : <i className="ti ti-package" aria-hidden="true" />}</div>
                <div className="part-main"><p className="part-name">{p.part_name}</p><p className="part-sub">{p.part_code}{p.photo_path ? '' : ' · no photo'}</p></div>
              </button>
            ))}
          </div>
        )}

        {toPrint.length > 0 && <p className="section-label" style={{ marginTop: 16 }}>Preview</p>}
      </div>

      <div className="part-label-sheet" style={{ '--lw': `${dims.w}cm`, '--lh': `${dims.h}cm` }}>
        {toPrint.map((p) => {
          const locs = ['P1', 'P2'].filter((st) => showStore === 'both' || showStore === st).map((st) => ({ st, loc: stockOf(p, st).location })).filter((x) => x.loc)
          return (
            <div className="part-label" key={p.id} style={{ '--pc': categoryColor(p.category, parts) }}>
              <div className="pl-head"><span>{p.category || 'Spare part'}</span></div>
              <div className="pl-body">
                <div className="pl-photo">{p.photo_path ? <img src={photoUrl(p.photo_path)} alt="" /> : <span>No photo</span>}</div>
                <div className="pl-text">
                  <p className="pl-name">{p.part_name}</p>
                  <p className="pl-code">{p.part_code}</p>
                  {[p.brand, p.model].filter(Boolean).length > 0 && <p className="pl-detail">{[p.brand, p.model].filter(Boolean).join(' · ')}</p>}
                  {p.description && <p className="pl-detail pl-desc">{p.description}</p>}
                  <p className="pl-detail">Unit: {p.unit}</p>
                  {locs.map((x) => <p className="pl-detail pl-loc" key={x.st}><b>{x.st}</b> {x.loc}</p>)}
                </div>
                <div className="pl-qr"><QRCodeSVG value={partQrValue(p.part_code)} size={220} level="M" /><span className="pl-scan">SCAN</span></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
