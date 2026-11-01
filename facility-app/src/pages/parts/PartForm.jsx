import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { STORES, stockOf, photoUrl, partPath, resizePhoto, loadParts } from '../../lib/parts'

const empty = { part_code: '', part_name: '', category: '', unit: 'pcs', brand: '', model: '', description: '' }

// Add a new part (/parts/new) or edit one (/parts/:code/edit). Admin only.
export default function PartForm() {
  const { code } = useParams()
  const editing = !!code
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()
  const [part, setPart] = useState(null)
  const [form, setForm] = useState(empty)
  const [stock, setStock] = useState({ P1: { min_qty: '', location: '' }, P2: { min_qty: '', location: '' } })
  const [photo, setPhoto] = useState(null) // { blob, preview }
  const [categories, setCategories] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadParts({ includeRetired: true }).then((all) => setCategories([...new Set(all.map((p) => p.category).filter(Boolean))].sort())).catch(() => {})
    if (!editing) return
    db.from('parts').select('*, stock:part_stock(store, quantity, min_qty, location)').eq('part_code', decodeURIComponent(code)).maybeSingle().then(({ data, error: e }) => {
      if (e || !data) { setError(e?.message || 'Part not found.'); return }
      setPart(data)
      setForm(Object.fromEntries(Object.keys(empty).map((k) => [k, data[k] ?? ''])))
      setStock(Object.fromEntries(STORES.map((st) => { const s = stockOf(data, st); return [st, { min_qty: s.min_qty ? String(s.min_qty) : '', location: s.location || '' }] })))
    })
  }, [code, editing])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const setSt = (st, k, v) => setStock((s) => ({ ...s, [st]: { ...s[st], [k]: v } }))

  async function pickPhoto(file) {
    if (!file) return
    try { const blob = await resizePhoto(file); setPhoto({ blob, preview: URL.createObjectURL(blob) }) } catch (e) { setError(e.message) }
  }

  async function save(e, status) {
    e?.preventDefault()
    setError('')
    if (!form.part_code.trim() || !form.part_name.trim()) { setError('Part code and name are required.'); return }
    setBusy(true)
    try {
      const values = { ...form, part_code: form.part_code.trim().toUpperCase() }
      if (status) values.status = status
      if (photo) {
        const path = `${values.part_code.replace(/[^A-Z0-9._-]/g, '_')}-${Date.now()}.jpg`
        const up = await db.storage.from('parts').upload(path, photo.blob, { upsert: true, contentType: 'image/jpeg' })
        if (up.error) throw up.error
        values.photo_path = path
      }
      const { error: e2 } = await db.rpc('part_save', { id: part?.id, part: values, stock })
      if (e2) throw e2
      navigate(partPath(values.part_code), { replace: true })
    } catch (err) {
      setError(/duplicate key/i.test(err.message) ? `Part code ${form.part_code.toUpperCase()} already exists.` : err.message)
    } finally { setBusy(false) }
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  const shownPhoto = photo?.preview || (part?.photo_path ? photoUrl(part.photo_path) : null)

  return (
    <div className="screen" style={{ maxWidth: 720 }}>
      <button className="btn-secondary back-btn" onClick={() => navigate(-1)}>← Back</button>
      <p className="page-title">{editing ? 'Edit part' : 'Add part'}</p>
      {error && <div className="banner-danger" role="alert">{error}</div>}

      <form onSubmit={save}>
        <div className="work-panel">
          <div className="part-photo-edit">
            <div className="part-photo">{shownPhoto ? <img src={shownPhoto} alt="" /> : <i className="ti ti-camera" aria-hidden="true" />}</div>
            <label className="btn-secondary" style={{ width: 'auto', cursor: 'pointer' }}>
              <i className="ti ti-photo" aria-hidden="true" />{shownPhoto ? 'Change photo' : 'Add photo'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => pickPhoto(e.target.files?.[0])} />
            </label>
          </div>
          <div className="form-grid">
            <label className="work-field">Part code *<input value={form.part_code} onChange={(e) => set('part_code', e.target.value)} placeholder="e.g. BRG-6204" required /></label>
            <label className="work-field">Part name *<input value={form.part_name} onChange={(e) => set('part_name', e.target.value)} placeholder="e.g. Bearing 6204-2RS" required /></label>
            <label className="work-field">Category
              <input list="part-categories" value={form.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Mechanical" />
              <datalist id="part-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </label>
            <label className="work-field">Unit<input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="pcs, m, set, L" /></label>
            <label className="work-field">Brand<input value={form.brand} onChange={(e) => set('brand', e.target.value)} /></label>
            <label className="work-field">Model<input value={form.model} onChange={(e) => set('model', e.target.value)} /></label>
          </div>
          <label className="work-field">Details<textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Size, rating, where it is used…" /></label>
        </div>

        <div className="form-grid">
          {STORES.map((st) => (
            <div className="work-panel" key={st}>
              <h2>{st} store</h2>
              <label className="work-field">Shelf / bin<input value={stock[st].location} onChange={(e) => setSt(st, 'location', e.target.value)} placeholder="e.g. Rack A1" /></label>
              <label className="work-field">Minimum stock (low-stock alert)<input type="number" inputMode="numeric" min="0" value={stock[st].min_qty} onChange={(e) => setSt(st, 'min_qty', e.target.value)} placeholder="0 = no alert" /></label>
              {editing && <p className="page-sub" style={{ margin: 0 }}>In stock: {stockOf(part, st).quantity} {form.unit}. Change quantities from the part page.</p>}
            </div>
          ))}
        </div>
        {!editing && <p className="page-sub">New parts start with 0 in stock. After saving, use <b>Receive</b> to add the stock you have.</p>}

        <div className="work-actions">
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save part'}</button>
          {editing && part?.status === 'Active' && <button type="button" className="btn-secondary" disabled={busy} onClick={(e) => { if (window.confirm('Retire this part? It will be hidden from the list but its history is kept.')) save(e, 'Retired') }}>Retire part</button>}
          {editing && part?.status === 'Retired' && <button type="button" className="btn-secondary" disabled={busy} onClick={(e) => save(e, 'Active')}>Reactivate part</button>}
        </div>
      </form>
    </div>
  )
}
