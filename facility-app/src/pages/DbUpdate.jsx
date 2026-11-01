import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

// Admin → Database update: adds new tables shipped with an app update
// (files in migrations/). Safe to press more than once.
async function call(method) {
  const { data: { session } } = await db.auth.getSession()
  const res = await fetch('/api/admin/db-update', { method, headers: { Authorization: `Bearer ${session?.access_token}` } })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.message || `Failed (${res.status})`)
  return body
}

const NAMES = { '0001_init.sql': 'Core tables (equipment, inspections, staff, extinguishers, tasks)', '0002_inventory.sql': 'Spare parts inventory (P1 / P2 stores)' }

export default function DbUpdate() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => { if (isAdmin) call('GET').then((b) => setStatus(b.status)).catch((e) => setMsg({ ok: false, text: e.message })) }, [isAdmin])

  async function apply() {
    setBusy(true); setMsg(null)
    try {
      const b = await call('POST')
      setStatus(b.status)
      setMsg({ ok: true, text: b.applied.length ? `Updated: ${b.applied.map((n) => NAMES[n] || n).join(', ')}.` : 'The database is already up to date.' })
    } catch (e) { setMsg({ ok: false, text: e.message }) } finally { setBusy(false) }
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>
  const pending = (status || []).filter((s) => !s.applied)

  return (
    <div className="screen" style={{ maxWidth: 720 }}>
      <button className="btn-secondary back-btn" onClick={() => navigate('/admin')}>← Admin</button>
      <p className="page-title">Database update</p>
      <p className="page-sub">When an app update adds new features that need new tables, press Update once. Existing data is not changed.</p>
      {!status ? <p className="center-msg">Checking…</p> : (
        <div className="work-panel">
          {status.map((s) => (
            <div className="move-row" key={s.name}>
              <span className={'pill ' + (s.applied ? 'pill-ok' : 'pill-warn')}>{s.applied ? 'Installed' : 'Needed'}</span>
              <div className="move-main"><strong>{NAMES[s.name] || s.name}</strong><span>{s.name}</span></div>
            </div>
          ))}
        </div>
      )}
      {msg && <div className={msg.ok ? 'banner-ok' : 'banner-danger'} role="status">{msg.text}</div>}
      <button className="btn-primary" disabled={busy || !status || pending.length === 0} onClick={apply}>
        {busy ? 'Updating…' : pending.length ? `Update database (${pending.length})` : 'Up to date'}
      </button>
    </div>
  )
}
