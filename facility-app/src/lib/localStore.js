// One IndexedDB database; every private record is scoped to the authenticated user.
let opening
export const changed = () => window.dispatchEvent(new Event('facility-local-change'))
function db() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const r = indexedDB.open('facility-work-v2', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('records', { keyPath: 'key' })
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => { opening = null; reject(r.error) }
  })
  return opening
}
export async function localGet(key) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const r = d.transaction('records').objectStore('records').get(key)
    r.onsuccess = () => resolve(r.result?.value)
    r.onerror = () => reject(r.error)
  })
}
export async function localPut(key, value) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction('records', 'readwrite')
    tx.objectStore('records').put({ key, value })
    tx.oncomplete = () => { changed(); resolve(value) }
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('Device storage unavailable'))
  })
}
export async function localDelete(key) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction('records', 'readwrite')
    tx.objectStore('records').delete(key)
    tx.oncomplete = () => { changed(); resolve() }
    tx.onerror = () => reject(tx.error)
  })
}
export async function localList(prefix) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const r = d.transaction('records').objectStore('records').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'))
    r.onsuccess = () => resolve(r.result.map(x => ({ ...x.value, localKey: x.key })))
    r.onerror = () => reject(r.error)
  })
}
