// A small PostgREST-compatible query engine on top of D1.
// The browser client (src/lib/db.js) builds the same chains the app used
// with supabase-js (.from().select().eq().order()...) and posts them here
// as JSON. Every table/column name is checked against worker/schema.js, and
// all values are bound parameters, so no client text is ever spliced into SQL.

import { TABLES, table, apiError, toDb, formatRow } from './schema.js'

const MAX_ROWS = 10000
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }

// ---------- select string parser:  "*, area:areas(area_name), details:inspection_details(*)" ----------
export function parseSelect(src) {
  const s = (src ?? '*').replace(/\s+/g, '')
  let i = 0
  function list() {
    const items = []
    while (i < s.length && s[i] !== ')') {
      let start = i
      while (i < s.length && !',()'.includes(s[i])) i++
      let token = s.slice(start, i)
      if (s[i] === '(') {
        i++
        const children = list()
        if (s[i] !== ')') throw apiError('Malformed select: missing )', 'PGRST100')
        i++
        let alias = null, name = token
        if (token.includes(':')) [alias, name] = token.split(':')
        name = name.split('!')[0]
        items.push({ embed: true, alias: alias || name, table: name, children })
      } else if (token) {
        let alias = null, name = token
        if (token.includes(':')) [alias, name] = token.split(':')
        name = name.split('::')[0]
        items.push({ embed: false, alias: alias || name, column: name })
      }
      if (s[i] === ',') i++
    }
    return items
  }
  const items = list()
  if (i !== s.length) throw apiError('Malformed select', 'PGRST100')
  return items.length ? items : [{ embed: false, alias: '*', column: '*' }]
}

// ---------- policies ----------
function canRead(ctx, name) {
  const t = table(name)
  if (!ctx.actor) throw apiError('permission denied: an active staff account is required', '42501', 403)
  return t
}
function canWrite(ctx, name, action) {
  const t = canRead(ctx, name)
  if (t.write === 'none') throw apiError(`permission denied for table ${name}`, '42501', 403)
  if (t.write === 'admin' && ctx.actor.role !== 'Admin') throw apiError(`permission denied for table ${name}: administrator required`, '42501', 403)
  if (action === 'delete' && t.noDelete) throw apiError(`permission denied for table ${name}`, '42501', 403)
  return t
}

function col(t, name, tableName) {
  if (!Object.prototype.hasOwnProperty.call(t.columns, name)) throw apiError(`column ${tableName}.${name} does not exist`, '42703')
  return name
}

// ---------- WHERE ----------
function buildWhere(t, tableName, filters = [], ctx) {
  const parts = [], params = []
  for (const f of filters) {
    const [c, op, value] = f
    col(t, c, tableName)
    const type = t.columns[c]
    if (OPS[op]) {
      if (value === null) { parts.push(op === 'neq' ? `"${c}" IS NOT NULL` : op === 'eq' ? `"${c}" IS NULL` : '0'); continue }
      parts.push(`"${c}" ${OPS[op]} ?`); params.push(toDb(type, value, c))
    } else if (op === 'in') {
      if (!Array.isArray(value)) throw apiError('in() expects an array', 'PGRST100')
      // json_each keeps us under D1's 100 bound-parameter limit for long id lists.
      parts.push(`"${c}" IN (SELECT value FROM json_each(?))`)
      params.push(JSON.stringify(value.map((v) => toDb(type, v, c))))
    } else if (op === 'is') {
      if (value === null || value === 'null') parts.push(`"${c}" IS NULL`)
      else if (value === true || value === 'true') parts.push(`"${c}" = 1`)
      else if (value === false || value === 'false') parts.push(`"${c}" = 0`)
      else throw apiError('is() expects null, true or false', 'PGRST100')
    } else if (op === 'not.is') {
      parts.push(value === null || value === 'null' ? `"${c}" IS NOT NULL` : `"${c}" IS NOT ?`)
      if (!(value === null || value === 'null')) params.push(toDb(type, value, c))
    } else if (op === 'like' || op === 'ilike') {
      parts.push(op === 'like' ? `"${c}" GLOB ?` : `"${c}" LIKE ? ESCAPE '\\'`)
      params.push(op === 'like' ? String(value).replace(/%/g, '*').replace(/_/g, '?') : String(value))
    } else throw apiError(`Unsupported filter operator: ${op}`, 'PGRST100')
  }
  if (t.read === 'own') { parts.push(`"${t.ownerColumn}" = ?`); params.push(ctx.user.id) }
  return { sql: parts.length ? ' WHERE ' + parts.join(' AND ') : '', params }
}

