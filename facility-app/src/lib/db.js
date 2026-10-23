// Browser client for the Cloudflare Worker + D1 backend (replaces supabase-js).
//
// It keeps the same chainable shape the pages already use, e.g.
//   const { data, error } = await db.from('equipment').select('*, area:areas(area_name)').eq('status','Active').order('equip_id')
// Each chain is sent to POST /api/query and evaluated by worker/query.js.
// Calls never throw: like supabase-js they resolve to { data, error, count }.

const API = (import.meta.env?.VITE_API_URL || globalThis.FACILITY_API_URL || '').replace(/\/$/, '')
const SESSION_KEY = 'facility-session'
const REFRESH_AFTER = 24 * 3600 // refresh a token once it is a day old

// ---------------- session ----------------
let session = loadSession()
const listeners = new Set()

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') } catch { return null }
}
function saveSession(s, event) {
  session = s
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY) } catch { /* private mode */ }
  for (const cb of listeners) { try { cb(event, s) } catch (e) { console.error(e) } }
}

function toError(body, status) {
  const e = new Error(body?.message || `Request failed (${status})`)
  e.code = body?.code; e.details = body?.details; e.status = status
  return { message: e.message, code: e.code, details: e.details, status }
}

let refreshing = null
async function maybeRefresh() {
  if (!session || refreshing || !navigator.onLine) return
  const issued = session.expires_at - 30 * 86400
  if (Date.now() / 1000 - issued < REFRESH_AFTER) return
  refreshing = request('/api/auth/refresh', {}, { skipRefresh: true })
    .then(({ data }) => { if (data?.access_token) saveSession(data, 'TOKEN_REFRESHED') })
    .finally(() => { refreshing = null })
}

async function request(path, body, { method = 'POST', raw, contentType, skipRefresh } = {}) {
  const headers = {}
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  let payload = raw
  if (!raw) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body ?? {}) }
  else if (contentType) headers['Content-Type'] = contentType
  let res
  try {
    res = await fetch(API + path, { method, headers, body: payload })
  } catch (e) {
    return { data: null, error: { message: `Failed to fetch: ${e.message || 'network error'}`, code: 'NETWORK' } }
  }
  let json = null
  try { json = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    // Session is no longer valid on the server: sign out locally.
    if (res.status === 401 && session && !path.startsWith('/api/auth/')) saveSession(null, 'SIGNED_OUT')
    return { data: null, error: toError(json, res.status), status: res.status }
  }
  if (!skipRefresh) maybeRefresh()
  return { data: json, error: null, status: res.status }
}

const auth = {
  async getSession() { return { data: { session }, error: null } },
  onAuthStateChange(cb) {
    listeners.add(cb)
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
  },
  async signInWithPin(pin, techId) {
    const { data, error } = await request('/api/auth/pin', techId ? { pin, tech_id: techId } : { pin })
    if (error) return { data: null, error }
    saveSession(data, 'SIGNED_IN')
    return { data: { session: data }, error: null }
  },
  async signInWithPassword({ email, password }) {
    const { data, error } = await request('/api/auth/password', { email, password })
    if (error) return { data: null, error }
    saveSession(data, 'SIGNED_IN')
    return { data: { session: data }, error: null }
  },
  async signOut() { saveSession(null, 'SIGNED_OUT'); return { error: null } },
}

// ---------------- query builder ----------------
class Query {
  constructor(table) {
    this.q = { table, action: 'select', select: '*', filters: [], order: [] }
  }
  select(columns = '*', opts = {}) {
    if (this.q.action === 'select') {
      this.q.select = columns
      if (opts.count) this.q.count = opts.count
      if (opts.head) this.q.head = true
    } else { this.q.returning = true; this.q.select = columns }
    return this
  }
  insert(values) { this.q.action = 'insert'; this.q.values = values; this.q.returning = false; return this }
  upsert(values, opts = {}) {
    this.q.action = 'upsert'; this.q.values = values; this.q.returning = false
    if (opts.onConflict) this.q.onConflict = opts.onConflict
    if (opts.ignoreDuplicates) this.q.ignoreDuplicates = true
    return this
  }
  update(values) { this.q.action = 'update'; this.q.values = values; this.q.returning = false; return this }
  delete() { this.q.action = 'delete'; this.q.returning = false; return this }
  _f(col, op, value) { this.q.filters.push([col, op, value]); return this }
  eq(c, v) { return this._f(c, 'eq', v) }
  neq(c, v) { return this._f(c, 'neq', v) }
  gt(c, v) { return this._f(c, 'gt', v) }
  gte(c, v) { return this._f(c, 'gte', v) }
  lt(c, v) { return this._f(c, 'lt', v) }
  lte(c, v) { return this._f(c, 'lte', v) }
  in(c, v) { return this._f(c, 'in', Array.from(v || [])) }
  is(c, v) { return this._f(c, 'is', v) }
  like(c, v) { return this._f(c, 'like', v) }
  ilike(c, v) { return this._f(c, 'ilike', v) }
  match(obj) { for (const [c, v] of Object.entries(obj)) this.eq(c, v); return this }
  not(c, op, v) { if (op !== 'is') throw new Error('Only not(col, "is", value) is supported'); return this._f(c, 'not.is', v) }
  order(col, opts = {}) { this.q.order.push([col, opts.ascending !== false, opts.nullsFirst]); return this }
  limit(n) { this.q.limit = n; return this }
  range(from, to) { this.q.offset = from; this.q.limit = to - from + 1; return this }
  single() { this.q.single = 'single'; return this }
  maybeSingle() { this.q.single = 'maybe'; return this }
  async _run() {
    const { data, error, status } = await request('/api/query', this.q)
    if (error) return { data: null, error, count: null, status }
    return { data: data.data ?? null, count: data.count ?? null, error: null, status }
  }
  then(resolve, reject) { return this._run().then(resolve, reject) }
  catch(reject) { return this._run().catch(reject) }
}

// ---------------- storage (Cloudflare KV via the Worker) ----------------
const storage = {
  from(bucket) {
    const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/')
    return {
      async upload(path, file, opts = {}) {
        const { data, error } = await request(`/api/storage/${bucket}/${enc(path)}?upsert=${opts.upsert ? 'true' : 'false'}`, null,
          { method: 'PUT', raw: file, contentType: opts.contentType || file?.type || 'application/octet-stream' })
        return error ? { data: null, error } : { data: data.data, error: null }
      },
      getPublicUrl(path) { return { data: { publicUrl: `${API}/files/${bucket}/${enc(path)}` } } },
    }
  },
}

export const db = {
  from: (table) => new Query(table),
  async rpc(name, args = {}) {
    const { data, error } = await request(`/api/rpc/${name}`, args)
    return error ? { data: null, error } : { data: data.data ?? null, error: null }
  },
  functions: {
    async invoke(name, { body } = {}) {
      const { data, error } = await request(`/api/functions/${name}`, body)
      return error ? { data: null, error } : { data: data.data ?? null, error: null }
    },
  },
  auth,
  storage,
}

export default db
