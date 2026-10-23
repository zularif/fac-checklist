import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const SECTIONS = [
  {
    id: 'start', icon: 'ti-rocket', title: 'Getting started',
    blocks: [
      { h: 'Install on your phone', steps: [
        'Open the app link in your phone browser (Chrome on Android, Safari on iPhone).',
        'Android: menu (⋮) → "Install app" / "Add to Home screen". iPhone: Share → "Add to Home Screen".',
        'The icon appears on your home screen and opens full-screen like a normal app.',
      ] },
      { h: 'Log in with your PIN', steps: [
        'Open the app — you see the PIN pad.',
        'Tap your 4-digit PIN; the dots fill as you type.',
        'Tap OK. The app recognises who you are from the PIN.',
      ], tip: 'Staying logged in for days is normal. Tap Sign out in the menu to switch users.' },
    ],
  },
  {
    id: 'daily', icon: 'ti-checkbox', title: 'Daily inspections',
    blocks: [
      { h: 'Home screen', bullets: [
        'Summary cards show Due today, Completed, Awaiting sign-off, and progress.',
        'Each area card shows done/pending with a progress bar.',
        'Filter chips: All / Pending / Done / Offline. Tap an area to open its equipment.',
      ] },
      { h: 'Scan a QR code', steps: [
        'Tap "Scan equipment".',
        'Allow camera access the first time.',
        'Point at the QR label — it reads automatically and opens the checklist.',
        'If the camera won\u2019t work, type the code into the manual box.',
      ], tip: 'Always scan from inside the app, not the phone camera. The same scanner works for equipment and fire extinguishers.' },
      { h: 'Fill a checklist', steps: [
        'Type numeric readings (min/max shown) or tap choice buttons (Good / Not Good, etc.).',
        'Out-of-range values are flagged.',
        'Add remarks, then Submit. Equipment goes to sign-off; extinguishers save immediately.',
      ] },
      { h: 'Work offline (dead zones)', steps: [
        'While you still have signal, tap the download icon on an area card.',
        'Wait for "Offline ready" (green).',
        'In the dead zone, scan and fill as normal — it loads from the cache.',
        'Submissions queue and send automatically when you\u2019re back in signal.',
      ], tip: 'Photos still need signal; the whole submission waits in the queue and uploads together.' },
    ],
  },
  {
    id: 'supervisor', icon: 'ti-checks', title: 'Sign-off & tracking',
    blocks: [
      { h: 'Sign-off', steps: [
        'Open Sign-off from the menu.',
        'Tap an inspection to review its readings.',
        'Approve it, or send it back if something is wrong.',
      ] },
      { h: 'Tracker', bullets: [
        'Month grid of completion by area, per cycle (Daily … Yearly).',
        'Green ✓ = done, red ✕ = missed, — = upcoming.',
        'Bi-weekly / Bi-monthly show 2/2, 1/2, 0/2 (two per period).',
        'Tap an area name to open its equipment; use the month/year controls to change period.',
      ] },
      { h: 'Parameter chart', steps: [
        'Choose Plant → Area → Equipment → numeric Parameter.',
        'Set a date range and Generate.',
        'The chart shows readings with min/max spec lines. Export CSV if needed.',
      ] },
    ],
  },
  {
    id: 'reports', icon: 'ti-file-text', title: 'Reports',
    blocks: [
      { h: 'Inspection report', bullets: [
        'Factory inspection record for a date range, with the wiwynn header and readings table.',
        'Out-of-range values are marked; capture a supervisor signature, then Print / Save as PDF.',
      ] },
      { h: 'Fire extinguisher report', bullets: [
        'Monthly checklist per plant — choose Plant, Month, Year, and inspected-only or all.',
        'Sign Prepared By and Verified By, then Print / Save as PDF.',
      ] },
    ],
  },
  {
    id: 'fe', icon: 'ti-fire-extinguisher', title: 'Fire extinguishers',
    blocks: [
      { h: 'Floor map', bullets: [
        'Choose building and floor with the tabs; coloured pins mark each unit.',
        'Green = inspected this month, red = pending, amber = expiring (3 weeks), grey = expired.',
        'Tap a pin for details and last inspection, then Start inspection.',
        'Toolbar: fullscreen, zoom, and toggle on-pin labels.',
      ] },
      { h: 'Edit mode (admins)', bullets: [
        'Tap a pin to select it — details and actions appear (Edit details, Remove from map).',
        'Press and drag to move a pin; it can\u2019t be dragged off the plan.',
        'Tap an empty spot to add a new extinguisher or place an existing one.',
      ] },
      { h: 'Expiry dates', bullets: [
        'Bulk entry: FE list & expiry → Bulk edit dates → pick a floor, type each date (Enter to move down).',
        'During inspection: read the date off the bottle into the checklist\u2019s expiry field.',
        'CSV import: add an expiry_date column and re-import (admins).',
      ] },
      { h: 'Renewal & vendor', bullets: [
        'See expired/expiring counts by plant and floor.',
        'Copy the ready-written email draft to paste into your own email app.',
        'Batch-renew: filter to a date, tick the renewed units, set their new date; leftovers keep the old date.',
      ] },
      { h: 'Labels & details list', bullets: [
        'FE QR labels: print scannable labels (filter by building/floor/type), with code, type, serial, location.',
        'View all details: list every unit on a floor or plant with location, serial and expiry — export to CSV.',
      ] },
    ],
  },
  {
    id: 'tasks', icon: 'ti-checklist', title: 'Tasks',
    blocks: [
      { h: 'Three views', bullets: [
        'Grid: table with parent tasks that expand to sub-tasks.',
        'Board: kanban columns by stage; move tasks with the dropdown.',
        'Timeline: Gantt-style bars by start and due dates.',
      ] },
      { h: 'Create a task', steps: [
        'Tap New task; enter a title and description.',
        'To make a sub-task, pick a parent task.',
        'Set stage, priority, assignee, and dates — start + duration fills the due date automatically.',
        'Save, then move it between stages from any view.',
      ] },
      { h: 'Manage stages (admins)', bullets: [
        'Rename, recolour, reorder, add, or delete stages.',
        'Mark final stages as "counts as done". Deleting a used stage asks where to move its tasks.',
      ] },
    ],
  },
  {
    id: 'admin', icon: 'ti-settings', title: 'Administration',
    blocks: [
      { h: 'Equipment & checklists', bullets: [
        'Equipment manager: search, add, edit, retire, or delete equipment; add areas/categories inline; set cycles.',
        'Checklist manager: edit each equipment\u2019s parameters (numeric with min/max, or multiple-choice).',
        'Equipment QR labels: print scannable labels by area, in three sizes.',
      ] },
      { h: 'Fire extinguisher setup', bullets: [
        'Add floors and upload each floor-plan image (use the original so pins line up).',
        'Import extinguishers from CSV (code, type, serial, location, building, floor, x, y, expiry).',
      ] },
      { h: 'Security', bullets: [
        'Login is PIN-only — keep PINs private, since anyone with a valid PIN can sign in.',
      ] },
    ],
  },
]

