export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
export function choices(t) { return (t.options || '').split(',').map(s => s.trim()).filter(Boolean) }
export function statusFor(t, value) {
  if (value === '' || value == null) return 'Not checked'
  if (t.type === 'numeric') {
    const n = Number(value)
    if (!Number.isFinite(n)) return 'Invalid'
    return (t.min_value != null && n < t.min_value) || (t.max_value != null && n > t.max_value) ? 'OutOfRange' : 'Normal'
  }
  if (!choices(t).includes(value)) return 'Invalid'
  if (value.startsWith('N/A')) return 'N/A'
  return (t.fail_values || t.fail_value || '').split(',').map(s=>s.trim()).includes(value) ? 'OutOfSpec' : 'Normal'
}
export const isFlagged = s => ['OutOfRange', 'OutOfSpec', 'Defect', 'Invalid'].includes(s)
export function validateAnswers(templates, values) {
  if (!templates.length) return 'No checklist is available. Ask an administrator to configure this equipment.'
  const missing = templates.filter(t => t.required && (values[t.parameter_name] === '' || values[t.parameter_name] == null))
  if (missing.length) return `Complete ${missing.length} required check${missing.length === 1 ? '' : 's'}: ${missing.map(t=>t.parameter_name).join(', ')}.`
  if (templates.some(t=>statusFor(t, values[t.parameter_name]) === 'Invalid')) return 'Check the highlighted answers.'
  return ''
}
