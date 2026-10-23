// Server functions that replace the Postgres SECURITY DEFINER functions:
//   facility_save_inspection, facility_review, facility_asset_reference,
//   change_my_pin  (from supabase/*.sql)
// and the "manage-tech" Supabase Edge Function used by Manage staff.
//
// D1 has no interactive transactions, so each operation validates first and
// then writes everything in ONE db.batch() (atomic: all or nothing). Rows the
// decision depended on are re-checked inside the batch with _guard inserts,
// which abort the batch if another device changed them in between.

import { table, apiError, toTimestamp, toDate, formatRow } from './schema.js'
import { runBatch } from './query.js'
import { hashPin } from './auth.js'

const nowIso = () => new Date().toISOString()
const KL_OFFSET = 8 * 3600 * 1000 // Asia/Kuala_Lumpur, UTC+8, no DST
const klDate = (iso) => new Date(new Date(iso).getTime() + KL_OFFSET).toISOString().slice(0, 10)
const NUMBER_RE = /^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$/
const MAX_SNAPSHOT = 1_500_000 // stay well under D1's 2 MB row limit
const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k)

const GUARD_MESSAGES = {
  stale_revision: 'This inspection has changed. Reopen it before correcting.',
  expiry_changed: 'The extinguisher expiry date changed. Reopen the checklist to verify it.',
  already_reviewed: 'This was reviewed on another device. Refresh before reviewing.',
}

function kindTables(kind) {
  if (kind === 'equipment') return { ht: 'inspection_headers', dt: 'inspection_details', assetcol: 'equipment_id', notecol: 'notes' }
  if (kind === 'fe') return { ht: 'fe_inspections', dt: 'fe_inspection_details', assetcol: 'fe_id', notecol: 'remarks' }
  throw apiError('Unknown inspection type', 'P0001')
}

async function readHeader(db, ht, id) {
  const r = await db.prepare(`SELECT * FROM "${ht}" WHERE id = ?`).bind(id).first()
  return r ? formatRow(table(ht), r, Object.keys(table(ht).columns)) : null
}
async function readDetails(db, dt, id) {
  const t = table(dt)
  const res = await db.prepare(`SELECT * FROM "${dt}" WHERE inspection_id = ?`).bind(id).all()
  return res.results.map((r) => formatRow(t, r, Object.keys(t.columns)))
}

function snapshotJson(header, details) {
  let json = JSON.stringify({ header, details })
  if (json.length > MAX_SNAPSHOT) {
    // Photos stay on the live detail rows; history keeps the readings.
    json = JSON.stringify({ header, details: details.map((d) => (d.evidence ? { ...d, evidence: null, evidence_omitted: true } : d)) })
  }
  return json
}

const guard = (db, column, sql, ...binds) => db.prepare(`INSERT INTO _guard (${column}) VALUES (${sql})`).bind(...binds)

