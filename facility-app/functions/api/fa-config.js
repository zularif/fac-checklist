// Cloudflare Pages Function: shared setup for the fire alarm simulator (fire-alarm-sim.html)
// GET  /api/fa-config  -> { config, rev, assets }
// POST /api/fa-config  <- { rev, config, assets:{id:dataUrl}, keep:[assetIds] }
// Uses whichever D1 database is bound to this Pages project; creates its own table "fa_store".

const TABLE = 'CREATE TABLE IF NOT EXISTS fa_store (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT)';
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

function getDb(env) {
  return Object.values(env || {}).find(v => v && typeof v.prepare === 'function' && typeof v.batch === 'function');
}

export async function onRequestGet({ env }) {
  const db = getDb(env);
  if (!db) return json({ error: 'No D1 database is bound to this Pages project.' }, 500);
  await db.prepare(TABLE).run();
  const { results } = await db.prepare('SELECT k, v FROM fa_store').all();
  let config = null, rev = 0; const assets = {};
  for (const r of results) {
    if (r.k === 'config') config = JSON.parse(r.v);
    else if (r.k === 'rev') rev = Number(r.v) || 0;
    else if (r.k.startsWith('asset:')) assets[r.k.slice(6)] = r.v;
  }
  return json({ config, rev, assets });
}

export async function onRequestPost({ env, request }) {
  const db = getDb(env);
  if (!db) return json({ error: 'No D1 database is bound to this Pages project.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { config, assets = {}, keep = [] } = body || {};
  if (!config || !Array.isArray(config.inputs) || !Array.isArray(config.outputs) || !Array.isArray(config.rules))
    return json({ error: 'Invalid setup' }, 400);

  await db.prepare(TABLE).run();
  const cur = await db.prepare("SELECT v FROM fa_store WHERE k = 'rev'").first();
  const curRev = cur ? Number(cur.v) || 0 : 0;
  if ((Number(body.rev) || 0) !== curRev) return json({ error: 'conflict', rev: curRev }, 409);

  const now = new Date().toISOString();
  const put = (k, v) => db.prepare('INSERT OR REPLACE INTO fa_store (k, v, updated_at) VALUES (?1, ?2, ?3)').bind(k, v, now);
  const stmts = [];
  for (const [id, data] of Object.entries(assets)) {
    if (typeof data !== 'string' || !/^up:[a-z0-9:]+$/i.test(id) || !data.startsWith('data:')) continue;
    if (data.length > 1500000) return json({ error: 'File too large: ' + id }, 413);
    stmts.push(put('asset:' + id, data));
  }
  stmts.push(put('config', JSON.stringify(config)));
  stmts.push(put('rev', String(curRev + 1)));

  // remove uploaded files that the new setup no longer uses
  const keepSet = new Set(keep.map(String));
  const { results } = await db.prepare("SELECT k FROM fa_store WHERE k LIKE 'asset:%'").all();
  for (const r of results) {
    const id = r.k.slice(6);
    if (!keepSet.has(id) && !(id in assets)) stmts.push(db.prepare('DELETE FROM fa_store WHERE k = ?1').bind(r.k));
  }
  await db.batch(stmts);
  return json({ ok: true, rev: curRev + 1 });
}
