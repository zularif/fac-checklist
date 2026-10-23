// Table registry used by the query engine.
//  - column types drive value conversion (D1 stores booleans as 0/1, JSON as text)
//  - `refs` declares foreign keys so `select('*, area:areas(area_name)')` embeds work
//  - `read` / `write` replace the Supabase row-level-security policies:
//      read:  'active'  = any signed-in, active staff member
//             'own'     = only rows where ownerColumn = the caller's auth uid
//      write: 'any'     = any active staff member
//             'admin'   = Admin role only
//             'none'    = only via server functions (worker/rpc.js)
// Keep in sync with migrations/*.sql (tests/schema-test.mjs checks this).

const T = 'text', U = 'uuid', I = 'int', R = 'real', B = 'bool', J = 'json', TS = 'timestamp', D = 'date'

export const TABLES = {
  plants: {
    columns: { id: U, plant_id: T, plant_name: T, status: T },
    read: 'active', write: 'admin',
  },
  areas: {
    columns: { id: U, area_id: T, area_name: T, plant_id: U, description: T, status: T },
    refs: { plant_id: 'plants' },
    read: 'active', write: 'admin',
  },
  equipment: {
    columns: {
      id: U, equip_id: T, equipment_name: T, area_id: U, qr_code: T, asset_tag: T, inspection_cycle: T,
      category: T, status: T, created_at: TS, updated_at: TS, created_by: T, document_links: J, next_maintenance_date: D,
    },
    refs: { area_id: 'areas' },
    touch: 'updated_at',
    read: 'active', write: 'admin',
  },
  technicians: {
    columns: { id: U, tech_id: T, name: T, role: T, auth_uid: U, status: T },
    // pin_hash exists in the table but is never selectable or writable through the API.
    insertable: ['tech_id', 'name', 'role', 'status', 'auth_uid'],
    updatable: ['name', 'role', 'status', 'auth_uid'],
    read: 'active', write: 'admin', noDelete: true,
  },
  checklist_templates: {
    columns: {
      id: U, template_id: T, equipment_id: U, parameter_name: T, unit: T, min_value: R, max_value: R,
      sort_order: I, type: T, options: T, pass_value: T, fail_value: T, required: B,
    },
    refs: { equipment_id: 'equipment' },
    read: 'active', write: 'admin',
  },
  inspection_headers: {
    columns: {
      id: U, inspection_id: T, equipment_id: U, technician_id: U, inspection_date: TS, status: T, notes: T,
      submitted_at: TS, is_backdated: B, revision: I, template_snapshot: J, received_at: TS,
    },
    refs: { equipment_id: 'equipment', technician_id: 'technicians' },
    read: 'active', write: 'none',
  },
  inspection_details: {
    columns: { id: U, inspection_id: U, parameter_name: T, value: T, computed_status: T, comment: T, evidence: T },
    refs: { inspection_id: 'inspection_headers' },
    read: 'active', write: 'none',
  },
  photos: {
    columns: { id: U, inspection_id: U, equipment_id: U, storage_path: T },
    refs: { inspection_id: 'inspection_headers', equipment_id: 'equipment' },
    read: 'active', write: 'any',
  },
  signatures: {
    columns: { id: U, inspection_id: U, storage_path: T, signed_by: T, role: T, signed_date: TS },
    refs: { inspection_id: 'inspection_headers' },
    read: 'active', write: 'none',
  },
  issues: {
    columns: {
      id: U, issue_id: T, plant_id: U, system: T, location: T, issue: T, date_reported: TS, status: T,
      root_cause: T, correction: T, target_date: D, completed_date: D, preventive_action: T, pic: T, comment: T,
      source_kind: T, source_inspection_id: U, source_parameter: T, correction_review_required: B,
    },
    refs: { plant_id: 'plants' },
    read: 'active', write: 'any',
  },
  alert_settings: {
    columns: { id: U, category: T, email: T, active: B },
    read: 'active', write: 'any',
  },
  fe_floors: {
    columns: {
      id: U, building: T, floor_name: T, image_path: T, sort_order: I, created_at: TS, ref_width: R, ref_height: R,
    },
    read: 'active', write: 'admin',
  },
  fire_extinguishers: {
    columns: {
      id: U, fe_code: T, fe_type: T, location_desc: T, floor_id: U, map_x: R, map_y: R, qr_code: T, status: T,
      created_at: TS, updated_at: TS, serial_no: T, expiry_date: D, document_links: J, next_maintenance_date: D,
    },
    refs: { floor_id: 'fe_floors' },
    read: 'active', write: 'admin',
  },
  fe_checklist_templates: {
    columns: { id: U, fe_type: T, parameter_name: T, options: T, fail_values: T, sort_order: I, required: B },
    read: 'active', write: 'admin',
  },
  fe_inspections: {
    columns: {
      id: U, fe_id: U, technician_id: U, inspection_date: TS, status: T, remarks: T, observed_expiry_date: D,
      revision: I, template_snapshot: J, received_at: TS,
    },
    refs: { fe_id: 'fire_extinguishers', technician_id: 'technicians' },
    read: 'active', write: 'none',
  },
  fe_inspection_details: {
    columns: { id: U, inspection_id: U, parameter_name: T, value: T, computed_status: T, comment: T, evidence: T },
    refs: { inspection_id: 'fe_inspections' },
    read: 'active', write: 'none',
  },
  task_stages: {
    columns: { id: U, name: T, color: T, sort_order: I, is_done: B, created_at: TS },
    read: 'active', write: 'admin',
  },
  tasks: {
    columns: {
      id: U, title: T, description: T, parent_id: U, stage_id: U, assigned_to: U, priority: T, start_date: D,
      due_date: D, duration_days: I, completed: B, sort_order: I, created_by: U, created_at: TS, updated_at: TS,
    },
    refs: { parent_id: 'tasks', stage_id: 'task_stages', assigned_to: 'technicians', created_by: 'technicians' },
    touch: 'updated_at',
    read: 'active', write: 'any',
  },
  facility_receipts: {
    columns: { request_id: U, user_id: U, result: J, created_at: TS },
    pk: 'request_id', read: 'own', ownerColumn: 'user_id', write: 'none',
  },
  inspection_versions: {
    columns: { id: U, kind: T, inspection_id: U, revision: I, snapshot: J, reason: T, changed_by: U, created_at: TS },
    read: 'active', write: 'none',
  },
  inspection_corrections: {
    columns: {
      id: U, kind: T, inspection_id: U, payload: J, requested_by: U, status: T, requested_at: TS,
      reviewed_by: U, reviewed_at: TS, review_note: T,
    },
    read: 'active', write: 'none',
  },
  inspection_reviews: {
    columns: {
      id: U, kind: T, inspection_id: U, revision: I, action: T, note: T, signature: T, reviewer_id: U, created_at: TS,
    },
    read: 'active', write: 'none',
  },
}

