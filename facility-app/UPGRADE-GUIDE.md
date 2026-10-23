> **Note (Cloudflare migration):** this guide describes the corrections/offline release as it was deployed on Supabase. The app now runs on Cloudflare Workers + D1 — the SQL steps below are replaced by `migrations/0001_init.sql`, and the database checks by `tests/worker-test.mjs`. Follow **DEPLOY-CLOUDFLARE.md** to deploy. The workflow descriptions (corrections, offline recovery, Sync Centre) still apply unchanged.

# Facility Maintenance — corrections and offline work update

This package updates the supplied app. No production database or deployment has been changed.

## Deploy this update

1. Back up your Supabase database and retain the previous app release. Schedule the update while technicians are not submitting inspections.
2. Make sure the existing equipment, FE, task, expiry and backdate schema migrations have been applied. Apply `supabase/20260907_reliable_inspections.sql` **after all older schema/security scripts**. Run it as the database owner in the Supabase SQL Editor. The migration is transactional and can be rerun.
3. Keep your existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` environment variables. Never put a service-role key in the frontend.
4. Run `npm ci` and `npm run build`. Deploy the resulting `dist` directory using your existing Vite/Netlify hosting setup and SPA redirects. A prebuilt dist is intentionally omitted: it must be built using your project's environment variables.
5. Ask technicians to update/reopen the installed app and use Today → Download to refresh offline equipment. Existing reference downloads use an older format and need downloading again. Do not clear browser data if unsent work exists.
6. Check the rollout examples below against a staging project before daily use.

**Deploy the SQL and frontend together.** The migration prevents direct writes to inspections and signatures. The old app's submission and sign-off code will no longer work after the new policies are applied. Do not rerun older permissive security scripts after this migration. Do not roll back only the frontend after accepting records with the new workflow.

## What changed

- Explicit **Correct this entry** and **Record a new inspection** actions in inspection history.
- An unsigned correction updates the same inspection, advances its revision and retains the earlier readings. Its date and original technician remain unchanged.
- A signed/completed entry stays unchanged while a proposed correction awaits supervisor approval. Approval applies the proposal and records a new sign-off; rejection leaves the signed entry unchanged.
- Corrections require a reason. A revision check rejects edits based on an outdated record. Restored correction drafts retain the revision they were based on.
- Headers, readings, revision snapshots, linked defects and receipt IDs save in one database transaction. Reusing a submission ID does not create another inspection.
- IndexedDB stores per-account drafts, submissions and downloaded reference data. Drafts save after every change. Both equipment and extinguisher inspections use the same persistent outbox.
- Sync Centre shows saved drafts, pending/failed/synced entries, saved answers and manual retry. Retry runs on connection/focus and periodically while the app is open. The app does not promise closed-app background delivery.
- Downloads finish atomically: a failed download leaves the earlier complete reference set in place. Refresh removes retired or removed entries. The checklist refreshes from the server when connected and falls back to downloaded data when needed.
- Saved draft recovery, unanswered/flagged filters, reading progress, previous readings, review-before-submit, notes/photos on abnormal readings and Scan next equipment.
- Extinguisher checks start unanswered. Expiry observations remain editable; the server rejects a conflicting expiry change instead of silently overwriting someone else's update.
- Navy navigation, larger field controls, interactive work cards, responsive bottom navigation, keyboard focus states, reduced-motion support and visible connection status.
- Today shows drafts, pending uploads, assigned open tasks and returned inspections. Supervisors have a combined equipment/FE/correction review queue and Return for correction.
- Equipment profiles link inspection history, reading trends and defects from the latest 50 inspections. Administrators can add HTTPS document links and a next planned maintenance date. Linked documents remain on their original service; the app does not download their contents for offline use.
- Tracker separates submissions, approved entries, awaiting approval and flagged readings. Area coverage is capped per equipment; multiple submissions for one equipment do not cover another equipment.
- Installed-app icons and interface fonts are bundled locally. App updates are deferred while a checklist or upload is active.

## Using corrections

Open **History → inspection → Correct this entry**. Change the required values, enter a reason, review, and submit. Use **Record a new inspection** only for a separate inspection round.

For signed records, the supervisor opens **Review & approve → Corrections**, reads the proposed readings, signs, and approves. The same inspection ID remains in reports, so a correction does not add another completion.

Linked defects created by this version are marked for review when an inspection is corrected. They are not silently deleted or closed. Older issues have no reliable inspection foreign key, so they are not automatically linked retrospectively.

## Offline recovery

- Sign in and download the required equipment while connected. A new sign-in requires a connection; an existing session can restore its matching cached profile offline.
- Drafts belong to the signed-in account on that device. Signing out does not transfer drafts to the next technician.
- A successful local save is shown separately from server receipt. Keep the app open until Sync Centre says Synced.
- Needs attention means a server validation, permission or revision problem. Read the error and inspect the saved answers. Retry after resolving the cause. An outdated correction should be reopened from its current inspection and re-entered after checking the latest values.
- The Sync Centre can recover the earlier app's localStorage queue for the matching technician. Recovered entries are held for review first because the previous uploader could have left a partial server record. Compare History before retrying; do not delete unexplained historical records blindly.
- Browser storage can be removed by the user/browser. Avoid clearing site data or switching devices until all uploads are confirmed.

## Records and photos

New approvals are stored in `inspection_reviews`, with the authenticated reviewer, revision, timestamp and signature. Earlier signature rows remain intact. Monthly report signatures retain their existing presentation function; they are not a substitute for the persisted inspection approval history.

New photos are resized to JPEG and stored with the protected inspection reading/revision, with a 450,000-character limit per image. This makes offline delivery atomic. Monitor database size if photographic evidence becomes frequent; a private object-storage attachment pipeline would be a later scaling improvement.

## Verification performed

- Production Vite build and service-worker generation.
- Lint: no errors; remaining warnings include legacy unused variables/hooks and React Fast Refresh context-export warnings.
- Isolated PostgreSQL-compatible PGlite tests: migration rerun, complete transactional save, retry idempotency, required-answer rejection without partial rows, correction history/count, stale revision rejection, other-user edit restrictions, immutable records, supervisor approval, signed correction approval and FE submission.
- IndexedDB tests with fake-indexeddb: persisted draft-to-outbox transition, network failures, simultaneous retries, account separation, permanent-error handling, FE queue and answer validation.

Run the included tests with `npm ci --prefix tests`, then `npm run test:database` and `npm run test:offline`. Test dependencies are separate from the shipped application.

No live Supabase, camera, mobile installation, browser layout or real-device offline/online test was performed. The isolated tests do not prove compatibility with unprovided production schema changes.

## Staging rollout checks

1. Submit one equipment and one extinguisher inspection, then repeat the same upload after a simulated connection interruption. Verify only one header per submission.
2. Correct an unsigned entry and confirm its earlier revision is visible and the inspection count is unchanged.
3. Sign an inspection, propose a correction, reject it once, then propose and approve another correction. Check the signed value changes only on approval.
4. Open the same inspection on two devices; ensure the older revision cannot overwrite a later correction.
5. Enter readings and a photo offline, close/reopen the app, restore the draft, submit offline, reconnect, and verify Synced.
6. Sign out with pending work and sign in as another technician. Confirm the original account's work is not displayed or uploaded under the second account.
7. Check camera access, install icons, signature input, mobile navigation and 200% text scaling on the actual devices.

## Existing limits outside this update

The original bi-weekly/bi-monthly schedule labels remain ambiguous and require a separate agreed scheduling rule. Some legacy report/chart queries remain unpaginated. The monthly equipment report shows the latest entry for each date; full individual rounds are available in History. This update does not add document file uploads, a full asset work-order scheduler, notifications, or automatic defect closure. Existing PIN authentication and legacy public storage buckets require the separate security review noted earlier.
