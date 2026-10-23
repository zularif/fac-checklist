// Gives an account an email + password sign-in (optional; staff normally use their PIN).
//   node scripts/set-password.mjs T002 "a long password"        -> prints SQL
//   node scripts/set-password.mjs T002 "a long password" --apply -> runs it on the remote D1
import { execFileSync } from 'node:child_process'
import { hashPassword } from '../worker/auth.js'

const [techId, password, flag] = process.argv.slice(2)
if (!techId || !password || password.length < 10) { console.error('Usage: node scripts/set-password.mjs <TECH_ID> "<password, 10+ chars>" [--apply]'); process.exit(1) }
const h = await hashPassword(password)
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const sql = `UPDATE auth_users SET password_hash = ${q(h)} WHERE id = (SELECT auth_uid FROM technicians WHERE tech_id = ${q(techId)});`
if (flag === '--apply') execFileSync('npx', ['wrangler', 'd1', 'execute', 'facility-db', '--remote', '--command', sql], { stdio: 'inherit' })
else console.log(sql)
