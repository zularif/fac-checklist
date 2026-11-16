// Phone push notifications (Web Push) for staff.
//   push_public_key   (staff)  the key the phone needs to subscribe
//   push_subscribe    (staff)  save this phone/browser
//   push_unsubscribe  (staff)  remove it
//   push_test         (Admin)  send a test notification to everyone subscribed
// pushToStaff(env) is called when a vendor submits a permit application.
// The push carries no text: the service worker (public/push-sw.js) shows a fixed message.
// The signing key pair is created automatically and kept in the push_config table.

import { apiError } from './schema.js'

const enc = new TextEncoder()
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
// Only the real browser push services are accepted (stops anyone pointing the server at another site).
const PUSH_HOSTS = ['googleapis.com', 'mozilla.com', 'push.apple.com', 'windows.com']
const okEndpoint = (e) => {
  try { const u = new URL(e); return u.protocol === 'https:' && e.length <= 1000 && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h)) } catch { return false }
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

// Sends a push to every subscribed phone. Never throws. Returns how many were accepted.
export async function pushToStaff(env) {
  if (!env.DB) return 0
  let sent = 0
  try {
    const keys = await getKeys(env)
    const { results } = await env.DB.prepare('SELECT endpoint FROM push_subscriptions').all()
    await Promise.allSettled((results || []).map(async ({ endpoint }) => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: await authHeader(env, keys, endpoint), TTL: '86400', Urgency: 'high' },
          body: '',
          signal: AbortSignal.timeout(6000),
        })
        if (res.ok) sent++
        else if (res.status === 404 || res.status === 410) await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
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
  await ctx.db.prepare('INSERT INTO push_subscriptions (endpoint, user_id) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id').bind(endpoint, ctx.user.id).run()
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
  const sent = await pushToStaff(ctx.env)
  return { total, sent }
}

export const PUSH_RPC = { push_public_key, push_subscribe, push_unsubscribe, push_test }
