// Sign-in, sessions and password/PIN hashing (replaces Supabase Auth).
//
// Sessions are HS256 JWTs signed with the JWT_SECRET Worker secret. Tokens
// last SESSION_DAYS and the app refreshes them silently while in use, so a
// technician stays signed in on their phone the way they did with Supabase.
// Every API call re-checks that the technician is still Active, so
// deactivating someone in Manage staff locks them out immediately.

import { apiError } from './schema.js'

const SESSION_DAYS = 30
const enc = new TextEncoder()

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlJson = (obj) => b64url(enc.encode(JSON.stringify(obj)))
function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

function requireSecret(env, name) {
  const v = env[name]
  if (!v || v.length < 16) throw apiError(`Server is not configured: set the ${name} secret (wrangler secret put ${name})`, 'CONFIG', 500)
  return v
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signToken(env, user) {
  const now = Math.floor(Date.now() / 1000)
  const payload = { sub: user.id, email: user.email, iat: now, exp: now + SESSION_DAYS * 86400 }
  const data = `${b64urlJson({ alg: 'HS256', typ: 'JWT' })}.${b64urlJson(payload)}`
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(requireSecret(env, 'JWT_SECRET')), enc.encode(data))
  return { access_token: `${data}.${b64url(sig)}`, expires_at: payload.exp, user: { id: user.id, email: user.email } }
}

export async function verifyToken(env, token) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(requireSecret(env, 'JWT_SECRET')), fromB64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`))
  if (!ok) return null
  let payload
  try { payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) } catch { return null }
  if (!payload.sub || !payload.exp || payload.exp < Date.now() / 1000) return null
  return payload
}

// Deterministic, peppered PIN hash so the server can find "whose PIN is this"
// with one indexed lookup. The pepper lives only in the Worker secret, so a
// copy of the database alone does not reveal PINs.
export async function hashPin(env, pin) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(requireSecret(env, 'PIN_PEPPER')), enc.encode(`pin:${pin}`))
  return b64url(sig)
}

// Passwords (optional email sign-in): PBKDF2-SHA256, 100k iterations (Workers maximum).
const PBKDF2_ITER = 100000
export async function hashPassword(password, saltB64) {
  const salt = saltB64 ? fromB64url(saltB64) : crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256)
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(bits)}`
}
async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || '').split('$')
  if (scheme !== 'pbkdf2' || Number(iter) !== PBKDF2_ITER) return false
  const again = await hashPassword(password, salt)
  return timingSafeEqual(again.split('$')[3], hash)
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// ---------- throttling: 10 failed sign-ins per 15 minutes per IP ----------
const WINDOW = 15 * 60, MAX_FAILS = 10
function clientKey(request) { return 'ip:' + (request.headers.get('CF-Connecting-IP') || 'local') }
async function checkThrottle(db, key) {
  const row = await db.prepare('SELECT failures, window_start FROM login_attempts WHERE key = ?').bind(key).first()
  const now = Math.floor(Date.now() / 1000)
  if (row && now - row.window_start < WINDOW && row.failures >= MAX_FAILS) {
    throw apiError('Too many incorrect attempts. Wait 15 minutes and try again.', 'THROTTLED', 429)
  }
}
async function recordFailure(db, key) {
  const now = Math.floor(Date.now() / 1000)
  await db.prepare(`INSERT INTO login_attempts (key, failures, window_start) VALUES (?, 1, ?)
    ON CONFLICT (key) DO UPDATE SET failures = CASE WHEN ? - window_start >= ${WINDOW} THEN 1 ELSE failures + 1 END,
    window_start = CASE WHEN ? - window_start >= ${WINDOW} THEN ? ELSE window_start END`).bind(key, now, now, now, now).run()
}
async function clearFailures(db, key) { await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run() }

const invalid = () => apiError('Invalid login credentials', 'invalid_credentials', 400)

async function issueFor(env, db, tech) {
  if (!tech || tech.status !== 'Active' || !tech.auth_uid) throw invalid()
  const user = await db.prepare('SELECT id, email FROM auth_users WHERE id = ?').bind(tech.auth_uid).first()
  if (!user) throw invalid()
  await db.prepare("UPDATE auth_users SET last_sign_in_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(user.id).run()
  return signToken(env, user)
}

// POST /api/auth/pin  { pin }  or  { tech_id, pin }
export async function loginWithPin(env, request, body) {
  const db = env.DB, key = clientKey(request)
  await checkThrottle(db, key)
  const pin = String(body.pin || '')
  if (!/^\d{4}$/.test(pin)) { await recordFailure(db, key); throw apiError('PIN not recognized', 'invalid_credentials', 400) }
  const h = await hashPin(env, pin)
  const tech = body.tech_id
    ? await db.prepare("SELECT * FROM technicians WHERE lower(tech_id) = lower(?) AND pin_hash = ? AND status = 'Active'").bind(String(body.tech_id), h).first()
    : await db.prepare("SELECT * FROM technicians WHERE pin_hash = ? AND status = 'Active' LIMIT 1").bind(h).first()
  if (!tech) { await recordFailure(db, key); throw apiError('PIN not recognized', 'invalid_credentials', 400) }
  await clearFailures(db, key)
  return issueFor(env, db, tech)
}

// POST /api/auth/password  { email, password }
export async function loginWithPassword(env, request, body) {
  const db = env.DB, key = clientKey(request)
  await checkThrottle(db, key)
  const user = await db.prepare('SELECT * FROM auth_users WHERE email = lower(?)').bind(String(body.email || '').trim()).first()
  if (!user || !user.password_hash || !(await verifyPassword(String(body.password || ''), user.password_hash))) {
    await recordFailure(db, key); throw invalid()
  }
  await clearFailures(db, key)
  const tech = await db.prepare('SELECT * FROM technicians WHERE auth_uid = ?').bind(user.id).first()
  return issueFor(env, db, tech)
}

// Resolve the caller from the Authorization header.
export async function authenticate(env, request) {
  const h = request.headers.get('Authorization') || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) return { user: null, actor: null }
  const payload = await verifyToken(env, token)
  if (!payload) throw apiError('JWT expired or invalid. Please sign in again.', 'PGRST301', 401)
  const actor = await env.DB.prepare("SELECT id, tech_id, name, role, status, auth_uid FROM technicians WHERE auth_uid = ? AND status = 'Active'").bind(payload.sub).first()
  return { user: { id: payload.sub, email: payload.email }, actor: actor || null, token: payload }
}