function buildOrder(t, tableName, order = []) {
  if (!order.length) return ''
  const parts = order.map(([c, ascending = true, nullsFirst]) => {
    col(t, c, tableName)
    const dir = ascending ? 'ASC' : 'DESC'
    // Postgres default: NULLS LAST for ASC, NULLS FIRST for DESC.
    const nf = nullsFirst ?? !ascending
    const coll = t.columns[c] === 'text' ? ' COLLATE NOCASE' : ''
    return `("${c}" IS NULL) ${nf ? 'DESC' : 'ASC'}, "${c}"${coll} ${dir}`
  })
  return ' ORDER BY ' + parts.join(', ')
}

// ---------- relationships ----------
function relation(parentName, targetName, alias) {
  const parent = table(parentName), target = table(targetName)
  const outgoing = Object.entries(parent.refs || {}).filter(([, ref]) => ref === targetName).map(([c]) => c)
  if (outgoing.length) {
    let c = outgoing[0]
    if (outgoing.length > 1) {
      c = outgoing.find((x) => x === `${alias}_id` || x === alias)
      if (!c) throw apiError(`Could not choose a relationship between ${parentName} and ${targetName}`, 'PGRST201', 300)
    }
    return { kind: 'one', column: c }
  }
  const incoming = Object.entries(target.refs || {}).filter(([, ref]) => ref === parentName).map(([c]) => c)
  if (incoming.length) {
    if (incoming.length > 1 && targetName !== parentName) throw apiError(`Could not choose a relationship between ${parentName} and ${targetName}`, 'PGRST201', 300)
    return { kind: 'many', column: incoming[0] }
  }
  throw apiError(`Could not find a relationship between '${parentName}' and '${targetName}'`, 'PGRST200')
}

function pkOf(t) { return t.pk || 'id' }

// Resolve which physical columns a select tree needs, and which keys to strip afterwards.
function plan(tableName, items) {
  const t = table(tableName)
  const wanted = []   // [alias, column]
  const embeds = []
  const needed = new Set()
  for (const it of items) {
    if (!it.embed) {
      if (it.column === '*') { for (const c of Object.keys(t.columns)) { wanted.push([c, c]); needed.add(c) } }
      else { col(t, it.column, tableName); wanted.push([it.alias, it.column]); needed.add(it.column) }
    } else {
      const rel = relation(tableName, it.table, it.alias)
      if (rel.kind === 'one') needed.add(rel.column)
      else needed.add(pkOf(t))
      embeds.push({ ...it, rel })
    }
  }
  return { t, wanted, embeds, cols: [...needed] }
}

async function attachEmbeds(ctx, tableName, rows, raw, embeds) {
  const t = table(tableName)
  for (const e of embeds) {
    canRead(ctx, e.table)
    const target = table(e.table)
    const isCount = e.children.length === 1 && !e.children[0].embed && e.children[0].column === 'count'
    if (e.rel.kind === 'one') {
      const keys = [...new Set(raw.map((r) => r[e.rel.column]).filter((v) => v != null))]
      const pk = pkOf(target)
      const sub = await selectRows(ctx, e.table, e.children, [[pk, 'in', keys]], [], null, null, [pk])
      const byId = new Map(sub.raw.map((r, i) => [r[pk], sub.rows[i]]))
      rows.forEach((row, i) => { row[e.alias] = byId.get(raw[i][e.rel.column]) ?? null })
    } else {
      const keys = [...new Set(raw.map((r) => r[pkOf(t)]))]
      if (isCount) {
        const counts = new Map()
        if (keys.length) {
          const res = await ctx.db.prepare(`SELECT "${e.rel.column}" AS k, COUNT(*) AS n FROM "${e.table}" WHERE "${e.rel.column}" IN (SELECT value FROM json_each(?)) GROUP BY "${e.rel.column}"`).bind(JSON.stringify(keys)).all()
          for (const r of res.results) counts.set(r.k, r.n)
        }
        rows.forEach((row, i) => { row[e.alias] = [{ count: counts.get(raw[i][pkOf(t)]) || 0 }] })
        continue
      }
      const sub = await selectRows(ctx, e.table, e.children, [[e.rel.column, 'in', keys]], [], null, null, [e.rel.column])
      const groups = new Map()
      sub.raw.forEach((r, i) => { const k = r[e.rel.column]; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(sub.rows[i]) })
      rows.forEach((row, i) => { row[e.alias] = groups.get(raw[i][pkOf(t)]) || [] })
    }
  }
}

