import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { loadParts, stockOf, isLow, partPath, STORES, categoryColor } from '../../lib/parts'

const NO_CAT = 'Uncategorised'
const DAYS = 30
const catOf = (p) => (p.category || '').trim() || NO_CAT
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
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
  const [metric, setMetric] = useState('parts')
  const [store, setStore] = useState('All') // All | P1 | P2

  async function load() {
    try {
      const since = new Date(Date.now() - DAYS * 864e5).toISOString()
      const [p, m] = await Promise.all([
        loadParts(),
        db.from('stock_movements').select('id,kind,store,change,created_at,reason,part:parts(part_code,part_name,unit),equipment:equipment(equip_id,equipment_name),technician:technicians(name)').gte('created_at', since).order('created_at', { ascending: false }).limit(500),
      ])
      setParts(p)
      setMoves(m.data || [])
      setError(null)
    } catch (e) { setError(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const stats = useMemo(() => {
    const st = store === 'All' ? STORES : [store]
    const qtyOf = (p) => st.reduce((n, x) => n + stockOf(p, x).quantity, 0)
    const lowOf = (p) => st.some((x) => isLow(stockOf(p, x)))
    const outOf = (p) => st.some((x) => { const y = stockOf(p, x); return y.min_qty > 0 && y.quantity === 0 })
    const cats = new Map()
    for (const p of parts) {
      const c = catOf(p)
      const row = cats.get(c) || { name: c, parts: 0, units: 0, low: 0 }
      row.parts += 1; row.units += qtyOf(p); if (lowOf(p)) row.low += 1
      cats.set(c, row)
    }
    const mv = store === 'All' ? moves : moves.filter((m) => m.store === store)
    const outs = mv.filter((m) => m.kind === 'out')
    const tally = (keyFn, labelFn) => {
      const t = new Map()
      for (const m of outs) {
        const k = keyFn(m); if (!k) continue
        const u = t.get(k) || { key: k, label: labelFn(m), qty: 0, times: 0 }
        u.qty += Math.abs(m.change); u.times += 1; t.set(k, u)
      }
      return [...t.values()].sort((a, b) => b.qty - a.qty).slice(0, 5)
    }
    const used = new Map()
    for (const m of outs) {
      if (!m.part) continue
      const u = used.get(m.part.part_code) || { ...m.part, qty: 0 }
      u.qty += Math.abs(m.change); used.set(m.part.part_code, u)
    }
    const lowList = parts.filter(lowOf).map((p) => ({ p, out: outOf(p) }))
      .sort((a, b) => Number(b.out) - Number(a.out) || a.p.part_name.localeCompare(b.p.part_name))
    return {
      total: parts.length,
      units: parts.reduce((n, p) => n + qtyOf(p), 0),
      low: lowList.length,
      out: lowList.filter((x) => x.out).length,
      noMin: parts.filter((p) => st.every((x) => !(stockOf(p, x).min_qty > 0))).length,
      cats: [...cats.values()].sort((a, b) => b.low - a.low || b.parts - a.parts),
      lowList,
      top: [...used.values()].sort((a, b) => b.qty - a.qty).slice(0, 5),
      byEquip: tally((m) => m.equipment?.equip_id, (m) => `${m.equipment.equip_id} · ${m.equipment.equipment_name}`),
      byTech: tally((m) => m.technician?.name, (m) => m.technician.name),
      recent: mv.slice(0, 8),
      qtyOf,
    }
  }, [parts, moves, store])

  // Re-order list for purchasing: one row per part and store that is at or below its minimum.
  function reorderRows() {
    const st = store === 'All' ? STORES : [store]
    const rows = []
    for (const { p } of stats.lowList) for (const x of st) {
      const s = stockOf(p, x)
      if (isLow(s)) rows.push({ code: p.part_code, name: p.part_name, category: catOf(p), store: x, qty: s.quantity, min: s.min_qty, order: Math.max(s.min_qty * 2 - s.quantity, 1), unit: p.unit || '' })
    }
    return rows
  }
  async function copyList() {
    const rows = reorderRows()
    const text = `Spare parts to re-order (${new Date().toLocaleDateString()})\n` + rows.map((r) => `${r.code} | ${r.name} | ${r.store} | in stock ${r.qty}, min ${r.min} | suggest ${r.order} ${r.unit}`).join('\n')
    try { await navigator.clipboard.writeText(text); setMsg(`Copied ${rows.length} line${rows.length === 1 ? '' : 's'} to the clipboard.`) } catch { setMsg('Could not copy. Use Download CSV instead.') }
  }
  function downloadCsv() {
    const rows = reorderRows()
    const head = ['Part code', 'Part name', 'Category', 'Store', 'In stock', 'Minimum', 'Suggested order', 'Unit']
    const csv = [head, ...rows.map((r) => [r.code, r.name, r.category, r.store, r.qty, r.min, r.order, r.unit])].map((r) => r.map(csvCell).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url; a.download = `reorder-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

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
  const catsByMetric = [...stats.cats].sort((a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name))
  const sum = catsByMetric.reduce((n, c) => n + c[metric], 0)
  const max = Math.max(1, ...catsByMetric.map((c) => c[metric]))
  const colorOf = (i) => categoryColor(catsByMetric[i].name, parts)
  const R = 52, C = 2 * Math.PI * R
  let acc = 0

  return (
    <div className="screen">
      <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
      <p className="page-title">Spare parts dashboard</p>
      <p className="page-sub">Stock across {store === 'All' ? 'P1 and P2' : `${store} store`} · movements for the last {DAYS} days</p>
      <div className="chip-row">
        {['All', ...STORES].map((x) => <button key={x} className={store === x ? 'chip active' : 'chip'} aria-pressed={store === x} onClick={() => setStore(x)}>{x === 'All' ? 'Both stores' : `${x} only`}</button>)}
      </div>

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
            <div className="dash-cat-title">
              <h2 style={{ margin: 0 }}>Needs re-ordering</h2>
              {stats.lowList.length > 0 && (
                <div className="chip-row" style={{ margin: 0 }}>
                  <button className="chip" onClick={copyList}><i className="ti ti-copy" aria-hidden="true" /> Copy list</button>
                  <button className="chip" onClick={downloadCsv}><i className="ti ti-download" aria-hidden="true" /> Download CSV</button>
                </div>
              )}
            </div>
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
            <div className="dash-cat-title">
              <h2 style={{ margin: 0 }}>By category</h2>
              <div className="chip-row" style={{ margin: 0 }}>
                {[['parts', 'Parts'], ['units', 'Units in stock']].map(([k, l]) => (
                  <button key={k} className={metric === k ? 'chip active' : 'chip'} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>
                ))}
              </div>
            </div>
            {catsByMetric.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No parts yet.</p> : sum === 0 ? (
              <p className="page-sub" style={{ margin: '10px 0 0' }}>No stock recorded yet. Receive stock to see units per category.</p>
            ) : (
              <div className="dash-cat-grid">
                <svg viewBox="0 0 140 140" className="dash-donut" role="img" aria-label={`${metric} by category`}>
                  <g transform="rotate(-90 70 70)">
                    {catsByMetric.filter((c) => c[metric] > 0).map((c) => {
                      const i = catsByMetric.indexOf(c)
                      const len = (c[metric] / sum) * C
                      const el = <circle key={c.name} cx="70" cy="70" r={R} fill="none" stroke={colorOf(i)} strokeWidth="22" strokeDasharray={`${Math.max(len - 1.5, 0.5)} ${C}`} strokeDashoffset={-acc}><title>{`${c.name}: ${c[metric]} (${Math.round((c[metric] / sum) * 100)}%)`}</title></circle>
                      acc += len
                      return el
                    })}
                  </g>
                  <text x="70" y="68" textAnchor="middle" className="dash-donut-num">{sum}</text>
                  <text x="70" y="85" textAnchor="middle" className="dash-donut-lbl">{metric === 'parts' ? 'parts' : 'units'}</text>
                </svg>
                <div className="dash-cat-list">
                  {catsByMetric.map((c, i) => (
                    <div key={c.name} className="dash-cat">
                      <div className="dash-cat-head">
                        <span className="dash-dot" style={{ background: colorOf(i) }} />
                        <Link to={catLink(c.name)}><b>{c.name}</b></Link>
                        <span className="dash-cat-nums">{c.parts} parts · {c.units} units{c.low > 0 && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{c.low} low</span>}</span>
                        {isAdmin && <button className="btn-secondary dash-edit" disabled={busy} onClick={() => renameCategory(c.name)} aria-label={`Rename ${c.name}`}><i className="ti ti-pencil" aria-hidden="true" /></button>}
                      </div>
                      <div className="dash-bar"><i style={{ width: `${(c[metric] / max) * 100}%`, background: colorOf(i) }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="work-panel">
            <h2>Most used parts (last {DAYS} days)</h2>
            {stats.top.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No parts taken out yet.</p> : (
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {stats.top.map((u) => <li key={u.part_code}><Link to={partPath(u.part_code)}>{u.part_name}</Link> — {u.qty} {u.unit}</li>)}
              </ol>
            )}
          </div>

          <div className="form-grid">
            <div className="work-panel">
              <h2>Used on equipment</h2>
              {stats.byEquip.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No parts linked to equipment yet. Pick the equipment when you take a part out.</p> : (
                <ol style={{ margin: 0, paddingLeft: 20 }}>{stats.byEquip.map((u) => <li key={u.key}>{u.label} — {u.qty} pcs in {u.times} take-out{u.times === 1 ? '' : 's'}</li>)}</ol>
              )}
            </div>
            <div className="work-panel">
              <h2>Taken out by</h2>
              {stats.byTech.length === 0 ? <p className="page-sub" style={{ margin: 0 }}>No take-outs yet.</p> : (
                <ol style={{ margin: 0, paddingLeft: 20 }}>{stats.byTech.map((u) => <li key={u.key}>{u.label} — {u.qty} pcs in {u.times} take-out{u.times === 1 ? '' : 's'}</li>)}</ol>
              )}
            </div>
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
