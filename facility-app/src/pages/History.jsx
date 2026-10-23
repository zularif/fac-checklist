import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { isFlagged } from '../lib/inspectionModel'
import { db } from '../lib/db'

const PAGE = 40

function fmt(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function History() {
  const [mode, setMode] = useState('equipment') // 'equipment' | 'fe'
  const [rows, setRows] = useState([])
  const [techs, setTechs] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)

  // filters
  const [search, setSearch] = useState('')
  const [techFilter, setTechFilter] = useState('All')
  const [areaFilter, setAreaFilter] = useState('All')
  const [resultFilter, setResultFilter] = useState('All') // All | Pass | Flagged
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  useEffect(() => {
    (async () => {
      const [{ data: tc }, { data: ar }] = await Promise.all([
        db.from('technicians').select('id, name').order('name'),
        db.from('areas').select('id, area_name').order('area_name'),
      ])
      setTechs(tc || [])
      setAreas(ar || [])
    })()
  }, [])

  async function fetchPage(reset) {
    const p = reset ? 0 : page
    reset ? setLoading(true) : setLoadingMore(true)

    if (mode === 'equipment') {
      let q = db
        .from('inspection_headers')
        .select('id, inspection_date, submitted_at, is_backdated, status, technician:technicians(id,name), equipment:equipment(equipment_name, area_id, area:areas(area_name)), details:inspection_details(computed_status)')
        .order('inspection_date', { ascending: false })
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (techFilter !== 'All') q = q.eq('technician_id', techFilter)
      if (from) q = q.gte('inspection_date', from)
      if (to) q = q.lte('inspection_date', to + 'T23:59:59')
      const { data } = await q
      const mapped = (data || []).map((r) => {
        const flagged = (r.details || []).some((d) => isFlagged(d.computed_status))
        return {
          id: r.id,
          status: r.status,
          name: r.equipment?.equipment_name || '—',
          area: r.equipment?.area?.area_name || '',
          area_id: r.equipment?.area_id,
          date: r.inspection_date,
          tech: r.technician?.name || '—',
          flagged,
          backdated: r.is_backdated,
        }
      })
      applyRows(mapped, reset, p)
    } else {
      let q = db
        .from('fe_inspections')
        .select('id, inspection_date, status, technician:technicians(id,name), fe:fire_extinguishers(fe_code, location_desc, floor:fe_floors(building, floor_name)), details:fe_inspection_details(computed_status)')
        .order('inspection_date', { ascending: false })
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (techFilter !== 'All') q = q.eq('technician_id', techFilter)
      if (from) q = q.gte('inspection_date', from)
      if (to) q = q.lte('inspection_date', to + 'T23:59:59')
      const { data } = await q
      const mapped = (data || []).map((r) => {
        const flagged = (r.details || []).some((d) => isFlagged(d.computed_status))
        return {
          id: r.id,
          status: r.status,
          name: r.fe?.fe_code || '—',
          area: r.fe?.floor ? `${r.fe.floor.building} · ${r.fe.floor.floor_name}` : (r.fe?.location_desc || ''),
          area_id: null,
          date: r.inspection_date,
          tech: r.technician?.name || '—',
          flagged,
          backdated: false,
        }
      })
      applyRows(mapped, reset, p)
    }
  }

  function applyRows(mapped, reset, p) {
    setHasMore(mapped.length === PAGE)
    setRows((prev) => (reset ? mapped : [...prev, ...mapped]))
    setPage(reset ? 1 : p + 1)
    setLoading(false)
    setLoadingMore(false)
  }

  // reload when mode or server-side filters change
  useEffect(() => { fetchPage(true) /* eslint-disable-next-line */ }, [mode, techFilter, from, to])

  // client-side filters (search, area, result) on what's loaded
  const visible = useMemo(() => rows.filter((r) => {
    if (areaFilter !== 'All' && r.area_id !== areaFilter) return false
    if (resultFilter === 'Pass' && r.flagged) return false
    if (resultFilter === 'Flagged' && !r.flagged) return false
    if (search && !r.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [rows, areaFilter, resultFilter, search])

  return (
    <div className="screen">
      <p className="page-title">History</p>
      <p className="page-sub">A record of inspections done — who, when, and the result.</p>

      {/* mode toggle */}
      <div className="seg-tabs" style={{ margin: '4px 0 12px' }}>
        <button className={'seg-tab' + (mode === 'equipment' ? ' active' : '')} onClick={() => setMode('equipment')}>
          <i className="ti ti-tools" aria-hidden="true" />Equipment
        </button>
        <button className={'seg-tab' + (mode === 'fe' ? ' active' : '')} onClick={() => setMode('fe')}>
          <i className="ti ti-fire-extinguisher" aria-hidden="true" />Fire extinguishers
        </button>
      </div>

      {/* filters */}
      <input placeholder={mode === 'equipment' ? 'Search equipment name' : 'Search FE code'} value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8, maxWidth: 420 }} />
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 150px', marginBottom: 8 }}>
          <label>Technician</label>
          <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)}>
            <option value="All">All</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {mode === 'equipment' && (
          <div className="field" style={{ flex: '1 1 150px', marginBottom: 8 }}>
            <label>Area</label>
            <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>
              <option value="All">All</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.area_name}</option>)}
            </select>
          </div>
        )}
        <div className="field" style={{ flex: '1 1 110px', marginBottom: 8 }}>
          <label>Result</label>
          <select value={resultFilter} onChange={(e) => setResultFilter(e.target.value)}>
            <option value="All">All</option>
            <option value="Pass">Pass only</option>
            <option value="Flagged">Flagged only</option>
          </select>
        </div>
      </div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 130px', marginBottom: 8 }}>
          <label>From date</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '1 1 130px', marginBottom: 8 }}>
          <label>To date</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No inspections match.</div>
      ) : (
        <>
          <div className="hist-list">
            {visible.map((r) => (
              <div className="hist-row" key={r.id}>
                <div className={'hist-dot ' + (r.flagged ? 'bad' : 'ok')} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p className="hist-name"><Link to={`/inspection/${mode}/${r.id}`}>{r.name}</Link>{r.backdated && <span className="hist-back"><i className="ti ti-history" aria-hidden="true" /> late</span>}</p>
                  <p className="hist-meta">{r.area}{r.area ? ' · ' : ''}{r.tech}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p className="hist-date">{fmt(r.date)}</p>
                  <span className={'pill ' + (r.flagged ? 'pill-danger' : 'pill-ok')}>{r.flagged ? 'Flagged' : 'No flagged readings'}</span><p>{r.status}</p>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <button className="btn-secondary" style={{ marginTop: 12 }} disabled={loadingMore} onClick={() => fetchPage(false)}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
