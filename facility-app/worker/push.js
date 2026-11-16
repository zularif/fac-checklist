// Phone push notifications (Web Push) for staff.
//   push_public_key   (staff)  the key the phone needs to subscribe
//   push_subscribe    (staff)  save this phone/browser
//   push_unsubscribe  (staff)  remove it
//   push_test         (Admin)  send a test notification to everyone subscribed
// pushToStaff(env) is called when a vendor submits a permit application.
// The push carries the message text (title + body), encrypted for each phone (RFC 8291) with the keys
// the phone gave when it subscribed. A phone saved without keys still gets a short fixed message.
// The signing key pair is created automatically and kept in the push_config table.

import { apiError } from './schema.js'

const enc = new TextEncoder()
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
// Only the real browser push services are accepted (stops anyone pointing the server at another site).
const PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'push.apple.com', 'windows.com']
const okEndpoint = (e) => {
  try { const u = new URL(e); return u.protocol === 'https:' && e.length <= 1000 && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) } catch { return false }
}

const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0))
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length } return out }

// Encrypts the message for one phone (Web Push, aes128gcm).
async function encryptFor(sub, text) {
  const ua = fromB64u(sub.p256dh), auth = fromB64u(sub.auth)
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256))
  const hkdf = async (salt, ikm, info, len) => {
    const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8))
  }
  const ikm = await hkdf(auth, secret, concat(enc.encode('WebPush: info\0'), ua, asPub), 32)
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(enc.encode(text), new Uint8Array([2]))))
  return concat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct)   // record size 4096
}

async function getKeys(env) {
  const get = () => env.DB.prepare('SELECT public_key, private_jwk FROM push_config WHERE id = 1').first()
  let row = await get()
  if (!row) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey))
    const jwk = JSON.stringify(await crypto.subtle.exportKey('jwk', kp.privateKey))
    await env.DB.prepare('INSERT OR IGNORE INTO push_config (id, public_key, private_jwk) VALUES (1, ?, ?)').bind(pub, jwk).run()
    row = await get()
  }
  return row
}

async function authHeader(env, keys, endpoint) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(keys.private_jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || `mailto:${env.MAIL_FROM || 'facility@wiwynn.com'}`,
  })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`))
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.public_key}`
}

// Sends a push to every subscribed phone. `message` is { title, body } (optional). Never throws. Returns how many were accepted.
export async function pushToStaff(env, message) {
  if (!env.DB) return 0
  let sent = 0
  try {
    const keys = await getKeys(env)
    let results
    try { results = (await env.DB.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions').all()).results }
    catch { results = (await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all()).results }   // database update 0005 not applied yet
    const text = JSON.stringify({ title: String(message?.title || 'New vendor work permit').slice(0, 100), body: String(message?.body || 'A vendor submitted a permit application. Tap to open.').slice(0, 600), url: '/permits' })
    await Promise.allSettled((results || []).map(async (s) => {
      try {
        const headers = { Authorization: await authHeader(env, keys, s.endpoint), TTL: '86400', Urgency: 'high' }
        let body = ''
        if (s.p256dh && s.auth) {
          try { body = await encryptFor(s, text); headers['Content-Encoding'] = 'aes128gcm'; headers['Content-Type'] = 'application/octet-stream' } catch (e) { console.error('Push encrypt error', String(e)) }
        }
        const res = await fetch(s.endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(6000) })
        if (res.ok) sent++
        else if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(s.endpoint).run()
        else console.error('Push failed', res.status, (await res.text()).slice(0, 200))
      } catch (e) { console.error('Push error', String(e)) }
    }))
  } catch (e) { console.error('Push error', String(e)) }
  return sent
}

async function push_public_key(ctx) {
  if (!ctx.actor) throw apiError('permission denied', '42501', 403)
  return { key: (await getKeys(ctx.env)).public_key }
}

async function push_subscribe(ctx, body) {
  if (!ctx.actor) throw apiError('permission denied', '42501', 403)
  const endpoint = String(body.endpoint || '')
  if (!okEndpoint(endpoint)) throw apiError('This browser is not supported for notifications.', 'P0001', 400)
  const p256dh = String(body.p256dh || '').slice(0, 200) || null, auth = String(body.auth || '').slice(0, 100) || null
  try {
    await ctx.db.prepare('INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth').bind(endpoint, ctx.user.id, p256dh, auth).run()
  } catch {   // database update 0005 not applied yet: save without the keys
    await ctx.db.prepare('INSERT INTO push_subscriptions (endpoint, user_id) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id').bind(endpoint, ctx.user.id).run()
  }
  return { ok: true }
}

async function push_unsubscribe(ctx, body) {
  if (!ctx.actor) throw apiError('permission denied', '42501', 403)
  await ctx.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(String(body.endpoint || '')).run()
  return { ok: true }
}

async function push_test(ctx) {
  if (ctx.actor?.role !== 'Admin') throw apiError('permission denied: administrator required', '42501', 403)
  const total = (await ctx.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first())?.n || 0
  const sent = await pushToStaff(ctx.env, { title: 'Test notification', body: `Hi ${ctx.actor.name || 'there'}, phone notifications are working.` })
  return { total, sent }
}

export const PUSH_RPC = { push_public_key, push_subscribe, push_unsubscribe, push_test }
