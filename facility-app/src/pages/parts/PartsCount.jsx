import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { loadParts, stockOf, recordMovement, partPath, categoryColor, STORES } from '../../lib/parts'

// Stock-count sheet (admin): pick a store, type the counted quantity for each part,
// then save once. Only parts whose count differs are changed; each change is
// recorded as a "Count correction" with the reason below.
export default function PartsCount() {
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { session } = useAuth()
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [store, setStore] = useState('P1')
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [counts, setCounts] = useState({}) // `${partId}:${store}` -> typed text
  const [reason, setReason] = useState(`Stock count ${new Date().toISOString().slice(0, 10)}`)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const searchRef = useRef(null)

  useEffect(() => { loadParts().then(setParts).finally(() => setLoading(false)) }, [])

  const categories = useMemo(() => ['All', ...[...new Set(parts.map((p) => p.category).filter(Boolean))].sort()], [parts])
  const visible = useMemo(() => {
    const s = search.trim().toLowerCase()
    return parts.filter((p) => (category === 'All' || p.category === category) && (!s || `${p.part_code} ${p.part_name}`.toLowerCase().includes(s)))
  }, [parts, category, search])

  const key = (p) => `${p.id}:${store}`
  const changed = parts.filter((p) => {
    const v = counts[key(p)]
    return v !== undefined && v !== '' && Number(v) !== stockOf(p, store).quantity
  })
  const bad = changed.some((p) => !Number.isInteger(Number(counts[key(p)])) || Number(counts[key(p)]) < 0)

  async function save() {
    if (reason.trim().length < 3) { setResult({ ok: false, text: 'Enter a reason (at least 3 letters).' }); return }
    setBusy(true); setResult(null)
    let ok = 0; const failed = []
    for (const p of changed) {
      const res = await recordMovement({ userId: session?.user.id, part: p, kind: 'adjust', store, quantity: Number(counts[key(p)]), reason: reason.trim() })
      if (res.success === false || res.error) failed.push(`${p.part_code}: ${res.error?.message || res.error || 'failed'}`)
      else ok++
    }
    setBusy(false)
    setResult({ ok: failed.length === 0, text: `${ok} count${ok === 1 ? '' : 's'} saved${failed.length ? `, ${failed.length} failed — ${failed.join('; ')}` : '.'}` })
    setCounts((c) => { const n = { ...c }; changed.forEach((p) => { if (!failed.some((f) => f.startsWith(p.part_code))) delete n[key(p)] }); return n })
    loadParts().then(setParts)
    searchRef.current?.focus()
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">Stock counts are for administrators only.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
      <p className="page-title">Stock count</p>
      <p className="page-sub">Type what you counted on the shelf. Leave a part empty to skip it. Only the numbers you change are saved.</p>

      <div className="chip-row">
        {STORES.map((x) => <button key={x} className={store === x ? 'chip active' : 'chip'} aria-pressed={store === x} onClick={() => setStore(x)}>{x} store</button>)}
      </div>
      <div className="hist-search-row">
        <input ref={searchRef} placeholder="Search or scan code" value={search} onChange={(e) => setSearch(e.target.value)} />
        {categories.length > 1 && <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" style={{ width: 'auto', maxWidth: 170, margin: 0 }}>{categories.map((c) => <option key={c} value={c}>{c === 'All' ? 'All categories' : c}</option>)}</select>}
      </div>

      {loading ? <p className="center-msg">Loading parts…</p> : (
        <div className="parts-list">
          {visible.map((p) => {
            const cur = stockOf(p, store).quantity
            const v = counts[key(p)] ?? ''
            const diff = v !== '' ? Number(v) - cur : 0
            return (
              <div className="part-row" key={p.id} style={{ borderLeft: `4px solid ${categoryColor(p.category, parts)}` }}>
                <div className="part-main">
                  <p className="part-name"><Link to={partPath(p.part_code)}>{p.part_name}</Link></p>
                  <p className="part-sub">{p.part_code}{stockOf(p, store).location ? ` · ${stockOf(p, store).location}` : ''} · now {cur} {p.unit}</p>
                </div>
                <input type="number" inputMode="numeric" min="0" step="1" style={{ width: 84, margin: 0 }} placeholder={String(cur)} aria-label={`Counted quantity for ${p.part_code}`}
                  value={v} onChange={(e) => setCounts((c) => ({ ...c, [key(p)]: e.target.value }))} />
                {diff !== 0 && <span className={'pill ' + (diff < 0 ? 'pill-warn' : 'pill-ok')}>{diff > 0 ? '+' : ''}{diff}</span>}
              </div>
            )
          })}
          {visible.length === 0 && <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No parts match.</div>}
        </div>
      )}

      <div className="work-panel" style={{ marginTop: 14 }}>
        <label className="work-field">Reason (required)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        {result && <div className={result.ok ? 'banner-warn' : 'banner-danger'} role="status">{result.text}</div>}
        <button className="btn-primary" disabled={busy || changed.length === 0 || bad} onClick={save}>
          {busy ? 'Saving…' : changed.length ? `Save ${changed.length} count${changed.length === 1 ? '' : 's'} for ${store}` : 'Nothing to save yet'}
        </button>
        {bad && <p className="page-sub" style={{ margin: '8px 0 0' }}>Counts must be whole numbers, 0 or more.</p>}
      </div>
    </div>
  )
}
