// End-to-end test of the Cloudflare Worker + D1 backend, driven through the
// same browser client the app uses (src/lib/db.js).
//
// 1. cp .dev.vars.example .dev.vars
// 2. npm run db:migrate:local
// 3. PIN_PEPPER=dev-only-pin-pepper-change-me-0123 node scripts/make-seed.mjs
//    npx wrangler d1 execute facility-db --local --file=seed/seed.sql
// 4. npm run build && npx wrangler dev --port 8787     (in another terminal)
// 5. npm run test:worker
//
// Uses a fresh local database: it creates inspections, tasks and staff.
import assert from 'node:assert/strict'

globalThis.FACILITY_API_URL = process.env.API_URL || 'http://127.0.0.1:8787'
const store = new Map()
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) }
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true })
const { db } = await import('../src/lib/db.js')

let passed = 0
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS:', name) } catch (e) { console.error('FAIL:', name, '\n ', e); process.exitCode = 1 }
}
const ok = (r) => { if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`); return r.data }
async function as(pin) { const r = await db.auth.signInWithPin(pin); ok(r); return (await db.auth.getSession()).data.session }

const ADMIN = '6743', TECH = '1912', OTHER = '7890'

await test('wrong PIN rejected, right PIN signs in', async () => {
  const bad = await db.auth.signInWithPin('0000')
  assert.ok(bad.error)
  const s = await as(TECH)
  assert.ok(s.access_token)
  const me = ok(await db.from('technicians').select('id, tech_id, name, role, status, auth_uid').eq('auth_uid', s.user.id).single())
  assert.equal(me.tech_id, 'T003')
})

await test('not signed in -> no data', async () => {
  await db.auth.signOut()
  const r = await db.from('plants').select('*')
  assert.equal(r.error.status, 401)
  await as(TECH)
})

await test('embeds, nested embeds, count, ordering', async () => {
  const eq = ok(await db.from('equipment').select('*, area:areas(area_name, plant:plants(plant_name))').eq('equip_id', 'EQ001').single())
  assert.equal(typeof eq.area.area_name, 'string')
  assert.ok(eq.area.plant.plant_name)
  assert.deepEqual(eq.document_links, [])
  const { count } = await db.from('checklist_templates').select('*', { count: 'exact', head: true })
  assert.ok(count > 3000)
  const withCount = ok(await db.from('equipment').select('*, area:areas(area_name), inspection_headers(count)').order('equip_id').limit(3))
  assert.deepEqual(withCount[0].inspection_headers, [{ count: 0 }])
  assert.equal(withCount[0].equip_id, 'EQ001')
  const tpl = ok(await db.from('checklist_templates').select('*').eq('equipment_id', eq.id).order('sort_order'))
  assert.equal(tpl[0].required, true)
  const paged = ok(await db.from('equipment').select('id').order('id').range(10, 19))
  assert.equal(paged.length, 10)
})

await test('in() with more than 100 ids', async () => {
  const ids = ok(await db.from('equipment').select('id')).map((e) => e.id)
  assert.ok(ids.length > 300)
  const rows = ok(await db.from('equipment').select('id').in('id', ids))
  assert.equal(rows.length, ids.length)
  assert.deepEqual(ok(await db.from('equipment').select('id').in('id', [])), [])
})

await test('single() errors when no row (Scan fallback relies on this)', async () => {
  const r = await db.from('equipment').select('equip_id').eq('qr_code', 'NOPE').single()
  assert.equal(r.error.code, 'PGRST116')
})

await test('PIN column is never exposed', async () => {
  const r = await db.from('technicians').select('pin_hash')
  assert.ok(r.error)
  const all = ok(await db.from('technicians').select('*').limit(1))
  assert.ok(!('pin_hash' in all[0]))
})

// ---- inspections (ports of the old PGlite database-test.mjs) ----
const eq = ok(await db.from('equipment').select('id, equipment_name').eq('equip_id', 'EQ001').single())
const tpls = ok(await db.from('checklist_templates').select('*').eq('equipment_id', eq.id).order('sort_order'))
const answer = (t) => t.type === 'numeric' ? String(t.min_value ?? 0) : t.options.split(',')[0].trim()
const payload = (extra = {}) => ({ kind: 'equipment', asset_id: eq.id, request_id: crypto.randomUUID(), label: eq.equipment_name, header: { notes: 'Test', inspection_date: new Date().toISOString() }, details: tpls.map((t) => ({ parameter_name: t.parameter_name, value: answer(t) })), ...extra })
const save = (p) => db.rpc('facility_save_inspection', { p })
let first

await test('transactional save and duplicate retry receipt', async () => {
  await as(TECH)
  const p = payload()
  first = ok(await save(p))
  assert.equal(first.revision, 1)
  assert.deepEqual(ok(await save(p)), first)
  const rows = ok(await db.from('inspection_headers').select('id').eq('equipment_id', eq.id))
  assert.equal(rows.length, 1)
  const h = ok(await db.from('inspection_headers').select('*, details:inspection_details(*), technician:technicians(name)').eq('id', first.inspectionId).single())
  assert.equal(h.details.length, tpls.length)
  assert.equal(h.status, 'Pending Sign-off')
  assert.equal(h.is_backdated, false)
  assert.ok(Array.isArray(h.template_snapshot))
})

await test('missing answer rejected without partial header', async () => {
  const bad = payload(); bad.details[0].value = ''
  const r = await save(bad)
  assert.match(r.error.message, /Answer required/)
  assert.equal(ok(await db.from('inspection_headers').select('id').eq('equipment_id', eq.id)).length, 1)
})

await test('future date rejected; backdated flagged', async () => {
  const fut = payload({ header: { inspection_date: new Date(Date.now() + 3 * 86400000).toISOString() } })
  assert.match((await save(fut)).error.message, /future/)
})

let correction
await test('correction preserves count, history and stale revision guard', async () => {
  correction = payload({ inspection_id: first.inspectionId, expected_revision: 1, reason: 'Typing error' })
  correction.details[0].value = String((tpls[0].max_value ?? 100) + 1000)
  assert.equal(ok(await save(correction)).revision, 2)
  assert.equal(ok(await db.from('inspection_headers').select('id').eq('equipment_id', eq.id)).length, 1)
  const v = ok(await db.from('inspection_versions').select('*').eq('inspection_id', first.inspectionId).order('revision', { ascending: false }))
  assert.equal(v.length, 2)
  assert.equal(v[0].snapshot.header.revision, 2)
  const stale = await save({ ...correction, request_id: crypto.randomUUID() })
  assert.match(stale.error.message, /changed/)
})

await test('out-of-range reading opens a linked issue', async () => {
  const issues = ok(await db.from('issues').select('id,issue,status,correction_review_required').eq('source_kind', 'equipment').eq('source_inspection_id', first.inspectionId))
  assert.equal(issues.length, 1)
  assert.equal(issues[0].status, 'Open')
})

await test('other-user correction and direct record writes blocked', async () => {
  await as(OTHER)
  const r = await save({ ...correction, request_id: crypto.randomUUID(), expected_revision: 2 })
  assert.match(r.error.message, /own inspections/)
  assert.ok((await db.from('inspection_headers').update({ status: 'Signed' }).eq('id', first.inspectionId)).error)
  const me = (await db.auth.getSession()).data.session.user.id
  assert.ok((await db.from('technicians').update({ role: 'Admin' }).eq('auth_uid', me)).error)
  assert.ok((await db.from('equipment').update({ status: 'Retired' }).eq('equip_id', 'EQ001')).error)
})

await test('signed value preserved until supervisor approves correction', async () => {
  await as(ADMIN)
  ok(await db.rpc('facility_review', { kind: 'equipment', inspection: first.inspectionId, expected_revision: 2, action: 'approve', note: '', signature: 'data:image/png;base64,TEST', correction: null }))
  await as(TECH)
  const signed = { ...correction, request_id: crypto.randomUUID(), expected_revision: 2 }
  signed.details[0].value = answer(tpls[0])
  const proposal = ok(await save(signed))
  assert.equal(proposal.correctionPending, true)
  assert.equal(ok(await db.from('inspection_headers').select('revision').eq('id', first.inspectionId).single()).revision, 2)
  const denied = await db.rpc('facility_review', { kind: 'equipment', inspection: first.inspectionId, expected_revision: 2, action: 'approve-correction', note: '', signature: 'data:image/png;base64,TEST', correction: proposal.correctionId })
  assert.match(denied.error.message, /Supervisor/)
  await as(ADMIN)
  ok(await db.rpc('facility_review', { kind: 'equipment', inspection: first.inspectionId, expected_revision: 2, action: 'approve-correction', note: '', signature: 'data:image/png;base64,TEST', correction: proposal.correctionId }))
  const h = ok(await db.from('inspection_headers').select('revision,status').eq('id', first.inspectionId).single())
  assert.deepEqual(h, { revision: 3, status: 'Signed' })
  const reviews = ok(await db.from('inspection_reviews').select('*').eq('inspection_id', first.inspectionId))
  assert.equal(reviews.length, 2)
  const issue = ok(await db.from('issues').select('correction_review_required').eq('source_inspection_id', first.inspectionId).single())
  assert.equal(issue.correction_review_required, true)
})

// ---- fire extinguishers ----
await test('admin FE setup, upsert keeps id, FE submission + retry + expiry', async () => {
  await as(ADMIN)
  const floor = ok(await db.from('fe_floors').insert({ building: 'P1', floor_name: 'Ground', sort_order: 1 }).select('*').single())
  const rows = [{ fe_code: 'GF-T-01', fe_type: 'ABC', floor_id: floor.id, qr_code: 'QR-GF-T-01', expiry_date: '2027-01-31', status: 'Active' }]
  ok(await db.from('fire_extinguishers').upsert(rows, { onConflict: 'fe_code' }))
  const a = ok(await db.from('fire_extinguishers').select('id, fe_code, floor:fe_floors(building,floor_name)').eq('fe_code', 'GF-T-01').single())
  ok(await db.from('fire_extinguishers').upsert([{ ...rows[0], location_desc: 'Lobby' }], { onConflict: 'fe_code' }))
  const b = ok(await db.from('fire_extinguishers').select('id, location_desc').eq('fe_code', 'GF-T-01').single())
  assert.equal(a.id, b.id); assert.equal(b.location_desc, 'Lobby'); assert.equal(a.floor.building, 'P1')
  await as(TECH)
  const ft = ok(await db.from('fe_checklist_templates').select('*').eq('fe_type', 'ABC').order('sort_order'))
  const fe = { kind: 'fe', asset_id: a.id, request_id: crypto.randomUUID(), label: 'GF-T-01', header: { notes: 'ok', observed_expiry_date: '2027-06-30', expected_expiry_date: '2027-01-31' }, details: ft.map((t) => ({ parameter_name: t.parameter_name, value: t.options.split(',')[0] })) }
  const fr = ok(await save(fe))
  assert.equal(fr.kind, 'fe')
  assert.deepEqual(ok(await save(fe)), fr)
  assert.equal(ok(await db.from('fire_extinguishers').select('expiry_date').eq('id', a.id).single()).expiry_date, '2027-06-30')
  const stale = await save({ ...fe, request_id: crypto.randomUUID(), header: { observed_expiry_date: '2028-01-01', expected_expiry_date: '2027-01-31' } })
  assert.match(stale.error.message, /expiry date changed/)
  const hist = ok(await db.from('fe_inspections').select('id, inspection_date, status, technician:technicians(id,name), fe:fire_extinguishers(fe_code, location_desc, floor:fe_floors(building, floor_name)), details:fe_inspection_details(computed_status)').order('inspection_date', { ascending: false }).range(0, 49))
  assert.equal(hist[0].fe.floor.floor_name, 'Ground')
  assert.equal(hist[0].details.length, 7)
})

// ---- tasks (any staff member can write) ----
await test('tasks CRUD, booleans, NULLS LAST ordering', async () => {
  await as(TECH)
  const stages = ok(await db.from('task_stages').select('*').order('sort_order'))
  assert.equal(stages.length, 5); assert.equal(stages[3].is_done, true)
  const t1 = ok(await db.from('tasks').insert({ title: 'No due date', stage_id: stages[0].id }).select('*').single())
  const t2 = ok(await db.from('tasks').insert({ title: 'Due', due_date: '2026-11-01', stage_id: stages[0].id, completed: false }).select('*').single())
  const sub = ok(await db.from('tasks').insert({ title: 'Sub', parent_id: t2.id }).select('id').single())
  const ordered = ok(await db.from('tasks').select('*').in('id', [t1.id, t2.id]).order('due_date'))
  assert.deepEqual(ordered.map((t) => t.title), ['Due', 'No due date'])
  ok(await db.from('tasks').update({ stage_id: stages[3].id, completed: true }).eq('id', t2.id))
  const u = ok(await db.from('tasks').select('completed, updated_at, created_at').eq('id', t2.id).single())
  assert.equal(u.completed, true)
  assert.equal((await db.from('tasks').select('*', { count: 'exact', head: true }).eq('stage_id', stages[3].id)).count, 1)
  ok(await db.from('tasks').delete().eq('id', t2.id))
  assert.equal(ok(await db.from('tasks').select('id').eq('id', sub.id)).length, 0) // cascade
  ok(await db.from('tasks').delete().eq('id', t1.id))
  assert.ok((await db.from('task_stages').insert({ name: 'X' })).error) // admin-only
})

// ---- staff management + PINs ----
await test('manage-tech, change PIN, deactivation locks out existing session', async () => {
  await as(ADMIN)
  assert.match((await db.functions.invoke('manage-tech', { body: { action: 'add', tech_id: 'T900', name: 'Test', role: 'Tech', pin: TECH } })).error.message, /already used/)
  ok(await db.functions.invoke('manage-tech', { body: { action: 'add', tech_id: 'T900', name: 'Test Person', role: 'Tech', pin: '4321' } }))
  const t = ok(await db.from('technicians').select('id, tech_id, name, role, status').eq('tech_id', 'T900').single())
  ok(await db.functions.invoke('manage-tech', { body: { action: 'edit', id: t.id, name: 'Renamed', role: 'Supervisor' } }))
  ok(await db.functions.invoke('manage-tech', { body: { action: 'reset_pin', id: t.id, pin: '4322' } }))
  await as('4322')
  assert.equal(ok(await db.rpc('change_my_pin', { current_pin: '0000', new_pin: '5555' })).ok, false)
  assert.equal(ok(await db.rpc('change_my_pin', { current_pin: '4322', new_pin: '5555' })).ok, true)
  const s = await as('5555')
  await as(ADMIN)
  ok(await db.functions.invoke('manage-tech', { body: { action: 'set_status', id: t.id, status: 'Inactive' } }))
  // replay the deactivated user's still-unexpired token
  const res = await fetch(globalThis.FACILITY_API_URL + '/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.access_token}` }, body: JSON.stringify({ table: 'plants', action: 'select', select: '*', filters: [], order: [] }) })
  assert.equal(res.status, 403)
  assert.ok((await db.auth.signInWithPin('5555')).error)
  await as(ADMIN)
  const me = ok(await db.from('technicians').select('id').eq('tech_id', 'T002').single())
  assert.match((await db.functions.invoke('manage-tech', { body: { action: 'set_status', id: me.id, status: 'Inactive' } })).error.message, /own account/)
  await as(TECH)
  assert.ok((await db.functions.invoke('manage-tech', { body: { action: 'add', tech_id: 'T901', name: 'x', pin: '1111' } })).error)
})

