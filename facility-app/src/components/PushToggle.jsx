import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

// "Turn on phone notifications" for the vendor work permits page.
// Works in the installed app (Android: Chrome; iPhone: added to the Home Screen, iOS 16.4 or newer).
const toBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)

async function currentSub() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 4000))])
  return reg ? reg.pushManager.getSubscription() : null
}

export default function PushToggle() {
  const isAdmin = useIsAdmin()
  const [state, setState] = useState('checking') // checking | unsupported | off | on | blocked
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let live = true
    ;(async () => {
      if (!supported()) return live && setState('unsupported')
      if (Notification.permission === 'denied') return live && setState('blocked')
      const sub = await currentSub().catch(() => null)
      if (live) setState(sub ? 'on' : 'off')
    })()
    return () => { live = false }
  }, [])

  async function enable() {
    setBusy(true); setMsg('')
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return }
      const { data, error } = await db.rpc('push_public_key')
      if (error) throw new Error(error.message)
      const reg = await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(data.key) })
      const { error: e2 } = await db.rpc('push_subscribe', { endpoint: sub.endpoint })
      if (e2) throw new Error(e2.message)
      setState('on'); setMsg('Notifications are on for this phone.')
    } catch (e) { setMsg('Could not turn on notifications: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function disable() {
    setBusy(true); setMsg('')
    try {
      const sub = await currentSub()
      if (sub) { await db.rpc('push_unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe() }
      setState('off'); setMsg('Notifications are off for this phone.')
    } catch (e) { setMsg('Could not turn off notifications: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function test() {
    setBusy(true); setMsg('')
    const { data, error } = await db.rpc('push_test')
    setBusy(false)
    setMsg(error ? error.message : `Test sent to ${data.sent} of ${data.total} phone(s).`)
  }

  const box = { margin: '0 0 10px', padding: '8px 10px', border: '1px solid #cbd5e0', borderRadius: 8, fontSize: 13 }
  if (state === 'checking') return null
  if (state === 'unsupported') return <p style={box}>Phone notifications are not available here. {isIOS() ? 'On iPhone, tap Share, then "Add to Home Screen", and open the app from the Home Screen (iOS 16.4 or newer).' : 'Open the installed app in Chrome.'}</p>
  if (state === 'blocked') return <p style={box}>Notifications are blocked for this app. Allow them in your phone's settings for this app or browser, then reload.</p>
  return (
    <div style={box}>
      <b>Phone notifications:</b> {state === 'on' ? 'on' : 'off'}{' '}
      {state === 'on'
        ? <><button type="button" className="chip" disabled={busy} onClick={disable}>Turn off</button>{isAdmin && <button type="button" className="chip" disabled={busy} onClick={test} style={{ marginLeft: 6 }}>Send test</button>}</>
        : <button type="button" className="chip active" disabled={busy} onClick={enable}>Turn on</button>}
      {msg && <div style={{ marginTop: 4 }}>{msg}</div>}
    </div>
  )
}