export default function Help() {
  const navigate = useNavigate()
  const [open, setOpen] = useState('start')

  return (
    <div className="screen">
      <section className="work-panel"><h2>Corrections & offline work</h2><p>To fix a typing mistake, open History, select the inspection, and choose Correct this entry. Enter a reason and submit. A signed inspection keeps its approved values until a supervisor approves the correction.</p><p>To inspect equipment again, choose Record a new inspection. A correction remains one inspection; a new round is a separate record.</p><p>Drafts save automatically on this device. Open Sync Centre to resume drafts and check Waiting to sync, Synced, or Needs attention. Keep the app open with a connection until uploads finish.</p><p>Download equipment from Today before entering an area without signal. Both equipment and extinguisher checklists support offline saving. Supervisor approval requires a connection.</p></section>
      <p className="page-title">Help &amp; guide</p>
      <p className="page-sub">How to use the app, section by section. Tap a topic to expand it.</p>

      {SECTIONS.map((sec) => {
        const isOpen = open === sec.id
        return (
          <div className={'help-card' + (isOpen ? ' open' : '')} key={sec.id}>
            <button className="help-head" onClick={() => setOpen(isOpen ? '' : sec.id)}>
              <span className="help-ic"><i className={'ti ' + sec.icon} aria-hidden="true" /></span>
              <span className="help-title">{sec.title}</span>
              <i className={'ti ' + (isOpen ? 'ti-chevron-up' : 'ti-chevron-down')} aria-hidden="true" />
            </button>
            {isOpen && (
              <div className="help-body">
                {sec.blocks.map((b, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <p className="help-h">{b.h}</p>
                    {b.steps && (
                      <ol className="help-steps">
                        {b.steps.map((s, j) => <li key={j}>{s}</li>)}
                      </ol>
                    )}
                    {b.bullets && (
                      <ul className="help-bullets">
                        {b.bullets.map((s, j) => <li key={j}>{s}</li>)}
                      </ul>
                    )}
                    {b.tip && (
                      <div className="help-tip"><i className="ti ti-bulb" aria-hidden="true" /> {b.tip}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <p className="page-sub" style={{ marginTop: 16 }}>
        Need the printable version? Ask your administrator for the Facility Maintenance User Guide document.
      </p>
    </div>
  )
}
