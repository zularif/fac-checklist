import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'
import { useToast, friendlyError } from '../context/ToastContext'
import { useIsAdmin } from '../lib/useIsAdmin'
import {
  PRIORITIES, PRIORITY_STYLE, fmtDate, fmtShort, isOverdue, reconcileTiming, daysBetween,
} from '../lib/taskHelpers'

const VIEWS = ['Grid', 'Board', 'Timeline']
const emptyTask = () => ({
  title: '', description: '', parent_id: '', stage_id: '', assigned_to: '',
  priority: 'Medium', start_date: '', due_date: '', duration_days: '',
})

export default function Tasks() {
  const { profile } = useAuth()
  const toast = useToast()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()

  const [view, setView] = useState('Grid')
  const [tasks, setTasks] = useState([])
  const [stages, setStages] = useState([])
  const [techs, setTechs] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')

  // filters
  const [stageFilter, setStageFilter] = useState('All')
  const [assigneeFilter, setAssigneeFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')

  // create/edit modal
  const [editing, setEditing] = useState(null) // task object or emptyTask()
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState({}) // parentId -> bool (grid)

  async function load() {
    setLoading(true)
    const [{ data: st }, { data: tk }, { data: tc }] = await Promise.all([
      db.from('task_stages').select('*').order('sort_order'),
      db.from('tasks').select('*').order('sort_order').order('created_at'),
      db.from('technicians').select('id, name').eq('status', 'Active').order('name'),
    ])
    setStages(st || [])
    setTasks(tk || [])
    setTechs(tc || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages])
  const techById = useMemo(() => Object.fromEntries(techs.map((t) => [t.id, t.name])), [techs])

  function passesFilters(t) {
    if (stageFilter !== 'All' && t.stage_id !== stageFilter) return false
    if (assigneeFilter !== 'All' && t.assigned_to !== assigneeFilter) return false
    if (priorityFilter !== 'All' && t.priority !== priorityFilter) return false
    return true
  }

  const filtered = useMemo(() => tasks.filter(passesFilters), [tasks, stageFilter, assigneeFilter, priorityFilter])
  const parents = useMemo(() => filtered.filter((t) => !t.parent_id), [filtered])
  const childrenOf = (pid) => filtered.filter((t) => t.parent_id === pid)

  const openCount = tasks.filter((t) => { const s = stageById[t.stage_id]; return !(s?.is_done) }).length
  const overdueCount = tasks.filter((t) => isOverdue(t.due_date, stageById[t.stage_id]?.is_done)).length

  function openNew(parentId = '') {
    setEditing({ ...emptyTask(), parent_id: parentId, stage_id: stages[0]?.id || '' })
  }
  function openEdit(t) {
    setEditing({
      ...t,
      parent_id: t.parent_id || '',
      stage_id: t.stage_id || '',
      assigned_to: t.assigned_to || '',
      start_date: t.start_date || '',
      due_date: t.due_date || '',
      duration_days: t.duration_days ?? '',
    })
  }

  function setField(field, value) {
    setEditing((prev) => {
      let next = { ...prev, [field]: value }
      if (field === 'start_date') next = reconcileTiming(next, 'start')
      else if (field === 'due_date') next = reconcileTiming(next, 'due')
      else if (field === 'duration_days') next = reconcileTiming(next, 'duration')
      return next
    })
  }

  async function saveTask() {
    if (!editing.title.trim()) { setMsg('Title is required.'); return }
    setSaving(true)
    setMsg('')
    const payload = {
      title: editing.title.trim(),
      description: editing.description?.trim() || null,
      parent_id: editing.parent_id || null,
      stage_id: editing.stage_id || null,
      assigned_to: editing.assigned_to || null,
      priority: editing.priority,
      start_date: editing.start_date || null,
      due_date: editing.due_date || null,
      duration_days: editing.duration_days === '' ? null : Number(editing.duration_days),
    }
    let error
    if (editing.id) {
      const res = await db.from('tasks').update(payload).eq('id', editing.id)
      error = res.error
    } else {
      payload.created_by = profile?.id || null
      const res = await db.from('tasks').insert(payload)
      error = res.error
    }
    setSaving(false)
    if (error) { setMsg(`Couldn't save: ${error.message}`); toast.error(friendlyError(error, 'Couldn\u2019t save the task.')); return }
    toast.success(editing.id ? 'Task updated.' : 'Task created.')
    setEditing(null)
    load()
  }

  async function changeStage(task, stageId) {
    const st = stages.find((s) => s.id === stageId)
    await db.from('tasks').update({ stage_id: stageId, completed: !!st?.is_done }).eq('id', task.id)
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, stage_id: stageId, completed: !!st?.is_done } : t)))
  }

  // Checkbox toggles completion: checking sends the task to the LAST stage
  // (e.g. Verified); unchecking sends it back to the FIRST stage.
  const lastStage = stages[stages.length - 1]
  const firstStage = stages[0]
  async function toggleDone(task) {
    const isDone = stageById[task.stage_id]?.is_done
    const target = isDone ? firstStage : lastStage
    if (!target) return
    await changeStage(task, target.id)
  }

  function assigneeExportRows() {
    // group filtered tasks by assignee name, parents then their sub-tasks
    const byAssignee = {}
    const nameOf = (id) => (id ? (techById[id] || 'Unknown') : 'Unassigned')
    for (const p of parents) {
      const group = (byAssignee[nameOf(p.assigned_to)] ||= [])
      group.push({ ...p, isParent: true })
      for (const k of childrenOf(p.id)) {
        (byAssignee[nameOf(k.assigned_to)] ||= []).push({ ...k, isParent: false, parentTitle: p.title })
      }
    }
    return byAssignee
  }

  function exportCSV() {
    const groups = assigneeExportRows()
    const head = ['Assignee', 'Task', 'Parent task', 'Stage', 'Priority', 'Start', 'Due', 'Duration (days)']
    const lines = [head]
    for (const person of Object.keys(groups).sort()) {
      for (const t of groups[person]) {
        lines.push([
          person,
          (t.isParent ? '' : '  ') + t.title,
          t.parentTitle || '',
          stageById[t.stage_id]?.name || '',
          t.priority || '',
          t.start_date || '',
          t.due_date || '',
          t.duration_days ?? '',
        ])
      }
    }
    const csv = lines.map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'tasks-by-assignee.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  function exportPDF() {
    const groups = assigneeExportRows()
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    let html = `<html><head><title>Tasks by assignee</title><style>
      body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:24px;color:#0f172a;}
      h1{font-size:20px;margin:0 0 2px;} .sub{color:#64748b;font-size:12px;margin:0 0 18px;}
      h2{font-size:14px;margin:18px 0 6px;color:#1a56db;border-bottom:1px solid #e2e8f0;padding-bottom:4px;}
      table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:6px;}
      th{text-align:left;color:#64748b;padding:4px 6px;border-bottom:1px solid #e2e8f0;}
      td{padding:4px 6px;border-bottom:1px solid #f1f5f9;}
      .sub-task td:first-child{padding-left:18px;color:#475569;}
      @media print{button{display:none;}}
    </style></head><body>
      <h1>Tasks by assignee</h1><p class="sub">Generated ${today}</p>
      <button onclick="window.print()" style="margin-bottom:16px;padding:8px 16px;background:#1a56db;color:#fff;border:none;border-radius:6px;cursor:pointer;">Print / Save as PDF</button>`
    for (const person of Object.keys(groups).sort()) {
      html += `<h2>${person} — ${groups[person].length} task(s)</h2>
        <table><thead><tr><th>Task</th><th>Stage</th><th>Priority</th><th>Start</th><th>Due</th><th>Dur.</th></tr></thead><tbody>`
      for (const t of groups[person]) {
        html += `<tr class="${t.isParent ? '' : 'sub-task'}">
          <td>${t.title}${t.parentTitle ? ` <span style="color:#94a3b8">(under ${t.parentTitle})</span>` : ''}</td>
          <td>${stageById[t.stage_id]?.name || ''}</td>
          <td>${t.priority || ''}</td>
          <td>${t.start_date || ''}</td>
          <td>${t.due_date || ''}</td>
          <td>${t.duration_days ?? ''}</td></tr>`
      }
      html += '</tbody></table>'
    }
    html += '</body></html>'
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  async function deleteTask(task) {
    const kids = tasks.filter((t) => t.parent_id === task.id).length
    const warn = kids ? ` This will also delete ${kids} sub-task(s).` : ''
    if (!window.confirm(`Delete "${task.title}"?${warn}`)) return
    await db.from('tasks').delete().eq('id', task.id)
    load()
  }

  function StagePill({ stageId, onChange }) {
    const s = stageById[stageId]
    return (
      <select
        className="stage-select"
        value={stageId || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ color: s?.color || '#64748b', borderColor: (s?.color || '#cbd5e1') + '55' }}
      >
        {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
      </select>
    )
  }

  function PriorityBadge({ p }) {
    const st = PRIORITY_STYLE[p] || PRIORITY_STYLE.Medium
    return <span className="task-prio" style={{ background: st.bg, color: st.fg }}>{p}</span>
  }

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <p className="page-title">Tasks</p>
          <p className="page-sub" style={{ margin: 0 }}>
            {openCount} open{overdueCount > 0 && <> · <span style={{ color: 'var(--danger)' }}>{overdueCount} overdue</span></>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" style={{ width: 'auto', padding: '9px 12px' }} onClick={exportCSV} title="Export tasks grouped by assignee (CSV)">
            <i className="ti ti-file-spreadsheet" aria-hidden="true" />CSV
          </button>
          <button className="btn-secondary" style={{ width: 'auto', padding: '9px 12px' }} onClick={exportPDF} title="Export tasks grouped by assignee (PDF)">
            <i className="ti ti-file-text" aria-hidden="true" />PDF
          </button>
          {isAdmin && (
            <button className="btn-secondary" style={{ width: 'auto', padding: '9px 12px' }} onClick={() => navigate('/tasks/stages')}>
              <i className="ti ti-adjustments" aria-hidden="true" />Stages
            </button>
          )}
          <button className="btn-primary" style={{ width: 'auto', padding: '9px 16px' }} onClick={() => openNew('')}>
            <i className="ti ti-plus" aria-hidden="true" />New task
          </button>
        </div>
      </div>

      {/* view tabs */}
      <div className="seg-tabs" style={{ margin: '12px 0' }}>
        {VIEWS.map((v) => (
          <button key={v} className={'seg-tab' + (view === v ? ' active' : '')} onClick={() => setView(v)}>
            <i className={'ti ' + (v === 'Grid' ? 'ti-table' : v === 'Board' ? 'ti-layout-kanban' : 'ti-timeline')} aria-hidden="true" />
            {v}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="chip-row">
        <button className={stageFilter === 'All' ? 'chip active' : 'chip'} onClick={() => setStageFilter('All')}>All stages</button>
        {stages.map((s) => (
          <button key={s.id} className={stageFilter === s.id ? 'chip active' : 'chip'} onClick={() => setStageFilter(s.id)}>
            <span className="dot" style={{ background: s.color }} />{s.name}
          </button>
        ))}
      </div>
      <div className="btn-row" style={{ flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 150px', marginBottom: 8 }}>
          <label>Assignee</label>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}>
            <option value="All">All assignees</option>
            <option value="">Unassigned</option>
            {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 130px', marginBottom: 8 }}>
          <label>Priority</label>
          <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option value="All">All priorities</option>
            {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      {msg && !editing && <div className="banner-warn">{msg}</div>}

      {loading ? (
        <p className="center-msg">Loading…</p>
      ) : tasks.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          No tasks yet. Create your first one.
        </div>
      ) : (
        <>
          {view === 'Grid' && (
            <GridView
              parents={parents} childrenOf={childrenOf} expanded={expanded} setExpanded={setExpanded}
              stageById={stageById} techById={techById} StagePill={StagePill} PriorityBadge={PriorityBadge}
              onEdit={openEdit} onAddSub={openNew} onChangeStage={changeStage} onDelete={deleteTask} onToggleDone={toggleDone}
            />
          )}
          {view === 'Board' && (
            <BoardView
              stages={stages} filtered={filtered} techById={techById} PriorityBadge={PriorityBadge}
              onEdit={openEdit} onChangeStage={changeStage}
            />
          )}
          {view === 'Timeline' && (
            <TimelineView parents={parents} childrenOf={childrenOf} stageById={stageById} onEdit={openEdit} onToggleDone={toggleDone} />
          )}
        </>
      )}

      {/* create / edit modal */}
      {editing && (
        <div className="fe-modal-overlay" onClick={() => setEditing(null)}>
          <div className="fe-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="fe-modal-head">
              <p className="fe-modal-code" style={{ flex: 1 }}>{editing.id ? 'Edit task' : editing.parent_id ? 'New sub-task' : 'New task'}</p>
              <button className="icon-btn" aria-label="Close" onClick={() => setEditing(null)}>
                <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
              </button>
            </div>
            <div className="fe-modal-body">
              <div className="field"><label>Title</label>
                <input autoFocus value={editing.title} onChange={(e) => setField('title', e.target.value)} placeholder="e.g. Replace worn belt on AHU 4-1" />
              </div>
              <div className="field"><label>Description</label>
                <textarea rows={2} value={editing.description || ''} onChange={(e) => setField('description', e.target.value)} placeholder="Details…" />
              </div>
              <div className="field"><label>Parent task (optional — makes this a sub-task)</label>
                <select value={editing.parent_id} onChange={(e) => setField('parent_id', e.target.value)}>
                  <option value="">— None (top-level task) —</option>
                  {tasks.filter((t) => !t.parent_id && t.id !== editing.id).map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>
              <div className="btn-row">
                <div className="field" style={{ flex: 1 }}><label>Stage</label>
                  <select value={editing.stage_id} onChange={(e) => setField('stage_id', e.target.value)}>
                    {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}><label>Priority</label>
                  <select value={editing.priority} onChange={(e) => setField('priority', e.target.value)}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Assign to</label>
                <select value={editing.assigned_to} onChange={(e) => setField('assigned_to', e.target.value)}>
                  <option value="">— Unassigned —</option>
                  {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="btn-row">
                <div className="field" style={{ flex: 1 }}><label>Start date</label>
                  <input type="date" value={editing.start_date} onChange={(e) => setField('start_date', e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1 }}><label>Duration (days)</label>
                  <input type="number" min="1" value={editing.duration_days} onChange={(e) => setField('duration_days', e.target.value)} />
                </div>
              </div>
              <div className="field"><label>Due date</label>
                <input type="date" value={editing.due_date} onChange={(e) => setField('due_date', e.target.value)} />
              </div>
              <p className="list-card-meta">Set start + duration and the due date fills in — or set start + due and duration is worked out.</p>

              {msg && <div className="banner-warn" style={{ marginTop: 8 }}>{msg}</div>}
            </div>
            <div className="fe-modal-foot">
              {editing.id && <button className="btn-secondary" style={{ color: 'var(--danger)', flex: '0 0 auto' }} onClick={() => { const t = editing; setEditing(null); deleteTask(t) }}><i className="ti ti-trash" aria-hidden="true" /></button>}
              <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
              <button className="btn-primary" onClick={saveTask} disabled={saving}>{saving ? 'Saving…' : editing.id ? 'Save' : 'Create task'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------------- Grid view ---------------- */
function GridView({ parents, childrenOf, expanded, setExpanded, stageById, techById, StagePill, PriorityBadge, onEdit, onAddSub, onChangeStage, onDelete, onToggleDone }) {
  function Row({ t, depth }) {
    const kids = childrenOf(t.id)
    const isParent = depth === 0
    const open = expanded[t.id]
    const done = stageById[t.stage_id]?.is_done
    const overdue = isOverdue(t.due_date, done)
    return (
      <>
        <tr className={done ? 'task-row done' : 'task-row'}>
          <td className="tg-name" style={{ paddingLeft: 8 + depth * 20 }}>
            {isParent && kids.length > 0 ? (
              <button className="tg-caret" onClick={() => setExpanded((e) => ({ ...e, [t.id]: !e[t.id] }))} aria-label="Toggle">
                <i className={'ti ' + (open ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
              </button>
            ) : <span className="tg-caret-spacer" />}
            <input type="checkbox" style={{ width: 'auto', marginRight: 6, cursor: 'pointer', verticalAlign: 'middle' }} checked={!!done} onChange={() => onToggleDone(t)} title={done ? 'Mark not done' : 'Mark done'} />
            <span className={done ? 'tg-title struck' : 'tg-title'} onClick={() => onEdit(t)}>{t.title}</span>
            {isParent && <button className="tg-addsub" title="Add sub-task" onClick={() => onAddSub(t.id)}><i className="ti ti-plus" aria-hidden="true" /></button>}
          </td>
          <td>{t.assigned_to ? techById[t.assigned_to] || '—' : <span className="tg-muted">Unassigned</span>}</td>
          <td><PriorityBadge p={t.priority} /></td>
          <td><StagePill stageId={t.stage_id} onChange={(v) => onChangeStage(t, v)} /></td>
          <td className="tg-date">{fmtShort(t.start_date)}</td>
          <td className={'tg-date' + (overdue ? ' tg-overdue' : '')}>{fmtShort(t.due_date)}</td>
          <td className="tg-date">{t.duration_days ? `${t.duration_days}d` : ''}</td>
        </tr>
        {isParent && open && kids.map((k) => <Row key={k.id} t={k} depth={1} />)}
      </>
    )
  }
  return (
    <div className="table-wrap">
      <table className="task-grid">
        <thead>
          <tr>
            <th className="tg-name">Name</th><th>Assigned</th><th>Priority</th><th>Stage</th><th>Start</th><th>Due</th><th>Dur.</th>
          </tr>
        </thead>
        <tbody>
          {parents.map((p) => <Row key={p.id} t={p} depth={0} />)}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- Board view ---------------- */
function BoardView({ stages, filtered, techById, PriorityBadge, onEdit, onChangeStage }) {
  return (
    <div className="board-wrap">
      {stages.map((s) => {
        const cards = filtered.filter((t) => t.stage_id === s.id)
        return (
          <div className="board-col" key={s.id}>
            <div className="board-col-head">
              <span className="dot" style={{ background: s.color }} />{s.name}
              <span className="board-count">{cards.length}</span>
            </div>
            <div className="board-col-body">
              {cards.map((t) => (
                <div className="board-card" key={t.id} onClick={() => onEdit(t)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <PriorityBadge p={t.priority} />
                    {isOverdue(t.due_date, s.is_done) && <span className="task-prio" style={{ background: '#fee2e2', color: '#dc2626' }}>Overdue</span>}
                  </div>
                  <p className={'board-card-title' + (s.is_done ? ' struck' : '')}>{t.title}</p>
                  <p className="board-card-meta">
                    {t.assigned_to ? techById[t.assigned_to] || '—' : 'Unassigned'}
                    {t.due_date && ` · ${fmtShort(t.due_date)}`}
                  </p>
                  <select
                    className="board-move"
                    value={t.stage_id || ''}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onChangeStage(t, e.target.value)}
                  >
                    {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                  </select>
                </div>
              ))}
              {cards.length === 0 && <p className="board-empty">—</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Timeline view ---------------- */
function TimelineView({ parents, childrenOf, stageById, onEdit, onToggleDone }) {
  // gather all dated tasks to find the range
  const all = []
  for (const p of parents) { all.push(p); for (const k of childrenOf(p.id)) all.push(k) }
  const dated = all.filter((t) => t.start_date && t.due_date)
  if (dated.length === 0) {
    return <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No tasks have both a start and due date yet — add dates to see them on the timeline.</div>
  }
  const min = new Date(Math.min(...dated.map((t) => new Date(t.start_date))))
  const max = new Date(Math.max(...dated.map((t) => new Date(t.due_date))))
  min.setHours(0, 0, 0, 0); max.setHours(0, 0, 0, 0)
  const totalDays = Math.max(1, Math.round((max - min) / 86400000) + 1)

  // month gridlines
  const months = []
  const cur = new Date(min.getFullYear(), min.getMonth(), 1)
  while (cur <= max) {
    const offset = Math.max(0, Math.round((cur - min) / 86400000))
    months.push({ label: cur.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }), pct: (offset / totalDays) * 100 })
    cur.setMonth(cur.getMonth() + 1)
  }

  function bar(t) {
    const s = new Date(t.start_date); s.setHours(0, 0, 0, 0)
    const e = new Date(t.due_date); e.setHours(0, 0, 0, 0)
    const left = (Math.round((s - min) / 86400000) / totalDays) * 100
    const width = Math.max(1.5, ((Math.round((e - s) / 86400000) + 1) / totalDays) * 100)
    const color = stageById[t.stage_id]?.color || '#94a3b8'
    return { left, width, color }
  }

  const rows = []
  for (const p of parents) {
    rows.push({ t: p, depth: 0 })
    for (const k of childrenOf(p.id)) rows.push({ t: k, depth: 1 })
  }

  return (
    <div className="tl-wrap">
      <div className="tl-inner">
        <div className="tl-months">
          {months.map((m, i) => <span key={i} className="tl-month" style={{ left: `${m.pct}%` }}>{m.label}</span>)}
        </div>
        {rows.map(({ t, depth }) => {
          const b = t.start_date && t.due_date ? bar(t) : null
          const done = stageById[t.stage_id]?.is_done
          return (
            <div className="tl-row" key={t.id}>
              <div className="tl-label" style={{ paddingLeft: 6 + depth * 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto', flexShrink: 0, cursor: 'pointer' }}
                  checked={!!done}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggleDone(t)}
                  title={done ? 'Mark not done' : 'Mark done'}
                />
                <span className={done ? 'struck' : ''} style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => onEdit(t)}>{t.title}</span>
              </div>
              <div className="tl-track" onClick={() => onEdit(t)}>
                {months.map((m, i) => <span key={i} className="tl-grid" style={{ left: `${m.pct}%` }} />)}
                {b && (
                  <span className="tl-bar" style={{ left: `${b.left}%`, width: `${b.width}%`, background: b.color }} title={`${fmtDate(t.start_date)} – ${fmtDate(t.due_date)}`} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
