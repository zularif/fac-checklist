// Cloudflare Worker entry: serves the built PWA (static assets) and the /api backend.
//
//   POST /api/auth/pin           { pin } | { tech_id, pin }   -> session
//   POST /api/auth/password      { email, password }           -> session
//   POST /api/auth/refresh       (Bearer)                       -> new session
//   POST /api/query              PostgREST-style query          -> { data, count }
//   POST /api/rpc/:name          server function                -> result
//   POST /api/functions/:name    admin function (manage-tech)   -> result
//   PUT  /api/storage/:bucket/*  upload a file (floor plans)
//   GET  /files/:bucket/*        read a file
//
// Bindings (wrangler.jsonc): DB (D1), FILES (KV), ASSETS (static files)
// Secrets: JWT_SECRET, PIN_PEPPER, SETUP_KEY (first-time setup at /setup)

import { apiError } from './schema.js'
import { runQuery } from './query.js'
import { authenticate, loginWithPin, loginWithPassword, signToken } from './auth.js'
import { RPC, FUNCTIONS } from './rpc.js'
import { runSetup } from './setup.js'

const BUCKETS = {
  floorplans: { write: 'admin', publicRead: true },
  photos: { write: 'any', publicRead: false },
  signatures: { write: 'any', publicRead: false },
}
const MAX_UPLOAD = 20 * 1024 * 1024

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
}
function errorResponse(e) {
  const status = e.status || 500
  if (status >= 500 && e.code !== 'CONFIG') console.error(e.cause || e)
  return json({ message: status >= 500 && e.code === 'DB' ? 'Database error. Please try again.' : e.message, code: e.code || 'ERROR', details: e.details ?? null }, status)
}
async function readJson(request) {
  try { return await request.json() } catch { throw apiError('Request body must be JSON', 'PGRST102') }
}
function storageKey(bucket, path) {
  const p = decodeURIComponent(path || '')
  if (!BUCKETS[bucket]) throw apiError('Bucket not found', 'NoSuchBucket', 404)
  if (!p || p.length > 300 || p.includes('..') || p.startsWith('/') || /[\u0000-\u001f\\]/.test(p)) throw apiError('Invalid file path', 'InvalidKey', 400)
  return `${bucket}/${p}`
}

async function handleApi(request, env, url) {
  const path = url.pathname
  const method = request.method

  if (path === '/api/health') return json({ ok: true })

  if (method === 'POST' && path === '/api/setup') return json(await runSetup(env, await readJson(request)))
  if (method === 'POST' && path === '/api/auth/pin') return json(await loginWithPin(env, request, await readJson(request)))
  if (method === 'POST' && path === '/api/auth/password') return json(await loginWithPassword(env, request, await readJson(request)))

  const auth = await authenticate(env, request)
  const ctx = { env, db: env.DB, user: auth.user, actor: auth.actor }

  if (method === 'POST' && path === '/api/auth/refresh') {
    if (!auth.user || !auth.actor) throw apiError('Not signed in', 'PGRST301', 401)
    return json(await signToken(env, auth.user))
  }

  if (!auth.user) throw apiError('Sign in required', 'PGRST301', 401)

  if (method === 'POST' && path === '/api/query') return json(await runQuery(ctx, await readJson(request)))

  let m
  if (method === 'POST' && (m = /^\/api\/rpc\/([a-z_]+)$/.exec(path))) {
    const fn = Object.prototype.hasOwnProperty.call(RPC, m[1]) ? RPC[m[1]] : null
    if (!fn) throw apiError(`Could not find the function ${m[1]}`, 'PGRST202', 404)
    return json({ data: await fn(ctx, await readJson(request)) })
  }
  if (method === 'POST' && (m = /^\/api\/functions\/([a-z_-]+)$/.exec(path))) {
    const fn = Object.prototype.hasOwnProperty.call(FUNCTIONS, m[1]) ? FUNCTIONS[m[1]] : null
    if (!fn) throw apiError(`Function ${m[1]} not found`, 'NOT_FOUND', 404)
    return json({ data: await fn(ctx, await readJson(request)) })
  }
  if ((method === 'PUT' || method === 'POST') && (m = /^\/api\/storage\/([a-z]+)\/(.+)$/.exec(path))) {
    const key = storageKey(m[1], m[2])
    const rule = BUCKETS[m[1]]
    if (!ctx.actor) throw apiError('permission denied', '42501', 403)
    if (rule.write === 'admin' && ctx.actor.role !== 'Admin') throw apiError('permission denied: administrator required', '42501', 403)
    const upsert = url.searchParams.get('upsert') === 'true'
    if (!upsert && (await env.FILES.get(key, 'arrayBuffer')) !== null) throw apiError('The resource already exists', 'Duplicate', 409)
    const body = await request.arrayBuffer()
    if (body.byteLength > MAX_UPLOAD) throw apiError('File is too large (20 MB maximum)', 'EntityTooLarge', 413)
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream'
    await env.FILES.put(key, body, { metadata: { contentType, uploadedBy: ctx.user.id, uploadedAt: new Date().toISOString() } })
    return json({ data: { path: m[2], fullPath: key } })
  }
  throw apiError('Not found', 'NOT_FOUND', 404)
}

async function handleFile(request, env, url) {
  const m = /^\/files\/([a-z]+)\/(.+)$/.exec(url.pathname)
  if (!m) return new Response('Not found', { status: 404 })
  const key = storageKey(m[1], m[2])
  if (!BUCKETS[m[1]].publicRead) {
    const auth = await authenticate(env, request)
    if (!auth.actor) return new Response('Sign in required', { status: 401 })
  }
  const { value, metadata } = await env.FILES.getWithMetadata(key, 'arrayBuffer')
  if (value === null) return new Response('Not found', { status: 404 })
  return new Response(value, {
    headers: {
      'Content-Type': metadata?.contentType || 'application/octet-stream',
      'Cache-Control': BUCKETS[m[1]].publicRead ? 'public, max-age=300' : 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env, url)
      if (url.pathname.startsWith('/files/')) return await handleFile(request, env, url)
    } catch (e) {
      return errorResponse(e.status ? e : Object.assign(apiError('Server error', 'SERVER', 500), { cause: e }))
    }
    // Everything else is the React app (SPA fallback is configured in wrangler.jsonc).
    return env.ASSETS.fetch(request)
  },
}
