import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { loadParts, stockOf, isLow, photoUrl, partPath, STORES } from '../../lib/parts'

const VIEWS = ['All', 'P1', 'P2', 'Low stock', 'Retired']

export default function Parts() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('All')
  const view = VIEWS.includes(params.get('view')) ? params.get('view') : 'All'

  useEffect(() => {
    let alive = true
    loadParts({ includeRetired: isAdmin }).then((p) => { if (alive) { setParts(p); setError(null) } }).catch((e) => { if (alive) setError(e) }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [isAdmin])

  const categories = useMemo(() => ['All', ...[...new Set(parts.map((p) => p.category).filter(Boolean))].sort()], [parts])
  const active = useMemo(() => parts.filter((p) => p.status === 'Active'), [parts])
  const lowCount = useMemo(() => active.filter((p) => STORES.some((s) => isLow(stockOf(p, s)))).length, [parts])

  const visible = useMemo(() => {
    const s = search.trim().toLowerCase()
    return parts.filter((p) => {
      if ((view === 'Retired') !== (p.status === 'Retired')) return false
      if (category !== 'All' && p.category !== category) return false
      if (view === 'Low stock' && !STORES.some((st) => isLow(stockOf(p, st)))) return false
      if ((view === 'P1' || view === 'P2') && stockOf(p, view).quantity <= 0) return false
      if (s && !`${p.part_code} ${p.part_name} ${p.brand || ''} ${p.model || ''} ${p.description || ''}`.toLowerCase().includes(s)) return false
      return true
    })
  }, [parts, search, category, view])

  const needsUpdate = error && (error.code === 'DB_UPDATE' || /no such table|does not exist/i.test(error.message))

  return (
    <div className="screen">
      <div className="page-head-row">
        <div>
          <p className="page-title">Spare parts</p>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            {active.length} parts · P1 and P2 stores
            {lowCount > 0 && <span className="pill pill-warn" style={{ marginLeft: 6 }}>{lowCount} low stock</span>}
          </p>
        </div>
        {isAdmin && (
          <div className="parts-admin-actions">
            <button className="btn-primary" onClick={() => navigate('/parts/new')}><i className="ti ti-plus" aria-hidden="true" />Add part</button>
            <button className="btn-secondary" onClick={() => navigate('/parts/import')}><i className="ti ti-file-import" aria-hidden="true" />Import</button>
            <button className="btn-secondary" onClick={() => navigate('/parts/labels')}><i className="ti ti-qrcode" aria-hidden="true" />QR labels</button>
          </div>
        )}
      </div>

      <button className="btn-primary parts-scan" onClick={() => navigate('/scan')}>
        <i className="ti ti-qrcode" aria-hidden="true" />Scan a part to take out or receive
      </button>

      {needsUpdate ? (
        <div className="banner-warn">
          The spare parts tables are not in the database yet.{' '}
          {isAdmin ? <Link to="/admin/database">Open Database update →</Link> : 'Ask an administrator to run Admin → Database update.'}
        </div>
      ) : error ? <div className="banner-danger" role="alert">{error.message}</div> : null}

      <div className="hist-search-row" style={{ marginTop: 10 }}>
        <input placeholder="Search code, name, brand, model" value={search} onChange={(e) => setSearch(e.target.value)} />
        {categories.length > 2 && (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category" style={{ width: 'auto', maxWidth: 170, margin: 0 }}>
            {categories.map((c) => <option key={c} value={c}>{c === 'All' ? 'All categories' : c}</option>)}
          </select>
        )}
      </div>
      <div className="chip-row">
        {VIEWS.filter((v) => v !== 'Retired' || isAdmin).map((v) => (
          <button key={v} className={view === v ? 'chip active' : 'chip'} aria-pressed={view === v}
            onClick={() => setParams(v === 'All' ? {} : { view: v }, { replace: true })}>
            {v === 'P1' || v === 'P2' ? `In ${v}` : v}{v === 'Low stock' && lowCount > 0 ? ` (${lowCount})` : ''}
          </button>
        ))}
      </div>

      {loading ? <p className="center-msg">Loading parts…</p> : visible.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          {parts.length === 0 ? (isAdmin ? 'No parts yet. Use Import to load your workbook, or Add part.' : 'No parts yet.') : 'No parts match.'}
        </div>
      ) : (
        <div className="parts-list">
          {visible.map((p) => (
            <Link className="part-row" key={p.id} to={partPath(p.part_code)}>
              <div className="part-thumb">{p.photo_path ? <img src={photoUrl(p.photo_path)} alt="" loading="lazy" /> : <i className="ti ti-package" aria-hidden="true" />}</div>
              <div className="part-main">
                <p className="part-name">{p.part_name}</p>
                <p className="part-sub">{p.part_code}{p.category ? ` · ${p.category}` : ''}{p.brand ? ` · ${p.brand}` : ''}</p>
              </div>
              <div className="part-qtys">
                {STORES.map((st) => {
                  const s = stockOf(p, st)
                  return (
                    <span key={st} className={'part-qty' + (isLow(s) ? (s.quantity === 0 ? ' zero' : ' low') : s.quantity === 0 ? ' none' : '')} title={`${st}: ${s.quantity} ${p.unit}${isLow(s) ? ' (low)' : ''}`}>
                      <small>{st}</small><b>{s.quantity}</b>
                    </span>
                  )
                })}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
