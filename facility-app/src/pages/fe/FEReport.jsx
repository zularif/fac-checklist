import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SignatureCanvas from 'react-signature-canvas'
import { db } from '../../lib/db'
import { isFailValue } from '../../lib/feHelpers'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// short column headings for the printed table
const SHORT = {
  'Physical Condition': 'Physical',
  'Rivet Pin': 'Rivet Pin',
  'Pressure Gauge': 'Pressure',
  'Discharge Hose / Nozzle': 'Hose',
  'Handle': 'Handle',
  'Label': 'Label',
  'Visibility': 'Visibility',
}

const INSTRUCTIONS = [
  'Physical condition must be free from damage and corrosion.',
  'Rivet pin and tamper seal must be intact.',
  'Pressure gauge must be within normal range.',
  'Discharge hose/nozzle must be in good condition.',
  'Handle must not be damaged.',
  'Label must be clear and readable.',
  'Extinguisher must remain visible and unobstructed.',
]

function fmtFull(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function FEReport() {
  const navigate = useNavigate()
  const now = new Date()

  const [buildings, setBuildings] = useState([])
  const [building, setBuilding] = useState('')
  const [month, setMonth] = useState(now.getMonth())
  const [year, setYear] = useState(now.getFullYear())
  const [scope, setScope] = useState('Inspected') // Inspected | All
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)

  const [preparedBy, setPreparedBy] = useState('')
  const [verifiedBy, setVerifiedBy] = useState('')
  const [prepImg, setPrepImg] = useState(null)
  const [verImg, setVerImg] = useState(null)
  const [signedAt, setSignedAt] = useState(null)
  const prepRef = useRef(null)
  const verRef = useRef(null)

  useEffect(() => {
    db.from('fe_floors').select('building').then(({ data }) => {
      const list = [...new Set((data || []).map((f) => f.building))].sort()
      setBuildings(list)
      if (list.length) setBuilding(list[0])
    })
  }, [])

  const years = useMemo(() => {
    const list = []
    for (let y = now.getFullYear() + 1; y >= now.getFullYear() - 3; y--) list.push(y)
    return list
  }, [now])

  async function generate() {
    if (!building) return
    setLoading(true)
    setPrepImg(null)
    setVerImg(null)

    const start = new Date(year, month, 1).toISOString()
    const end = new Date(year, month + 1, 1).toISOString()

    const { data: floorRows } = await db
      .from('fe_floors').select('id, floor_name').eq('building', building)
    const floorIds = (floorRows || []).map((f) => f.id)
    const floorName = Object.fromEntries((floorRows || []).map((f) => [f.id, f.floor_name]))

    const { data: units } = await db
      .from('fire_extinguishers')
      .select('id, fe_code, fe_type, location_desc, floor_id')
      .in('floor_id', floorIds.length ? floorIds : ['00000000-0000-0000-0000-000000000000'])
      .eq('status', 'Active')
      .order('fe_code')

    const unitIds = (units || []).map((u) => u.id)
    const { data: insps } = await db
      .from('fe_inspections')
      .select('id, fe_id, inspection_date, remarks, technician:technicians(name)')
      .in('fe_id', unitIds.length ? unitIds : ['00000000-0000-0000-0000-000000000000'])
      .gte('inspection_date', start).lt('inspection_date', end)
      .order('inspection_date')

    // latest inspection per unit within the month
    const inspByUnit = {}
    for (const i of insps || []) inspByUnit[i.fe_id] = i
    const inspIds = Object.values(inspByUnit).map((i) => i.id)

    const { data: details } = await db
      .from('fe_inspection_details')
      .select('inspection_id, parameter_name, value, computed_status')
      .in('inspection_id', inspIds.length ? inspIds : ['00000000-0000-0000-0000-000000000000'])

    const detailsByInsp = {}
    for (const d of details || []) (detailsByInsp[d.inspection_id] ||= []).push(d)

    const { data: templates } = await db
      .from('fe_checklist_templates').select('*').order('sort_order')

    // column order from the templates (same 7 across types)
    const seen = new Set()
    const columns = []
    for (const t of (templates || [])) {
      if (!seen.has(t.parameter_name)) { seen.add(t.parameter_name); columns.push(t.parameter_name) }
    }
    const tplByTypeParam = {}
    for (const t of templates || []) tplByTypeParam[`${t.fe_type}|${t.parameter_name}`] = t

    const rows = (units || [])
      .map((u) => {
        const insp = inspByUnit[u.id]
        const vals = {}
        for (const d of detailsByInsp[insp?.id] || []) vals[d.parameter_name] = d.value
        return {
          unit: u,
          floorName: floorName[u.floor_id] || '',
          inspected: !!insp,
          date: insp?.inspection_date || null,
          technician: insp?.technician?.name || '',
          remarks: insp?.remarks || '',
          values: vals,
        }
      })
      .filter((r) => (scope === 'All' ? true : r.inspected))

    setReport({ columns, rows, tplByTypeParam, totalUnits: (units || []).length })
    setLoading(false)
  }

  function applySignatures() {
    if (prepRef.current && !prepRef.current.isEmpty()) setPrepImg(prepRef.current.getCanvas().toDataURL('image/png'))
    if (verRef.current && !verRef.current.isEmpty()) setVerImg(verRef.current.getCanvas().toDataURL('image/png'))
    setSignedAt(new Date())
  }

  function exportCSV() {
    if (!report) return
    const head = ['Tag No.', 'Location', 'Floor', 'Type', 'Date', 'Technician', ...report.columns.map((c) => SHORT[c] || c), 'Remark']
    const lines = [head]
    for (const r of report.rows) {
      lines.push([
        r.unit.fe_code, r.unit.location_desc || '', r.floorName, r.unit.fe_type,
        r.date ? fmtFull(r.date) : '', r.technician,
        ...report.columns.map((c) => r.values[c] ?? ''),
        r.remarks,
      ])
    }
    const csv = lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `FE-inspection-${building}-${MONTHS[month]}-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // how a cell prints: ✓ for pass, the value in red for a defect,
  // and the literal text for single-option parameters like "N/A (CO2)"
  function cellFor(row, param) {
    if (!row.inspected) return { text: '—', bad: false, plain: true }
    const v = row.values[param]
    if (v === undefined || v === '') return { text: '—', bad: false, plain: true }
    const tpl = report.tplByTypeParam[`${row.unit.fe_type}|${param}`]
    if (tpl && isFailValue(tpl, v)) return { text: v, bad: true, plain: false }
    const opts = (tpl?.options || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (opts.length <= 1) return { text: v, bad: false, plain: true }
    return { text: '✓', bad: false, plain: false }
  }

  const defectCount = report
    ? report.rows.reduce((n, r) => n + report.columns.filter((c) => cellFor(r, c).bad).length, 0)
    : 0

  return (
    <div className="screen">
      <div className="no-print">
        <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/fe')}>
          <i className="ti ti-arrow-left" aria-hidden="true" />Back
        </button>
        <p className="page-title">Fire extinguisher report</p>
        <p className="page-sub">Monthly inspection checklist per plant.</p>

        <div className="field"><label>Plant</label>
          <select value={building} onChange={(e) => setBuilding(e.target.value)}>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="btn-row">
          <div className="field" style={{ flex: 1 }}><label>Month</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}><label>Year</label>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <p className="field-label">Include</p>
        <div className="chip-row">
          {['Inspected', 'All'].map((s) => (
            <button key={s} className={scope === s ? 'chip active' : 'chip'} onClick={() => setScope(s)}>
              {s === 'Inspected' ? 'Inspected only' : 'All extinguishers'}
            </button>
          ))}
        </div>

        <button className="btn-primary" onClick={generate} disabled={loading || !building}>
          {loading ? 'Generating…' : 'Generate report'}
        </button>

        {report && (
          <>
            <p className="section-label">Signatures</p>
            <p className="page-sub">Sign before printing — both appear at the bottom of the report.</p>

            {prepImg || verImg ? (
              <div className="card">
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {prepImg && <div style={{ textAlign: 'center' }}><img src={prepImg} alt="prepared by" style={{ height: 50 }} /><p className="list-card-meta">{preparedBy || 'Person in-charge'}</p></div>}
                  {verImg && <div style={{ textAlign: 'center' }}><img src={verImg} alt="verified by" style={{ height: 50 }} /><p className="list-card-meta">{verifiedBy || 'Supervisor'}</p></div>}
                </div>
                <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => { setPrepImg(null); setVerImg(null) }}>Re-sign</button>
              </div>
            ) : (
              <>
                <div className="field"><label>Prepared by (person in-charge)</label>
                  <input value={preparedBy} onChange={(e) => setPreparedBy(e.target.value)} placeholder="Name" />
                </div>
                <div className="sig-pad"><SignatureCanvas ref={prepRef} canvasProps={{ className: 'sig-canvas' }} /></div>
                <button className="btn-secondary" onClick={() => prepRef.current?.clear()} style={{ marginBottom: 12 }}>Clear</button>

                <div className="field"><label>Verified by (supervisor)</label>
                  <input value={verifiedBy} onChange={(e) => setVerifiedBy(e.target.value)} placeholder="Name" />
                </div>
                <div className="sig-pad"><SignatureCanvas ref={verRef} canvasProps={{ className: 'sig-canvas' }} /></div>
                <div className="btn-row">
                  <button className="btn-secondary" onClick={() => verRef.current?.clear()}>Clear</button>
                  <button className="btn-secondary" onClick={applySignatures}>Apply signatures</button>
                </div>
              </>
            )}

            <div className="btn-row" style={{ marginTop: 12 }}>
              <button className="btn-secondary" onClick={exportCSV}><i className="ti ti-download" aria-hidden="true" />Export CSV</button>
              <button className="btn-primary" onClick={() => window.print()}><i className="ti ti-printer" aria-hidden="true" />Print / PDF</button>
            </div>

            <p className="page-sub" style={{ marginTop: 10 }}>
              {report.rows.length} row(s) · {defectCount} defect(s) · {report.totalUnits} extinguisher(s) in {building}
            </p>
          </>
        )}
      </div>

      {/* ---------- printed report ---------- */}
      {report && (
        <div className="print-only fer-doc">
          <div className="fer-head">
            <img src="/wiwynn-logo.png" alt="" className="fer-logo" onError={(e) => { e.target.style.display = 'none' }} />
          </div>
          <p className="fer-title">Fire Fighting Equipment Inspection Checklist</p>
          <p className="fer-sub">
            <span>Plant: {building}</span>
            <span>Month: {MONTHS[month]}</span>
            <span>Year: {year}</span>
          </p>
          <div className="fer-rule" />

          <table className="fer-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Tag No.</th>
                <th style={{ textAlign: 'left' }}>Location</th>
                {report.columns.map((c) => <th key={c}>{SHORT[c] || c}</th>)}
                <th style={{ textAlign: 'left' }}>Remark</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.unit.id}>
                  <td style={{ textAlign: 'left' }}>{r.unit.fe_code}</td>
                  <td style={{ textAlign: 'left' }}>{r.unit.location_desc || r.floorName}</td>
                  {report.columns.map((c) => {
                    const cell = cellFor(r, c)
                    return <td key={c} className={cell.bad ? 'fer-bad' : cell.plain ? 'fer-plain' : 'fer-ok'}>{cell.text}</td>
                  })}
                  <td style={{ textAlign: 'left' }}>{r.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="fer-inst-title">Inspection Instructions</p>
          <ol className="fer-inst">
            {INSTRUCTIONS.map((t) => <li key={t}>{t}</li>)}
          </ol>

          <div className="fer-signs">
            <div className="fer-sign">
              <div className="fer-sign-box">{prepImg && <img src={prepImg} alt="prepared by signature" />}</div>
              <div className="fer-sign-line" />
              <p className="fer-sign-label">Prepared By (Person in-charge)</p>
              <p className="fer-sign-name">{preparedBy || '\u00A0'}</p>
              <p className="fer-sign-date">{signedAt ? `Date: ${fmtFull(signedAt)}` : '\u00A0'}</p>
            </div>
            <div className="fer-sign">
              <div className="fer-sign-box">{verImg && <img src={verImg} alt="verified by signature" />}</div>
              <div className="fer-sign-line" />
              <p className="fer-sign-label">Verified By (Supervisor)</p>
              <p className="fer-sign-name">{verifiedBy || '\u00A0'}</p>
              <p className="fer-sign-date">{signedAt ? `Date: ${fmtFull(signedAt)}` : '\u00A0'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