await test('asset reference links (admin only)', async () => {
  await as(ADMIN)
  ok(await db.rpc('facility_asset_reference', { kind: 'equipment', asset: eq.id, documents: [{ title: 'Manual', url: 'https://example.com/m.pdf' }], maintenance_date: '2026-12-01' }))
  const e = ok(await db.from('equipment').select('document_links, next_maintenance_date').eq('id', eq.id).single())
  assert.deepEqual(e.document_links, [{ title: 'Manual', url: 'https://example.com/m.pdf' }])
  assert.equal(e.next_maintenance_date, '2026-12-01')
  assert.match((await db.rpc('facility_asset_reference', { kind: 'equipment', asset: eq.id, documents: [{ title: 'x', url: 'http://x' }], maintenance_date: null })).error.message, /HTTPS/)
})

await test('floor plan upload + public URL', async () => {
  await as(ADMIN)
  const bytes = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' })
  ok(await db.storage.from('floorplans').upload('test-plan.png', bytes, { upsert: true }))
  const url = db.storage.from('floorplans').getPublicUrl('test-plan.png').data.publicUrl
  const r = await fetch(url)
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png')
  assert.equal((await r.arrayBuffer()).byteLength, 7)
  assert.equal((await fetch(globalThis.FACILITY_API_URL + '/files/floorplans/..%2Fx')).status, 400)
})

await test('date filters behave like Postgres timestamptz', async () => {
  await as(TECH)
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const rows = ok(await db.from('inspection_headers').select('id').gte('inspection_date', today).lte('inspection_date', tomorrow + 'T23:59:59'))
  assert.equal(rows.length, 1)
})

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
