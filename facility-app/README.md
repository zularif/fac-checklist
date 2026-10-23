# Facility Maintenance Checklist — PWA

QR-scan equipment → dynamic checklist (numeric range + choice validation) →
supervisor e-sign → auto-flagged issues → progress tracker. Built as an
installable PWA (works offline for short signal drops), hosted on
**Cloudflare Workers** with a **Cloudflare D1** database.

**Setup and deployment:**
- No Node.js on your PC? Use **[DEPLOY-BROWSER-ONLY.md](DEPLOY-BROWSER-ONLY.md)** (Cloudflare Worker) or **[DEPLOY-PAGES.md](DEPLOY-PAGES.md)** (Cloudflare Pages) — GitHub + Cloudflare dashboard only.
- With Node.js / command line: [DEPLOY-CLOUDFLARE.md](DEPLOY-CLOUDFLARE.md).

## Project layout

```
src/          React app (Vite). src/lib/db.js is the API client.
worker/       Backend: API, sign-in, permissions, inspection functions
functions/    Cloudflare Pages entry points (call worker/; only used for Pages)
migrations/   D1 schema (wrangler d1 migrations apply)
seed/         Master data for a fresh database
scripts/      make-seed, migrate-from-supabase, set-password
tests/        worker-test (API end-to-end), offline-test (IndexedDB outbox)
wrangler.jsonc  Cloudflare config (D1 + KV bindings, static assets)
```

Quick start:

```bash
npm install
npx wrangler login
# create D1 + KV, put ids in wrangler.jsonc, set secrets (see DEPLOY-CLOUDFLARE.md)
npm run db:migrate
PIN_PEPPER=... npm run db:seed        # or migrate your Supabase data
npm run deploy
```

## What's built so far

- **Login** — PIN pad for technicians, email/password for supervisors
- **Today** — due/completed equipment list for the day
- **Scan** — camera QR scanner (falls back to manual code entry)
- **Checklist** — dynamic form generated from `checklist_templates`, live range/choice validation, flags out-of-spec/out-of-range
- **Sign-off** — supervisor reviews flagged results, signs on a canvas pad, signature saved with the inspection review; out-of-spec items auto-create `issues` rows
- **Tracker** — current-month completion grid by area, filterable by plant
- **Offline queue** — if a submission fails (no signal), it's saved to the browser and retried automatically once back online

## Not built yet (next round)
- PDF report generation (pull header + details + signature into a formatted PDF)
- Full annual tracker view with day-level drill-down modal (currently shows current month only)
- Push/email notifications via `alert_settings`
