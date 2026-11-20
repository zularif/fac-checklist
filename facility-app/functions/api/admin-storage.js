// functions/api/admin-storage.js
// Admin-only API: measures what is stored in the FILES KV namespace.
// Called page by page (default 40 keys) because Cloudflare Pages Functions
// on the free plan allow ~50 subrequests (KV calls) per request.
//
// Setup needed (one time):
//  1. KV binding in Pages > Settings > Bindings must be named FILES (change KV_BINDING below if different)
//  (No password: anyone who knows the page address can view it.)

const KV_BINDING = "FILES";
const PAGE_SIZE = 40;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const kv = env[KV_BINDING];
  if (!kv) return json({ error: "KV binding '" + KV_BINDING + "' not found" }, 500);

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const prefix = url.searchParams.get("prefix") || undefined;

  // 1 list call
  const page = await kv.list({ limit: PAGE_SIZE, cursor, prefix });

  // measure each value (reads one by one in small batches to limit memory)
  const items = [];
  const BATCH = 5;
  for (let i = 0; i < page.keys.length; i += BATCH) {
    const slice = page.keys.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (k) => {
        let bytes = null;
        try {
          const buf = await kv.get(k.name, "arrayBuffer");
          bytes = buf ? buf.byteLength : 0;
        } catch (e) {
          bytes = null; // could not read
        }
        return {
          name: k.name,
          bytes,
          expiration: k.expiration || null,
          nameBytes: new TextEncoder().encode(k.name).length,
        };
      })
    );
    items.push(...results);
  }

  return json({
    items,
    done: page.list_complete,
    cursor: page.list_complete ? null : page.cursor,
  });
}
