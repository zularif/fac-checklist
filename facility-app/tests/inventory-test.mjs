// End-to-end tests for the spare parts inventory, through the app's own client.
// Needs `wrangler dev` (or `wrangler pages dev`) running with a seeded local DB,
// same as tests/worker-test.mjs. Usage: API_URL=http://127.0.0.1:8787 node tests/inventory-test.mjs
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
async function as(pin) { ok(await db.auth.signInWithPin(pin)); return (await db.auth.getSession()).data.session }
const ADMIN = '6743', TECH = '1912'
const rid = () => crypto.randomUUID()
const move = (args) => db.rpc('stock_move', { request_id: rid(), ...args })
async function qty(partId) {
  const rows = ok(await db.from('part_stock').select('store, quantity').eq('part_id', partId))
  return Object.fromEntries(rows.map((r) => [r.store, r.quantity]))
}
const suffix = Date.now().toString(36).toUpperCase()

await test('admin database update installs the inventory tables', async () => {
  const s = await as(ADMIN)
  const res = await fetch(globalThis.FACILITY_API_URL + '/api/admin/db-update', { method: 'POST', headers: { Authorization: `Bearer ${s.access_token}` } })
  const body = await res.json()
  assert.equal(res.status, 200, JSON.stringify(body))
  assert.ok(body.status.every((m) => m.applied), JSON.stringify(body.status))
  await as(TECH)
  const t = (await db.auth.getSession()).data.session
  const denied = await fetch(globalThis.FACILITY_API_URL + '/api/admin/db-update', { method: 'POST', headers: { Authorization: `Bearer ${t.access_token}` } })
  assert.equal(denied.status, 403)
})

let part
await test('admin creates a part; technician cannot', async () => {
  await as(TECH)
  assert.ok((await db.rpc('part_save', { part: { part_code: 'X-' + suffix, part_name: 'Nope' } })).error)
  await as(ADMIN)
  const r = ok(await db.rpc('part_save', { part: { part_code: 'brg-' + suffix, part_name: 'Bearing 6204', category: 'Mechanical', unit: 'pcs' }, stock: { P1: { min_qty: 3, location: 'Rack A1' }, P2: { min_qty: '', location: 'Shelf 3' } } }))
  part = ok(await db.from('parts').select('*, stock:part_stock(store, quantity, min_qty, location)').eq('id', r.id).single())
  assert.equal(part.part_code, 'BRG-' + suffix)
  assert.equal(part.qr_code, 'PART-BRG-' + suffix)
  assert.equal(part.stock.length, 2)
  assert.equal(part.stock.find((s) => s.store === 'P1').min_qty, 3)
  assert.deepEqual(await qty(part.id), { P1: 0, P2: 0 })
  assert.match((await db.rpc('part_save', { part: { part_code: 'brg-' + suffix, part_name: 'Dup' } })).error.message, /duplicate/)
})

await test('receive, take out, transfer; cannot go below zero', async () => {
  await as(TECH)
  ok(await move({ part_id: part.id, kind: 'in', store: 'P1', quantity: 10, reason: 'PO 123' }))
  const out = ok(await move({ part_id: part.id, kind: 'out', store: 'P1', quantity: 4, reason: 'Pump repair' }))
  assert.deepEqual(out.balances, { P1: 6, P2: 0 })
  const tooMany = await move({ part_id: part.id, kind: 'out', store: 'P1', quantity: 7 })
  assert.match(tooMany.error.message, /Not enough stock in P1: only 6 pcs left/)
  assert.deepEqual(await qty(part.id), { P1: 6, P2: 0 })
  ok(await move({ part_id: part.id, kind: 'transfer', store: 'P1', to_store: 'P2', quantity: 2 }))
  assert.deepEqual(await qty(part.id), { P1: 4, P2: 2 })
  assert.ok((await move({ part_id: part.id, kind: 'transfer', store: 'P1', to_store: 'P1', quantity: 1 })).error)
  assert.ok((await move({ part_id: part.id, kind: 'out', store: 'P3', quantity: 1 })).error)
  assert.ok((await move({ part_id: part.id, kind: 'out', store: 'P1', quantity: 0 })).error)
  assert.ok((await move({ part_id: part.id, kind: 'out', store: 'P1', quantity: 1.5 })).error)
})

await test('retrying the same request never double-counts (offline queue safety)', async () => {
  const args = { request_id: rid(), part_id: part.id, kind: 'out', store: 'P2', quantity: 1 }
  const a = ok(await db.rpc('stock_move', args))
  const b = ok(await db.rpc('stock_move', args))
  assert.equal(a.ok, true); assert.equal(b.ok, true)
  assert.deepEqual(await qty(part.id), { P1: 4, P2: 1 })
})

await test('two people taking the last items at the same moment: one is refused', async () => {
  const results = await Promise.all([1, 2, 3].map(() => move({ part_id: part.id, kind: 'out', store: 'P1', quantity: 2 })))
  const okCount = results.filter((r) => !r.error).length
  assert.equal(okCount, 2)
  assert.ok(results.some((r) => r.error && /Not enough stock/.test(r.error.message)))
  assert.deepEqual(await qty(part.id), { P1: 0, P2: 1 })
})

