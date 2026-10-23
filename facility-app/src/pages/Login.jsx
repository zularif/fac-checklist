import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { loginWithPinOnly } = useAuth()
  const navigate = useNavigate()
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const MAX = 4

  function press(digit) {
    if (busy) return
    setError('')
    setPin((p) => (p.length < MAX ? p + digit : p))
  }
  function backspace() {
    setError('')
    setPin((p) => p.slice(0, -1))
  }
  async function submit() {
    if (pin.length < MAX || busy) return
    setBusy(true)
    setError('')
    const { error } = await loginWithPinOnly(pin)
    setBusy(false)
    if (error) {
      setError('Incorrect PIN')
      setPin('')
    } else {
      navigate('/')
    }
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

  return (
    <div className="pin-screen">
      <div className="pin-card">
        <div className="pin-lock"><i className="ti ti-lock" aria-hidden="true" /></div>
        <p className="pin-title">Technician Access</p>
        <p className="pin-sub">Enter your PIN to continue</p>

        <div className="pin-dots">
          {Array.from({ length: MAX }).map((_, i) => (
            <span key={i} className={'pin-dot' + (i < pin.length ? ' filled' : '')} />
          ))}
        </div>

        {error && <p className="pin-error">{error}</p>}

        <div className="pin-grid">
          {keys.map((k) => (
            <button key={k} className="pin-key" onClick={() => press(k)} disabled={busy}>{k}</button>
          ))}
          <button className="pin-key pin-key-back" onClick={backspace} disabled={busy} aria-label="Delete">
            <i className="ti ti-backspace" aria-hidden="true" />
          </button>
          <button className="pin-key" onClick={() => press('0')} disabled={busy}>0</button>
          <button className="pin-key pin-key-ok" onClick={submit} disabled={busy || pin.length < MAX}>
            {busy ? '…' : 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
