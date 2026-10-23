import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { useIsAdmin } from '../lib/useIsAdmin'

const SWATCHES = ['#94a3b8', '#6366f1', '#1a56db', '#0ea5e9', '#f59e0b', '#16a34a', '#15803d', '#dc2626']

export default function TaskStages() {
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const [stages, setStages] = useState([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [newName, setNewName] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await db.from('task_stages').select('*').order('sort_order')
    setStages(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function addStage() {
    if (!newName.trim()) return
    const sort = (stages[stages.length - 1]?.sort_order || 0) + 1
    const { error } = await db.from('task_stages').insert({ name: newName.trim(), color: '#94a3b8', sort_order: sort, is_done: false })
    if (error) { setMsg(error.message); return }
    setNewName('')
    load()
  }

  async function updateStage(id, patch) {
    await db.from('task_stages').update(patch).eq('id', id)
    setStages((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  async function move(idx, dir) {
    const j = idx + dir
    if (j < 0 || j >= stages.length) return
    const a = stages[idx], b = stages[j]
    await Promise.all([
      db.from('task_stages').update({ sort_order: b.sort_order }).eq('id', a.id),
      db.from('task_stages').update({ sort_order: a.sort_order }).eq('id', b.id),
    ])
    load()
  }

  async function removeStage(s) {
    // if tasks use it, ask where to move them
    const { count } = await db.from('tasks').select('*', { count: 'exact', head: true }).eq('stage_id', s.id)
    if (count && count > 0) {
      const others = stages.filter((x) => x.id !== s.id)
      if (!others.length) { setMsg('Add another stage before deleting this one.'); return }
      const target = window.prompt(`${count} task(s) use "${s.name}". Move them to which stage?\n\n${others.map((o, i) => `${i + 1}. ${o.name}`).join('\n')}\n\nEnter a number:`)
      const idx = Number(target) - 1
      if (Number.isNaN(idx) || idx < 0 || idx >= others.length) { setMsg('Cancelled — invalid choice.'); return }
      await db.from('tasks').update({ stage_id: others[idx].id }).eq('stage_id', s.id)
    } else if (!window.confirm(`Delete stage "${s.name}"?`)) {
      return
    }
    await db.from('task_stages').delete().eq('id', s.id)
    load()
  }

  if (!isAdmin) return <div className="screen"><p className="center-msg">This area is for administrators only.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate('/tasks')}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back to tasks
      </button>
      <p className="page-title">Manage stages</p>
      <p className="page-sub">Rename, recolour, reorder, or add stages. Mark the final ones as "done" so their tasks show as completed.</p>

      {msg && <div className="banner-warn">{msg}</div>}

      {loading ? <p className="center-msg">Loading…</p> : (
        <>
          {stages.map((s, i) => (
            <div className="card" key={s.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className="tg-caret" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><i className="ti ti-chevron-up" aria-hidden="true" /></button>
                  <button className="tg-caret" onClick={() => move(i, 1)} disabled={i === stages.length - 1} aria-label="Move down"><i className="ti ti-chevron-down" aria-hidden="true" /></button>
                </div>
                <input value={s.name} onChange={(e) => setStages((prev) => prev.map((x) => x.id === s.id ? { ...x, name: e.target.value } : x))} onBlur={(e) => updateStage(s.id, { name: e.target.value.trim() || s.name })} style={{ flex: 1, margin: 0 }} />
                <button className="icon-action" style={{ color: 'var(--danger)' }} onClick={() => removeStage(s)} aria-label="Delete"><i className="ti ti-trash" aria-hidden="true" /></button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 5 }}>
                  {SWATCHES.map((c) => (
                    <button key={c} onClick={() => updateStage(s.id, { color: c })}
                      style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: s.color === c ? '2px solid #0f172a' : '2px solid transparent', cursor: 'pointer' }}
                      aria-label={`Colour ${c}`} />
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginLeft: 'auto' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={s.is_done} onChange={(e) => updateStage(s.id, { is_done: e.target.checked })} />
                  Counts as done
                </label>
              </div>
            </div>
          ))}

          <div className="card" style={{ borderStyle: 'dashed' }}>
            <div className="btn-row">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New stage name" style={{ flex: 1, margin: 0 }} />
              <button className="btn-primary" style={{ width: 'auto' }} onClick={addStage}><i className="ti ti-plus" aria-hidden="true" />Add</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
