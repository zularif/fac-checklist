import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/db'
import { useIsAdmin } from '../../lib/useIsAdmin'
import { expiryState, daysToExpiry, EXPIRY_WARN_DAYS } from '../../lib/feHelpers'

function fmt(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function FEExpiry() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [units, setUnits] = useState([])
  const [floors, setFloors] = useState([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  // bulk renewal
  const [renewDate, setRenewDate] = useState('')
  const [newDate, setNewDate] = useState('')
  const [renewing, setRenewing] = useState(false)
  const [renewMsg, setRenewMsg] = useState('')

  async function load() {
    setLoading(true)
    const { data: fl } = await db.from('fe_floors').select('id, building, floor_name')
    setFloors(fl || [])
    const { data } = await db
      .from('fire_extinguishers')
      .select('id, fe_code, fe_type, serial_no, location_desc, expiry_date, floor_id')
      .eq('status', 'Active')
    setUnits(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const floorInfo = useMemo(() => {
    const m = {}
    for (const f of floors) m[f.id] = { building: f.building, name: f.floor_name }
    return m
  }, [floors])

  // group expired + expiring by plant -> floor
  const summary = useMemo(() => {
    const flagged = units
      .map((u) => ({ ...u, state: expiryState(u.expiry_date), info: floorInfo[u.floor_id] }))
      .filter((u) => u.state === 'expired' || u.state === 'expiring')

    const byPlant = {}
    for (const u of flagged) {
      const plant = u.info?.building || 'Unknown'
      const floorName = u.info?.name || 'Unknown'
      const p = (byPlant[plant] ||= { plant, expired: 0, expiring: 0, floors: {}, units: [] })
      p[u.state === 'expired' ? 'expired' : 'expiring']++
      const f = (p.floors[floorName] ||= { floorName, expired: 0, expiring: 0, units: [] })
      f[u.state === 'expired' ? 'expired' : 'expiring']++
      f.units.push(u)
      p.units.push(u)
    }
    return Object.values(byPlant).sort((a, b) => a.plant.localeCompare(b.plant))
  }, [units, floorInfo])

  const totalExpired = summary.reduce((n, p) => n + p.expired, 0)
  const totalExpiring = summary.reduce((n, p) => n + p.expiring, 0)

  const emailDraft = useMemo(() => {
    if (!summary.length) return ''
    const lines = []
    lines.push('Subject: Fire Extinguisher Recharge / Replacement Request')
    lines.push('')
    lines.push('Dear Sir/Madam,')
    lines.push('')
    lines.push('Please arrange to service the following fire extinguishers that are expired or due to expire within the next three weeks:')
    lines.push('')
    for (const p of summary) {
      lines.push(`Plant ${p.plant} — ${p.expired} expired, ${p.expiring} expiring soon:`)
      const floorNames = Object.keys(p.floors).sort()
      for (const fn of floorNames) {
        const f = p.floors[fn]
        lines.push(`  ${fn}:`)
        for (const u of f.units.sort((a, b) => (a.expiry_date || '').localeCompare(b.expiry_date || ''))) {
          const tag = u.state === 'expired' ? 'EXPIRED' : 'expiring'
          const sn = u.serial_no ? `, S/N ${u.serial_no}` : ''
          lines.push(`    - ${u.fe_code} (${u.fe_type}${sn}) — ${u.location_desc || 'location n/a'} — ${tag} ${fmt(u.expiry_date)}`)
        }
      }
      lines.push('')
    }
    lines.push(`Total: ${totalExpired} expired, ${totalExpiring} expiring soon.`)
    lines.push('')
    lines.push('Kindly confirm your collection schedule and the expected return date.')
    lines.push('')
    lines.push('Thank you.')
    return lines.join('\n')
  }, [summary, totalExpired, totalExpiring])

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(emailDraft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setRenewMsg('Copy failed — select the text manually.')
    }
  }

  // units matching the chosen expiry date exactly
  const renewMatches = useMemo(
    () => (renewDate ? units.filter((u) => u.expiry_date === renewDate) : []),
    [units, renewDate]
  )

  // distinct existing expiry dates (for the picker hint)
  const existingDates = useMemo(() => {
    const counts = {}
    for (const u of units) if (u.expiry_date) counts[u.expiry_date] = (counts[u.expiry_date] || 0) + 1
    return Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]))
  }, [units])

  async function applyRenewal() {
    if (!renewDate || !newDate) { setRenewMsg('Pick both the current date and the new date.'); return }
    if (!renewMatches.length) { setRenewMsg('No extinguishers have that expiry date.'); return }
    setRenewing(true)
    setRenewMsg('')
    const ids = renewMatches.map((u) => u.id)
    const { error } = await db
      .from('fire_extinguishers')
      .update({ expiry_date: newDate })
      .in('id', ids)
    if (error) {
      setRenewMsg(`Couldn't update: ${error.message}`)
    } else {
      setRenewMsg(`Updated ${ids.length} extinguisher(s) to ${fmt(newDate)}.`)
      setRenewDate('')
      setNewDate('')
      load()
    }
    setRenewing(false)
  }

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/fe')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back to map
      </button>
      <p className="page-title">Expiry &amp; renewal</p>
      <p className="page-sub">Expired and soon-to-expire units, a vendor email draft, and batch renewal.</p>

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : (
        <>
          {/* summary */}
          <div className="stat-grid-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="stat-card">
              <div className="stat-ic" style={{ background: 'var(--danger-tint)', color: 'var(--danger)' }}><i className="ti ti-alert-triangle" aria-hidden="true" /></div>
              <div><p className="stat-val" style={{ color: 'var(--danger)' }}>{totalExpired}</p><p className="stat-lbl">Expired</p></div>
            </div>
            <div className="stat-card">
              <div className="stat-ic" style={{ background: 'var(--warning-tint)', color: 'var(--warning)' }}><i className="ti ti-clock-exclamation" aria-hidden="true" /></div>
              <div><p className="stat-val" style={{ color: 'var(--warning)' }}>{totalExpiring}</p><p className="stat-lbl">Expiring ≤ {EXPIRY_WARN_DAYS}d</p></div>
            </div>
          </div>

          {summary.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
              Nothing expired or expiring soon. 🎉
            </div>
          ) : (
            <>
              {summary.map((p) => (
                <div className="card" key={p.plant}>
                  <p className="eq-t">Plant {p.plant}</p>
                  <p className="eq-s">{p.expired} expired · {p.expiring} expiring soon</p>
                  <div style={{ marginTop: 6 }}>
                    {Object.values(p.floors).sort((a, b) => a.floorName.localeCompare(b.floorName)).map((f) => (
                      <div key={f.floorName} className="fe-floor-line">
                        <span>{f.floorName}</span>
                        <span>
                          {f.expired > 0 && <span className="pill pill-danger" style={{ marginLeft: 4 }}>{f.expired} expired</span>}
                          {f.expiring > 0 && <span className="pill pill-warn" style={{ marginLeft: 4 }}>{f.expiring} soon</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* email draft */}
              <p className="section-label">Vendor email draft</p>
              <p className="page-sub">Copy this and paste into your email app. Nothing is sent automatically.</p>
              <textarea className="email-draft" rows={12} readOnly value={emailDraft} />
              <button className="btn-primary" onClick={copyDraft}>
                <i className="ti ti-copy" aria-hidden="true" />{copied ? 'Copied!' : 'Copy email draft'}
              </button>
            </>
          )}

          {/* bulk renewal */}
          {isAdmin && (
            <>
              <p className="section-label">Batch renewal</p>
              <p className="page-sub">When the vendor returns a recharged batch, update them all at once by their shared expiry date.</p>
              <div className="card">
                <div className="field"><label>Current expiry date of the batch</label>
                  <input type="date" value={renewDate} onChange={(e) => { setRenewDate(e.target.value); setRenewMsg('') }} list="fe-existing-dates" />
                  <datalist id="fe-existing-dates">
                    {existingDates.map(([d, n]) => <option key={d} value={d}>{fmt(d)} — {n} unit(s)</option>)}
                  </datalist>
                </div>

                {renewDate && (
                  <p className="eq-s" style={{ marginBottom: 8 }}>
                    {renewMatches.length} extinguisher(s) currently expire on {fmt(renewDate)}.
                  </p>
                )}

                <div className="field"><label>New certification / expiry date</label>
                  <input type="date" value={newDate} onChange={(e) => { setNewDate(e.target.value); setRenewMsg('') }} />
                </div>

                {renewMsg && <div className={renewMsg.startsWith('Updated') ? 'banner-ok' : 'banner-warn'}>{renewMsg}</div>}

                <button className="btn-primary" onClick={applyRenewal} disabled={renewing || !renewDate || !newDate || !renewMatches.length}>
                  {renewing ? 'Updating…' : renewMatches.length ? `Renew ${renewMatches.length} unit(s)` : 'Renew'}
                </button>

                {renewDate && renewMatches.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <p className="eq-s" style={{ marginBottom: 4 }}>Affected units:</p>
                    <div className="fe-renew-list">
                      {renewMatches.map((u) => (
                        <span key={u.id} className="pill pill-blue" style={{ marginRight: 4, marginBottom: 4, display: 'inline-block' }}>{u.fe_code}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
