import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'

export default function ChangePin() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [currentPin, setCurrentPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [done, setDone] = useState(false)

  const onlyDigits = (v) => v.replace(/\D/g, '').slice(0, 4)

  async function submit() {
    setMsg('')
    if (newPin.length !== 4) { setMsg('New PIN must be exactly 4 digits.'); return }
    if (newPin !== confirmPin) { setMsg('The new PIN and confirmation do not match.'); return }
    if (newPin === currentPin) { setMsg('New PIN is the same as your current one.'); return }

    setBusy(true)

    // The server checks the current PIN, uniqueness, and that it's my own
    // account, then stores the new PIN (hashed). It is used for sign-in at once.
    const { data, error } = await db.rpc('change_my_pin', {
      current_pin: currentPin,
      new_pin: newPin,
    })

    setBusy(false)

    if (error) { setMsg(`Something went wrong: ${error.message}`); return }
    if (!data?.ok) {
      setMsg(data?.error || 'Could not change PIN.')
      return
    }

    setDone(true)
    setCurrentPin(''); setNewPin(''); setConfirmPin('')
  }

  if (done) {
    return (
      <div className="screen" style={{ textAlign: 'center', paddingTop: 40 }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>
          <i className="ti ti-circle-check" style={{ color: 'var(--success)' }} aria-hidden="true" />
        </div>
        <p className="page-title">PIN changed</p>
        <p className="page-sub">Use your new PIN next time you sign in.</p>
        <button className="btn-primary" style={{ maxWidth: 240, margin: '14px auto 0' }} onClick={() => navigate('/')}>
          Back to home
        </button>
      </div>
    )
  }

  return (
    <div className="screen" style={{ maxWidth: 420 }}>
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate(-1)}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <p className="page-title">Change my PIN</p>
      <p className="page-sub">{profile?.name ? `Signed in as ${profile.name}. ` : ''}Enter your current PIN, then choose a new 4-digit PIN.</p>

      <div className="field">
        <label>Current PIN</label>
        <input inputMode="numeric" type="password" value={currentPin}
          onChange={(e) => setCurrentPin(onlyDigits(e.target.value))} placeholder="••••" />
      </div>
      <div className="field">
        <label>New PIN (4 digits)</label>
        <input inputMode="numeric" type="password" value={newPin}
          onChange={(e) => setNewPin(onlyDigits(e.target.value))} placeholder="••••" />
      </div>
      <div className="field">
        <label>Confirm new PIN</label>
        <input inputMode="numeric" type="password" value={confirmPin}
          onChange={(e) => setConfirmPin(onlyDigits(e.target.value))} placeholder="••••"
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>

      {msg && <div className="banner-warn">{msg}</div>}

      <button className="btn-primary" onClick={submit}
        disabled={busy || !currentPin || !newPin || !confirmPin}>
        {busy ? 'Saving…' : 'Change PIN'}
      </button>

      <p className="page-sub" style={{ marginTop: 14 }}>
        Forgot your current PIN? You can't change it yourself — ask an administrator to reset it for you.
      </p>
    </div>
  )
}
