import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { db } from '../../lib/db'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { STORES, stockOf, isLow, photoUrl, recordMovement } from '../../lib/parts'

const ACTIONS = [
  { kind: 'out', label: 'Take out', icon: 'ti-arrow-up-right' },
  { kind: 'in', label: 'Receive', icon: 'ti-arrow-down-left' },
  { kind: 'transfer', label: 'Transfer', icon: 'ti-arrows-exchange' },
  { kind: 'adjust', label: 'Count', icon: 'ti-clipboard-check', admin: true },
]
const KIND_TEXT = { in: 'Received', out: 'Taken out', transfer: 'Transfer', adjust: 'Count correction', opening: 'Opening stock' }

export default function PartDetail() {
  const { code } = useParams()
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const { session } = useAuth()
  const [part, setPart] = useState(null)
  const [moves, setMoves] = useState([])
  const [equipment, setEquipment] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)

  const [kind, setKind] = useState('out')
  const [store, setStore] = useState('P1')
  const [qty, setQty] = useState('1')
  const [reason, setReason] = useState('')
  const [equipCode, setEquipCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  useEffect(() => {
    let alive = true
    async function load() {
      setLoading(true)
      const { data, error: e } = await db.from('parts')
        .select('*, stock:part_stock(store, quantity, min_qty, location)').eq('part_code', decodeURIComponent(code)).maybeSingle()
      if (!alive) return
      if (e) { setError(e.message); setLoading(false); return }
      if (!data) { setError('Part not found. It may have been renamed.'); setLoading(false); return }
      setPart(data); setError('')
      const m = await db.from('stock_movements')
        .select('id, kind, store, other_store, change, balance_after, reason, created_at, technician:technicians(name), equipment:equipment(equip_id, equipment_name)')
        .eq('part_id', data.id).order('created_at', { ascending: false }).limit(60)
      if (alive) { setMoves(m.data || []); setLoading(false) }
    }
    load()
    return () => { alive = false }
  }, [code, refresh])

  // equipment list for "used on" (loaded once, only when needed)
  useEffect(() => {
    if (kind !== 'out' || equipment.length) return
    db.from('equipment').select('id, equip_id, equipment_name').eq('status', 'Active').order('equip_id').then(({ data }) => setEquipment(data || []))
  }, [kind, equipment.length])

  const toStore = store === 'P1' ? 'P2' : 'P1'
  const current = part ? stockOf(part, store) : null
  const equipMatch = useMemo(() => {
    const v = equipCode.trim().toLowerCase()
    if (!v) return null
    return equipment.find((e) => e.equip_id.toLowerCase() === v || `${e.equip_id} · ${e.equipment_name}`.toLowerCase() === v) || null
  }, [equipCode, equipment])

  function pickAction(k) { setKind(k); setMsg(null); setQty(k === 'adjust' ? String(current?.quantity ?? 0) : '1'); setReason('') }

  async function submit(e) {
    e.preventDefault()
    setMsg(null)
    const n = Number(qty)
    if (!Number.isInteger(n) || n < (kind === 'adjust' ? 0 : 1)) { setMsg({ ok: false, text: kind === 'adjust' ? 'Enter the counted quantity (0 or more).' : 'Enter a quantity of at least 1.' }); return }
    if ((kind === 'out' || kind === 'transfer') && navigator.onLine && n > current.quantity) {
      setMsg({ ok: false, text: `Only ${current.quantity} ${part.unit} in ${store}.` }); return
    }
    if (kind === 'adjust' && reason.trim().length < 3) { setMsg({ ok: false, text: 'Enter a reason for the count correction.' }); return }
    if (equipCode.trim() && !equipMatch) { setMsg({ ok: false, text: 'Pick the equipment from the list, or leave it empty.' }); return }
    setBusy(true)
    const res = await recordMovement({ userId: session?.user.id, part, kind, store, toStore, quantity: n, reason: reason.trim(), equipmentId: kind === 'out' ? equipMatch?.id : null })
    setBusy(false)
    if (res.success) {
      const done = { out: `Took out ${n} ${part.unit} from ${store}.`, in: `Received ${n} ${part.unit} into ${store}.`, transfer: `Moved ${n} ${part.unit} from ${store} to ${toStore}.`, adjust: `${store} count set to ${n} ${part.unit}.` }[kind]
      setMsg({ ok: true, text: done }); setReason(''); setEquipCode(''); setQty(kind === 'adjust' ? qty : '1'); setRefresh((x) => x + 1)
    } else if (res.queued) {
      setMsg({ ok: true, text: 'Saved on this device. It will be sent automatically when you are back online (see Sync Centre).' })
    } else setMsg({ ok: false, text: res.error || 'Could not save.' })
  }

  if (loading && !part) return <div className="screen"><p className="center-msg">Loading part…</p></div>
  if (!part) return <div className="screen"><button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button><p className="banner-danger" role="alert">{error}</p></div>

  const actions = ACTIONS.filter((a) => !a.admin || isAdmin)

  return (
    <div className="screen">
      <div className="work-topline">
        <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
        {isAdmin && <button className="btn-secondary back-btn" onClick={() => navigate(`/parts/${encodeURIComponent(part.part_code)}/edit`)}><i className="ti ti-edit" aria-hidden="true" />Edit</button>}
      </div>

      <div className="part-hero">
        <div className="part-photo">{part.photo_path ? <img src={photoUrl(part.photo_path)} alt={part.part_name} /> : <i className="ti ti-package" aria-hidden="true" />}</div>
        <div style={{ minWidth: 0 }}>
          <span className="work-eyebrow">SPARE PART{part.status !== 'Active' ? ' · RETIRED' : ''}</span>
          <h1 className="part-title">{part.part_name}</h1>
          <p className="part-sub">{part.part_code}{part.category ? ` · ${part.category}` : ''} · unit: {part.unit}</p>
          {(part.brand || part.model) && <p className="part-sub">{[part.brand, part.model].filter(Boolean).join(' · ')}</p>}
          {part.description && <p className="part-desc">{part.description}</p>}
        </div>
      </div>

      <div className="part-stores">
        {STORES.map((st) => {
          const s = stockOf(part, st)
          return (
            <div key={st} className={'part-store' + (isLow(s) ? (s.quantity === 0 ? ' zero' : ' low') : s.quantity === 0 ? ' none' : '')}>
              <span className="part-store-name">{st} store</span>
              <strong>{s.quantity}<small> {part.unit}</small></strong>
              <span>{s.location ? `Shelf: ${s.location}` : 'No shelf set'}</span>
              <span>{s.min_qty > 0 ? `Minimum ${s.min_qty}` : 'No minimum set'}{isLow(s) && <b> · {s.quantity === 0 ? 'Out of stock' : 'Low stock'}</b>}</span>
            </div>
          )
        })}
      </div>

      {part.status === 'Active' && (
        <form className="work-panel part-action" onSubmit={submit}>
          <div className="part-action-tabs" role="tablist">
            {actions.map((a) => (
              <button type="button" role="tab" key={a.kind} aria-selected={kind === a.kind} className={kind === a.kind ? 'active' : ''} onClick={() => pickAction(a.kind)}>
                <i className={`ti ${a.icon}`} aria-hidden="true" />{a.label}
              </button>
            ))}
          </div>

          <p className="field-label">{kind === 'transfer' ? 'From store' : 'Store'}</p>
          <div className="chip-row">
            {STORES.map((st) => (
              <button type="button" key={st} className={store === st ? 'chip active' : 'chip'} aria-pressed={store === st}
                onClick={() => { setStore(st); if (kind === 'adjust') setQty(String(stockOf(part, st).quantity)) }}>
                {st} · {stockOf(part, st).quantity} {part.unit}
              </button>
            ))}
            {kind === 'transfer' && <span className="part-to">→ to <b>{toStore}</b></span>}
          </div>

          <label className="work-field">{kind === 'adjust' ? `Counted quantity in ${store}` : 'Quantity'}
            <div className="qty-stepper">
              <button type="button" aria-label="Less" onClick={() => setQty((q) => String(Math.max(kind === 'adjust' ? 0 : 1, (Number(q) || 0) - 1)))}>−</button>
              <input inputMode="numeric" type="number" min={kind === 'adjust' ? 0 : 1} step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
              <button type="button" aria-label="More" onClick={() => setQty((q) => String((Number(q) || 0) + 1))}>+</button>
            </div>
          </label>

          {kind === 'out' && (
            <label className="work-field">Used on equipment (optional)
              <input list="part-equipment" value={equipCode} onChange={(e) => setEquipCode(e.target.value)} placeholder="Type equipment ID or name" />
              <datalist id="part-equipment">{equipment.map((e) => <option key={e.id} value={`${e.equip_id} · ${e.equipment_name}`} />)}</datalist>
            </label>
          )}
          <label className="work-field">{kind === 'adjust' ? 'Reason (required)' : kind === 'in' ? 'Note (optional) — e.g. PO number, supplier' : kind === 'out' ? 'What is it for? (optional)' : 'Note (optional)'}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={kind === 'adjust' ? 'e.g. Monthly stock count' : ''} />
          </label>

          {msg && <div className={msg.ok ? 'banner-ok' : 'banner-danger'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
          <button className="btn-primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : { out: `Take out from ${store}`, in: `Receive into ${store}`, transfer: `Transfer ${store} → ${toStore}`, adjust: `Set ${store} count` }[kind]}
          </button>
        </form>
      )}

      <section className="work-panel">
        <h2>History</h2>
        {moves.length === 0 ? <p>No stock movements yet.</p> : (
          <div className="move-list">
            {moves.map((m) => (
              <div className="move-row" key={m.id}>
                <span className={'move-change ' + (m.change > 0 ? 'plus' : m.change < 0 ? 'minus' : '')}>{m.change > 0 ? '+' : ''}{m.change}</span>
                <div className="move-main">
                  <strong>{KIND_TEXT[m.kind] || m.kind} · {m.store}{m.kind === 'transfer' ? (m.change < 0 ? ` → ${m.other_store}` : ` ← ${m.other_store}`) : ''}</strong>
                  <span>{new Date(m.created_at).toLocaleString()} · {m.technician?.name || '—'}{m.balance_after != null ? ` · left ${m.balance_after}` : ''}</span>
                  {(m.reason || m.equipment) && <span>{m.equipment ? <Link to={`/asset/equipment/${encodeURIComponent(m.equipment.equip_id)}`}>{m.equipment.equip_id} · {m.equipment.equipment_name}</Link> : null}{m.equipment && m.reason ? ' — ' : ''}{m.reason}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
