import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html5Qrcode } from 'html5-qrcode'
import { db } from '../lib/db'
import { lookupByQr, lookupFeByQr } from '../lib/offlineCache'

const SCANNER_ID = 'qr-reader'

export default function Scan() {
  const navigate = useNavigate()
  const scannerRef = useRef(null)
  const handlingRef = useRef(false)   // guard: only handle one successful scan
  const mountedRef = useRef(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [manualCode, setManualCode] = useState('')

  useEffect(() => {
    mountedRef.current = true
    const scanner = new Html5Qrcode(SCANNER_ID)
    scannerRef.current = scanner
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        (decodedText) => { handleResult(decodedText) },
        () => {}
      )
      .catch(() => setError('Could not access the camera. Enter the equipment code manually below.'))

    return () => {
      mountedRef.current = false
      // stop() may already have been called; ignore any errors on teardown
      const s = scannerRef.current
      if (s) {
        try {
          if (s.isScanning) s.stop().then(() => s.clear()).catch(() => {})
          else s.clear()
        } catch { /* ignore */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fully stop the camera BEFORE navigating, so the scanner never fires a
  // callback against a page that no longer exists (which caused the blank screen).
  async function stopScanner() {
    const s = scannerRef.current
    if (!s) return
    try {
      if (s.isScanning) await s.stop()
      s.clear()
    } catch { /* ignore */ }
    scannerRef.current = null
  }

  async function resolveAndGo(code) {
    // Offline-first: local cache before the network so it works in dead zones.
    const cached = lookupByQr(code)
    if (cached) return `/checklist/${cached.equipment.equip_id}`
    const cachedFe = lookupFeByQr(code)
    if (cachedFe) return `/fe/checklist/${cachedFe.unit.fe_code}`

    const { data, error: eqErr } = await db.from('equipment').select('equip_id').eq('qr_code', code).single()
    if (data && !eqErr) return `/checklist/${data.equip_id}`

    const { data: fe } = await db.from('fire_extinguishers').select('fe_code').eq('qr_code', code).single()
    if (fe) return `/fe/checklist/${fe.fe_code}`

    return null
  }

  async function handleResult(code) {
    // The scanner fires repeatedly; only act on the first good read.
    if (handlingRef.current) return
    handlingRef.current = true
    setBusy(true)
    setError('')

    let target = null
    try {
      target = await resolveAndGo(code)
    } catch {
      target = null
    }

    if (!mountedRef.current) return

    if (!target) {
      setError(`Unrecognized code: ${code}. If you're offline, cache this area first from the Home screen.`)
      setBusy(false)
      handlingRef.current = false // allow another attempt
      return
    }

    // stop the camera fully, THEN navigate
    await stopScanner()
    if (mountedRef.current) navigate(target)
  }

  async function manualGo() {
    const code = manualCode.trim()
    if (!code) return
    setBusy(true)
    handlingRef.current = true
    // try to resolve the same way; if it doesn't match, still try as an equip_id
    let target = null
    try { target = await resolveAndGo(code) } catch { target = null }
    await stopScanner()
    navigate(target || `/checklist/${encodeURIComponent(code)}`)
  }

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={async () => { await stopScanner(); navigate(-1) }}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <p className="page-title">Scan equipment</p>
      <p className="page-sub">Point the camera at the equipment or extinguisher QR label.</p>

      <div id={SCANNER_ID} className="qr-box" />
      {busy && <p className="page-sub" style={{ marginTop: 8 }}>Opening…</p>}
      {error && <p className="error-text">{error}</p>}

      <p className="section-label">Or enter code manually</p>
      <div className="btn-row">
        <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} placeholder="EQ054 or QR-GF-OF-CO2-01"
          onKeyDown={(e) => { if (e.key === 'Enter') manualGo() }} />
        <button type="button" className="btn-primary" style={{ flex: '0 0 auto', width: 'auto', padding: '10px 20px' }} onClick={manualGo} disabled={busy}>Go</button>
      </div>
    </div>
  )
}
