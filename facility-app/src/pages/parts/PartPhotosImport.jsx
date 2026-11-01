import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { loadParts, partPath } from '../../lib/parts'
import { compressImage, formatBytes } from '../../lib/image'

// Bulk photo upload: name each photo after its part code (BRG-6204.jpg) and
// select them all at once. Photos are compressed on this device first.
const DAILY_KV_WRITES = 1000 // Cloudflare free plan: KV writes per day

function candidates(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, '').trim().toUpperCase()
  const out = new Set([stem])
  out.add(stem.replace(/\s*\(\d+\)$/, ''))          // "BRG-6204 (1)"
  out.add(stem.replace(/[_\s]+\d{1,2}$/, ''))       // "BRG-6204_1", "BRG-6204 2"
  out.add(stem.split(/[\s]+/)[0])                   // "BRG-6204 bearing front"
  out.add(stem.replace(/[\s]+/g, '-'))              // "BRG 6204" -> "BRG-6204"
  return [...out].filter(Boolean)
}

export default function PartPhotosImport() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [parts, setParts] = useState([])
  const [files, setFiles] = useState([])
  const [replace, setReplace] = useState(false)
  const [status, setStatus] = useState({}) // fileName -> { state, text }
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => { loadParts({ includeRetired: true }).then(setParts) }, [])
  const byCode = useMemo(() => new Map(parts.map((p) => [p.part_code.toUpperCase(), p])), [parts])

  const rows = useMemo(() => {
    const used = new Set()
    return files.map((f) => {
      const part = candidates(f.name).map((c) => byCode.get(c)).find(Boolean) || null
      const duplicate = part && used.has(part.id)
      if (part) used.add(part.id)
      return { file: f, part, duplicate, hasPhoto: !!part?.photo_path }
    })
  }, [files, byCode])

  // rows already uploaded in this session are never sent twice (retry only does the failed ones)
  const todo = rows.filter((r) => r.part && !r.duplicate && (replace || !r.hasPhoto) && status[r.file.name]?.state !== 'ok')
  const unmatched = rows.filter((r) => !r.part)
  const skippedHasPhoto = rows.filter((r) => r.part && !r.duplicate && r.hasPhoto && !replace)

  function pick(list) {
    setDone(null); setStatus({})
    setFiles([...list].filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.name)))
  }

  async function run() {
    setBusy(true); setDone(null)
    setStatus((st) => Object.fromEntries(Object.entries(st).filter(([, v]) => v.state === 'ok')))
    let ok = 0, failed = 0, savedBytes = 0
    const queue = [...todo]
    const set = (name, s) => setStatus((st) => ({ ...st, [name]: s }))
    async function worker() {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const name = r.file.name
        try {
          set(name, { state: 'busy', text: 'Compressing…' })
          const c = await compressImage(r.file)
          set(name, { state: 'busy', text: `Uploading ${formatBytes(c.bytes)}…` })
          const path = `${r.part.part_code.replace(/[^A-Z0-9._-]/gi, '_')}-${Date.now()}.jpg`
          const up = await db.storage.from('parts').upload(path, c.blob, { upsert: true, contentType: 'image/jpeg' })
          if (up.error) throw up.error
          const { error } = await db.rpc('part_save', { id: r.part.id, part: { photo_path: path } })
          if (error) throw error
          if (r.part.photo_path) await db.storage.from('parts').remove([r.part.photo_path]).catch(() => {})
          r.part.photo_path = path
          savedBytes += Math.max(0, c.originalBytes - c.bytes)
          ok++
          set(name, { state: 'ok', text: `Done · ${formatBytes(c.originalBytes)} → ${formatBytes(c.bytes)}` })
        } catch (e) {
          failed++
          set(name, { state: 'error', text: e.message || 'Failed' })
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]) // 3 at a time
    setBusy(false)
    setDone({ ok, failed, savedBytes })
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen" style={{ maxWidth: 860 }}>
      <button className="btn-secondary back-btn" onClick={() => navigate('/parts')}>← Spare parts</button>
      <p className="page-title">Import part photos</p>
      <p className="page-sub">Add photos for many parts at once.</p>

      <div className="work-panel">
        <h2>How it works</h2>
        <ul className="import-notes">
          <li>Name each photo with its <b>part code</b>, e.g. <code>BRG-6204.jpg</code>. Names like <code>BRG-6204 (1).jpg</code>, <code>BRG-6204_2.jpg</code> or <code>BRG-6204 front.jpg</code> also match.</li>
          <li>Select all the photos together (Ctrl+A in the file window), or choose a whole folder.</li>
          <li>Each photo is compressed on this device (about 800 px, ~100 KB) before upload.</li>
          <li>Parts that already have a photo are skipped unless you tick <b>Replace existing photos</b>.</li>
        </ul>
        <div className="work-actions" style={{ marginTop: 0 }}>
          <label className="btn-primary" style={{ cursor: 'pointer', width: 'auto' }}>
            <i className="ti ti-photo-plus" aria-hidden="true" />Choose photos
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => pick(e.target.files || [])} />
          </label>
          <label className="btn-secondary" style={{ cursor: 'pointer', width: 'auto' }}>
            <i className="ti ti-folder" aria-hidden="true" />Choose a folder
            <input type="file" webkitdirectory="" directory="" multiple style={{ display: 'none' }} onChange={(e) => pick(e.target.files || [])} />
          </label>
        </div>
      </div>

      {files.length > 0 && (
        <div className="work-panel">
          <h2>{files.length} photo(s) selected</h2>
          <p style={{ margin: '0 0 8px' }}>
            <b>{todo.length}</b> will be uploaded
            {skippedHasPhoto.length > 0 && <> · {skippedHasPhoto.length} part(s) already have a photo</>}
            {unmatched.length > 0 && <> · <span style={{ color: 'var(--danger)' }}>{unmatched.length} not matched to a part</span></>}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={replace} disabled={busy} onChange={(e) => setReplace(e.target.checked)} />Replace existing photos
          </label>
          {todo.length > DAILY_KV_WRITES / 2 && <div className="banner-warn">That is a lot of photos for one day. On Cloudflare's free plan the file store allows about {DAILY_KV_WRITES} uploads per day — do the rest tomorrow if some fail with a limit error.</div>}

          <div className="photo-match-list">
            {rows.map((r) => {
              const st = status[r.file.name]
              const willDo = r.part && !r.duplicate && (replace || !r.hasPhoto)
              return (
                <div className="photo-match" key={r.file.name + r.file.size}>
                  <span className="photo-match-file">{r.file.name}<small>{formatBytes(r.file.size)}</small></span>
                  <span className="photo-match-part">
                    {r.part ? <Link to={partPath(r.part.part_code)}>{r.part.part_code}</Link> : <b style={{ color: 'var(--danger)' }}>No matching part code</b>}
                    {r.part && <small>{r.part.part_name}</small>}
                  </span>
                  <span className={'photo-match-state ' + (st?.state || (willDo ? 'wait' : 'skip'))}>
                    {st ? st.text : !r.part ? 'Skipped' : r.duplicate ? 'Skipped (second photo for this part)' : r.hasPhoto && !replace ? 'Has photo' : 'Ready'}
                  </span>
                </div>
              )
            })}
          </div>

          <button className="btn-primary" disabled={busy || !todo.length} onClick={run} style={{ marginTop: 12 }}>
            {busy ? 'Uploading…' : `Upload ${todo.length} photo${todo.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {done && (
        <div className={done.failed ? 'banner-warn' : 'banner-ok'}>
          {done.ok} photo(s) added{done.failed ? `, ${done.failed} failed (see the list — you can press Upload again to retry those)` : ''}. Saved {formatBytes(done.savedBytes)} by compressing. <Link to="/parts">Open spare parts →</Link>
        </div>
      )}

      {unmatched.length > 0 && !busy && (
        <p className="page-sub">Tip: rename unmatched photos to the exact part code shown in Spare parts, then choose them again.</p>
      )}
      {parts.length > 0 && files.length === 0 && (
        <p className="page-sub">{parts.filter((p) => !p.photo_path).length} of {parts.length} parts have no photo yet.{' '}
          {parts.filter((p) => !p.photo_path).length > 0 && <>Examples: {parts.filter((p) => !p.photo_path).slice(0, 5).map((p) => p.part_code).join(', ')}</>}
        </p>
      )}
    </div>
  )
}
