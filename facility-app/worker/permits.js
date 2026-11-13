// Vendor work permit applications.
//   POST /api/public/permit   (no sign-in) multipart: field "data" (JSON) + files "f_<doc>"
//   permit_set_status         (staff)  change the status of an application
//   permit_delete             (Admin)  delete an application and its files
// Files are compressed in the vendor's browser first and kept in the FILES (KV) store.

import { apiError } from './schema.js'

export const DOC_TYPES = {
  mos: 'Method of Statement (MOS)', hirarc: 'HIRARC', timeline: 'Project Timeline',
  safetycert: 'Safety Personnel Certificate', drawing: 'Drawing Layout',
  machinecert: 'Machine Certificate', sds: 'Safety Data Sheet (SDS)',
}
const STATUSES = ['New', 'Reviewing', 'Approved', 'Rejected', 'Closed']
const ALLOWED = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png']
const MAX_FILE = 5 * 1024 * 1024       // per file, after compression
const MAX_TOTAL = 20 * 1024 * 1024     // per application, after compression
const MAX_PER_HOUR = 10                // applications per network address per hour

const text = (v, max = 300) => String(v ?? '').trim().slice(0, max)
const req = (v, label, max) => { const t = text(v, max); if (!t) throw apiError(`${label} is required.`, 'P0001', 400); return t }
// Documents go to the R2 bucket (binding PERMITS) when it is connected; otherwise to the FILES KV store.
export const putDoc = (env, key, buf, meta) => env.PERMITS
  ? env.PERMITS.put(key, buf, { httpMetadata: { contentType: meta.contentType }, customMetadata: { encoding: meta.encoding || '', originalName: meta.originalName || '' } })
  : env.FILES.put(key, buf, { metadata: meta })
export const deleteDoc = (env, key) => (env.PERMITS ? env.PERMITS.delete(key) : env.FILES.delete(key))
export async function getDoc(env, key) {
  if (env.PERMITS) {
    const o = await env.PERMITS.get(key)
    if (o) return { body: o.body, contentType: o.httpMetadata?.contentType, encoding: o.customMetadata?.encoding }
  }
  const { value, metadata } = await env.FILES.getWithMetadata(key, 'arrayBuffer')
  return value === null ? null : { body: value, contentType: metadata?.contentType, encoding: metadata?.encoding }
}
const safeName = (s) => String(s).replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\.{2,}/g, '.').slice(0, 80) || 'file'

async function ipHash(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + (env.PIN_PEPPER || '')))
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
}
const newRef = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '') // Malaysia date
  const r = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().padStart(6, '0').slice(-4)
  return `VWP-${d}-${r}`
}
const list = (a, keys) => (Array.isArray(a) ? a.slice(0, 50).map((o) => Object.fromEntries(keys.map((k) => [k, text(o?.[k], 200)]))).filter((o) => Object.values(o).some(Boolean)) : [])

