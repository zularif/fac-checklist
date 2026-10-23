// Cloudflare Pages entry for /api/* — runs the same backend as the Worker build.
import app from '../../worker/index.js'
export const onRequest = (context) => app.fetch(context.request, context.env)
