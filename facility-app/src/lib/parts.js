// Shared helpers for the spare parts inventory.
import { db } from './db'
import { submitInspection } from './offlineQueue'
import { localDelete } from './localStore'

export const STORES = ['P1', 'P2']

// One fixed colour per category (same on the dashboard and the printed labels).
// Colours follow the alphabetical order of the category names, so they stay
// stable when stock changes. Dark enough for white text.
export const CATEGORY_COLORS = ['#2f6f9f', '#d97706', '#15803d', '#c2410c', '#7c3aed', '#0e7490', '#be185d', '#4d7c0f']
export const categoryColor = (name, parts) => {
  const names = [...new Set((parts || []).map((p) => (p.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const i = names.indexOf((name || '').trim())
  return i < 0 ? '#64748b' : CATEGORY_COLORS[i % CATEGORY_COLORS.length]
}

export const partPath = (code) => `/parts/${encodeURIComponent(code)}`
// The QR on each label holds the full web address, so a phone camera opens the
// part straight away and the in-app scanner understands it too.
export const partQrValue = (code) => `${window.location.origin}${partPath(code)}`
export const photoUrl = (path) => (path ? db.storage.from('parts').getPublicUrl(path).data.publicUrl : null)

export function stockOf(part, store) {
  return (part?.stock || []).find((s) => s.store === store) || { store, quantity: 0, min_qty: 0, location: null }
}
export function isLow(s) { return s.min_qty > 0 && s.quantity <= s.min_qty }
export function totalQty(part) { return (part?.stock || []).reduce((n, s) => n + (s.quantity || 0), 0) }

// Load every active part with its two store rows (paged, any size).
export async function loadParts({ includeRetired = false } = {}) {
  const rows = []
  for (let from = 0; ; from += 500) {
    let q = db.from('parts').select('id, part_code, part_name, category, description, brand, model, unit, photo_path, status, stock:part_stock(store, quantity, min_qty, location)').order('part_code').range(from, from + 499)
    if (!includeRetired) q = q.eq('status', 'Active')
    const { data, error } = await q
    if (error) throw error
    rows.push(...data)
    if (data.length < 500) return rows
  }
}

// Record a stock movement. Saved on the device first (works offline) and sent
// right away when online. A refusal from the server (e.g. not enough stock) is
// returned as an error and removed from the device so it isn't retried.
export async function recordMovement({ userId, part, kind, store, toStore, quantity, reason, equipmentId }) {
  const request_id = crypto.randomUUID()
  const verb = { in: 'Receive', out: 'Take out', transfer: 'Transfer', adjust: 'Count' }[kind]
  const res = await submitInspection({
    request_id,
    rpc: 'stock_move',
    args: { part_id: part.id, kind, store, to_store: toStore || null, quantity: Number(quantity), reason: reason || null, equipment_id: equipmentId || null },
    label: `${verb} ${quantity} ${part.unit || ''} · ${part.part_code}${kind === 'transfer' ? ` (${store} → ${toStore})` : ` (${store})`}`,
    route: partPath(part.part_code),
  })
  if (res.needsAttention) {
    await localDelete(`outbox:${userId}:${request_id}`).catch(() => {})
    return { success: false, error: res.error }
  }
  return res
}

// Part photos: compressed to about 800px / 120 KB before upload (see lib/image.js).
export { compressImage } from './image'

// ---------- CSV import ----------
// Column names from the old workbook (or Excel in general) -> app fields.
const ALIASES = {
  part_code: ['part_code', 'code', 'part_no', 'part_number', 'partno', 'item_code', 'item_no', 'sap_code', 'material_code', 'stock_code', 'id'],
  part_name: ['part_name', 'name', 'item', 'item_name', 'spare_part', 'spare_part_name', 'part'],
  description: ['description', 'details', 'specification', 'spec', 'remarks', 'remark'],
  category: ['category', 'type', 'system', 'group'],
  unit: ['unit', 'uom', 'units'],
  brand: ['brand', 'manufacturer', 'make'],
  model: ['model', 'model_no', 'model_number'],
  qty_p1: ['qty_p1', 'p1_qty', 'p1', 'quantity_p1', 'p1_quantity', 'quantity_in_stock', 'qty_in_stock', 'quantity', 'qty', 'stock', 'stock_qty', 'on_hand'],
  qty_p2: ['qty_p2', 'p2_qty', 'p2', 'quantity_p2', 'p2_quantity'],
  min_p1: ['min_p1', 'p1_min', 'min', 'minimum', 'min_qty', 'reorder_level', 'reorder_point', 'safety_stock'],
  min_p2: ['min_p2', 'p2_min'],
  loc_p1: ['loc_p1', 'p1_location', 'location', 'rack', 'shelf', 'bin', 'location_p1'],
  loc_p2: ['loc_p2', 'p2_location', 'location_p2'],
}
export const FIELD_LABELS = {
  part_code: 'Part code', part_name: 'Part name', description: 'Description', category: 'Category', unit: 'Unit',
  brand: 'Brand', model: 'Model', qty_p1: 'Stock in P1', qty_p2: 'Stock in P2', min_p1: 'Minimum P1', min_p2: 'Minimum P2',
  loc_p1: 'Shelf in P1', loc_p2: 'Shelf in P2',
}

function splitLine(line, delim) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === delim && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => s.trim())
}
const norm = (h) => h.toLowerCase().replace(/^﻿/, '').trim().replace(/[()#.]/g, '').replace(/[\s/-]+/g, '_').replace(/_+$/, '')

// Returns { rows, mapping: [{ column, field }], missing: [fields] }
export function parsePartsCsv(text) {
  text = text.replace(/^﻿/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { rows: [], mapping: [], missing: ['part_code'] }
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
  const headers = splitLine(lines[0], delim)
  const used = new Set()
  const mapping = headers.map((h) => {
    const k = norm(h)
    let field = null
    for (const [f, names] of Object.entries(ALIASES)) if (!used.has(f) && (names.includes(k) || names.includes(k.replace(/_/g, '')))) { field = f; break }
    // "Balance" is calculated from movements in the old workbook — never import it as stock.
    if (k === 'balance') field = null
    if (field) used.add(field)
    return { column: h, field }
  })
  // The workbook may call the part name "Description": use it as the name if there's no name column.
  if (!used.has('part_name') && used.has('description')) {
    mapping.find((m) => m.field === 'description').field = 'part_name'; used.delete('description'); used.add('part_name')
  }
  const rows = lines.slice(1).map((l) => {
    const cells = splitLine(l, delim), r = {}
    mapping.forEach((m, i) => { if (m.field && cells[i] !== undefined && cells[i] !== '') r[m.field] = cells[i] })
    return r
  }).filter((r) => Object.keys(r).length)
  const missing = ['part_code', 'part_name'].filter((f) => !used.has(f))
  return { rows, mapping, missing }
}

export const TEMPLATE_CSV = 'part_code,part_name,category,unit,brand,model,description,qty_p1,qty_p2,min_p1,min_p2,loc_p1,loc_p2\n' +
  'BRG-6204,Bearing 6204-2RS,Mechanical,pcs,SKF,6204-2RS,Pump motor bearing,12,4,4,2,Rack A1,Shelf 3\n'
