// First-time setup from the browser (no Node.js or command line needed).
//
// Open https://<your-app>/setup, enter the SETUP_KEY secret, press Start.
// The page calls POST /api/setup once per step:
//   step "schema"  -> creates the tables (migrations/0001_init.sql)
//   step 1..18     -> loads seed/01..18 (plants, areas, equipment, staff, checklists, gensets)
//   step "logins"  -> creates a PIN login for each technician in seed/tech_list.json
// Each step is one atomic batch and is recorded, so a retry skips finished steps.
// Setup locks itself permanently once any technician has a PIN.

import { apiError } from './schema.js'
import { hashPin } from './auth.js'
import { migrations, seedFiles, techList } from './setup-data.generated.js'

const SEEDS = seedFiles.map((f) => f.sql)
const LABELS = ['Plants', 'Areas', 'Equipment', 'Staff', 'Issues', ...Array.from({ length: 12 }, (_, i) => `Checklists ${i + 1}/12`), 'Gensets']
export const STEPS = [{ id: 'schema', label: 'Create tables' }, ...SEEDS.map((_, i) => ({ id: String(i + 1), label: LABELS[i] })), { id: 'logins', label: 'Create PIN logins' }]

// Split a SQL file into statements (handles quotes and -- comments).
export function splitSql(sql) {
  const out = []
  let cur = '', inStr = false
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (!inStr && c === '-' && sql[i + 1] === '-') { while (i < sql.length && sql[i] !== '\n') i++; cur += '\n'; continue }
    if (c === "'") inStr = !inStr
    if (c === ';' && !inStr) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function keyMatches(given, expected) {
  if (typeof given !== 'string' || given.length !== expected.length) return false
  let r = 0
  for (let i = 0; i < given.length; i++) r |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  return r === 0
}

async function tableExists(db, name) {
  return !!(await db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first())
}

export async function runSetup(env, body) {
  const db = env.DB
  if (!env.SETUP_KEY || env.SETUP_KEY.length < 12) throw apiError('Setup is disabled. Add a SETUP_KEY secret (12+ characters) to the Worker first.', 'SETUP_DISABLED', 403)
  if (!keyMatches(body?.key, env.SETUP_KEY)) throw apiError('Wrong setup key.', 'SETUP_KEY', 403)
  if (!env.PIN_PEPPER || env.PIN_PEPPER.length < 16) throw apiError('Add the PIN_PEPPER secret (16+ characters) before setup.', 'CONFIG', 500)
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 16) throw apiError('Add the JWT_SECRET secret (16+ characters) before setup.', 'CONFIG', 500)

  const hasSchema = await tableExists(db, 'technicians')
  if (hasSchema) {
    const locked = await db.prepare('SELECT 1 FROM technicians WHERE pin_hash IS NOT NULL LIMIT 1').first()
    if (locked) return { done: true, locked: true, message: 'Setup is already complete. Staff can sign in with their PINs.' }
  }
  await db.prepare('CREATE TABLE IF NOT EXISTS _setup (step TEXT PRIMARY KEY, done_at TEXT NOT NULL)').run()
  const doneRows = (await db.prepare('SELECT step FROM _setup').all()).results.map((r) => r.step)
  const done = new Set(doneRows)

  if (body.step === 'status' || !body.step) return { steps: STEPS, done: [...done] }
  const step = STEPS.find((s) => s.id === String(body.step))
  if (!step) throw apiError('Unknown setup step', 'SETUP', 400)
  if (done.has(step.id)) return { step: step.id, skipped: true }
  const mark = db.prepare("INSERT INTO _setup (step, done_at) VALUES (?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(step.id)

  try {
    if (step.id === 'schema') {
      await applyPendingMigrations(db)
      await mark.run()
    } else if (step.id === 'logins') {
      for (const s of STEPS.slice(0, -1)) if (!done.has(s.id)) throw apiError(`Run "${s.label}" first.`, 'SETUP', 400)
      const stmts = []
      for (const { techId, pin } of techList) {
        const email = `${techId.toLowerCase()}@internal.app`
        stmts.push(db.prepare('INSERT OR IGNORE INTO auth_users (id, email) VALUES (?, ?)').bind(crypto.randomUUID(), email))
        stmts.push(db.prepare('UPDATE technicians SET auth_uid = (SELECT id FROM auth_users WHERE email = ?), pin_hash = ? WHERE tech_id = ?').bind(email, await hashPin(env, pin), techId))
      }
      await db.batch([...stmts, mark])
      return { step: step.id, ok: true, finished: true }
    } else {
      if (!done.has('schema')) throw apiError('Run "Create tables" first.', 'SETUP', 400)
      const sql = SEEDS[Number(step.id) - 1]
      await db.batch([...splitSql(sql).map((s) => db.prepare(s)), mark])
    }
  } catch (e) {
    if (e.status) throw e
    throw apiError(`Step "${step.label}" failed: ${e.message}`, 'SETUP', 500)
  }
  return { step: step.id, ok: true }
}

// ---------------------------------------------------------------------------
// Database updates (new tables from migrations/*.sql) without the command line.
// Uses the same d1_migrations table as `wrangler d1 migrations apply`, so both
// ways can be mixed safely. Each migration is applied as one atomic batch.
const MIGRATIONS_TABLE = 'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)'

export async function migrationStatus(db) {
  await db.prepare(MIGRATIONS_TABLE).run()
  const applied = new Set((await db.prepare('SELECT name FROM d1_migrations').all()).results.map((r) => r.name))
  // A database created before migrations were tracked already has the 0001 tables.
  if (!applied.has('0001_init.sql') && (await tableExists(db, 'technicians'))) {
    await db.prepare("INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql')").run()
    applied.add('0001_init.sql')
  }
  return migrations.map((m) => ({ name: m.name, applied: applied.has(m.name) }))
}

export async function applyPendingMigrations(db) {
  const status = await migrationStatus(db)
  const done = []
  for (const m of migrations) {
    if (status.find((s) => s.name === m.name)?.applied) continue
    const stmts = splitSql(m.sql).map((sql) => db.prepare(sql))
    stmts.push(db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(m.name))
    try { await db.batch(stmts) } catch (e) { throw apiError(`Database update ${m.name} failed: ${e.message}`, 'MIGRATION', 500) }
    done.push(m.name)
  }
  return done
}

// GET status / POST apply — Admin only (signed in), no setup key needed.
export async function adminDbUpdate(ctx, method) {
  if (ctx.actor?.role !== 'Admin') throw apiError('Administrator required', '42501', 403)
  if (method === 'POST') {
    const applied = await applyPendingMigrations(ctx.db)
    return { applied, status: await migrationStatus(ctx.db) }
  }
  return { status: await migrationStatus(ctx.db) }
}
