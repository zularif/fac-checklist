# Deploy on Cloudflare Pages (browser only, no Node.js)

The same project can run on **Cloudflare Pages** instead of a Worker. Pages serves the app from `dist/` and runs the backend from the `functions/` folder (which simply calls the code in `worker/`). Use either Pages *or* the Worker setup — not both.

You need a GitHub account and a Cloudflare account.

---

## 1. Put the project on GitHub

1. **github.com** → **+** → **New repository** → name `facility-checklist`, **Private** → **Create repository**.
2. Click **uploading an existing file**. Drag in everything **inside** the `facility-app` folder (`functions`, `migrations`, `public`, `scripts`, `seed`, `src`, `tests`, `worker`, `package.json`, `package-lock.json`, `index.html`, `vite.config.js`, `wrangler.jsonc`, …). `package.json` must be at the top of the repository.
   If GitHub complains about too many files, upload in two rounds.
3. **Commit changes**.

You do **not** need to edit `wrangler.jsonc` for Pages — Pages ignores it; bindings are set in the dashboard (step 4).

## 2. Create the database and file store

1. **dash.cloudflare.com** → **Storage & databases** → **D1 SQL database** → **Create** → name `facility-db` → **Create**.
2. **Storage & databases** → **Workers KV** → **Create** → name `FILES` → **Create**.

## 3. Create the Pages project

1. **Workers & Pages** → **Create** → **Pages** tab → **Import an existing Git repository** (Connect to Git).
2. Connect GitHub and choose `facility-checklist` → **Begin setup**.
3. Settings:
   - **Project name:** `facility-checklist`
   - **Production branch:** `main`
   - **Framework preset:** `None` (or `Vite`)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** leave empty
4. **Save and Deploy**. Wait for the build to finish (2–4 minutes). Your address is shown, e.g. `https://facility-checklist.pages.dev`.
   The site opens, but sign-in won't work until steps 4–6 are done.

## 4. Connect the database and file store (bindings)

**Workers & Pages** → `facility-checklist` → **Settings** → **Bindings** → **Add**:

| Type | Variable name | Value |
|---|---|---|
| **D1 database** | `DB` | `facility-db` |
| **KV namespace** | `FILES` | `FILES` |

Names must be exactly `DB` and `FILES` (capitals). Add them for **Production** (and Preview if you use preview branches).

## 5. Add the secrets

**Settings** → **Variables and Secrets** → **Add** → choose **Secret** (encrypted) for each:

| Name | Value |
|---|---|
| `JWT_SECRET` | long random text (32+ characters) |
| `PIN_PEPPER` | long random text (32+ characters) — **save a copy safely**; if lost, all PINs must be reset |
| `SETUP_KEY` | a password you'll type once in step 6 |

## 6. Redeploy so the settings take effect

Bindings and secrets only apply to new deployments:
**Deployments** → on the latest deployment click **⋯** → **Retry deployment**. Wait until it is **Success**.

## 7. Fill the database from the browser

1. Open `https://facility-checklist.pages.dev/setup`
2. Enter the `SETUP_KEY` → **Start setup** → wait for all ✓ (tables, plants, areas, equipment, 3,582 checklist items, gensets, PIN logins). If one step fails, press Start again — finished steps are skipped.
3. When it says **Setup complete** the page locks itself. You may now delete the `SETUP_KEY` secret.

## 8. Sign in

Sign in with an Admin PIN from `seed/tech_list.json` (e.g. T002). Ask all staff to change their PIN (☰ → **Change my PIN**). On phones: open the address → **Add to Home Screen**.

Own domain (optional): project → **Custom domains** → **Set up a custom domain**.

---

## Changing the app / adding pages

Exactly as in `DEPLOY-BROWSER-ONLY.md` Part B: edit on GitHub (press `.` for the browser editor), commit, and Pages rebuilds automatically. For a new table, run the `CREATE TABLE` in **D1 → facility-db → Console** first, then commit the page and the `worker/schema.js` change.

## If something doesn't work

| Symptom | Fix |
|---|---|
| `/api/health` shows the app page instead of `{"ok":true}` | The `functions` folder wasn't uploaded to the top level of the repository. |
| Error "Server is not configured: set the JWT_SECRET…" | Secret missing or misspelt → add it, then **Retry deployment**. |
| Error mentioning `DB` / "Cannot read properties of undefined (reading 'prepare')" | D1 binding missing or not named `DB` → add it, then **Retry deployment**. |
| Floor plan upload fails | KV binding `FILES` missing. |
| Build fails | Open the deployment → **View build log** → read the red lines (usually a typo in a file you edited). The previous version stays live. |

## Pages or Worker — which is better?

Both run the same code with the same free-plan limits. Pages is simpler to set up in the dashboard (no API token, bindings are point-and-click). Cloudflare now recommends Workers for new projects and adds new features there first, so `DEPLOY-BROWSER-ONLY.md` (Worker) remains the default. You can switch later: create the other project and bind it to the **same** `facility-db` database — no data is lost.
