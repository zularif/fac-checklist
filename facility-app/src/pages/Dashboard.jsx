import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isFlagged } from '../lib/inspectionModel'
import { db } from '../lib/db'

const FREQ_ORDER = ['Daily', 'Weekly', 'Bi-weekly', 'Monthly', 'Bi-monthly', 'Quarterly', 'Semi-annual', 'Yearly']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function weekOfMonth(date) {
  const d = new Date(date)
  return Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)
}

export default function Dashboard() {
  const now = new Date()
  const navigate = useNavigate()
  const [plants, setPlants] = useState([])
  const [plantId, setPlantId] = useState(null)
  const [freq, setFreq] = useState('Daily')
  const [availFreqs, setAvailFreqs] = useState(['Daily'])
  const [month, setMonth] = useState(now.getMonth()) // 0-11
  const [year, setYear] = useState(now.getFullYear())
  const [areas, setAreas] = useState([])
  const [headers, setHeaders] = useState([])
  const [equipToArea, setEquipToArea] = useState({})
  const [loading, setLoading] = useState(true)

  // month/year navigation only meaningful for Daily/Weekly
  const usesMonth = freq === 'Daily' || freq === 'Weekly' || freq === 'Bi-weekly'

  useEffect(() => {
    db.from('plants').select('*').then(({ data }) => {
      setPlants(data || [])
      if (data && data.length) setPlantId(data[0].id)
    })
  }, [])

  // Which frequencies actually exist (so we only show relevant tabs)
  useEffect(() => {
    db.from('equipment').select('inspection_cycle').eq('status', 'Active').then(({ data }) => {
      const set = new Set((data || []).map((e) => e.inspection_cycle).filter(Boolean))
      const ordered = FREQ_ORDER.filter((f) => set.has(f))
      setAvailFreqs(ordered.length ? ordered : ['Daily'])
      if (ordered.length && !ordered.includes(freq)) setFreq(ordered[0])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!plantId) return
    async function load() {
      setLoading(true)
      const { data: areaRows } = await db.from('areas').select('id, area_name').eq('plant_id', plantId)
      const areaIds = (areaRows || []).map((a) => a.id)
      if (!areaIds.length) { setAreas([]); setHeaders([]); setLoading(false); return }

      const { data: eq } = await db.from('equipment')
        .select('id, area_id').eq('inspection_cycle', freq).eq('status', 'Active').in('area_id', areaIds)
      const map = Object.fromEntries((eq || []).map((e) => [e.id, e.area_id]))
      setEquipToArea(map)
      const equipIds = (eq || []).map((e) => e.id)

      // Only show areas that actually have active equipment on this cycle —
      // otherwise a deleted/retired-out area lingers as a row of ✕ marks.
      const areasWithEquipment = new Set((eq || []).map((e) => e.area_id))
      setAreas((areaRows || []).filter((a) => areasWithEquipment.has(a.id)))

      // date window: month for daily/weekly, whole year otherwise
      const start = usesMonth ? new Date(year, month, 1) : new Date(year, 0, 1)
      const end = usesMonth ? new Date(year, month + 1, 1) : new Date(year + 1, 0, 1)

      const { data: hdr } = await db.from('inspection_headers')
        .select('id, equipment_id, inspection_date, status, details:inspection_details(computed_status)')
        .in('equipment_id', equipIds.length ? equipIds : ['00000000-0000-0000-0000-000000000000'])
        .gte('inspection_date', start.toISOString()).lt('inspection_date', end.toISOString())
      setHeaders(hdr || [])
      setLoading(false)
    }
    load()
  }, [plantId, freq, month, year, usesMonth])

  // Build the matrix: area -> period key -> done
  // required inspections per period for the "twice per period" cycles
  const requiredPer = freq === 'Bi-weekly' || freq === 'Bi-monthly' ? 2 : 1

  const { columns, matrix } = useMemo(() => {
    const m = {} // area -> colKey -> count of inspections
    for (const a of areas) m[a.id] = {}
    let cols = []

    const perAsset = {}
    const bump = (assetId, key) => {
      const areaId = equipToArea[assetId]
      if (!areaId || !m[areaId]) return
      const k = `${assetId}:${key}`
      perAsset[k] = (perAsset[k] || 0) + 1
      if(perAsset[k]<=requiredPer) m[areaId][key] = (m[areaId][key] || 0) + 1
    }

    if (freq === 'Daily') {
      const days = new Date(year, month + 1, 0).getDate()
      cols = Array.from({ length: days }, (_, i) => ({ key: i + 1, label: String(i + 1) }))
      for (const h of headers) bump(h.equipment_id, new Date(h.inspection_date).getDate())
    } else if (freq === 'Weekly' || freq === 'Bi-weekly') {
      cols = [1, 2, 3, 4, 5].map((w) => ({ key: w, label: 'W' + w }))
      for (const h of headers) bump(h.equipment_id, weekOfMonth(h.inspection_date))
    } else if (freq === 'Monthly' || freq === 'Bi-monthly') {
      cols = MONTHS.map((mm, i) => ({ key: i, label: mm }))
      for (const h of headers) bump(h.equipment_id, new Date(h.inspection_date).getMonth())
    } else if (freq === 'Quarterly') {
      cols = [0, 1, 2, 3].map((q) => ({ key: q, label: 'Q' + (q + 1) }))
      for (const h of headers) bump(h.equipment_id, Math.floor(new Date(h.inspection_date).getMonth() / 3))
    } else if (freq === 'Semi-annual') {
      cols = [{ key: 0, label: 'H1' }, { key: 1, label: 'H2' }]
      for (const h of headers) bump(h.equipment_id, new Date(h.inspection_date).getMonth() < 6 ? 0 : 1)
    } else if (freq === 'Yearly') {
      cols = [{ key: year, label: String(year) }]
      for (const h of headers) bump(h.equipment_id, year)
    }
    return { columns: cols, matrix: m }
  }, [freq, headers, areas, equipToArea, month, year, requiredPer])

  function isFuture(colKey) {
    const thisYear = now.getFullYear()
    if (freq === 'Daily') return new Date(year, month, colKey) > now
    if (freq === 'Weekly' || freq === 'Bi-weekly') return year > thisYear || (year === thisYear && month > now.getMonth()) || (year === thisYear && month === now.getMonth() && colKey > weekOfMonth(now))
    if (freq === 'Monthly' || freq === 'Bi-monthly') return year > thisYear || (year === thisYear && colKey > now.getMonth())
    if (freq === 'Quarterly') return year > thisYear || (year === thisYear && colKey > Math.floor(now.getMonth() / 3))
    if (freq === 'Semi-annual') return year > thisYear || (year === thisYear && colKey > (now.getMonth() < 6 ? 0 : 1))
    if (freq === 'Yearly') return colKey > thisYear
    return false
  }

  // returns { state: 'ok'|'partial'|'missed'|'upcoming', text }
  function cellInfo(areaId, colKey) {
    const count = matrix[areaId]?.[colKey] || 0
    const future = isFuture(colKey)
    const target = Object.values(equipToArea).filter(id=>id===areaId).length * requiredPer
    const text = `${count}/${target}`
    if (target && count >= target) return {state:'ok',text}
    if (count > 0) return {state:'partial',text}
    return future ? {state:'upcoming',text:'—'} : {state:'missed',text}

  }

  const years = []
  for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 3; y--) years.push(y)

  function stepMonth(delta) {
    let m2 = month + delta, y2 = year
    if (m2 < 0) { m2 = 11; y2-- }
    if (m2 > 11) { m2 = 0; y2++ }
    setMonth(m2); setYear(y2)
  }

  return (
    <div className="screen">
      <p className="page-title">Tracker</p>
      <p className="page-sub">Inspection coverage by area. A submission does not mean the readings passed.</p>
      <div className="work-metrics"><div><strong>{headers.length}</strong><span>Submitted in selected period</span></div><div><strong>{headers.filter(h=>h.status==='Signed').length}</strong><span>Approved</span></div><div><strong>{headers.filter(h=>h.status==='Pending Sign-off').length}</strong><span>Awaiting approval</span></div><div><strong>{headers.filter(h=>h.details?.some(d=>isFlagged(d.computed_status))).length}</strong><span>With flagged readings</span></div></div>

      {/* Frequency tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {availFreqs.map((f) => (
          <button key={f} className={freq === f ? 'seg active' : 'seg'} onClick={() => setFreq(f)}>{f}</button>
        ))}
      </div>

      {/* Period navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {usesMonth && (
          <>
            <button className="seg" onClick={() => stepMonth(-1)} aria-label="Previous month">◀</button>
            <span style={{ fontSize: 13, fontWeight: 500, minWidth: 90, textAlign: 'center' }}>{MONTHS[month]} {year}</span>
            <button className="seg" onClick={() => stepMonth(1)} aria-label="Next month">▶</button>
          </>
        )}
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="year-select">
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Plant filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {plants.map((p) => (
          <button key={p.id} className={plantId === p.id ? 'seg active' : 'seg'} onClick={() => setPlantId(p.id)}>{p.plant_name}</button>
        ))}
      </div>

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : areas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No areas for this plant.</div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th className="sticky-col">Area</th>
                  {columns.map((c) => <th key={c.key}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {areas.map((a) => (
                  <tr key={a.id}>
                    <td className="sticky-col">
                      <button className="area-link" onClick={() => navigate(`/area/${a.id}`)}>{a.area_name}</button>
                    </td>
                    {columns.map((c) => {
                      const info = cellInfo(a.id, c.key)
                      const cls = info.state === 'ok' ? 'cell-ok'
                        : info.state === 'partial' ? 'cell-partial'
                        : info.state === 'upcoming' ? 'cell-upcoming' : 'cell-missed'
                      return <td key={c.key} className={cls}>{info.text}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="legend">
            <span><span className="cell-ok">✓</span> done</span>
            {requiredPer > 1 && <span><span className="cell-partial">1/2</span> partial</span>}
            <span><span className="cell-missed">✕</span> missed</span>
            <span>— upcoming</span>
          </div>
        </>
      )}
    </div>
  )
}