export function table(name) {
  const t = Object.prototype.hasOwnProperty.call(TABLES, name) ? TABLES[name] : null
  if (!t) throw apiError(`relation "${name}" does not exist`, '42P01', 404)
  return t
}

export function apiError(message, code = 'API', status = 400, details) {
  const e = new Error(message)
  e.code = code; e.status = status; e.details = details
  return e
}

// ---------- value conversion ----------
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const HAS_TZ = /(Z|[+-]\d{2}(:?\d{2})?)$/i

// Normalises any timestamp to the stored form (ISO UTC with milliseconds).
// Matches Postgres/Supabase behaviour: a bare date is midnight UTC and a
// date-time without a zone is taken as UTC.
export function toTimestamp(v) {
  if (v === null || v === undefined || v === '') return null
  let s = String(v).trim()
  if (ISO_DATE.test(s)) s += 'T00:00:00Z'
  else if (!HAS_TZ.test(s)) s = s.replace(' ', 'T') + 'Z'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw apiError(`invalid input syntax for type timestamp: "${v}"`, '22007')
  return d.toISOString()
}

export function toDate(v) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (ISO_DATE.test(s)) return s
  const m = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(s)
  if (m) return m[1]
  throw apiError(`invalid input syntax for type date: "${v}"`, '22007')
}

function toNumber(v, type, col) {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' && v.trim() === '') throw apiError(`invalid input syntax for type ${type === I ? 'integer' : 'numeric'}: ""`, '22P02', 400, col)
  const n = Number(v)
  if (!Number.isFinite(n)) throw apiError(`invalid input syntax for type numeric: "${v}"`, '22P02', 400, col)
  return type === I ? Math.trunc(n) : n
}

// JS value -> D1 bind value
export function toDb(type, v, col) {
  if (v === undefined) return null
  switch (type) {
    case B: return v === null ? null : (v === true || v === 1 || v === 'true' || v === 't') ? 1 : 0
    case J: return v === null ? null : JSON.stringify(v)
    case TS: return toTimestamp(v)
    case D: return toDate(v)
    case I: case R: return toNumber(v, type, col)
    default: return v === null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

// D1 row value -> JS value
export function fromDb(type, v) {
  if (v === null || v === undefined) return null
  if (type === B) return !!v
  if (type === J) { try { return JSON.parse(v) } catch { return v } }
  return v
}

export function formatRow(t, row, cols) {
  const out = {}
  for (const c of cols) out[c] = fromDb(t.columns[c], row[c])
  return out
}
