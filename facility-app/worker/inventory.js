// Spare parts inventory (P1 / P2 stores).
//   stock_move   — take out / receive / transfer (all staff), count adjustment (Admin)
//   part_save    — create or edit a part and its per-store settings (Admin)
//   parts_import — bulk import from the old workbook CSV (Admin)
// Every quantity change is one atomic D1 batch that also writes stock_movements.
// part_stock.quantity has CHECK (quantity >= 0), so stock can never go negative,
// even if two phones take the last item at the same moment.

import { apiError } from './schema.js'
import { runBatch } from './query.js'

export const STORES = ['P1', 'P2']
const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
const text = (v, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null)

function wholeNumber(v, { min = 0, max = 1_000_000, label = 'Quantity' } = {}) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw apiError(`${label} must be a whole number${min > 0 ? ' of at least ' + min : ''}.`, 'P0001')
  return n
}

async function getPart(db, id) {
  const p = await db.prepare('SELECT id, part_code, part_name, unit, status FROM parts WHERE id = ?').bind(id).first()
  if (!p) throw apiError('Part not found.', 'P0001', 404)
  return p
}

async function balances(db, partId) {
  const res = await db.prepare('SELECT store, quantity FROM part_stock WHERE part_id = ?').bind(partId).all()
  const out = { P1: 0, P2: 0 }
  for (const r of res.results) out[r.store] = r.quantity
  return out
}

function ensureStock(db, partId, store) {
  return db.prepare('INSERT OR IGNORE INTO part_stock (id, part_id, store) VALUES (?, ?, ?)').bind(crypto.randomUUID(), partId, store)
}
function move(db, { group, partId, kind, store, other = null, changeSql, changeBinds, reason, equipmentId, techId }) {
  // balance_after is read inside the same batch, right after the update
  return db.prepare(`INSERT INTO stock_movements (id, group_id, part_id, kind, store, other_store, change, balance_after, reason, equipment_id, technician_id)
    VALUES (?, ?, ?, ?, ?, ?, ${changeSql}, (SELECT quantity FROM part_stock WHERE part_id = ? AND store = ?), ?, ?, ?)`)
    .bind(crypto.randomUUID(), group, partId, kind, store, other, ...changeBinds, partId, store, reason, equipmentId, techId)
}

// ---------------------------------------------------------------------------
export async function stock_move(ctx, args) {
  const db = ctx.db, a = ctx.actor
  if (!a) throw apiError('Active account required', 'P0001', 403)
  const { request_id, part_id, kind } = args || {}
  if (!request_id) throw apiError('Request ID required', 'P0001')

  const prior = await db.prepare('SELECT user_id, result FROM facility_receipts WHERE request_id = ?').bind(request_id).first()
  if (prior) {
    if (prior.user_id !== ctx.user.id) throw apiError('Submission belongs to another account', 'P0001', 403)
    return JSON.parse(prior.result)
  }

  const part = await getPart(db, part_id)
  if (part.status !== 'Active') throw apiError('This part is retired.', 'P0001')
  if (!['in', 'out', 'transfer', 'adjust'].includes(kind)) throw apiError('Unknown stock action.', 'P0001')
  const store = args.store
  if (!STORES.includes(store)) throw apiError('Choose the store (P1 or P2).', 'P0001')
  const reason = text(args.reason)
  let equipmentId = args.equipment_id || null
  if (equipmentId) {
    const eq = await db.prepare('SELECT id FROM equipment WHERE id = ?').bind(equipmentId).first()
    if (!eq) equipmentId = null
  }

  const group = crypto.randomUUID()
  const stmts = [ensureStock(db, part.id, store)]
  const common = { group, partId: part.id, reason, equipmentId, techId: a.id }

  if (kind === 'adjust') {
    if (a.role !== 'Admin') throw apiError('Only administrators can correct a stock count.', 'P0001', 403)
    if (!reason || reason.length < 3) throw apiError('Enter a reason for the count correction.', 'P0001')
    const counted = wholeNumber(args.quantity, { label: 'Counted quantity' })
    // record the difference first, then set the new count
    stmts.push(move(db, { ...common, kind, store, changeSql: `? - (SELECT quantity FROM part_stock WHERE part_id = ? AND store = ?)`, changeBinds: [counted, part.id, store] }))
    stmts.push(db.prepare('UPDATE part_stock SET quantity = ? WHERE part_id = ? AND store = ?').bind(counted, part.id, store))
    // balance_after was read before the update in the row above; fix it to the new count
    stmts.push(db.prepare('UPDATE stock_movements SET balance_after = ? WHERE group_id = ?').bind(counted, group))
  } else {
    const qty = wholeNumber(args.quantity, { min: 1, label: 'Quantity' })
    if (kind === 'in') {
      stmts.push(db.prepare('UPDATE part_stock SET quantity = quantity + ? WHERE part_id = ? AND store = ?').bind(qty, part.id, store))
      stmts.push(move(db, { ...common, kind, store, changeSql: '?', changeBinds: [qty] }))
    } else if (kind === 'out') {
      stmts.push(db.prepare('UPDATE part_stock SET quantity = quantity - ? WHERE part_id = ? AND store = ?').bind(qty, part.id, store))
      stmts.push(move(db, { ...common, kind, store, changeSql: '?', changeBinds: [-qty] }))
    } else {
      const to = args.to_store
      if (!STORES.includes(to) || to === store) throw apiError('Choose a different store to transfer to.', 'P0001')
      stmts.push(ensureStock(db, part.id, to))
      stmts.push(db.prepare('UPDATE part_stock SET quantity = quantity - ? WHERE part_id = ? AND store = ?').bind(qty, part.id, store))
      stmts.push(move(db, { ...common, kind, store, other: to, changeSql: '?', changeBinds: [-qty] }))
      stmts.push(db.prepare('UPDATE part_stock SET quantity = quantity + ? WHERE part_id = ? AND store = ?').bind(qty, part.id, to))
      stmts.push(move(db, { ...common, kind, store: to, other: store, changeSql: '?', changeBinds: [qty] }))
    }
  }
  stmts.push(db.prepare(`UPDATE parts SET updated_at = ${NOW} WHERE id = ?`).bind(part.id))

  const result = { ok: true, part_id: part.id, kind }
  stmts.push(db.prepare('INSERT INTO facility_receipts (request_id, user_id, result) VALUES (?, ?, ?)').bind(request_id, ctx.user.id, JSON.stringify(result)))
  try {
    await runBatch(ctx, stmts)
  } catch (e) {
    const m = String(e.cause?.message || e.message || '')
    if (m.includes('facility_receipts')) {
      const again = await db.prepare('SELECT result FROM facility_receipts WHERE request_id = ?').bind(request_id).first()
      if (again) return JSON.parse(again.result)
    }
    if (m.includes('not_enough_stock')) {
      const b = await balances(db, part.id)
      throw apiError(`Not enough stock in ${store}: only ${b[store]} ${part.unit} left.`, 'P0001')
    }
    throw e
  }
  return { ...result, balances: await balances(db, part.id) }
}