// Core select. extraCols are fetched (for joining) but only returned if asked for.
async function selectRows(ctx, tableName, items, filters, order, limit, offset, extraCols = []) {
  const p = plan(tableName, items)
  const cols = [...new Set([...p.cols, ...extraCols])]
  if (!cols.length) cols.push(pkOf(p.t))
  if (filters.some(([, op, v]) => op === 'in' && Array.isArray(v) && v.length === 0)) return { rows: [], raw: [] }
  const where = buildWhere(p.t, tableName, filters, ctx)
  let sql = `SELECT ${cols.map((c) => `"${c}"`).join(', ')} FROM "${tableName}"${where.sql}${buildOrder(p.t, tableName, order)}`
  const lim = Math.min(limit ?? MAX_ROWS, MAX_ROWS)
  sql += ` LIMIT ${Number(lim) | 0} OFFSET ${Math.max(0, Number(offset) | 0)}`
  const res = await ctx.db.prepare(sql).bind(...where.params).all()
  const raw = res.results
  const rows = raw.map((r) => {
    const o = {}
    for (const [alias, c] of p.wanted) o[alias] = formatRow(p.t, r, [c])[c]
    return o
  })
  if (p.embeds.length) await attachEmbeds(ctx, tableName, rows, raw, p.embeds)
  return { rows, raw }
}

async function countRows(ctx, tableName, filters) {
  const t = table(tableName)
  if (filters.some(([, op, v]) => op === 'in' && Array.isArray(v) && v.length === 0)) return 0
  const where = buildWhere(t, tableName, filters, ctx)
  const r = await ctx.db.prepare(`SELECT COUNT(*) AS n FROM "${tableName}"${where.sql}`).bind(...where.params).first()
  return r.n
}

// ---------- writes ----------
function writableColumns(t, action) {
  if (action === 'insert' && t.insertable) return new Set(t.insertable)
  if (action === 'update' && t.updatable) return new Set(t.updatable)
  return new Set(Object.keys(t.columns))
}

function rowValues(t, tableName, obj, action) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw apiError('Each row must be an object', 'PGRST102')
  const allowed = writableColumns(t, action)
  const cols = [], vals = []
  for (const [c, v] of Object.entries(obj)) {
    if (v === undefined) continue
    col(t, c, tableName)
    if (!allowed.has(c)) throw apiError(`permission denied for column ${c} of table ${tableName}`, '42501', 403)
    cols.push(c); vals.push(toDb(t.columns[c], v, c))
  }
  return { cols, vals }
}

async function returningRows(ctx, tableName, rawRows, q) {
  if (!q.returning) return null
  const items = parseSelect(q.select)
  const p = plan(tableName, items)
  const rows = rawRows.map((r) => {
    const o = {}
    for (const [alias, c] of p.wanted) o[alias] = formatRow(p.t, r, [c])[c]
    return o
  })
  if (p.embeds.length) await attachEmbeds(ctx, tableName, rows, rawRows, p.embeds)
  return rows
}

