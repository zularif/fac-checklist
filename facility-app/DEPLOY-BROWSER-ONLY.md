# Deploy and update using only a web browser (no Node.js)

Everything here is done on **github.com** and **dash.cloudflare.com**. Cloudflare builds and deploys the app for you every time you save a change on GitHub.

You need: a GitHub account and a Cloudflare account (both free).

---

## Part A — First deployment (once, about 30 minutes)

### A1. Put the project on GitHub

1. Sign in to **github.com** → click **+** (top right) → **New repository**.
2. Name: `facility-checklist` · choose **Private** · click **Create repository**.
3. On the new empty repository page, click the link **uploading an existing file**.
4. On your PC, open the unzipped `facility-app` folder. Select **everything inside it** (folders `migrations`, `public`, `scripts`, `seed`, `src`, `tests`, `worker` and all the files such as `package.json`, `package-lock.json`, `wrangler.jsonc`, `index.html`, `vite.config.js`) and drag them into the browser.
   - Upload the *contents* of `facility-app`, not the `facility-app` folder itself — `package.json` must be at the top level of the repository.
   - If GitHub says there are too many files, upload in two rounds: first everything except `public` and `seed`, commit, then upload `public` and `seed`.
5. Click **Commit changes**.

### A2. Create the database and file store in Cloudflare

1. Sign in to **dash.cloudflare.com**.
2. Left menu → **Storage & databases** → **D1 SQL database** → **Create database**.
   Name: `facility-db` → **Create**. On the database page, copy the **Database ID** (looks like `a1b2c3d4-....`).
3. Left menu → **Storage & databases** → **Workers KV** → **Create instance** (or **Create namespace**).
   Name: `FILES` → **Create**. Copy its **ID**.

### A3. Put the two IDs into the project

1. On GitHub, open your repository → click `wrangler.jsonc` → click the **pencil icon** (Edit).
2. Replace `REPLACE_WITH_YOUR_D1_DATABASE_ID` with the Database ID.
3. Replace `REPLACE_WITH_YOUR_KV_NAMESPACE_ID` with the KV ID.
   Keep the quotes, e.g. `"database_id": "a1b2c3d4-...."`.
4. Click **Commit changes…** → **Commit changes**.

### A4. Connect GitHub to Cloudflare (automatic builds)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → on the **Workers** tab choose **Import a repository**.
2. Click **Connect GitHub**, sign in, and allow access to the `facility-checklist` repository.
3. Select the repository. On the settings screen:
   - **Project name:** `facility-checklist` (must match `"name"` in `wrangler.jsonc`)
   - **Build command:** `npm run build`
   - **Deploy command:** `npx wrangler deploy`
   - **Root directory:** leave empty (or `/`)
4. Click **Deploy**. Wait for the build log to finish (2–4 minutes). It shows the address, e.g. `https://facility-checklist.<your-name>.workers.dev`.
   The app will open but nobody can sign in yet — that's next.

> If the build log shows a permission error about **D1**, go to the Worker → **Settings** → **Build** → **API token**, edit the token and add the permission **Account · D1 · Edit**, then click **Retry build**.

### A5. Add the three secrets

1. **Workers & Pages** → **facility-checklist** → **Settings** → **Variables and Secrets** → **Add**.
2. Add each of these with **Type: Secret** and a long random value (use a password manager / generator, at least 32 characters):

   | Name | What it is for |
   |---|---|
   | `JWT_SECRET` | Signs sign-in sessions |
   | `PIN_PEPPER` | Protects stored PINs. **Save a copy somewhere safe** — if it is lost, every PIN must be reset. |
   | `SETUP_KEY` | One-time password for the setup page in A6 |

3. Click **Deploy** / **Save** after adding them.

### A6. Fill the database (from the browser)

1. Open `https://facility-checklist.<your-name>.workers.dev/setup`
2. Enter your `SETUP_KEY` → **Start setup**.
3. Wait until all steps show ✓ (tables, plants, areas, 319 equipment, 3,582 checklist items, gensets, PIN logins). If a step fails, press **Start setup** again — finished steps are skipped.
4. When it says **Setup complete**, the page locks itself for good. You can now delete the `SETUP_KEY` secret (Settings → Variables and Secrets).

### A7. Sign in and finish

1. Open the app address and sign in with an Admin PIN (from `seed/tech_list.json`, e.g. T002).
2. The starting PINs are written in that file, so ask every staff member to change theirs: ☰ menu → **Change my PIN**. Admins can also reset PINs in **Admin → Manage staff**.
3. On phones: open the address → browser menu → **Add to Home Screen**.

Optional: own domain — Worker → **Settings** → **Domains & Routes** → **Add** → **Custom domain**.

---

## Part B — Changing the app or adding a page (no Node.js)

Every time you **commit** on GitHub, Cloudflare rebuilds and deploys automatically (about 3 minutes). Watch progress in Worker → **Deployments**; a failed build keeps the previous version live, so a mistake never takes the app down.

**Editing tip:** in your repository press the **`.`** (full stop) key. This opens **github.dev**, a VS Code editor in the browser where you can create, edit and commit several files at once. Use **Source Control** (left bar) → type a message → **Commit & Push**.

### B1. Page that only shows existing data

1. In `src/pages`, create the new file (e.g. `MyPage.jsx`).
2. In `src/App.jsx` add the `lazy(...)` import line and the `<Route ...>` line.
3. In `src/components/Header.jsx` add the menu line.
4. Commit. Done.

### B2. Page that needs a new table — example: spare parts

1. **Create the table** — Cloudflare dashboard → **Storage & databases** → **D1 SQL database** → `facility-db` → **Console**. Paste and click **Execute**:
   ```sql
   CREATE TABLE spare_parts (
     id TEXT PRIMARY KEY,
     part_code TEXT UNIQUE NOT NULL,
     part_name TEXT NOT NULL,
     store TEXT NOT NULL DEFAULT 'P1',
     quantity INTEGER NOT NULL DEFAULT 0,
     min_qty INTEGER NOT NULL DEFAULT 0,
     location TEXT,
     updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   );
   INSERT INTO d1_migrations (name) VALUES ('0002_spare_parts.sql');
   ```
   The last line records the change so the database history stays in order.
2. **Keep a copy in the project** — on GitHub, create `migrations/0002_spare_parts.sql` containing the same `CREATE TABLE` statement (without the last `INSERT` line). Next change uses `0003_...`.
3. **Allow the app to use the table** — edit `worker/schema.js`, and just above the line `facility_receipts: {` add:
   ```js
     spare_parts: {
       columns: { id: U, part_code: T, part_name: T, store: T, quantity: I, min_qty: I, location: T, updated_at: TS },
       touch: 'updated_at',
       read: 'active', write: 'any',
     },
   ```
   (`write: 'admin'` if only Admins may change it.)
4. **Add the page, route and menu item** as in B1.
5. Commit, wait for the build, refresh the app.

Order matters: create the table (step 1) **before** committing the code that uses it.

### When a build fails

Worker → **Deployments** → click the failed build → read the red lines in the log. The usual causes are a typo in a `.jsx` file (missing `}` or `)`), or a file name in an `import` that doesn't match the real file name (capital letters count). Fix the file on GitHub and commit again.

---

## Daily admin without Node.js

- **Look at or fix data:** D1 → `facility-db` → **Console** (run SQL) or **Tables** (browse).
- **Backup / undo:** D1 → `facility-db` → **Time Travel** restores the database to any point in the last 30 days.
- **Errors:** Worker → **Logs**.
- **Staff, PINs, deactivating people:** in the app, Admin → Manage staff.
