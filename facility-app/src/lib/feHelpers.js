import { db } from './db'

// Fire extinguishers are on a MONTHLY cycle: a unit counts as inspected
// once it has an inspection dated within the current calendar month.
export function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}
export function endOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
}

export function publicFloorplanUrl(path) {
  if (!path) return null
  return db.storage.from('floorplans').getPublicUrl(path).data.publicUrl
}

// value fails if it appears in the parameter's comma-separated fail_values
export function isFailValue(template, value) {
  if (!template?.fail_values || !value) return false
  return template.fail_values.split(',').map((s) => s.trim()).includes(value)
}

export const FE_TYPE_COLOR = {
  CO2: '#0ea5e9',
  ABC: '#dc2626',
  Water: '#2563eb',
}

// Expiry: warn 3 weeks (21 days) ahead.
export const EXPIRY_WARN_DAYS = 21

export function expiryState(expiryDate) {
  if (!expiryDate) return 'none'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate); exp.setHours(0, 0, 0, 0)
  const days = Math.round((exp - today) / 86400000)
  if (days < 0) return 'expired'
  if (days <= EXPIRY_WARN_DAYS) return 'expiring'
  return 'ok'
}

export function daysToExpiry(expiryDate) {
  if (!expiryDate) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const exp = new Date(expiryDate); exp.setHours(0, 0, 0, 0)
  return Math.round((exp - today) / 86400000)
}
