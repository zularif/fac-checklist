import { useState } from 'react'
import { Link } from 'react-router-dom'

// First-time database setup, done from the browser. See DEPLOY-CLOUDFLARE.md.
async function call(body) {
  const res = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.message || `Setup failed (${res.status})`)
  return json
}

export default function Setup() {
  const [key, setKey] = useState('')
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [finished, setFinished] = useState(false)

  async function start(e) {
    e.preventDefault()
    setBusy(true); setError(''); setLog([])
    try {
      const status = await call({ key, step: 'status' })
      if (status.locked) { setLog([status.message]); setFinished(true); return }
      const done = new Set(status.done)
      for (const s of status.steps) {
        if (done.has(s.id)) { setLog((l) => [...l, `✓ ${s.label} (already done)`]); continue }
        setLog((l) => [...l, `… ${s.label}`])
        await call({ key, step: s.id })
        setLog((l) => [...l.slice(0, -1), `✓ ${s.label}`])
      }
      setFinished(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen" style={{ maxWidth: 520, margin: '0 auto' }}>
      <p className="page-title">First-time setup</p>
      <p className="page-sub">Creates the database tables and loads equipment, checklists and staff PIN logins. Run this once after the first deploy.</p>
      {!finished && (
        <form onSubmit={start} className="work-panel">
          <label className="work-field">Setup key (the SETUP_KEY secret)
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} required autoComplete="off" />
          </label>
          <button className="btn-primary" type="submit" disabled={busy || !key}>{busy ? 'Working…' : 'Start setup'}</button>
        </form>
      )}
      {error && <div className="banner-danger" role="alert">{error} — fix it and press Start setup again; finished steps are skipped.</div>}
      {log.length > 0 && <div className="work-panel">{log.map((l, i) => <p key={i} style={{ margin: '2px 0' }}>{l}</p>)}</div>}
      {finished && (
        <div className="banner-ok">
          Setup complete. Staff can now sign in with their PINs. Ask everyone to change their PIN (menu → Change my PIN).
          You can now delete the SETUP_KEY secret. <Link to="/login">Go to sign in</Link>
        </div>
      )}
    </div>
  )
}