// ---------------------------------------------------------------------------
const PART_FIELDS = ['part_code', 'part_name', 'category', 'description', 'brand', 'model', 'unit', 'photo_path', 'status']

function cleanPart(p, { creating }) {
  const out = {}
  for (const f of PART_FIELDS) if (p && Object.prototype.hasOwnProperty.call(p, f)) out[f] = text(p[f], f === 'description' ? 2000 : 200)
  if (out.part_code !== undefined) {
    out.part_code = (out.part_code || '').toUpperCase()
    if (!/^[A-Z0-9][A-Z0-9._/-]{0,49}$/.test(out.part_code)) throw apiError(`Part code "${p.part_code}" may only use letters, numbers and . _ / - (max 50).`, 'P0001')
  }
  if (creating && !out.part_code) throw apiError('Part code is required.', 'P0001')
  if ((creating || out.part_name !== undefined) && !out.part_name) throw apiError('Part name is required.', 'P0001')
  if (out.unit === null) out.unit = 'pcs'
  if (out.status !== undefined && !['Active', 'Retired'].includes(out.status)) throw apiError('Unknown status.', 'P0001')
  return out
}

// { id?, part: {...}, stock: { P1: {min_qty, location}, P2: {...} } }
export async function part_save(ctx, args) {
  const db = ctx.db
  if (ctx.actor?.role !== 'Admin') throw apiError('Administrator required', '42501', 403)
  const creating = !args?.id
  const part = cleanPart(args?.part || {}, { creating })
  const stmts = []
  let id = args?.id
  if (creating) {
    id = crypto.randomUUID()
    const cols = ['id', 'qr_code', ...Object.keys(part)]
    stmts.push(db.prepare(`INSERT INTO parts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(id, `PART-${part.part_code}`, ...Object.values(part)))
  } else {
    await getPart(db, id)
    const keys = Object.keys(part)
    if (keys.length) {
      if (part.part_code) keys.push('qr_code'), (part.qr_code = `PART-${part.part_code}`)
      stmts.push(db.prepare(`UPDATE parts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ${NOW} WHERE id = ?`).bind(...keys.map((k) => part[k]), id))
    }
  }
  for (const store of STORES) {
    const s = args?.stock?.[store]
    stmts.push(ensureStock(db, id, store))
    if (s) {
      const min = s.min_qty === '' || s.min_qty == null ? 0 : wholeNumber(s.min_qty, { label: `Minimum for ${store}` })
      stmts.push(db.prepare('UPDATE part_stock SET min_qty = ?, location = ? WHERE part_id = ? AND store = ?').bind(min, text(s.location, 100), id, store))
    }
  }
  await runBatch(ctx, stmts)
  return { ok: true, id }
}

// ---------------------------------------------------------------------------
// rows: [{ part_code, part_name, category, description, brand, model, unit,
//          qty_p1, qty_p2, min_p1, min_p2, loc_p1, loc_p2 }]  (max 200 per call)
// New parts get their opening stock. Existing parts get their details updated;
// their quantities are only set if the part has never had a stock movement
// (so re-importing can't wipe out real usage).
export async function parts_import(ctx, { rows }) {
  const db = ctx.db, a = ctx.actor
  if (a?.role !== 'Admin') throw apiError('Administrator required', '42501', 403)
  if (!Array.isArray(rows) || !rows.length) throw apiError('No rows to import.', 'P0001')
  if (rows.length > 200) throw apiError('Import at most 200 rows at a time.', 'P0001')

  const cleaned = rows.map((r, i) => {
    try { return { r, p: cleanPart(r, { creating: true }) } } catch (e) { throw apiError(`Row ${i + 2}: ${e.message}`, 'P0001') }
  })
  const codes = cleaned.map((c) => c.p.part_code)
  const dup = codes.find((c, i) => codes.indexOf(c) !== i)
  if (dup) throw apiError(`Part code ${dup} appears twice in the file.`, 'P0001')

  const existing = new Map()
  const res = await db.prepare(`SELECT p.id, p.part_code, (SELECT COUNT(*) FROM stock_movements m WHERE m.part_id = p.id AND m.kind <> 'opening') AS used
    FROM parts p WHERE p.part_code IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(codes)).all()
  for (const e of res.results) existing.set(e.part_code, e)

  const num = (v, label) => (v === '' || v == null ? null : wholeNumber(String(v).replace(/,/g, ''), { label }))
  const stmts = []
  let created = 0, updated = 0
  const qtySkipped = []
  for (const [i, { r, p }] of cleaned.entries()) {
    let qty, min, loc
    try {
      qty = { P1: num(r.qty_p1, 'P1 quantity'), P2: num(r.qty_p2, 'P2 quantity') }
      min = { P1: num(r.min_p1, 'P1 minimum'), P2: num(r.min_p2, 'P2 minimum') }
      loc = { P1: text(r.loc_p1, 100), P2: text(r.loc_p2, 100) }
    } catch (e) { throw apiError(`Row ${i + 2} (${p.part_code}): ${e.message}`, 'P0001') }
    const ex = existing.get(p.part_code)
    const id = ex?.id || crypto.randomUUID()
    if (ex) {
      const keys = Object.keys(p).filter((k) => k !== 'part_code' && p[k] != null)
      if (keys.length) stmts.push(db.prepare(`UPDATE parts SET ${keys.map((k) => `${k} = ?`).join(', ')}, status = 'Active', updated_at = ${NOW} WHERE id = ?`).bind(...keys.map((k) => p[k]), id))
      updated++
    } else {
      const cols = ['id', 'qr_code', ...Object.keys(p)]
      stmts.push(db.prepare(`INSERT INTO parts (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(id, `PART-${p.part_code}`, ...Object.values(p)))
      created++
    }
    const canSetQty = !ex || ex.used === 0
    if (ex && !canSetQty && (qty.P1 != null || qty.P2 != null)) qtySkipped.push(p.part_code)
    for (const store of STORES) {
      stmts.push(ensureStock(db, id, store))
      if (min[store] != null) stmts.push(db.prepare('UPDATE part_stock SET min_qty = ? WHERE part_id = ? AND store = ?').bind(min[store], id, store))
      if (loc[store] != null) stmts.push(db.prepare('UPDATE part_stock SET location = ? WHERE part_id = ? AND store = ?').bind(loc[store], id, store))
      if (canSetQty && qty[store] != null) {
        if (ex) stmts.push(db.prepare("DELETE FROM stock_movements WHERE part_id = ? AND store = ? AND kind = 'opening'").bind(id, store))
        stmts.push(db.prepare('UPDATE part_stock SET quantity = ? WHERE part_id = ? AND store = ?').bind(qty[store], id, store))
        if (qty[store] > 0) stmts.push(db.prepare(`INSERT INTO stock_movements (id, group_id, part_id, kind, store, change, balance_after, reason, technician_id) VALUES (?, ?, ?, 'opening', ?, ?, ?, 'Opening stock (import)', ?)`)
          .bind(crypto.randomUUID(), crypto.randomUUID(), id, store, qty[store], qty[store], a.id))
      }
    }
  }
  await runBatch(ctx, stmts)
  return { ok: true, created, updated, qty_skipped: qtySkipped }
}

export const INVENTORY_RPC = { stock_move, part_save, parts_import }
