// Builds seed/seed.sql for a FRESH database: master data (plants, areas,
// equipment, technicians, checklists, gensets) plus a PIN login for every
// technician listed in seed/tech_list.json.
//
//   PIN_PEPPER=... node scripts/make-seed.mjs
//
// PIN_PEPPER must be the same value you set with `wrangler secret put PIN_PEPPER`,
// otherwise nobody will be able to sign in.
// Not needed when moving an existing Supabase database: use migrate-from-supabase.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { hashPin } from '../worker/auth.js'

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const pepper = process.env.PIN_PEPPER
if (!pepper || pepper.length < 16) { console.error('Set PIN_PEPPER (16+ characters, same as the Worker secret).'); process.exit(1) }

const parts = []
for (const f of fs.readdirSync(path.join(root, 'seed')).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort()) {
  parts.push(`-- ===== ${f} =====\n` + fs.readFileSync(path.join(root, 'seed', f), 'utf8'))
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const techs = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'tech_list.json'), 'utf8'))
const logins = ['-- ===== technician logins (PINs hashed with PIN_PEPPER) =====']
for (const { techId, pin } of techs) {
  const uid = crypto.randomUUID()
  const h = await hashPin({ PIN_PEPPER: pepper }, pin)
  logins.push(`INSERT OR IGNORE INTO auth_users (id, email) VALUES (${q(uid)}, ${q(techId.toLowerCase() + '@internal.app')});`)
  logins.push(`UPDATE technicians SET auth_uid = (SELECT id FROM auth_users WHERE email = ${q(techId.toLowerCase() + '@internal.app')}), pin_hash = ${q(h)} WHERE tech_id = ${q(techId)};`)
}
parts.push(logins.join('\n'))
fs.writeFileSync(path.join(root, 'seed', 'seed.sql'), parts.join('\n\n') + '\n')
console.log(`Wrote seed/seed.sql (${techs.length} technician logins). Next: npx wrangler d1 execute facility-db --remote --file=seed/seed.sql`)
