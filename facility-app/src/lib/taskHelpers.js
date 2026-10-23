export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent']

export const PRIORITY_STYLE = {
  Low: { bg: '#f1f5f9', fg: '#64748b' },
  Medium: { bg: '#e0f2fe', fg: '#0369a1' },
  High: { bg: '#fef3c7', fg: '#b45309' },
  Urgent: { bg: '#fee2e2', fg: '#dc2626' },
}

export function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function fmtShort(d) {
  if (!d) return ''
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function isOverdue(due, isDone) {
  if (!due || isDone) return false
  const t = new Date(); t.setHours(0, 0, 0, 0)
  return new Date(due) < t
}

// days between two ISO dates, inclusive of the start day
export function daysBetween(start, end) {
  if (!start || !end) return null
  const a = new Date(start); a.setHours(0, 0, 0, 0)
  const b = new Date(end); b.setHours(0, 0, 0, 0)
  return Math.round((b - a) / 86400000) + 1
}

export function addDays(start, days) {
  if (!start || days == null) return ''
  const d = new Date(start); d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + (days - 1)) // duration includes the start day
  return d.toISOString().slice(0, 10)
}

// Given the fields, reconcile duration <-> dates when one side changes.
// which = 'start' | 'due' | 'duration'
export function reconcileTiming(form, which) {
  const f = { ...form }
  const dur = f.duration_days === '' || f.duration_days == null ? null : Number(f.duration_days)
  if (which === 'duration' && f.start_date && dur) {
    f.due_date = addDays(f.start_date, dur)
  } else if (which === 'start') {
    if (f.start_date && dur) f.due_date = addDays(f.start_date, dur)
    else if (f.start_date && f.due_date) f.duration_days = daysBetween(f.start_date, f.due_date)
  } else if (which === 'due') {
    if (f.start_date && f.due_date) f.duration_days = daysBetween(f.start_date, f.due_date)
    else if (f.due_date && dur) f.start_date = addDays(f.due_date, -dur + 2) // back-calc
  }
  return f
}
