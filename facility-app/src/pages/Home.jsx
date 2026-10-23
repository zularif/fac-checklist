import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'
import DailyFocus from '../components/DailyFocus'
import { useOffline } from '../context/OfflineContext'
import { localGet, localPut } from '../lib/localStore'
import { isAreaCached, cacheArea, removeAreaCache, cacheEverything, allCacheInfo } from '../lib/offlineCache'
import { periodStart, dueLabel } from '../lib/cycleHelpers'

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const todayLabel = () =>
  new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function areaIcon(cat) {
  if (cat === 'ACMV') return 'ti-air-conditioning'
  if (cat === 'Electrical') return 'ti-bolt'
  return 'ti-building-factory-2'
}

const FILTERS = ['All', 'Pending', 'Done', 'Offline']

export default function Home() {
  const { profile, session } = useAuth()
  const { items } = useOffline()
  const queued = items.filter(x=>x.state!=='synced').length
  const [loadError,setLoadError] = useState('')
  const navigate = useNavigate()
  const [areas, setAreas] = useState([])
  const [totals, setTotals] = useState({ total: 0, doneToday: 0, flaggedCount: 0 })
  const [dueByCycle, setDueByCycle] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [cacheState, setCacheState] = useState({})
  const [allCache, setAllCache] = useState(() => allCacheInfo())
  const [allStatus, setAllStatus] = useState('') // '', 'caching', progress text

  async function downloadEverything() {
    setAllStatus('Starting…')
    try {
      const res = await cacheEverything((p) => setAllStatus(p))
      setAllCache({ cachedAt: Date.now(), ...res })
      setAllStatus('')
    } catch {
      setAllStatus('failed')
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true)
      const homeKey = `home:${session?.user.id}`
      if (!navigator.onLine) {
        const cached = await localGet(homeKey)
        if(cached){setAreas(cached.areas);setTotals(cached.totals);setDueByCycle(cached.dueByCycle || [])}
        setLoadError('Offline — showing the last downloaded overview. Pending uploads are shown separately.');setLoading(false);return
      }
      let all = []
      let from = 0
      const pageSize = 1000
      while (true) {
        const { data, error } = await db
          .from('equipment')
          .select('id, equip_id, equipment_name, category, area_id, area:areas(area_name)')
          .eq('status', 'Active')
          .eq('inspection_cycle', 'Daily')
          .range(from, from + pageSize - 1)
        if (error || !data || data.length === 0) break
        all = all.concat(data)
        if (data.length < pageSize) break
        from += pageSize
      }

      const { data: done } = await db
        .from('inspection_headers')
        .select('equipment_id, status')
        .gte('inspection_date', startOfToday())
      const doneSet = new Set((done || []).map((d) => d.equipment_id))
      const flaggedCount = (done || []).filter((d) => d.status === 'Pending Sign-off').length

      const groups = {}
      for (const e of all) {
        const areaName = e.area?.area_name || 'Unassigned'
        const g = (groups[e.area_id] ||= { areaId: e.area_id, areaName, total: 0, done: 0, pending: [], cats: {} })
        g.total++
        if (e.category) g.cats[e.category] = (g.cats[e.category] || 0) + 1
        if (doneSet.has(e.id)) g.done++
        else g.pending.push(e)
      }

      const grouped = Object.values(groups)
        .map((g) => ({
          ...g,
          topCat: Object.entries(g.cats).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        }))
        .sort((a, b) => a.areaName.localeCompare(b.areaName))

      setAreas(grouped)
      const nextTotals = { total: all.length, doneToday: all.filter(e=>doneSet.has(e.id)).length, flaggedCount }
      setTotals(nextTotals)
      await localPut(homeKey,{areas:grouped,totals:nextTotals})

      // --- Non-daily cycles: what's due but not yet done this period ---
      const { data: nonDaily } = await db
        .from('equipment')
        .select('id, equip_id, equipment_name, inspection_cycle, area:areas(area_name)')
        .eq('status', 'Active')
        .neq('inspection_cycle', 'Daily')
      if (nonDaily && nonDaily.length) {
        // earliest period start across the cycles present, to bound the query
        const earliest = nonDaily.reduce((min, e) => {
          const ps = periodStart(e.inspection_cycle)
          return ps < min ? ps : min
        }, new Date())
        const { data: recentInsp } = await db
          .from('inspection_headers')
          .select('equipment_id, inspection_date')
          .gte('inspection_date', earliest.toISOString())
        const doneByEquip = {}
        for (const r of recentInsp || []) {
          const t = new Date(r.inspection_date)
          if (!doneByEquip[r.equipment_id] || t > doneByEquip[r.equipment_id]) doneByEquip[r.equipment_id] = t
        }
        // group still-due items by cycle
        const groups = {}
        for (const e of nonDaily) {
          const ps = periodStart(e.inspection_cycle)
          const last = doneByEquip[e.id]
          const doneThisPeriod = last && last >= ps
          if (!doneThisPeriod) {
            (groups[e.inspection_cycle] ||= { cycle: e.inspection_cycle, label: dueLabel(e.inspection_cycle), items: [] })
              .items.push(e)
          }
        }
        const order = ['Weekly', 'Bi-weekly', 'Monthly', 'Bi-monthly', 'Quarterly', 'Semi-annual', 'Yearly']
        setDueByCycle(Object.values(groups).sort((a, b) => order.indexOf(a.cycle) - order.indexOf(b.cycle)))
      } else {
        setDueByCycle([])
      }
      setLoading(false)
    }
    load().catch(e=>{setLoadError(e.message);setLoading(false)})
  }, [session?.user.id])

  useEffect(() => {
    const init = {}
    for (const a of areas) init[a.areaId] = isAreaCached(a.areaId) ? 'ready' : 'idle'
    setCacheState(init)
  }, [areas])

  async function toggleOffline(e, area) {
    e.stopPropagation()
    const areaId = area.areaId
    if (cacheState[areaId] === 'ready') {
      await removeAreaCache(areaId)
      setCacheState((s) => ({ ...s, [areaId]: 'idle' }))
      return
    }
    setCacheState((s) => ({ ...s, [areaId]: 'caching' }))
    try {
      await cacheArea(areaId, area.areaName)
      setCacheState((s) => ({ ...s, [areaId]: 'ready' }))
    } catch {
      setCacheState((s) => ({ ...s, [areaId]: 'error' }))
    }
  }

  const totalPending = totals.total - totals.doneToday
  const progressPct = totals.total ? Math.round((totals.doneToday / totals.total) * 100) : 0

  const visibleAreas = useMemo(() => {
    return areas.filter((a) => {
      if (filter === 'Pending' && a.pending.length === 0) return false
      if (filter === 'Done' && a.pending.length > 0) return false
      if (filter === 'Offline' && cacheState[a.areaId] !== 'ready') return false
      if (search && !a.areaName.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [areas, search, filter, cacheState])

  const scanBtn = (
    <button className="btn-primary" onClick={() => navigate('/scan')}>
      <i className="ti ti-qrcode" style={{ fontSize: 17 }} aria-hidden="true" />Scan equipment
    </button>
  )

  return (
    <>
      {/* phone: blue greeting band */}
      <div className="hero-band">
        <p className="greet">{greeting()} · {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
        <p className="name">{profile?.name || 'Technician'}</p>
      </div>

      <div className="screen pull-up">
        {/* desktop: compact header row */}
        <div className="page-head">
          <div>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-secondary)' }}>{greeting()}</p>
            <p style={{ margin: '1px 0 0', fontSize: 18, fontWeight: 600 }}>{profile?.name || 'Technician'}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>{todayLabel()}</p>
          </div>
          {scanBtn}
        </div>

        <DailyFocus />
        {loadError && <p role="status" className="work-notice">{loadError}</p>}
        {queued > 0 && (
          <div className="banner-warn">{queued} submission(s) waiting to sync — open Sync Centre to check delivery.</div>
        )}

        <div className="offline-all">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <i className={'ti ' + (allCache ? 'ti-circle-check' : 'ti-cloud-download')} style={{ fontSize: 18, color: allCache ? 'var(--success)' : 'var(--blue)', flexShrink: 0 }} aria-hidden="true" />
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600 }}>
                {allStatus && allStatus !== 'failed' ? allStatus
                  : allCache ? 'Everything saved for offline'
                  : 'Work anywhere, offline'}
              </p>
              <p style={{ margin: '1px 0 0', fontSize: 10.5, color: 'var(--text-secondary)' }}>
                {allStatus === 'failed' ? 'Download failed — try again with signal.'
                  : allCache ? `${allCache.equipmentCount ?? '—'} equipment · ${allCache.feCount ?? '—'} extinguishers · saved ${new Date(allCache.cachedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`
                  : 'Download all equipment & extinguishers so any QR scans offline.'}
              </p>
            </div>
          </div>
          <button className="btn-secondary" style={{ width: 'auto', margin: 0, padding: '8px 12px', flexShrink: 0 }} disabled={!!allStatus && allStatus !== 'failed'} onClick={downloadEverything}>
            {allStatus && allStatus !== 'failed' ? '…' : allCache ? 'Refresh' : 'Download'}
          </button>
        </div>

        <div className="stat-grid-4">
          <div className="stat-card">
            <div className="stat-ic" style={{ background: 'var(--blue-tint)', color: 'var(--blue)' }}><i className="ti ti-clipboard-list" aria-hidden="true" /></div>
            <div><p className="stat-val" style={{ color: 'var(--blue)' }}>{totalPending}</p><p className="stat-lbl">Due today</p></div>
          </div>
          <div className="stat-card">
            <div className="stat-ic" style={{ background: 'var(--success-tint)', color: 'var(--success)' }}><i className="ti ti-circle-check" aria-hidden="true" /></div>
            <div><p className="stat-val" style={{ color: 'var(--success)' }}>{totals.doneToday}</p><p className="stat-lbl">Submitted today</p></div>
          </div>
          <div className="stat-card">
            <div className="stat-ic" style={{ background: 'var(--warning-tint)', color: 'var(--warning)' }}><i className="ti ti-signature" aria-hidden="true" /></div>
            <div><p className="stat-val" style={{ color: 'var(--warning)' }}>{totals.flaggedCount}</p><p className="stat-lbl">Awaiting sign-off</p></div>
          </div>
          <div className="stat-card">
            <div className="stat-ic" style={{ background: '#f1f5f9', color: '#475569' }}><i className="ti ti-percentage" aria-hidden="true" /></div>
            <div><p className="stat-val">{progressPct}%</p><p className="stat-lbl">Today's progress</p></div>
          </div>
        </div>

        {/* phone: big scan button */}
        <div className="phone-only-block">{scanBtn}</div>

        {dueByCycle.length > 0 && (
          <div className="cycle-due-wrap">
            {dueByCycle.map((g) => (
              <div className="cycle-due" key={g.cycle}>
                <div className="cycle-due-head">
                  <i className="ti ti-calendar-repeat" aria-hidden="true" />
                  <span>{g.label}</span>
                  <span className="cycle-due-count">{g.items.length}</span>
                </div>
                <div className="cycle-due-items">
                  {g.items.map((e) => (
                    <button className="cycle-due-item" key={e.id} onClick={() => navigate(`/asset/equipment/${e.equip_id}`)}>
                      <span className="cycle-due-name">{e.equipment_name}</span>
                      <span className="cycle-due-area">{e.area?.area_name || ''}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px', gap: 10, flexWrap: 'wrap' }}>
          <p className="section-label" style={{ margin: 0 }}>
            Pending by area <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {areas.length} areas</span>
          </p>
          <input
            placeholder="Search area"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="area-search"
          />
        </div>

        <div className="chip-row">
          {FILTERS.map((f) => (
            <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>

        {loading ? (
          <p className="center-msg">Loading…</p>
        ) : visibleAreas.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
            {search || filter !== 'All' ? 'No areas match.' : 'All caught up today.'}
          </div>
        ) : (
          <div className="card-grid">
            {visibleAreas.map((a) => {
              const pending = a.pending.length
              const complete = pending === 0
              const pct = a.total ? Math.round((a.done / a.total) * 100) : 0
              const cs = cacheState[a.areaId] || 'idle'
              return (
                <div
                  className={'list-card' + (complete ? ' ok-border' : cs === 'ready' ? ' ok-border' : '')}
                  key={a.areaId}
                  role="link" tabIndex={0} onKeyDown={e=>{if(e.key==='Enter') navigate(`/area/${a.areaId}`)}}
                  onClick={() => navigate(`/area/${a.areaId}`)}
                >
                  <div className="list-card-head">
                    <div className="eq-ic" style={{ width: 28, height: 28, borderRadius: 7 }}>
                      <i className={'ti ' + areaIcon(a.topCat)} style={{ fontSize: 15 }} aria-hidden="true" />
                    </div>
                    <p className="list-card-title">{a.areaName}</p>
                    <button
                      className={'icon-action' + (cs === 'ready' ? ' on' : '')}
                      onClick={(e) => toggleOffline(e, a)}
                      title={cs === 'ready' ? 'Cached for offline — tap to remove' : 'Save this area for offline use'}
                      aria-label="Toggle offline cache"
                    >
                      {cs === 'caching'
                        ? <i className="ti ti-loader-2 spin" aria-hidden="true" />
                        : cs === 'ready'
                          ? <i className="ti ti-download-off" aria-hidden="true" />
                          : cs === 'error'
                            ? <i className="ti ti-alert-triangle" style={{ color: 'var(--danger)' }} aria-hidden="true" />
                            : <i className="ti ti-download" aria-hidden="true" />}
                    </button>
                  </div>

                  <div className="progress">
                    <span className={complete ? 'full' : ''} style={{ width: `${pct}%` }} />
                  </div>

                  <p className="list-card-meta">
                    <b>{a.done}</b>/{a.total} done
                    {!complete && <> · <span style={{ color: 'var(--warning)' }}>{pending} pending</span></>}
                    {complete && <span className="tag-inline"><i className="ti ti-check" style={{ fontSize: 10 }} aria-hidden="true" /> Complete</span>}
                    {cs === 'ready' && <span className="tag-inline"><i className="ti ti-circle-check" style={{ fontSize: 10 }} aria-hidden="true" /> Offline</span>}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
