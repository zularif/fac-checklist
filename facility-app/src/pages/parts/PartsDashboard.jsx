import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { loadParts, stockOf, isLow, totalQty, partPath, STORES } from '../../lib/parts'

const NO_CAT = 'Uncategorised'
const DAYS = 30
const catOf = (p) => (p.category || '').trim() || NO_CAT
const catLink = (c) => `/parts?category=${encodeURIComponent(c)}`

// Spare parts dashboard: stock health, per-category breakdown, what needs
// re-ordering, and what has been moving lately. Computed on the device from
// the same data as the parts list (no database change needed).
export default function PartsDashboard() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [parts, setParts] = useState([])
  const [moves, setMoves] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      const since = new Date(Date.now() - DAYS * 864e5).toISOString()
      const [p, m] = await Promise.all([
        loadParts(),
        db.from('stock_movements').select('id,kind,store,change,created_at,reason,part:parts(part_code,part_name,unit)').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
      ])
      setParts(p)
      setMoves(m.data || [])
      setError(null)
    } catch (e) { setError(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const stats = useMemo(() => {
    const lowOf = (p) => STORES.some((s) => isLow(stockOf(p, s)))
    const outOf = (p) => STORES.some((s) => { const x = stockOf(p, s); return x.min_qty > 0 && x.quantity === 0 })
    const cats = new Map()
    for (const p of parts) {
      const c = catOf(p)
      const row = cats.get(c) || { name: c, parts: 0, units: 0, low: 0 }
      row.parts += 1; row.units += totalQty(p); if (lowOf(p)) row.low += 1
      cats.set(c, row)
    }
    const used = new Map()
    for (const m of moves) {
      if (m.kind !== 'out' || !m.part) continue
      const k = m.part.part_code
      const u = used.get(k) || { ...m.part, qty: 0 }
      u.qty += Math.abs(m.change); used.set(k, u)
    }
    const lowList = parts.filter(lowOf).map((p) => ({ p, out: outOf(p) }))
      .sort((a, b) => Number(b.out) - Number(a.out) || a.p.part_name.localeCompare(b.p.part_name))
    return {
      total: parts.length,
      units: parts.reduce((n, p) => n + totalQty(p), 0),
      low: lowList.length,
      out: lowList.filter((x) => x.out).length,
      noMin: parts.filter((p) => STORES.every((s) => !(stockOf(p, s).min_qty > 0))).length,
      cats: [...cats.values()].sort((a, b) => b.low - a.low || b.parts - a.parts),
      lowList,
      top: [...used.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
      recent: moves.slice(0, 8),
    }
  }, [parts, moves])

  async function renameCategory(from) {
    const to = window.prompt(`Rename or merge category "${from}" into (type an existing name to merge):`, from === NO_CAT ? '' : from)
    if (to == null) return
    const name = to.trim()
    if (!name || name === from) return
    setBusy(true); setMsg('')
    const q = db.from('parts').update({ category: name })
    const { error: e } = await (from === NO_CAT ? q.is('category', null) : q.eq('category', from))
    setBusy(false)
    if (e) { setMsg(e.message); return }
    setMsg(`"${from}" is now "${name}".`)
    load()
  }

  const needsUpdate = error && (error.code === 'DB_UPDATE' || /no such table|does not exist/i.test(error.message))
  const max = Math.max(1, ...stats.cats.map((c) => c.parts))

  return (
    <div className="screen">
      <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
      <p className="page-title">Spare parts dashboard</p>
      <p className="page-sub">Stock across P1 and P2 · movements for the last {DAYS} days</p>

      {needsUpdate ? <div className="banner-warn">The spare parts tables are not in the database yet.</div>
        : error ? <div className="banner-danger" role="alert">{error.message}</div> : null}
      {msg && <div className="banner-warn" role="status">{msg}</div>}

      {loading ? <p className="center-msg">Loading dashboard…</p> : (
        <>
          <div className="work-metrics">
            <Link to="/parts" className="dash-tile"><strong>{stats.total}</strong><span>Active parts</span></Link>
            <div className="dash-tile"><strong>{stats.units}</strong><span>Units in stock</span></div>
            <Link to="/parts?view=Low+stock" className="dash-tile"><strong style={stats.low ? { color: 'var(--danger, #b42318)' } : undefined}>{stats.low}</strong><span>Low stock</span></Link>
            <div className="dash-tile"><strong>{stats.out}</strong><span>Out of stock</span></div>
          </div>
          {stats.noMin > 0 && <p className="page-sub">{stats.noMin} part{stats.noMin === 1 ? ' has' : 's have'} no minimum stock set, so no low-stock alert.</p>}

          <div className="work-panel">
            <h2>Needs re-ordering</h2>
            {stats.lowList.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>All parts are above their minimum. 👍</p> : (
              <div className="parts-list">
                {stats.lowList.slice(0, 10).map(({ p, out }) => (
                  <Link className="part-row" key={p.id} to={partPath(p.part_code)}>
                    <div className="part-main">
                      <p className="part-name">{p.part_name}</p>
                      <p className="part-sub">{p.part_code} · {catOf(p)}</p>
                    </div>
                    <div className="part-qtys">
                      {STORES.map((st) => {
                        const s = stockOf(p, st)
                        return <span key={st} className={'part-qty' + (isLow(s) ? (s.quantity === 0 ? ' zero' : ' low') : '')} title={`${st}: ${s.quantity} (min ${s.min_qty})`}><small>{st}</small><b>{s.quantity}</b></span>
                      })}
                    </div>
                    {out && <span className="pill pill-danger">Out</span>}
                  </Link>
                ))}
              </div>
            )}
            {stats.lowList.length > 10 && <p style={{ margin: '10px 0 0' }}><Link to="/parts?view=Low+stock">See all {stats.lowList.length} →</Link></p>}
          </div>

          <div className="work-panel">
            <h2>By category</h2>
            {stats.cats.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No parts yet.</p> : stats.cats.map((c) => (
              <div key={c.name} className="dash-cat">
                <div className="dash-cat-head">
                  <Link to={catLink(c.name)}><b>{c.name}</b></Link>
                  <span>{c.parts} parts · {c.units} units{c.low > 0 && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{c.low} low</span>}</span>
                  {isAdmin && <button className="btn-secondary" style={{ width: 'auto', padding: '2px 10px' }} disabled={busy} onClick={() => renameCategory(c.name)} aria-label={`Rename ${c.name}`}><i className="ti ti-pencil" aria-hidden="true" /></button>}
                </div>
                <div className="dash-bar"><i style={{ width: `${(c.parts / max) * 100}%` }} /></div>
              </div>
            ))}
          </div>

          <div className="work-panel">
            <h2>Most used (last {DAYS} days)</h2>
            {stats.top.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No parts taken out yet.</p> : (
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {stats.top.map((u) => <li key={u.part_code}><Link to={partPath(u.part_code)}>{u.part_name}</Link> — {u.qty} {u.unit}</li>)}
              </ol>
            )}
          </div>

          <div className="work-panel">
            <h2>Recent movements</h2>
            {stats.recent.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No movements in the last {DAYS} days.</p> : stats.recent.map((m) => (
              <p key={m.id} className="page-sub" style={{ margin: '0 0 6px' }}>
                {new Date(m.created_at).toLocaleDateString()} · <b>{m.change > 0 ? '+' : ''}{m.change}</b> {m.part?.unit} · {m.part ? <Link to={partPath(m.part.part_code)}>{m.part.part_name}</Link> : 'part'} ({m.store}, {m.kind})
              </p>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
