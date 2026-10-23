import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { expiryState, daysToExpiry } from '../../lib/feHelpers'

const FILTERS = ['All', 'Expiring', 'Expired', 'No date']

function fmt(d) {
  if (!d) return 'No date'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function FEList() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [units, setUnits] = useState([])
  const [floors, setFloors] = useState([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [msg, setMsg] = useState('')

  // date / plant / floor filters
  const [dateFilter, setDateFilter] = useState('All')
  const [plantFilter, setPlantFilter] = useState('All')
  const [floorFilter, setFloorFilter] = useState('All')

  // batch renewal selection
  const [selected, setSelected] = useState(new Set())
  const [newDate, setNewDate] = useState('')
  const [renewing, setRenewing] = useState(false)

  async function load() {
    setLoading(true)
    const { data: fl } = await db.from('fe_floors').select('id, building, floor_name')
    setFloors(fl || [])
    const { data } = await db
      .from('fire_extinguishers')
      .select('id, fe_code, fe_type, serial_no, location_desc, expiry_date, floor_id, status')
      .eq('status', 'Active')
      .order('fe_code')
    setUnits(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const floorInfo = useMemo(() => {
    const m = {}
    for (const f of floors) m[f.id] = { building: f.building, name: f.floor_name, label: `${f.building} · ${f.floor_name}` }
    return m
  }, [floors])

  const plants = useMemo(() => [...new Set(floors.map((f) => f.building))].sort(), [floors])
  const floorsOfPlant = useMemo(
    () => (plantFilter === 'All' ? floors : floors.filter((f) => f.building === plantFilter)),
    [floors, plantFilter]
  )

  // distinct expiry dates with counts (for the date dropdown)
  const dateOptions = useMemo(() => {
    const counts = {}
    for (const u of units) {
      const key = u.expiry_date || '__none__'
      counts[key] = (counts[key] || 0) + 1
    }
    const withDates = Object.entries(counts)
      .filter(([k]) => k !== '__none__')
      .sort((a, b) => a[0].localeCompare(b[0]))
    return { withDates, noneCount: counts['__none__'] || 0 }
  }, [units])

  const visible = useMemo(() => {
    return units.filter((u) => {
      const st = expiryState(u.expiry_date)
      if (filter === 'Expiring' && st !== 'expiring') return false
      if (filter === 'Expired' && st !== 'expired') return false
      if (filter === 'No date' && u.expiry_date) return false

      if (dateFilter === '__none__' && u.expiry_date) return false
      if (dateFilter !== 'All' && dateFilter !== '__none__' && u.expiry_date !== dateFilter) return false

      const info = floorInfo[u.floor_id]
      if (plantFilter !== 'All' && info?.building !== plantFilter) return false
      if (floorFilter !== 'All' && u.floor_id !== floorFilter) return false

      if (search) {
        const s = search.toLowerCase()
        return u.fe_code?.toLowerCase().includes(s) || u.location_desc?.toLowerCase().includes(s) || u.serial_no?.toLowerCase().includes(s)
      }
      return true
    })
  }, [units, search, filter, dateFilter, plantFilter, floorFilter, floorInfo])

  // when a specific date is chosen, auto-select all visible (renew-most is the
  // common case, so you untick the exceptions rather than tick everything)
  useEffect(() => {
    if (dateFilter !== 'All' && dateFilter !== '__none__') {
      setSelected(new Set(visible.map((u) => u.id)))
    } else {
      setSelected(new Set())
    }
    setNewDate('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter, plantFilter, floorFilter])

  async function saveExpiry(id, value) {
    setSavingId(id)
    const { error } = await db
      .from('fire_extinguishers')
      .update({ expiry_date: value || null })
      .eq('id', id)
    if (error) setMsg(`Couldn't save: ${error.message}`)
    else {
      setMsg('')
      setUnits((prev) => prev.map((u) => (u.id === id ? { ...u, expiry_date: value || null } : u)))
    }
    setSavingId(null)
  }

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function selectAllVisible() {
    setSelected(new Set(visible.map((u) => u.id)))
  }
  function clearSelection() {
    setSelected(new Set())
  }

  const selectedVisibleCount = visible.filter((u) => selected.has(u.id)).length

  // Export the currently-filtered FE list to a file Excel opens natively.
  function exportExcel() {
    const rows = visible.map((u) => {
      const info = floorInfo[u.floor_id] || {}
      const st = expiryState(u.expiry_date)
      const statusLabel = st === 'expired' ? 'Expired' : st === 'soon' ? 'Expiring soon' : u.expiry_date ? 'OK' : 'No date'
      return {
        Plant: info.building || '',
        Floor: info.name || '',
        'FE ID': u.fe_code || '',
        Type: u.fe_type || '',
        Location: u.location_desc || '',
        'Serial Number': u.serial_no || '',
        'Expiry Date': u.expiry_date || '',
        Status: statusLabel,
      }
    })
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n')
    // BOM so Excel reads UTF-8 correctly
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = new Date().toISOString().slice(0, 10)
    a.href = url; a.download = `fire-extinguishers-${stamp}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  async function renewSelected() {
    if (!newDate || selectedVisibleCount === 0) return
    setRenewing(true)
    setMsg('')
    const ids = visible.filter((u) => selected.has(u.id)).map((u) => u.id)
    const { error } = await db
      .from('fire_extinguishers')
      .update({ expiry_date: newDate })
      .in('id', ids)
    if (error) {
      setMsg(`Couldn't renew: ${error.message}`)
    } else {
      setUnits((prev) => prev.map((u) => (ids.includes(u.id) ? { ...u, expiry_date: newDate } : u)))
      setMsg(`Renewed ${ids.length} extinguisher(s) to ${fmt(newDate)}.`)
      setSelected(new Set())
      setNewDate('')
      setDateFilter('All')
    }
    setRenewing(false)
  }

  const counts = useMemo(() => ({
    expiring: units.filter((u) => expiryState(u.expiry_date) === 'expiring').length,
    expired: units.filter((u) => expiryState(u.expiry_date) === 'expired').length,
    noDate: units.filter((u) => !u.expiry_date).length,
  }), [units])

  const selecting = dateFilter !== 'All' && dateFilter !== '__none__' && isAdmin

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/fe')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back to map
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p className="page-title">Extinguisher list</p>
          <p className="page-sub" style={{ margin: 0 }}>{units.length} active · {counts.expiring} expiring · {counts.expired} expired · {counts.noDate} without a date</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" style={{ width: 'auto', padding: '9px 14px' }} onClick={exportExcel} title="Export the filtered list to Excel">
            <i className="ti ti-file-spreadsheet" aria-hidden="true" />Export Excel
          </button>
          {isAdmin && (
            <button className="btn-primary" style={{ width: 'auto', padding: '9px 14px' }} onClick={() => navigate('/fe/expiry-bulk')}>
              <i className="ti ti-calendar-plus" aria-hidden="true" />Bulk edit dates
            </button>
          )}
        </div>
      </div>

      {msg && <div className={msg.startsWith('Renewed') ? 'banner-ok' : 'banner-warn'} style={{ marginTop: 10 }}>{msg}</div>}

      <input placeholder="Search code, serial, or location" value={search} onChange={(e) => setSearch(e.target.value)} style={{ margin: '10px 0 8px', maxWidth: 420 }} />

      <div className="chip-row">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {/* date / plant / floor filters */}
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 180px', marginBottom: 8 }}>
          <label>Expiry date</label>
          <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}>
            <option value="All">All dates</option>
            {dateOptions.withDates.map(([d, n]) => (
              <option key={d} value={d}>{fmt(d)} — {n} unit(s)</option>
            ))}
            {dateOptions.noneCount > 0 && <option value="__none__">No date — {dateOptions.noneCount} unit(s)</option>}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 120px', marginBottom: 8 }}>
          <label>Plant</label>
          <select value={plantFilter} onChange={(e) => { setPlantFilter(e.target.value); setFloorFilter('All') }}>
            <option value="All">All</option>
            {plants.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 140px', marginBottom: 8 }}>
          <label>Floor</label>
          <select value={floorFilter} onChange={(e) => setFloorFilter(e.target.value)}>
            <option value="All">All floors</option>
            {floorsOfPlant.map((f) => <option key={f.id} value={f.id}>{f.building} · {f.floor_name}</option>)}
          </select>
        </div>
      </div>

      {/* selection controls appear when a specific date is chosen */}
      {selecting && (
        <div className="banner-warn" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>{selectedVisibleCount} of {visible.length} selected for renewal</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="chip" onClick={selectAllVisible}>Select all</button>
            <button className="chip" onClick={clearSelection}>Clear</button>
          </span>
        </div>
      )}

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : visible.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Nothing matches.</div>
      ) : (
        <div className="card-grid">
          {visible.map((u) => {
            const st = expiryState(u.expiry_date)
            const days = daysToExpiry(u.expiry_date)
            const border = st === 'expired' ? ' bad-border' : st === 'expiring' ? ' warn-border' : ''
            const isSel = selected.has(u.id)
            return (
              <div className={'list-card' + border + (selecting && isSel ? ' ok-border' : '')} key={u.id} style={{ cursor: selecting ? 'pointer' : 'default' }} onClick={selecting ? () => toggle(u.id) : undefined}>
                <div className="list-card-head">
                  {selecting && (
                    <input type="checkbox" style={{ width: 'auto' }} checked={isSel} onChange={() => toggle(u.id)} onClick={(e) => e.stopPropagation()} />
                  )}
                  <div className="eq-ic" style={{ width: 28, height: 28, borderRadius: 7 }}>
                    <i className="ti ti-fire-extinguisher" style={{ fontSize: 15 }} aria-hidden="true" />
                  </div>
                  <p className="list-card-title">{u.fe_code}</p>
                  {st === 'expired' && <span className="pill pill-danger">Expired</span>}
                  {st === 'expiring' && <span className="pill pill-warn">{days}d left</span>}
                  {st === 'ok' && <span className="pill pill-ok">Valid</span>}
                  {st === 'none' && <span className="pill pill-blue">No date</span>}
                </div>
                <p className="list-card-meta">{u.fe_type}{u.location_desc ? ` · ${u.location_desc}` : ''}</p>
                {u.serial_no && <p className="list-card-meta" style={{ marginTop: 2 }}>S/N: {u.serial_no}</p>}
                <p className="list-card-meta" style={{ marginTop: 2 }}>{floorInfo[u.floor_id]?.label || 'No floor'}</p>

                {!selecting && (
                  <>
                    <div className="field" style={{ marginTop: 9, marginBottom: 0, maxWidth: 'none' }}>
                      <label>Expiry date</label>
                      <input
                        type="date"
                        value={u.expiry_date || ''}
                        disabled={!isAdmin || savingId === u.id}
                        onChange={(e) => saveExpiry(u.id, e.target.value)}
                      />
                    </div>
                    <div className="list-card-actions">
                      <button className="btn-secondary" onClick={() => navigate(`/fe/checklist/${u.fe_code}`)}>
                        <i className="ti ti-clipboard-check" aria-hidden="true" />Inspect
                      </button>
                    </div>
                  </>
                )}
                {selecting && (
                  <p className="list-card-meta" style={{ marginTop: 6 }}>Current expiry: {fmt(u.expiry_date)}</p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* renew-selected action bar */}
      {selecting && selectedVisibleCount > 0 && (
        <div className="bulk-savebar" style={{ flexWrap: 'wrap' }}>
          <span>{selectedVisibleCount} selected</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={{ width: 160, margin: 0 }} placeholder="New date" />
            <button className="btn-primary" style={{ width: 'auto', margin: 0 }} disabled={renewing || !newDate} onClick={renewSelected}>
              {renewing ? 'Renewing…' : `Renew ${selectedVisibleCount}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