export async function submitPermit(env, request) {
  if (!env.DB || !(env.PERMITS || env.FILES)) throw apiError('Server is not set up.', 'CONFIG', 500)
  let form
  try { form = await request.formData() } catch { throw apiError('Invalid submission.', 'P0001', 400) }
  if (text(form.get('website'))) return { ok: true, ref: 'VWP-OK' } // hidden spam-trap field: pretend success
  let d
  try { d = JSON.parse(String(form.get('data') || '')) } catch { throw apiError('Invalid submission data.', 'P0001', 400) }

  const hash = await ipHash(request, env)
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM permits WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')").bind(hash).first()
  if ((recent?.n || 0) >= MAX_PER_HOUR) throw apiError('Too many applications from this network. Please try again later.', 'RATE', 429)

  const r = d.requestor || {}, p = d.project || {}, mc = d.mainconSafety || {}
  const rec = {
    requestor_name: req(r.name, 'Requestor name', 100), requestor_position: req(r.position, 'Requestor position', 100),
    requestor_company: req(r.company, 'Requestor company', 150), requestor_contact: req(r.contact, 'Requestor contact no.', 30),
    request_type: req(p.requestType, 'Request type', 20), title: req(p.title, 'Project title', 200), description: req(p.description, 'Work description', 3000),
    plant: req(p.plant, 'Plant', 5), po_number: text(p.po, 60), start_date: req(p.startDate, 'Start date', 10), target_date: req(p.targetCompletion, 'Target completion date', 10),
    work_category: text(p.category, 100), work_location: text(p.location, 200),
  }
  if (!['New', 'Renewal', 'Extension', 'Revision'].includes(rec.request_type)) throw apiError('Invalid request type.', 'P0001', 400)
  if (!['P1', 'P2'].includes(rec.plant)) throw apiError('Invalid plant.', 'P0001', 400)
  if (rec.target_date < rec.start_date) throw apiError('Completion date cannot be before the start date.', 'P0001', 400)
  const workers = Number(p.totalWorkers)
  if (!Number.isInteger(workers) || workers < 1 || workers > 10000) throw apiError('Total workers must be 1 or more.', 'P0001', 400)
  const permits = (Array.isArray(p.permits) ? p.permits : []).map((x) => text(x, 6)).filter((x) => ['GEN', 'WAH', 'HW', 'LP', 'CS', 'EXC', 'LOTO'].includes(x))
  if (!permits.length) throw apiError('Select at least one applicable permit.', 'P0001', 400)
  const big = workers >= 5
  if (big && !(text(mc.name) && text(mc.company) && text(mc.dosh))) throw apiError('Main contractor safety personnel details are required for 5 or more workers.', 'P0001', 400)

  // Files
  const incoming = {}
  let total = 0
  for (const key of Object.keys(DOC_TYPES)) {
    const f = form.get('f_' + key)
    if (!f || typeof f === 'string' || !f.size) continue
    let meta = {}
    try { meta = JSON.parse(String(form.get('m_' + key) || '{}')) } catch { /* use defaults */ }
    const origName = safeName(meta.name || f.name)
    if (!ALLOWED.includes(origName.split('.').pop().toLowerCase())) throw apiError(`${DOC_TYPES[key]}: file type not allowed.`, 'P0001', 400)
    if (f.size > MAX_FILE) throw apiError(`${DOC_TYPES[key]}: file is too large (5 MB maximum). Please reduce the file size.`, 'P0001', 413)
    total += f.size
    incoming[key] = { f, origName, encoding: meta.encoding === 'gzip' ? 'gzip' : '', type: String(meta.type || '').slice(0, 100) || 'application/octet-stream', origSize: Number(meta.origSize) || f.size }
  }
  if (total > MAX_TOTAL) throw apiError('The documents are too large in total (20 MB maximum).', 'P0001', 413)
  const needed = ['mos', 'hirarc', 'timeline', ...(big ? ['safetycert'] : [])]
  for (const k of needed) if (!incoming[k]) throw apiError(`${DOC_TYPES[k]} is required.`, 'P0001', 400)

  const data = {
    requestor: { name: rec.requestor_name, position: rec.requestor_position, company: rec.requestor_company, contact: rec.requestor_contact },
    project: { ...rec, permits, totalWorkers: workers },
    machines: list(d.machines, ['name', 'qty']), equipment: list(d.equipment, ['name', 'qty']), chemicals: list(d.chemicals, ['name', 'qty']),
    mainconSafety: { name: text(mc.name, 100), company: text(mc.company, 150), dosh: text(mc.dosh, 60) },
    subcontractors: list(d.subcontractors, ['company', 'safetyName', 'dosh']),
  }

  const id = crypto.randomUUID()
  let ref = newRef()
  const files = []
  const written = []
  try {
    for (const [doc, v] of Object.entries(incoming)) {
      const key = `permits/${id}/${doc}-${v.origName}`
      await putDoc(env, key, await v.f.arrayBuffer(), { contentType: v.type, encoding: v.encoding, originalName: v.origName, uploadedAt: new Date().toISOString() })
      written.push(key)
      files.push({ doc, label: DOC_TYPES[doc], name: v.origName, key: `${id}/${doc}-${v.origName}`, size: v.f.size, origSize: v.origSize, encoding: v.encoding, type: v.type })
    }
    for (let attempt = 0; ; attempt++) {
      try {
        await env.DB.prepare(`INSERT INTO permits (id, ref, requestor_name, requestor_position, requestor_company, requestor_contact, request_type, title, description, plant, po_number, total_workers, start_date, target_date, work_category, work_location, permit_types, data, files, ip_hash)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, ref, rec.requestor_name, rec.requestor_position, rec.requestor_company, rec.requestor_contact, rec.request_type, rec.title, rec.description, rec.plant, rec.po_number || null, workers, rec.start_date, rec.target_date, rec.work_category || null, rec.work_location || null, permits.join(', '), JSON.stringify(data), JSON.stringify(files), hash).run()
        break
      } catch (e) {
        if (attempt < 3 && /UNIQUE/i.test(String(e.message))) { ref = newRef(); continue }
        throw e
      }
    }
  } catch (e) {
    for (const k of written) await deleteDoc(env, k).catch(() => {})
    throw e.status ? e : apiError('Could not save the application. Please try again.', 'DB', 500)
  }
  return { ok: true, ref }
}

async function permit_set_status(ctx, body) {
  if (!ctx.actor) throw apiError('permission denied', '42501', 403)
  if (!STATUSES.includes(body.status)) throw apiError('Invalid status.', 'P0001', 400)
  const res = await ctx.db.prepare('UPDATE permits SET status = ? WHERE id = ?').bind(body.status, String(body.id || '')).run()
  if (!res.meta?.changes) throw apiError('Application not found.', 'P0001', 404)
  return { ok: true }
}

async function permit_delete(ctx, body) {
  if (ctx.actor?.role !== 'Admin') throw apiError('permission denied: administrator required', '42501', 403)
  const id = String(body.id || '')
  const row = await ctx.db.prepare('SELECT files FROM permits WHERE id = ?').bind(id).first()
  if (!row) throw apiError('Application not found.', 'P0001', 404)
  let files = []
  try { files = JSON.parse(row.files || '[]') } catch { /* none */ }
  for (const f of files) await deleteDoc(ctx.env, 'permits/' + f.key)
  await ctx.db.prepare('DELETE FROM permits WHERE id = ?').bind(id).run()
  return { ok: true }
}

export const PERMIT_RPC = { permit_set_status, permit_delete }