// ---------------------------------------------------------------------------
// facility_apply: validate a submission and return the statements that save it
// ---------------------------------------------------------------------------
async function prepareApply(db, p, actorUid) {
  const kind = p.kind
  const { ht, dt, assetcol, notecol } = kindTables(kind)
  const tech = await db.prepare("SELECT id FROM technicians WHERE auth_uid = ? AND status = 'Active'").bind(actorUid).first()
  if (!tech) throw apiError('Active technician profile required', 'P0001')
  let iid = p.inspection_id || null
  const aid = p.asset_id
  const correction = !!iid
  const header = p.header || {}
  const stmts = []
  let rev = 1, tpl = null, stamp, oldh = null
  const now = nowIso()

  if (correction) {
    oldh = await readHeader(db, ht, iid)
    if (!oldh || oldh[assetcol] !== aid) throw apiError('Inspection not found for this equipment', 'P0001')
    if (p.expected_revision == null || oldh.revision !== Number(p.expected_revision)) throw apiError(GUARD_MESSAGES.stale_revision, 'P0001')
    if (String(p.reason ?? '').trim().length < 3) throw apiError('Enter a correction reason', 'P0001')
    rev = oldh.revision + 1
    stmts.push(guard(db, 'stale_revision', `COALESCE((SELECT revision FROM "${ht}" WHERE id = ?) = ?, 0)`, iid, oldh.revision))
    const olddetails = await readDetails(db, dt, iid)
    stmts.push(db.prepare('INSERT OR IGNORE INTO inspection_versions (id, kind, inspection_id, revision, snapshot, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), kind, iid, rev - 1, snapshotJson(oldh, olddetails), 'Original version before correction', actorUid))
    tpl = oldh.template_snapshot
    stamp = oldh.inspection_date
  } else {
    iid = crypto.randomUUID()
    stamp = toTimestamp(header.inspection_date) || now
    if (klDate(stamp) > klDate(now)) throw apiError('Inspection date cannot be in the future', 'P0001')
  }

  if (!Array.isArray(tpl) || !tpl.length) {
    const ct = kind === 'equipment' ? 'checklist_templates' : 'fe_checklist_templates'
    const res = kind === 'equipment'
      ? await db.prepare('SELECT * FROM checklist_templates WHERE equipment_id = ? ORDER BY sort_order, id').bind(aid).all()
      : await db.prepare('SELECT c.* FROM fe_checklist_templates c JOIN fire_extinguishers f ON c.fe_type = f.fe_type WHERE f.id = ? ORDER BY c.sort_order, c.id').bind(aid).all()
    tpl = res.results.map((r) => formatRow(table(ct), r, Object.keys(table(ct).columns)))
  }
  if (!tpl.length) throw apiError('No checklist configured', 'P0001')
  if (!Array.isArray(p.details)) throw apiError('Checklist answers required', 'P0001')
  if (p.details.length !== tpl.length) throw apiError('Checklist changed or answers missing. Refresh and review the checklist.', 'P0001')

  const rows = []
  for (const t of tpl) {
    const matches = p.details.filter((x) => x?.parameter_name === t.parameter_name)
    if (matches.length !== 1) throw apiError(`Missing or duplicate parameter: ${t.parameter_name}`, 'P0001')
    const d = matches[0]
    const answer = d.value == null ? '' : String(d.value)
    if ((t.required ?? true) !== false && answer.trim() === '') throw apiError(`Answer required: ${t.parameter_name}`, 'P0001')
    let computed = 'Normal'
    if (answer === '') computed = 'Not checked'
    else if (t.type === 'numeric') {
      if (!NUMBER_RE.test(answer)) throw apiError(`Invalid number: ${t.parameter_name}`, 'P0001')
      const n = Number(answer)
      if ((t.min_value != null && n < Number(t.min_value)) || (t.max_value != null && n > Number(t.max_value))) computed = 'OutOfRange'
    } else {
      const options = t.options == null ? [] : String(t.options).split(',').map((o) => o.trim())
      if (!options.includes(answer)) throw apiError(`Invalid option: ${t.parameter_name}`, 'P0001')
      const fails = t.fail_values ?? t.fail_value
      if (answer.startsWith('N/A')) computed = 'N/A'
      else if (fails != null && String(fails).split(',').map((o) => o.trim()).includes(answer)) computed = kind === 'fe' ? 'Defect' : 'OutOfSpec'
    }
    const evidence = d.evidence || null
    if (evidence && evidence.length > 450000) throw apiError('Photo is too large; choose a smaller photo', 'P0001')
    if (evidence && !evidence.startsWith('data:image/jpeg;base64,')) throw apiError('Unsupported photo', 'P0001')
    rows.push({ parameter_name: t.parameter_name, value: answer, computed_status: computed, comment: d.comment ?? null, evidence })
  }

  let observed
  const hasExpiry = kind === 'fe' && own(header, 'observed_expiry_date')
  if (hasExpiry) {
    observed = toDate(header.observed_expiry_date)
    const cur = await db.prepare('SELECT expiry_date FROM fire_extinguishers WHERE id = ?').bind(aid).first()
    const current = cur?.expiry_date ?? null
    if (observed !== current) {
      if (current !== toDate(header.expected_expiry_date)) throw apiError(GUARD_MESSAGES.expiry_changed, 'P0001')
      stmts.push(guard(db, 'expiry_changed', '(SELECT expiry_date FROM fire_extinguishers WHERE id = ?) IS ?', aid, current))
      stmts.push(db.prepare("UPDATE fire_extinguishers SET expiry_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(observed, aid))
    }
  }

  const tplJson = JSON.stringify(tpl)
  const notes = header.notes ?? null
  let newHeader
  if (!correction) {
    if (kind === 'equipment') {
      const backdated = klDate(stamp) < klDate(now)
      newHeader = { id: iid, inspection_id: `INS-${iid}`, equipment_id: aid, technician_id: tech.id, inspection_date: stamp, status: 'Pending Sign-off', notes, submitted_at: now, is_backdated: backdated, revision: 1, template_snapshot: tpl, received_at: now }
      stmts.push(db.prepare('INSERT INTO inspection_headers (id, inspection_id, equipment_id, technician_id, inspection_date, submitted_at, is_backdated, status, notes, template_snapshot, received_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)')
        .bind(iid, `INS-${iid}`, aid, tech.id, stamp, now, backdated ? 1 : 0, 'Pending Sign-off', notes, tplJson, now))
    } else {
      newHeader = { id: iid, fe_id: aid, technician_id: tech.id, inspection_date: stamp, status: 'Pending Sign-off', remarks: notes, observed_expiry_date: hasExpiry ? observed : null, revision: 1, template_snapshot: tpl, received_at: now }
      stmts.push(db.prepare('INSERT INTO fe_inspections (id, fe_id, technician_id, inspection_date, status, remarks, template_snapshot, received_at, revision, observed_expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .bind(iid, aid, tech.id, stamp, 'Pending Sign-off', notes, tplJson, now, hasExpiry ? observed : null))
    }
  } else {
    newHeader = { ...oldh, revision: rev, status: 'Pending Sign-off', template_snapshot: tpl, [notecol]: notes }
    if (hasExpiry) newHeader.observed_expiry_date = observed
    stmts.push(db.prepare(`UPDATE "${ht}" SET revision = ?, status = 'Pending Sign-off', template_snapshot = ?, "${notecol}" = ?${hasExpiry ? ', observed_expiry_date = ?' : ''} WHERE id = ?`)
      .bind(...[rev, tplJson, notes, ...(hasExpiry ? [observed] : []), iid]))
    stmts.push(db.prepare(`DELETE FROM "${dt}" WHERE inspection_id = ?`).bind(iid))
    stmts.push(db.prepare('UPDATE issues SET correction_review_required = 1 WHERE source_kind = ? AND source_inspection_id = ?').bind(kind, iid))
  }

  for (const d of rows) {
    stmts.push(db.prepare(`INSERT INTO "${dt}" (id, inspection_id, parameter_name, value, computed_status, comment, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), iid, d.parameter_name, d.value, d.computed_status, d.comment, d.evidence))
    if (['OutOfRange', 'OutOfSpec', 'Defect'].includes(d.computed_status)) {
      stmts.push(db.prepare(`INSERT INTO issues (id, issue_id, system, location, issue, status, source_kind, source_inspection_id, source_parameter)
        VALUES (?, ?, ?, ?, ?, 'Open', ?, ?, ?)
        ON CONFLICT (source_kind, source_inspection_id, source_parameter) DO UPDATE SET correction_review_required = 1`)
        .bind(crypto.randomUUID(), `ISS-${crypto.randomUUID()}`, p.label ?? null, p.location ?? null, `${d.parameter_name} — ${d.value}`, kind, iid, d.parameter_name))
    }
  }

  stmts.push(db.prepare('INSERT INTO inspection_versions (id, kind, inspection_id, revision, snapshot, reason, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), kind, iid, rev, snapshotJson(newHeader, rows), p.reason || 'Initial submission', actorUid))
  return { stmts, result: { inspectionId: iid, revision: rev, kind, correctionPending: false } }
}

function translateGuard(err, extra = {}) {
  const m = String(err.cause?.message || err.message || '')
  for (const [k, msg] of Object.entries(GUARD_MESSAGES)) if (m.includes(k)) return apiError(msg, 'P0001')
  if (m.includes('inspection_corrections')) return apiError('A correction is already awaiting review', 'P0001')
  if (m.includes('inspection_versions')) return apiError(GUARD_MESSAGES.stale_revision, 'P0001')
  for (const [needle, msg] of Object.entries(extra)) if (m.includes(needle)) return apiError(msg, 'P0001')
  return err
}

async function commit(ctx, stmts) {
  stmts.push(ctx.db.prepare('DELETE FROM _guard'))
  return runBatch(ctx, stmts)
}

// ---------------------------------------------------------------------------
export async function facility_save_inspection(ctx, { p }) {
  const db = ctx.db, a = ctx.actor
  if (!a) throw apiError('Active account required', 'P0001', 403)
  if (!p || typeof p !== 'object') throw apiError('Submission required', 'P0001')
  const rid = p.request_id
  if (!rid) throw apiError('Submission ID required', 'P0001')

  const readReceipt = async () => {
    const r = await db.prepare('SELECT * FROM facility_receipts WHERE request_id = ?').bind(rid).first()
    if (!r) return null
    if (r.user_id !== ctx.user.id) throw apiError('Submission belongs to another account', 'P0001', 403)
    return JSON.parse(r.result)
  }
  const existing = await readReceipt()
  if (existing) return existing

  let stmts, result
  if (p.inspection_id) {
    const { ht } = kindTables(p.kind)
    const h = await readHeader(db, ht, p.inspection_id)
    if (!h) throw apiError('Inspection not found', 'P0001')
    if (h.technician_id !== a.id && !['Admin', 'Supervisor'].includes(a.role)) throw apiError('You can only correct your own inspections', 'P0001', 403)
    if (p.expected_revision == null || h.revision !== Number(p.expected_revision)) throw apiError(GUARD_MESSAGES.stale_revision, 'P0001')
    if (String(p.reason ?? '').trim().length < 3) throw apiError('Enter a correction reason', 'P0001')
    const pending = await db.prepare("SELECT 1 FROM inspection_corrections WHERE kind = ? AND inspection_id = ? AND status = 'Pending'").bind(p.kind, p.inspection_id).first()
    if (pending) throw apiError('A correction is already awaiting review', 'P0001')
    if (['Signed', 'Completed'].includes(h.status)) {
      const cid = crypto.randomUUID()
      stmts = [
        guard(db, 'stale_revision', `COALESCE((SELECT revision FROM "${ht}" WHERE id = ?) = ?, 0)`, p.inspection_id, h.revision),
        db.prepare('INSERT INTO inspection_corrections (id, kind, inspection_id, payload, requested_by) VALUES (?, ?, ?, ?, ?)').bind(cid, p.kind, p.inspection_id, JSON.stringify(p), ctx.user.id),
      ]
      result = { inspectionId: p.inspection_id, kind: p.kind, correctionPending: true, correctionId: cid }
    }
  }
  if (!stmts) ({ stmts, result } = await prepareApply(db, p, ctx.user.id))
  stmts.push(db.prepare('INSERT INTO facility_receipts (request_id, user_id, result) VALUES (?, ?, ?)').bind(rid, ctx.user.id, JSON.stringify(result)))
  try {
    await commit(ctx, stmts)
  } catch (e) {
    // Two devices retried the same submission at once: the other one won.
    if (String(e.cause?.message || '').includes('facility_receipts')) { const again = await readReceipt(); if (again) return again }
    throw translateGuard(e)
  }
  return result
}

// ---------------------------------------------------------------------------
export async function facility_review(ctx, args) {
  const { kind, inspection, expected_revision, action, signature = null, correction = null } = args || {}
  const note = args?.note ?? ''
  const db = ctx.db
  if (!ctx.actor || !['Admin', 'Supervisor'].includes(ctx.actor.role)) throw apiError('Supervisor or administrator required', 'P0001', 403)
  const { ht } = kindTables(kind)
  const h = await readHeader(db, ht, inspection)
  if (!h || h.revision !== Number(expected_revision)) throw apiError('Inspection changed. Refresh before reviewing.', 'P0001')
  let rev = Number(expected_revision)
  if (!['approve', 'return', 'approve-correction', 'reject-correction'].includes(action)) throw apiError('Unknown review action', 'P0001')
  if (['approve', 'approve-correction'].includes(action) && (!signature || !String(signature).startsWith('data:image/png;base64,') || signature.length > 450000)) throw apiError('Signature required', 'P0001')
  if (['return', 'reject-correction'].includes(action) && String(note).trim().length < 3) throw apiError('Enter a reason', 'P0001')

  let stmts = []
  if (action.endsWith('correction')) {
    const c = await db.prepare("SELECT * FROM inspection_corrections WHERE id = ? AND inspection_id = ? AND kind = ? AND status = 'Pending'").bind(correction, inspection, kind).first()
    if (!c) throw apiError('Pending correction not found', 'P0001')
    stmts.push(guard(db, 'already_reviewed', "COALESCE((SELECT status FROM inspection_corrections WHERE id = ?) = 'Pending', 0)", c.id))
    if (action === 'approve-correction') {
      const applied = await prepareApply(db, JSON.parse(c.payload), c.requested_by)
      stmts.push(...applied.stmts)
      rev = applied.result.revision
      stmts.push(db.prepare(`UPDATE "${ht}" SET status = 'Signed' WHERE id = ?`).bind(inspection))
    }
    stmts.push(db.prepare("UPDATE inspection_corrections SET status = ?, reviewed_by = ?, reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), review_note = ? WHERE id = ?")
      .bind(action === 'approve-correction' ? 'Approved' : 'Rejected', ctx.user.id, note, c.id))
  } else {
    if (!['Pending Sign-off', 'Returned'].includes(h.status)) throw apiError('Inspection is already reviewed', 'P0001')
    stmts.push(guard(db, 'already_reviewed', `COALESCE((SELECT revision FROM "${ht}" WHERE id = ? AND status IN ('Pending Sign-off','Returned')) = ?, 0)`, inspection, rev))
    stmts.push(db.prepare(`UPDATE "${ht}" SET status = ? WHERE id = ?`).bind(action === 'approve' ? 'Signed' : 'Returned', inspection))
  }
  stmts.push(db.prepare('INSERT INTO inspection_reviews (id, kind, inspection_id, revision, action, note, signature, reviewer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), kind, inspection, rev, action, note, signature, ctx.user.id))
  try { await commit(ctx, stmts) } catch (e) { throw translateGuard(e) }
  return { inspectionId: inspection, revision: rev }
}

// ---------------------------------------------------------------------------
export async function facility_asset_reference(ctx, { kind, asset, documents, maintenance_date }) {
  if (ctx.actor?.role !== 'Admin') throw apiError('Administrator required', 'P0001', 403)
  if (!Array.isArray(documents) || documents.length > 30) throw apiError('Provide up to 30 document links', 'P0001')
  for (const d of documents) {
    if (!String(d?.title ?? '').trim() || !/^https:\/\//.test(String(d?.url ?? ''))) throw apiError('Each document needs a title and HTTPS link', 'P0001')
  }
  const tn = kind === 'equipment' ? 'equipment' : kind === 'fe' ? 'fire_extinguishers' : null
  if (!tn) throw apiError('Unknown equipment type', 'P0001')
  await ctx.db.prepare(`UPDATE "${tn}" SET document_links = ?, next_maintenance_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(JSON.stringify(documents), toDate(maintenance_date), asset).run()
  return null
}

// ---------------------------------------------------------------------------
export async function change_my_pin(ctx, { current_pin, new_pin }) {
  const db = ctx.db
  if (!ctx.user) return { ok: false, error: 'Not signed in.' }
  const me = await db.prepare('SELECT id, pin_hash FROM technicians WHERE auth_uid = ? LIMIT 1').bind(ctx.user.id).first()
  if (!me) return { ok: false, error: 'Not signed in.' }
  if (!me.pin_hash || me.pin_hash !== await hashPin(ctx.env, String(current_pin ?? ''))) return { ok: false, error: 'Current PIN is incorrect.' }
  if (!/^\d{4}$/.test(String(new_pin ?? ''))) return { ok: false, error: 'New PIN must be exactly 4 digits.' }
  if (new_pin === current_pin) return { ok: false, error: 'New PIN is the same as the current one.' }
  const h = await hashPin(ctx.env, new_pin)
  const taken = await db.prepare("SELECT 1 FROM technicians WHERE pin_hash = ? AND status = 'Active' AND id <> ?").bind(h, me.id).first()
  if (taken) return { ok: false, error: 'That PIN is already in use. Please choose another.' }
  try { await db.prepare('UPDATE technicians SET pin_hash = ? WHERE id = ?').bind(h, me.id).run() }
  catch { return { ok: false, error: 'That PIN is already in use. Please choose another.' } }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Manage staff (was the Supabase Edge Function "manage-tech")
// ---------------------------------------------------------------------------
const ROLES = ['Tech', 'Supervisor', 'Admin']
export async function manage_tech(ctx, body) {
  const db = ctx.db
  if (ctx.actor?.role !== 'Admin') throw apiError('Administrator required', '42501', 403)
  const { action } = body || {}
  const pinCheck = async (pin, exceptId) => {
    if (!/^\d{4}$/.test(String(pin ?? ''))) throw apiError('PIN must be exactly 4 digits.', 'P0001')
    const h = await hashPin(ctx.env, String(pin))
    const taken = await db.prepare("SELECT 1 FROM technicians WHERE pin_hash = ? AND status = 'Active' AND id <> ?").bind(h, exceptId || '').first()
    if (taken) throw apiError('That PIN is already used by another active staff member. Choose a different PIN.', 'P0001')
    return h
  }
  const getTech = async (id) => {
    const t = await db.prepare('SELECT id, tech_id, name, role, status, auth_uid, pin_hash FROM technicians WHERE id = ?').bind(id).first()
    if (!t) throw apiError('Staff member not found.', 'P0001', 404)
    return t
  }
  const lastAdminCheck = async (t) => {
    if (t.role !== 'Admin' || t.status !== 'Active') return
    const n = await db.prepare("SELECT COUNT(*) AS n FROM technicians WHERE role = 'Admin' AND status = 'Active'").first()
    if (n.n <= 1) throw apiError('This is the only active administrator. Make someone else an Admin first.', 'P0001')
  }

  switch (action) {
    case 'add': {
      const techId = String(body.tech_id ?? '').trim().toUpperCase()
      const name = String(body.name ?? '').trim()
      const role = ROLES.includes(body.role) ? body.role : 'Tech'
      if (!techId || !name) throw apiError('Staff ID and name are required.', 'P0001')
      if (!/^[A-Z0-9_-]{1,32}$/.test(techId)) throw apiError('Staff ID may only contain letters, numbers, - and _.', 'P0001')
      if (await db.prepare('SELECT 1 FROM technicians WHERE lower(tech_id) = lower(?)').bind(techId).first()) throw apiError(`Staff ID ${techId} already exists.`, 'P0001')
      const h = await pinCheck(body.pin)
      const email = `${techId.toLowerCase()}@internal.app`
      const existingUser = await db.prepare('SELECT u.id FROM auth_users u LEFT JOIN technicians t ON t.auth_uid = u.id WHERE u.email = ? AND t.id IS NULL').bind(email).first()
      const uid = existingUser?.id || crypto.randomUUID()
      const stmts = []
      if (!existingUser) stmts.push(db.prepare('INSERT INTO auth_users (id, email) VALUES (?, ?)').bind(uid, email))
      stmts.push(db.prepare("INSERT INTO technicians (id, tech_id, name, role, status, auth_uid, pin_hash) VALUES (?, ?, ?, ?, 'Active', ?, ?)").bind(crypto.randomUUID(), techId, name, role, uid, h))
      await runBatch(ctx, stmts)
      return { ok: true }
    }
    case 'edit': {
      const t = await getTech(body.id)
      const name = String(body.name ?? '').trim()
      if (!name) throw apiError('Name is required.', 'P0001')
      if (!ROLES.includes(body.role)) throw apiError('Unknown role.', 'P0001')
      if (body.role !== 'Admin') await lastAdminCheck(t)
      await db.prepare('UPDATE technicians SET name = ?, role = ? WHERE id = ?').bind(name, body.role, t.id).run()
      return { ok: true }
    }
    case 'reset_pin': {
      const t = await getTech(body.id)
      const h = await pinCheck(body.pin, t.id)
      const stmts = []
      let uid = t.auth_uid
      if (!uid) {
        // Older rows without a login: create one now.
        uid = crypto.randomUUID()
        stmts.push(db.prepare('INSERT OR IGNORE INTO auth_users (id, email) VALUES (?, ?)').bind(uid, `${t.tech_id.toLowerCase()}@internal.app`))
        stmts.push(db.prepare('UPDATE technicians SET auth_uid = (SELECT id FROM auth_users WHERE email = ?) WHERE id = ?').bind(`${t.tech_id.toLowerCase()}@internal.app`, t.id))
      }
      stmts.push(db.prepare('UPDATE technicians SET pin_hash = ? WHERE id = ?').bind(h, t.id))
      await runBatch(ctx, stmts)
      return { ok: true }
    }
    case 'set_status': {
      const t = await getTech(body.id)
      if (!['Active', 'Inactive'].includes(body.status)) throw apiError('Unknown status.', 'P0001')
      if (body.status === 'Inactive') {
        if (t.id === ctx.actor.id) throw apiError('You cannot deactivate your own account.', 'P0001')
        await lastAdminCheck(t)
      } else if (t.pin_hash) {
        const taken = await db.prepare("SELECT 1 FROM technicians WHERE pin_hash = ? AND status = 'Active' AND id <> ?").bind(t.pin_hash, t.id).first()
        if (taken) throw apiError('Another active staff member uses this person’s old PIN. Reset their PIN first, then reactivate them.', 'P0001')
      }
      await db.prepare('UPDATE technicians SET status = ? WHERE id = ?').bind(body.status, t.id).run()
      return { ok: true }
    }
    default: throw apiError('Unknown action.', 'P0001')
  }
}

export const RPC = { facility_save_inspection, facility_review, facility_asset_reference, change_my_pin }
export const FUNCTIONS = { 'manage-tech': manage_tech }
