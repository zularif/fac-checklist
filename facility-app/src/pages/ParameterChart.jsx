import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Area, ComposedChart,
} from 'recharts'
import { db } from '../lib/db'

function toISODate(d) { return d.toISOString().slice(0, 10) }

export default function ParameterChart() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedId = searchParams.get('equipId')
  const [requested,setRequested] = useState(null)
  const [plants, setPlants] = useState([])
  const [areas, setAreas] = useState([])
  const [equipment, setEquipment] = useState([])
  const [params, setParams] = useState([]) // numeric params for selected equipment
  const [plantId, setPlantId] = useState('')
  const [areaId, setAreaId] = useState('')
  const [equipmentId, setEquipmentId] = useState('')
  const [paramName, setParamName] = useState('')
  const today = new Date()
  const monthAgo = new Date(Date.now() - 29 * 86400000)
  const [dateFrom, setDateFrom] = useState(toISODate(monthAgo))
  const [dateTo, setDateTo] = useState(toISODate(today))
  const [chart, setChart] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    db.from('plants').select('*').order('plant_name').then(async ({ data }) => {
      setPlants(data || [])
      if(requestedId){const {data:eq}=await db.from('equipment').select('id,area_id,area:areas(plant_id)').eq('id',requestedId).single();if(eq){setRequested(eq);setPlantId(eq.area.plant_id);return}}
      if (data?.length) setPlantId(data[0].id)
    })
  }, [requestedId])

  useEffect(() => {
    if (!plantId) return
    db.from('areas').select('id, area_name').eq('plant_id', plantId).order('area_name').then(({ data }) => {
      setAreas(data || [])
      setAreaId(data?.some(a=>a.id===requested?.area_id)?requested.area_id:(data?.[0]?.id || ''))
    })
  }, [plantId, requested?.area_id])

  useEffect(() => {
    if (!areaId) { setEquipment([]); return }
    db.from('equipment').select('id, equip_id, equipment_name').eq('area_id', areaId).eq('status', 'Active').order('equip_id').then(({ data }) => {
      setEquipment(data || [])
      setEquipmentId(data?.some(e=>e.id===requestedId)?requestedId:(data?.[0]?.id || ''))
    })
  }, [areaId, requestedId])

  useEffect(() => {
    if (!equipmentId) { setParams([]); return }
    // only numeric parameters can be charted
    db.from('checklist_templates').select('parameter_name, unit, min_value, max_value, type')
      .eq('equipment_id', equipmentId).eq('type', 'numeric').order('sort_order').then(({ data }) => {
        setParams(data || [])
        setParamName(data?.[0]?.parameter_name || '')
      })
  }, [equipmentId])

  const selectedParam = params.find((p) => p.parameter_name === paramName)

  async function generate() {
    if (!equipmentId || !paramName) return
    setLoading(true)
    // get inspection headers for this equipment in range
    const { data: headers } = await db
      .from('inspection_headers')
      .select('id, inspection_date')
      .eq('equipment_id', equipmentId)
      .gte('inspection_date', dateFrom)
      .lte('inspection_date', dateTo + 'T23:59:59')
      .order('inspection_date')
    const headerIds = (headers || []).map((h) => h.id)
    const dateById = Object.fromEntries((headers || []).map((h) => [h.id, h.inspection_date]))

    let points = []
    if (headerIds.length) {
      const { data: details } = await db
        .from('inspection_details')
        .select('inspection_id, value')
        .in('inspection_id', headerIds)
        .eq('parameter_name', paramName)
      points = (details || [])
        .map((d) => ({ date: toISODate(new Date(dateById[d.inspection_id])), value: parseFloat(d.value) }))
        .filter((p) => !Number.isNaN(p.value))
        .sort((a, b) => a.date.localeCompare(b.date))
    }

    const vals = points.map((p) => p.value)
    const stats = vals.length
      ? {
          avg: (vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(2),
          min: Math.min(...vals),
          max: Math.max(...vals),
        }
      : null

    setChart({ points, stats, param: selectedParam, paramName })
    setLoading(false)
  }

  function exportCSV() {
    if (!chart?.points?.length) return
    const rows = [['Date', chart.paramName + (chart.param?.unit ? ` (${chart.param.unit})` : ''), 'Status']]
    for (const p of chart.points) {
      let status = 'Normal'
      if (chart.param?.min_value != null && p.value < chart.param.min_value) status = 'Below min'
      if (chart.param?.max_value != null && p.value > chart.param.max_value) status = 'Above max'
      rows.push([p.date, p.value, status])
    }
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${chart.paramName}-${dateFrom}-to-${dateTo}.csv`.replace(/\s+/g, '_')
    a.click()
    URL.revokeObjectURL(url)
  }

  const equipmentName = equipment.find((e) => e.id === equipmentId)?.equipment_name

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <p className="page-title">Parameter chart</p>
      <p className="page-sub">Trend a numeric parameter over time.</p>

      <div className="field"><label>Plant</label>
        <select value={plantId} onChange={(e) => setPlantId(e.target.value)}>
          {plants.map((p) => <option key={p.id} value={p.id}>{p.plant_name}</option>)}
        </select>
      </div>
      <div className="field"><label>Area</label>
        <select value={areaId} onChange={(e) => setAreaId(e.target.value)}>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}
        </select>
      </div>
      <div className="field"><label>Equipment</label>
        <select value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
          {equipment.map((e) => <option key={e.id} value={e.id}>{e.equipment_name} ({e.equip_id})</option>)}
        </select>
      </div>
      <div className="field"><label>Parameter (numeric only)</label>
        <select value={paramName} onChange={(e) => setParamName(e.target.value)}>
          {params.length === 0 && <option value="">No numeric parameters</option>}
          {params.map((p) => <option key={p.parameter_name} value={p.parameter_name}>{p.parameter_name}{p.unit ? ` (${p.unit})` : ''}</option>)}
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

      <button className="btn-primary" style={{ marginTop: 6 }} onClick={generate} disabled={loading || !paramName}>
        {loading ? 'Generating…' : 'Generate chart'}
      </button>

      {chart && (
        <div style={{ marginTop: 16 }}>
          <p className="report-title">{chart.paramName}{chart.param?.unit ? ` (${chart.param.unit})` : ''}</p>
          <p className="report-sub">{equipmentName} · {dateFrom} to {dateTo} · {chart.points.length} reading(s)</p>

          {chart.stats ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
                <span className="pill pill-blue">Avg: {chart.stats.avg}{chart.param?.unit ? ` ${chart.param.unit}` : ''}</span>
                <span className="pill pill-blue">Min: {chart.stats.min}</span>
                <span className="pill pill-blue">Max: {chart.stats.max}</span>
                {chart.param?.min_value != null && (
                  <span className="pill pill-warn">Spec: {chart.param.min_value}–{chart.param.max_value}</span>
                )}
              </div>

              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <ComposedChart data={chart.points} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" height={54} />
                    <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
                    <Tooltip />
                    <Area type="monotone" dataKey="value" fill="#1a56db" fillOpacity={0.08} stroke="none" />
                    {chart.param?.max_value != null && (
                      <ReferenceLine y={chart.param.max_value} stroke="#dc2626" strokeDasharray="5 5" label={{ value: `Max ${chart.param.max_value}`, position: 'right', fontSize: 10, fill: '#dc2626' }} />
                    )}
                    {chart.param?.min_value != null && (
                      <ReferenceLine y={chart.param.min_value} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: `Min ${chart.param.min_value}`, position: 'right', fontSize: 10, fill: '#f59e0b' }} />
                    )}
                    <Line type="monotone" dataKey="value" stroke="#1a56db" strokeWidth={2} dot={{ r: 3 }} name={chart.paramName} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <button className="btn-secondary" style={{ marginTop: 12 }} onClick={exportCSV}>
                <i className="ti ti-download" aria-hidden="true" />Export CSV
              </button>
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              No readings for this parameter in the selected date range.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
