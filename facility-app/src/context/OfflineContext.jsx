import { createContext, useContext, useEffect, useState } from 'react'
import { useAuth } from './AuthContext'
import { queueItems, flushQueue, setSyncUser, refreshPending } from '../lib/offlineQueue'
import { prepareCache } from '../lib/offlineCache'
import { localList } from '../lib/localStore'
const Context = createContext(null)
export function OfflineProvider({children}) {
  const {session} = useAuth()
  const userId = session?.user.id
  const [readyUser,setReadyUser] = useState(null)
  const [state,setState] = useState({online:navigator.onLine, items:[], drafts:[], error:''})
  useEffect(()=>{
    let alive = true
    setSyncUser(userId)
    async function refresh() {
      try {
        const [items,drafts] = await Promise.all([queueItems(userId), userId ? localList(`draft:${userId}:`) : []])
        if (alive) setState({online:navigator.onLine,items,drafts,error:''})
        await refreshPending()
      } catch(e) { if(alive) setState(s=>({...s,error:e.message})) }
    }
    function reconnect() { refresh(); flushQueue().catch(()=>{}) }
    window.addEventListener('facility-local-change',refresh)
    window.addEventListener('online',reconnect)
    window.addEventListener('offline',refresh)
    window.addEventListener('focus',reconnect)
    const timer = setInterval(()=>flushQueue().catch(()=>{}),30000)
    prepareCache(userId).then(()=>{if(alive)setReadyUser(userId);reconnect()}).catch(e=>{if(alive){setReadyUser(userId);setState(s=>({...s,error:e.message}))}})
    return ()=>{alive=false;setSyncUser(null);clearInterval(timer);window.removeEventListener('facility-local-change',refresh);window.removeEventListener('online',reconnect);window.removeEventListener('offline',refresh);window.removeEventListener('focus',reconnect)}
  },[userId])
  if(userId && readyUser!==userId)return <p className="screen" role="status">Opening your saved workspace…</p>
  return <Context.Provider value={{...state,retry:()=>flushQueue(true)}}>{children}</Context.Provider>
}
export const useOffline = ()=>useContext(Context)
