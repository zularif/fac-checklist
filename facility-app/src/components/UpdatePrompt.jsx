import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import { useOffline } from '../context/OfflineContext'
export default function UpdatePrompt(){
 const [needRefresh,setNeedRefresh]=useState(false),[updateSW,setUpdateSW]=useState(null)
 const {pathname}=useLocation(),{items}=useOffline()
 const protectedWork=pathname.includes('/checklist/') || items.some(x=>x.state==='syncing')
 useEffect(()=>{
  let timer
  const update=registerSW({immediate:true,onNeedRefresh(){setNeedRefresh(true)},onRegisteredSW(_url,r){if(r)timer=setInterval(()=>r.update().catch(()=>{}),30*60*1000)}})
  setUpdateSW(()=>update)
  return()=>clearInterval(timer)
 },[])
 if(!needRefresh)return null
 return <div className="update-banner" role="status"><span>{protectedWork?'Update ready. Finish your checklist or upload first.':'A new version is ready. Saved drafts will be kept.'}</span><button disabled={protectedWork} onClick={()=>{updateSW?.(true);setTimeout(()=>window.location.reload(),1500)}}>Update now</button></div>
}