await test('count correction: admin only, needs a reason, records the difference', async () => {
  assert.match((await move({ part_id: part.id, kind: 'adjust', store: 'P1', quantity: 9, reason: 'Count' })).error.message, /administrators/)
  await as(ADMIN)
  assert.match((await move({ part_id: part.id, kind: 'adjust', store: 'P1', quantity: 9 })).error.message, /reason/)
  ok(await move({ part_id: part.id, kind: 'adjust', store: 'P1', quantity: 9, reason: 'Monthly count' }))
  assert.deepEqual(await qty(part.id), { P1: 9, P2: 1 })
  const last = ok(await db.from('stock_movements').select('*').eq('part_id', part.id).eq('kind', 'adjust').single())
  assert.equal(last.change, 9); assert.equal(last.balance_after, 9)
})

await test('history adds up and shows who did it', async () => {
  const m = ok(await db.from('stock_movements').select('change, store, kind, balance_after, technician:technicians(name)').eq('part_id', part.id).order('created_at'))
  const sum = { P1: 0, P2: 0 }
  for (const x of m) sum[x.store] += x.change
  assert.deepEqual(sum, await qty(part.id))
  assert.ok(m.every((x) => x.technician?.name))
  assert.equal(m.filter((x) => x.kind === 'transfer').length, 2)
})

await test('stock can only change through the stock functions', async () => {
  await as(ADMIN)
  assert.ok((await db.from('part_stock').update({ quantity: 999 }).eq('part_id', part.id)).error)
  assert.ok((await db.from('stock_movements').insert({ part_id: part.id, kind: 'in', store: 'P1', change: 5, group_id: rid() })).error)
  ok(await db.from('part_stock').update({ location: 'Rack B2' }).eq('part_id', part.id).eq('store', 'P1'))
  await as(TECH)
  assert.ok((await db.from('part_stock').update({ location: 'x' }).eq('part_id', part.id)).error)
  assert.ok((await db.from('parts').update({ part_name: 'x' }).eq('id', part.id)).error)
})

await test('import: new parts get opening stock; re-import never overwrites used stock', async () => {
  await as(ADMIN)
  const codes = ['IMP1-' + suffix, 'IMP2-' + suffix]
  const r1 = ok(await db.rpc('parts_import', { rows: [
    { part_code: codes[0], part_name: 'Fuse 10A', category: 'Electrical', qty_p1: '10', min_p1: '2', loc_p1: 'Drawer 1' },
    { part_code: codes[1], part_name: 'V-belt A42', qty_p1: '1,200', qty_p2: '3' },
  ] }))
  assert.equal(r1.created, 2)
  const [a, b] = await Promise.all(codes.map((c) => db.from('parts').select('id').eq('part_code', c).single().then(ok)))
  assert.deepEqual(await qty(a.id), { P1: 10, P2: 0 })
  assert.deepEqual(await qty(b.id), { P1: 1200, P2: 3 })
  // unused part: re-import replaces the opening stock (no double opening rows)
  const r2 = ok(await db.rpc('parts_import', { rows: [{ part_code: codes[0], part_name: 'Fuse 10A glass', qty_p1: '12' }] }))
  assert.equal(r2.updated, 1)
  assert.deepEqual(await qty(a.id), { P1: 12, P2: 0 })
  assert.equal(ok(await db.from('stock_movements').select('id').eq('part_id', a.id)).length, 1)
  // after real use, re-import keeps the real stock
  ok(await move({ part_id: a.id, kind: 'out', store: 'P1', quantity: 2 }))
  const r3 = ok(await db.rpc('parts_import', { rows: [{ part_code: codes[0], part_name: 'Fuse 10A glass', qty_p1: '50' }] }))
  assert.deepEqual(r3.qty_skipped, [codes[0]])
  assert.deepEqual(await qty(a.id), { P1: 10, P2: 0 })
  assert.match((await db.rpc('parts_import', { rows: [{ part_code: 'bad code!', part_name: 'x' }] })).error.message, /Row 2/)
  assert.match((await db.rpc('parts_import', { rows: [{ part_code: 'Q1', part_name: 'a' }, { part_code: 'q1', part_name: 'b' }] })).error.message, /twice/)
})

await test('part used on equipment shows on the equipment', async () => {
  await as(TECH)
  const eq = ok(await db.from('equipment').select('id').eq('equip_id', 'EQ001').single())
  ok(await move({ part_id: part.id, kind: 'out', store: 'P1', quantity: 1, equipment_id: eq.id, reason: 'Replaced bearing' }))
  const used = ok(await db.from('stock_movements').select('change, part:parts(part_code)').eq('equipment_id', eq.id).eq('kind', 'out'))
  assert.ok(used.some((u) => u.part.part_code === part.part_code && u.change === -1))
})

await test('part photo upload (admin) and public image link', async () => {
  await as(ADMIN)
  const blob = new Blob([new Uint8Array([255, 216, 255, 0, 1, 2])], { type: 'image/jpeg' })
  ok(await db.storage.from('parts').upload(`t-${suffix}.jpg`, blob, { upsert: true, contentType: 'image/jpeg' }))
  const r = await fetch(db.storage.from('parts').getPublicUrl(`t-${suffix}.jpg`).data.publicUrl)
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg')
  await as(TECH)
  assert.ok((await db.storage.from('parts').upload(`t2-${suffix}.jpg`, blob, { upsert: true })).error)
})

await test('retired parts refuse stock movements', async () => {
  await as(ADMIN)
  ok(await db.rpc('part_save', { id: part.id, part: { status: 'Retired' } }))
  assert.match((await move({ part_id: part.id, kind: 'in', store: 'P1', quantity: 1 })).error.message, /retired/)
  ok(await db.rpc('part_save', { id: part.id, part: { status: 'Active' } }))
})

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`)