async function insertRows(ctx, tableName, q, upsert) {
  const t = canWrite(ctx, tableName, 'insert')
  const list = Array.isArray(q.values) ? q.values : [q.values]
  if (!list.length) return { data: [] }
  const pk = pkOf(t)
  const conflict = upsert ? (q.onConflict || pk).split(',').map((c) => col(t, c.trim(), tableName)) : null
  const stmts = list.map((obj) => {
    const { cols, vals } = rowValues(t, tableName, obj, 'insert')
    const userGaveId = cols.includes(pk)
    if (!userGaveId && t.columns[pk] === 'uuid') { cols.push(pk); vals.push(crypto.randomUUID()) }
    let sql = `INSERT INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    if (upsert) {
      const set = cols.filter((c) => !conflict.includes(c) && (c !== pk || userGaveId))
      if (t.touch && !cols.includes(t.touch)) set.push(t.touch)
      sql += q.ignoreDuplicates || !set.length
        ? ` ON CONFLICT (${conflict.map((c) => `"${c}"`).join(', ')}) DO NOTHING`
        : ` ON CONFLICT (${conflict.map((c) => `"${c}"`).join(', ')}) DO UPDATE SET ${set.map((c) => c === t.touch && !cols.includes(c) ? `"${c}" = strftime('%Y-%m-%dT%H:%M:%fZ','now')` : `"${c}" = excluded."${c}"`).join(', ')}`
    }
    return ctx.db.prepare(sql + ' RETURNING *').bind(...vals)
  })
  const results = await runBatch(ctx, stmts)
  const raw = results.flatMap((r) => r.results || [])
  return { data: await returningRows(ctx, tableName, raw, q) }
}

async function updateRows(ctx, tableName, q) {
  const t = canWrite(ctx, tableName, 'update')
  if (!q.filters?.length) throw apiError('UPDATE requires a WHERE clause', '21000')
  const { cols, vals } = rowValues(t, tableName, q.values, 'update')
  if (!cols.length) throw apiError('Nothing to update', 'PGRST102')
  const sets = cols.map((c) => `"${c}" = ?`)
  if (t.touch && !cols.includes(t.touch)) sets.push(`"${t.touch}" = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
  const where = buildWhere(t, tableName, q.filters, ctx)
  if (q.filters.some(([, op, v]) => op === 'in' && Array.isArray(v) && v.length === 0)) return { data: q.returning ? [] : null }
  const res = await ctx.db.prepare(`UPDATE "${tableName}" SET ${sets.join(', ')}${where.sql} RETURNING *`).bind(...vals, ...where.params).all()
  return { data: await returningRows(ctx, tableName, res.results, q) }
}

async function deleteRows(ctx, tableName, q) {
  const t = canWrite(ctx, tableName, 'delete')
  if (!q.filters?.length) throw apiError('DELETE requires a WHERE clause', '21000')
  if (q.filters.some(([, op, v]) => op === 'in' && Array.isArray(v) && v.length === 0)) return { data: q.returning ? [] : null }
  const where = buildWhere(t, tableName, q.filters, ctx)
  const res = await ctx.db.prepare(`DELETE FROM "${tableName}"${where.sql} RETURNING *`).bind(...where.params).all()
  return { data: await returningRows(ctx, tableName, res.results, q) }
}

// Translate SQLite constraint errors into the Postgres wording the UI already understands.
export function translateDbError(err) {
  if (err.status) return err
  const m = String(err.message || err)
  let out
  if (/UNIQUE constraint failed: ([\w.]+(, [\w.]+)*)/.test(m)) out = apiError(`duplicate key value violates unique constraint (${RegExp.$1})`, '23505', 409)
  else if (/FOREIGN KEY constraint failed/.test(m)) out = apiError('update or delete violates foreign key constraint: the record is still referenced by other records', '23503', 409)
  else if (/NOT NULL constraint failed: ([\w.]+)/.test(m)) out = apiError(`null value in column "${RegExp.$1.split('.').pop()}" violates not-null constraint`, '23502', 400)
  else if (/CHECK constraint failed: (\w+)/.test(m)) out = apiError(`check constraint failed: ${RegExp.$1}`, '23514', 409)
  else { out = apiError('Database error', 'DB', 500); console.error(err) }
  out.cause = err
  return out
}

export async function runBatch(ctx, stmts) {
  try { return await ctx.db.batch(stmts) } catch (e) { throw translateDbError(e) }
}

// ---------- entry point ----------
export async function runQuery(ctx, q) {
  const tableName = q.table
  table(tableName)
  try {
    switch (q.action) {
      case 'select': {
        canRead(ctx, tableName)
        const filters = q.filters || []
        let count = null
        if (q.count) count = await countRows(ctx, tableName, filters)
        if (q.head) return { data: null, count }
        const limit = q.single ? 2 : q.limit
        const { rows } = await selectRows(ctx, tableName, parseSelect(q.select), filters, q.order || [], limit, q.offset)
        return singleResult({ data: rows, count }, q)
      }
      case 'insert': return singleResult(await insertRows(ctx, tableName, q, false), q)
      case 'upsert': return singleResult(await insertRows(ctx, tableName, q, true), q)
      case 'update': return singleResult(await updateRows(ctx, tableName, q), q)
      case 'delete': return singleResult(await deleteRows(ctx, tableName, q), q)
      default: throw apiError(`Unknown action ${q.action}`, 'PGRST100')
    }
  } catch (e) { throw translateDbError(e) }
}

function singleResult(res, q) {
  if (!q.single || !Array.isArray(res.data)) return res
  if (res.data.length === 1) return { ...res, data: res.data[0] }
  if (res.data.length === 0 && q.single === 'maybe') return { ...res, data: null }
  throw apiError('JSON object requested, multiple (or no) rows returned', 'PGRST116', 406, `The result contains ${res.data.length} rows`)
}

export { TABLES }
