import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SignatureCanvas from 'react-signature-canvas'
import { isFlagged } from '../lib/inspectionModel'
import { db } from '../lib/db'

function toISODate(d) { return d.toISOString().slice(0, 10) }
function fmtDay(d) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }
function fmtFull(d) { return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }

export default function Reports() {
  const navigate = useNavigate()
  const [plants, setPlants] = useState([])
  const [areas, setAreas] = useState([])
  const [equipList, setEquipList] = useState([])
  const [plantId, setPlantId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [equipId, setEquipId] = useState('')
  const today = new Date()
  const weekAgo = new Date(Date.now() - 6 * 86400000)
  const [dateFrom, setDateFrom] = useState(toISODate(weekAgo))
  const [dateTo, setDateTo] = useState(toISODate(today))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [signedName, setSignedName] = useState('')
  const [signedImg, setSignedImg] = useState(null)
  const [signedAt, setSignedAt] = useState(null)
  const sigRef = useRef(null)

  useEffect(() => {
    db.from('plants').select('*').then(({ data }) => {
      setPlants(data || [])
      if (data?.length) setPlantId(data[0].id)
    })
  }, [])

  useEffect(() => {
    if (!plantId) return
    db.from('areas').select('*').eq('plant_id', plantId).then(({ data }) => {
      setAreas(data || [])
      setAreaId('')
    })
  }, [plantId])

  // Load equipment for the chosen area (or the whole plant if no area picked).
  useEffect(() => {
    setEquipId('')
    const areaIds = areaId ? [areaId] : areas.map((a) => a.id)
    if (!areaIds.length) { setEquipList([]); return }
    db
      .from('equipment')
      .select('id, equip_id, equipment_name')
      .eq('status', 'Active')
      .in('area_id', areaIds)
      .order('equip_id')
      .then(({ data }) => setEquipList(data || []))
  }, [areaId, areas])

  const dateList = useMemo(() => {
    const list = []
    let d = new Date(dateFrom)
    const end = new Date(dateTo)
    while (d <= end) { list.push(toISODate(d)); d = new Date(d.getTime() + 86400000) }
    return list
  }, [dateFrom, dateTo])

  const plantName = plants.find((p) => p.id === plantId)?.plant_name || ''
  const areaName = areas.find((a) => a.id === areaId)?.area_name || 'All areas'

  async function generate() {
    setLoading(true)
    setSignedImg(null)
    const areaIds = areaId ? [areaId] : areas.map((a) => a.id)
    let eqQuery = db
      .from('equipment').select('id, equip_id, equipment_name, category, asset_tag, inspection_cycle, area:areas(area_name)')
      .in('area_id', areaIds.length ? areaIds : ['00000000-0000-0000-0000-000000000000']).order('equip_id')
    if (equipId) eqQuery = eqQuery.eq('id', equipId)
    const { data: eqRows } = await eqQuery
    const equipIds = (eqRows || []).map((e) => e.id)
    const { data: templates } = await db
      .from('checklist_templates').select('equipment_id, parameter_name, unit, min_value, max_value, sort_order, type')
      .in('equipment_id', equipIds.length ? equipIds : ['00000000-0000-0000-0000-000000000000']).order('sort_order')
    const { data: headers } = await db
      .from('inspection_headers').select('id, equipment_id, inspection_date, status, technician:technicians(name)')
      .in('equipment_id', equipIds.length ? equipIds : ['00000000-0000-0000-0000-000000000000'])
      .gte('inspection_date', dateFrom).lte('inspection_date', dateTo + 'T23:59:59').order('inspection_date').order('received_at')
    const headerIds = (headers || []).map((h) => h.id)
    const { data: details } = await db.from('inspection_details').select('*')
      .in('inspection_id', headerIds.length ? headerIds : ['00000000-0000-0000-0000-000000000000'])

    const headersByEquip = {}
    for (const h of headers || []) (headersByEquip[h.equipment_id] ||= []).push(h)
    const detailsByHeader = {}
    for (const d of details || []) (detailsByHeader[d.inspection_id] ||= []).push(d)
    const paramsByEquip = {}
    for (const t of templates || []) {
      const list = (paramsByEquip[t.equipment_id] ||= [])
      if (!list.find((x) => x.parameter_name === t.parameter_name)) list.push(t)
    }

    const equipmentBlocks = (eqRows || []).map((eq) => {
      const params = paramsByEquip[eq.id] || []
      const byDate = {}
      for (const h of headersByEquip[eq.id] || []) byDate[toISODate(new Date(h.inspection_date))] = h
      const columns = dateList.map((date) => {
        const h = byDate[date]
        if (!h) return { date, header: null, values: {}, technician: null, outOfSpec: 0 }
        const rows = detailsByHeader[h.id] || []
        const values = {}; let outOfSpec = 0
        for (const r of rows) { values[r.parameter_name] = r; if (isFlagged(r.computed_status)) outOfSpec++ }
        return { date, header: h, values, technician: h.technician?.name, outOfSpec }
      })
      return { equipment: eq, params, columns }
    })
    setReport({ equipmentBlocks, dates: dateList })
    setLoading(false)
  }

  function applySignature() {
    if (!sigRef.current || sigRef.current.isEmpty()) return
    setSignedImg(sigRef.current.getCanvas().toDataURL('image/png'))
    setSignedAt(new Date())
  }

  function exportCSV() {
    if (!report) return
    const rows = [['Equipment', 'EquipID', 'Parameter', 'Reference', 'Date', 'Value', 'Status', 'Technician']]
    for (const block of report.equipmentBlocks)
      for (const col of block.columns)
        for (const p of block.params) {
          const v = col.values[p.parameter_name]
          const ref = p.type === 'numeric' && p.min_value != null ? `${p.min_value}-${p.max_value}${p.unit ? ' ' + p.unit : ''}` : ''
          rows.push([block.equipment.equipment_name, block.equipment.equip_id, p.parameter_name, ref, col.date, v ? v.value : '', v ? v.computed_status : '', col.technician || ''])
        }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `inspection-report-${dateFrom}-to-${dateTo}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="screen">
      <div className="no-print">
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate(-1)}>
          <i className="ti ti-arrow-left" aria-hidden="true" />Back
        </button>
        <p className="page-title">Inspection report</p>
        <p className="page-sub">Filter by plant, area, and date range.</p>

        <div className="field"><label>Plant</label>
          <select value={plantId} onChange={(e) => setPlantId(e.target.value)}>
            {plants.map((p) => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
          </select>
        </div>
        <div className="field"><label>Area</label>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}
          </select>
        </div>
        <div className="field"><label>Equipment</label>
          <select value={equipId} onChange={(e) => setEquipId(e.target.value)}>
            <option value="">All equipment</option>
            {equipList.map((e) => <option key={e.id} value={e.id}>{e.equip_id} · {e.equipment_name}</option>)}
          </select>
        </div>
        <div className="btn-row">
          <div className="field" style={{ flex: 1 }}><label>Date from</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}><label>Date to</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        <button className="btn-primary" style={{ marginTop: 6 }} onClick={generate} disabled={loading}>
          {loading ? 'Generating…' : 'Generate report'}
        </button>

        {report && (
          <>
            <p className="section-label">Supervisor signature</p>
            <p className="page-sub">Sign here before printing. It appears at the end of the report.</p>
            {signedImg ? (
              <div className="card" style={{ textAlign: 'center' }}>
                <img src={signedImg} alt="signature" style={{ maxWidth: 200, height: 60, objectFit: 'contain' }} />
                <p className="eq-s">Signed {signedAt && fmtFull(signedAt)}</p>
                <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setSignedImg(null)}>Re-sign</button>
              </div>
            ) : (
              <>
                <div className="sig-pad">
                  <SignatureCanvas ref={sigRef} canvasProps={{ className: 'sig-canvas' }} />
                </div>
                <div className="field"><label>Signed by (name)</label>
                  <input value={signedName} onChange={(e) => setSignedName(e.target.value)} placeholder="Supervisor name" />
                </div>
                <div className="btn-row">
                  <button className="btn-secondary" onClick={() => sigRef.current?.clear()}>Clear</button>
                  <button className="btn-secondary" onClick={applySignature}>Apply signature</button>
                </div>
              </>
            )}

            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn-secondary" onClick={exportCSV}><i className="ti ti-download" aria-hidden="true" />Export CSV</button>
              <button className="btn-primary" onClick={() => window.print()}><i className="ti ti-printer" aria-hidden="true" />Print / PDF</button>
            </div>
          </>
        )}
      </div>

      {report && (
        <div className="print-only report-doc">
          {report.equipmentBlocks.map((block, bi) => (
            <div className="fir-block" key={block.equipment.id}>
              <div className="fir-head">
                <img src="/wiwynn-logo.png" alt="" className="fir-logo" onError={(e) => { e.target.style.display = 'none' }} />
                <div className="fir-period">
                  <p className="fir-period-l">Period</p>
                  <p className="fir-period-v">{fmtFull(report.dates[0])} – {fmtFull(report.dates[report.dates.length - 1])}</p>
                </div>
              </div>
              <p className="fir-title">Factory Inspection Record</p>
              <p className="fir-crumb">{plantName} › {block.equipment.area?.area_name}</p>
              <p className="fir-meta">{block.equipment.category} &nbsp; Cycle: {block.equipment.inspection_cycle} &nbsp; Tag: {block.equipment.asset_tag || block.equipment.equip_id}</p>

              <table className="fir-table">
                <thead>
                  <tr>
                    <th>No</th><th>Panel Name</th><th>Description</th><th>Reference</th>
                    {report.dates.map((d) => <th key={d}>{fmtDay(d)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {block.params.map((p, pi) => {
                    const ref = p.type === 'numeric' && p.min_value != null ? `(${p.min_value}-${p.max_value}${p.unit ? ' ' + p.unit : ''})` : '-'
                    return (
                      <tr key={p.parameter_name}>
                        {pi === 0 && <td rowSpan={block.params.length} className="fir-no">{bi + 1}</td>}
                        {pi === 0 && <td rowSpan={block.params.length} className="fir-panel">{block.equipment.equipment_name}</td>}
                        <td className="fir-desc">{p.parameter_name}</td>
                        <td className="fir-ref">{ref}</td>
                        {block.columns.map((col) => {
                          const v = col.values[p.parameter_name]
                          if (!v) return <td key={col.date} className="fir-empty">—</td>
                          const bad = isFlagged(v.computed_status)
                          return <td key={col.date} className={bad ? 'fir-bad' : 'fir-val'}>{v.value}{bad && v.computed_status === 'OutOfRange' ? '*' : ''}</td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="fir-foot"><td colSpan={4}>TECHNICIAN</td>{block.columns.map((c) => <td key={c.date}>{c.technician || '—'}</td>)}</tr>
                  <tr className="fir-foot"><td colSpan={4}>STATUS</td>{block.columns.map((c) => <td key={c.date} className={c.outOfSpec > 0 ? 'fir-attention' : c.header ? 'fir-normal' : ''}>{c.header ? (c.outOfSpec > 0 ? 'Attention' : 'Normal') : '—'}</td>)}</tr>
                  <tr className="fir-foot"><td colSpan={4}>OUT OF SPEC</td>{block.columns.map((c) => <td key={c.date} className={c.outOfSpec > 0 ? 'fir-attention' : ''}>{c.header ? c.outOfSpec : '—'}</td>)}</tr>
                  <tr className="fir-foot"><td colSpan={4}>NOTES</td>{block.columns.map((c) => <td key={c.date}>—</td>)}</tr>
                  <tr className="fir-foot"><td colSpan={4}>PHOTOS</td>{block.columns.map((c) => <td key={c.date}>—</td>)}</tr>
                </tfoot>
              </table>
              <p className="fir-note">* Value outside specified range.</p>
            </div>
          ))}

          {signedImg && (
            <div className="fir-sign">
              <p className="fir-sign-l">Reviewed and approved by</p>
              <img src={signedImg} alt="signature" className="fir-sign-img" />
              <div className="fir-sign-line" />
              <p className="fir-sign-name">{signedName || 'Supervisor'}</p>
              <p className="fir-sign-date">Date: {signedAt && fmtFull(signedAt)}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
