import { db } from './db'
import { localList, localPut, localDelete } from './localStore'
let activeUser = null
let pending = 0
const flights = new Map()
export const pendingCount = () => pending
export function setSyncUser(id) { activeUser = id; pending = 0 }
export async function queueItems(userId = activeUser) { return userId ? localList(`outbox:${userId}:`) : [] }
export async function refreshPending() { pending = (await queueItems()).filter(x=>x.state !== 'synced').length; return pending }
export async function submitInspection(payload) {
  const userId = activeUser
  if (!userId) return { success:false, error:'Sign in before saving this inspection.' }
  const requestId = payload.request_id || crypto.randomUUID()
  const key = `outbox:${userId}:${requestId}`
  try {
    await localPut(key, { payload:{ ...payload, request_id:requestId }, userId, state:'queued', createdAt:Date.now(), attempts:0 })
    if (payload.draftKey) await localDelete(payload.draftKey)
    await flushQueue()
    const rows = await queueItems(userId)
    const item = rows.find(x=>x.payload.request_id === requestId)
    if (item?.state === 'synced') return { success:true, ...item.result }
    return { success:false, queued:true, needsAttention:item?.state === 'error', error:item?.error }
  } catch (err) { return { success:false, queued:false, error:`Could not save on this device: ${err.message}. Keep this page open and try again.` } }
}
export async function flushQueue(retryErrors = false) {
  const userId = activeUser
  if (!userId || !navigator.onLine) return
  if (flights.has(userId)) return flights.get(userId)
  const run = async () => {
    const items = await queueItems(userId)
    for (const item of items) {
      if (activeUser !== userId || !navigator.onLine) break
      if (item.state === 'synced' || (item.state === 'error' && !retryErrors)) continue
      // Session ownership is checked again immediately before each remote mutation.
      const { data } = await db.auth.getSession()
      if (data.session?.user.id !== userId) break
      await localPut(item.localKey, { ...item, state:'syncing', attempts:item.attempts + 1 })
      try {
        const { data:result, error } = await db.rpc('facility_save_inspection', { p:item.payload })
        if (error) throw error
        await localPut(item.localKey, { ...item, state:'synced', syncedAt:Date.now(), error:null, result, attempts:item.attempts + 1 })
      } catch (err) {
        const network = !navigator.onLine || /fetch|network|timeout/i.test(err.message || '')
        await localPut(item.localKey, { ...item, state:network ? 'queued':'error', error:err.message || 'Sync failed', attempts:item.attempts + 1 })
        if (network) break
      }
    }
    await refreshPending()
  }
  const flight = (navigator.locks ? navigator.locks.request(`facility-sync:${userId}`, run) : run()).finally(()=>flights.delete(userId))
  flights.set(userId, flight)
  return flight
}
// Preserve legacy queued data without silently attributing it to the next user.
export function legacyQueue() {
  try { return JSON.parse(localStorage.getItem('facility_app_pending_submissions') || '[]') } catch { return [] }
}
export async function importLegacy(profile) {
  const items = legacyQueue()
  const remaining = []
  for (const item of items) {
    if (item.header?.technician_id !== profile.id) { remaining.push(item); continue }
    const requestId = item.migrationId || crypto.randomUUID()
    item.migrationId = requestId
    // Persist the stable import ID before touching IndexedDB.
    localStorage.setItem('facility_app_pending_submissions', JSON.stringify(items))
    await localPut(`outbox:${activeUser}:${requestId}`, {
      userId:activeUser, state:'error', createdAt:item.queuedAt || Date.now(), attempts:0,
      error:'Recovered from the earlier app. Review the original entry before retrying; an earlier partial upload may exist.',
      payload:{ request_id:requestId, kind:'equipment', asset_id:item.header.equipment_id, header:item.header, details:item.details, label:item.header.equipment_name || 'Recovered inspection' },
    })
  }
  localStorage.setItem('facility_app_pending_submissions', JSON.stringify(remaining))
}
