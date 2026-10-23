# Deploying on Cloudflare (Workers + D1)

The app now runs entirely on Cloudflare. Supabase and Netlify are no longer used.

> **Can't install Node.js?** Follow [DEPLOY-BROWSER-ONLY.md](DEPLOY-BROWSER-ONLY.md) instead — everything is done on github.com and dash.cloudflare.com, including first-time database setup at `/setup`.

| Before (Supabase + Netlify) | Now (Cloudflare) |
|---|---|
| Netlify static hosting | **Worker static assets** (same Worker serves the app) |
| Supabase Postgres | **D1** database `facility-db` (`migrations/0001_init.sql`) |
| PostgREST + row-level security | **Worker API** `/api/query` (`worker/query.js`, rules in `worker/schema.js`) |
| SQL functions (`facility_save_inspection`, …) | **Worker functions** (`worker/rpc.js`), same names and behaviour |
| Supabase Auth (PIN padded into a password) | **Worker sign-in** with hashed PINs + signed session tokens (`worker/auth.js`) |
| Edge Function `manage-tech` | `/api/functions/manage-tech` (`worker/rpc.js`) |
| Storage bucket `floorplans` | **KV** namespace `FILES`, served at `/files/floorplans/...` |

Everything fits in Cloudflare's free plan for a team this size.

---

## 1. One-time setup (on your computer)

You need Node.js 20+ and a Cloudflare account.

```bash
cd facility-app
npm install
npx wrangler login                     # opens the browser to authorise
```

Create the database and the file store:

```bash
npx wrangler d1 create facility-db
npx wrangler kv namespace create FILES
```

Each command prints an id. Paste them into `wrangler.jsonc`:

- `database_id` → the D1 id
- `kv_namespaces[0].id` → the KV id

Create the two secrets. Use long random values (for example from a password manager) and **keep a copy of PIN_PEPPER somewhere safe** — if it is lost, every PIN has to be reset.

```bash
npx wrangler secret put JWT_SECRET     # signs sign-in sessions
npx wrangler secret put PIN_PEPPER     # used to hash PINs
```

> If `wrangler secret put` says the Worker doesn't exist yet, run `npm run deploy` once first, then add the secrets.

Create the tables:

```bash
npm run db:migrate
```

## 2. Load data — choose ONE

### A. Move your existing Supabase data (keeps all history)

Run on your computer. The service-role key is in Supabase → Project Settings → API. It is only used locally by this script.

```bash
SUPABASE_URL=https://YOUR-PROJECT.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
PIN_PEPPER=the-same-value-you-set-above \
node scripts/migrate-from-supabase.mjs

npx wrangler d1 execute facility-db --remote --file=migration/data.sql
bash migration/upload-files.sh          # floor plan images
```

- All IDs are kept, so inspections, revisions, reviews, tasks and staff stay linked.
- Technicians keep their **same 4-digit PIN**.
- Supabase email passwords cannot be copied. Staff sign in with their PIN; if someone needs email sign-in, see step 5.
- Old files in the `photos` / `signatures` buckets are not copied (the app no longer displays them; new photos and signatures are stored inside the inspection records).
- Delete the `migration` folder afterwards — it contains your data.

Do this while nobody is submitting inspections, then point staff to the new address. Tell technicians to upload anything waiting in **Sync Centre** on the old app first: offline drafts saved in the old app's browser storage stay with the old web address.

### B. Fresh start (master data only)

```bash
PIN_PEPPER=the-same-value-you-set-above npm run db:seed
```

This loads plants, areas, 319 equipment, 3 gensets, 3,582 checklist parameters and the 34 technicians with the PINs in `seed/tech_list.json`. Those PINs are written in that file, so ask everyone to change their PIN (☰ menu → Change PIN) after first sign-in.

## 3. Deploy

```bash
npm run deploy
```

Wrangler prints the address, e.g. `https://facility-checklist.<your-subdomain>.workers.dev`. Open it on a phone and use "Add to Home Screen" as before.

To use your own domain: Cloudflare dashboard → Workers & Pages → facility-checklist → Settings → Domains & Routes → Add custom domain.

Deploy again after any change with `npm run deploy`. Database changes go in a new file `migrations/0002_....sql` and are applied with `npm run db:migrate`.

## 4. Running locally

```bash
cp .dev.vars.example .dev.vars          # local-only secrets
npm run db:migrate:local
PIN_PEPPER=dev-only-pin-pepper-change-me-0123 node scripts/make-seed.mjs
npx wrangler d1 execute facility-db --local --file=seed/seed.sql
npm run build && npx wrangler dev       # http://localhost:8787
```

For UI work with hot reload, run `npm run dev:api` in one terminal and `npm run dev` in another (Vite proxies `/api` to the Worker).

Tests (with `wrangler dev` running on port 8787 against a freshly seeded local database):

```bash
npm run test:worker                     # API, permissions, inspections, corrections, staff, files
npm ci --prefix tests && npm run test:offline
```

## 5. Admin tasks

- **Add / edit staff, reset PINs, deactivate:** in the app, Admin → Manage staff (unchanged). Deactivating someone signs them out on every device at their next action.
- **Optional email + password sign-in** for an account:
  `node scripts/set-password.mjs T002 "a long password" --apply`
- **Run SQL directly:** `npx wrangler d1 execute facility-db --remote --command "select count(*) from inspection_headers"`, or use the D1 console in the Cloudflare dashboard.
- **Backups:** D1 Time Travel can restore the database to any minute in the last 30 days (`npx wrangler d1 time-travel restore facility-db --timestamp=...`). For an offline copy: `npx wrangler d1 export facility-db --remote --output=backup.sql`.
- **Logs:** Cloudflare dashboard → Workers & Pages → facility-checklist → Logs.

## Security notes

- PINs are stored as HMAC-SHA256 hashes keyed with `PIN_PEPPER`; the API never returns them.
- The PIN pad locks an IP address out for 15 minutes after 10 wrong PINs.
- Sessions last 30 days and renew automatically while the app is used; every request re-checks that the account is still Active.
- Permissions that used to be database policies are enforced by the Worker (`worker/schema.js`): master data, extinguishers and task stages are Admin-only to change; inspections, reviews and revision history can only be written through the inspection functions; everyone signed in can read.
- Never commit `.dev.vars`, `seed/seed.sql` or the `migration` folder (they are in `.gitignore`).

## Limits to know

- D1 rows max out at 2 MB. Each photo is limited to ~450 KB (as before); if one inspection's revision snapshot would exceed ~1.5 MB, its history copy keeps the readings but drops the photos (the live record keeps them).
- The free Workers plan allows 100,000 requests/day and 10 ms CPU per request; normal use is well inside that. Email/password sign-in (PBKDF2) is the heaviest call — if it ever fails with "exceeded CPU", upgrade to Workers Paid ($5/month) or use PIN sign-in.
