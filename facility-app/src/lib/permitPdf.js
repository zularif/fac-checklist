// Builds the application PDF and the ZIP (PDF + uploaded documents) for one vendor permit application.
// The PDF and ZIP libraries are loaded only when the button is pressed.

const NAVY = [20, 33, 61], AMBER = [252, 163, 17], GREY = [243, 244, 246]
export const DOC_LABELS = ['Method of Statement (MOS)', 'HIRARC', 'Project Timeline', 'Safety Personnel Certificate', 'Drawing Layout', 'Machine Certificate', 'Safety Data Sheet (SDS)']

// The built-in PDF fonts only cover Western characters; anything else becomes "?".
const t = (v) => String(v ?? '').replace(/[^\u0009\u000a -ÿ]/g, '?').trim() || '-'
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB')
const day = (s) => (s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')
const stamp = (s) => (s ? new Date(s).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kuala_Lumpur' }) : '-')
// File name inside the ZIP: keep the extension even when the name is long; no characters Windows rejects.
export const fitName = (s, max = 110) => {
  const clean = String(s || 'file').replace(/[^A-Za-z0-9._ ()&,'+-]/g, '_')
  const m = /(\.[A-Za-z0-9]{1,5})$/.exec(clean)
  const ext = m ? m[1] : ''
  const base = clean.slice(0, clean.length - ext.length).replace(/[. ]+$/, '').slice(0, max - ext.length) || 'file'
  return base + ext
}
export const safe = (s) => String(s || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 60)

export async function buildPermitPdf(r) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const d = r.data || {}, files = r.files || []
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const M = 14, W = 210 - 2 * M
  let y = 0

  doc.setFillColor(...NAVY); doc.rect(0, 0, 210, 24, 'F')
  doc.setFillColor(...AMBER); doc.rect(0, 24, 210, 1.6, 'F')
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15)
  doc.text('VENDOR WORK PERMIT APPLICATION', M, 12)
  doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
  doc.text(`Ref: ${t(r.ref)}   |   Status: ${t(r.status)}   |   Submitted: ${stamp(r.created_at)}`, M, 19)
  doc.setTextColor(0, 0, 0)
  y = 31

  const next = () => (doc.lastAutoTable?.finalY ?? y) + 5
  const head = (title, cols = 2) => [[{ content: title, colSpan: cols, styles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10 } }]]
  const room = (need) => { if (y > 297 - need) { doc.addPage(); y = 16 } }
  const kv = (title, rows) => {
    room(18 + rows.length * 8)
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: 'grid', head: head(title),
      body: rows.map(([k, v]) => [k, t(v)]),
      styles: { fontSize: 9, cellPadding: 1.8, lineColor: [200, 205, 212], lineWidth: 0.15 },
      columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', fillColor: GREY, textColor: NAVY }, 1: { cellWidth: W - 52 } },
    })
    y = next()
  }
  const grid = (title, columns, rows, empty = 'None') => {
    room(26 + rows.length * 8)
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [...head(title, columns.length), columns.map((c) => ({ content: c, styles: { fillColor: GREY, textColor: NAVY, fontStyle: 'bold' } }))],
      body: rows.length ? rows.map((row) => row.map(t)) : [[{ content: empty, colSpan: columns.length, styles: { textColor: [120, 120, 120], fontStyle: 'italic' } }]],
      styles: { fontSize: 9, cellPadding: 1.8, lineColor: [200, 205, 212], lineWidth: 0.15 },
    })
    y = next()
  }

  kv('PART A - HOST DETAILS', [['Host Name', d.host?.name], ['Host Email', d.host?.email], ['Host Mobile', d.host?.phone]])
  kv('PART B - PERMIT REQUESTOR (PR) DETAILS - VENDOR DETAILS', [
    ['Requestor Name', r.requestor_name], ['Requestor Position', r.requestor_position],
    ['Requestor Company', r.requestor_company], ['Requestor Contact No.', r.requestor_contact],
  ])
  kv('PART C - PROJECT DETAILS', [
    ['Request Type', r.request_type], ['Project / Activity Title', r.title], ['Work Description', r.description],
    ['Plant', r.plant], ['PO Number', r.po_number], ['Total Workers', r.total_workers],
    ['Start Date', day(r.start_date)], ['Target Completion Date', day(r.target_date)],
    ['Work Category', r.work_category],
    ...(d.locations?.length ? d.locations.map((l) => [`Work Location - ${l.area}`, l.specific]) : [['Work Location', r.work_location]]),
    ['Applicable Permit(s)', r.permit_types],
  ])
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...NAVY)
  if (y > 255) { doc.addPage(); y = 16 }
  doc.text('PART D - MACHINE / EQUIPMENT / CHEMICAL DETAILS', M, y); y += 3; doc.setTextColor(0, 0, 0)
  grid('A. Machine', ['Machine Name', 'Quantity'], (d.machines || []).map((x) => [x.name, x.qty]))
  grid('B. Equipment', ['Equipment Name', 'Quantity'], (d.equipment || []).map((x) => [x.name, x.qty]))
  grid('C. Chemical', ['Chemical Name', 'Quantity / Volume'], (d.chemicals || []).map((x) => [x.name, x.qty]))
  const mc = d.mainconSafety || {}
  kv('PART E - SAFETY PERSONNEL DETAILS: MAIN CONTRACTOR', [
    ['Maincon Safety Name', mc.name], ['Maincon Company Name', mc.company], ['Maincon Registration DOSH', mc.dosh],
  ])
  grid('Sub-Contractor Details', ['Company Name', 'Safety Full Name', 'DOSH Registration No.'], (d.subcontractors || []).map((x) => [x.company, x.safetyName, x.dosh]))
  grid('PART F - SUPPORTING DOCUMENTS', ['Document', 'File name', 'Size'],
    DOC_LABELS.map((label) => { const fs = files.filter((x) => x.label === label); return [label, fs.length ? fs.map((x) => x.name).join(', ') : 'Not provided', fs.length ? kb(fs.reduce((n, x) => n + (x.origSize || x.size || 0), 0)) : '-'] }))
  room(60)
  autoTable(doc, {
    startY: y, margin: { left: M, right: M }, theme: 'grid', head: head('OFFICE USE ONLY'),
    body: [['Reviewed by', ''], ['Date', ''], ['Decision', 'Approved  /  Rejected'], ['Remarks', '\n\n']],
    styles: { fontSize: 9, cellPadding: 2, lineColor: [200, 205, 212], lineWidth: 0.15 },
    columnStyles: { 0: { cellWidth: 52, fontStyle: 'bold', fillColor: GREY, textColor: NAVY } },
  })

  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(110, 110, 110); doc.setFont('helvetica', 'normal')
    doc.text(`${t(r.ref)}  -  Page ${i} of ${n}`, 105, 290, { align: 'center' })
  }
  return doc.output('blob')
}

export async function buildPermitZip(r, fetchBlob, onProgress = () => {}) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file(`${safe(r.ref)}_Application.pdf`, await buildPermitPdf(r))
  const folder = zip.folder('Documents')
  const files = r.files || []
  const used = new Set()
  for (let i = 0; i < files.length; i++) {
    onProgress(i + 1, files.length)
    let name = fitName(`${files[i].label} - ${files[i].name}`)
    for (let n = 2; used.has(name.toLowerCase()); n++) name = fitName(`${files[i].label} - ${n} - ${files[i].name}`)
    used.add(name.toLowerCase())
    folder.file(name, await fetchBlob(files[i]))
  }
  const out = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  // Re-open the finished ZIP and check every entry before offering it, so a bad file is never downloaded.
  const check = await JSZip.loadAsync(out, { checkCRC32: true })
  const bad = []
  for (const entry of Object.values(check.files)) if (!entry.dir) { try { await entry.async('uint8array') } catch { bad.push(entry.name) } }
  if (bad.length) throw new Error('The ZIP failed its own check (' + bad.join(', ') + '). Please try again.')
  return out
}
