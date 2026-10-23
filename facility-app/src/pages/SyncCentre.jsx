import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useOffline } from '../context/OfflineContext'
import { useAuth } from '../context/AuthContext'
import { importLegacy, legacyQueue } from '../lib/offlineQueue'
export default function SyncCentre(){
 const {items,drafts,online,retry,error}=useOffline(),{profile}=useAuth()
 const [filter,setFilter]=useState('Pending'),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const labels={queued:'Waiting to sync',syncing:'Sending…',synced:'Synced',error:'Needs attention'}
 const visible=items.filter(x=>filter==='All'||(filter==='Pending'?x.state!=='synced':x.state==='synced')).sort((a,b)=>b.createdAt-a.createdAt)
 async function sync(){setBusy(true);try{await retry()}catch(e){setMessage(e.message)}finally{setBusy(false)}}
 return <div className="screen"><header className="work-heading"><span className="work-eyebrow">DEVICE & CONNECTION</span><h1>Sync Centre</h1><p>{online?'Connected. Your saved work can be sent.':'Offline. Your drafts and queued inspections stay on this device.'}</p></header>
 <div className="work-metrics"><div><strong>{drafts.length}</strong><span>Saved drafts</span></div><div><strong>{items.filter(x=>x.state!=='synced').length}</strong><span>Pending uploads</span></div><div><strong>{items.filter(x=>x.state==='error').length}</strong><span>Need attention</span></div></div>
 <button className="btn-primary" disabled={!online || busy} onClick={sync}>{busy?'Syncing…':'Retry pending uploads'}</button>
 {(error || message) && <p role="alert" className="banner-danger">{error || message}</p>}
 <p className="work-notice">Sync runs while this app is open. Keep it open until pending uploads show “Synced”. Clearing browser data removes work that has not synced.</p>
 {legacyQueue().length>0 && <div className="work-notice">The earlier app left saved submissions on this device. <button className="btn-secondary" onClick={async()=>{try{await importLegacy(profile);setMessage('Your earlier submissions were recovered. Check History for a partial upload before retrying.')}catch(e){setMessage(e.message)}}}>Recover my earlier submissions</button></div>}
 <h2>Continue a draft</h2>{!drafts.length?<p>No unfinished drafts on this device.</p>:drafts.map(d=><Link className="work-list-item" to={d.route} key={d.localKey}><div><strong>{d.label}</strong><p>Saved {new Date(d.updatedAt).toLocaleString()}</p></div><span>Continue →</span></Link>)}
 <h2>Submissions</h2><div className="chip-row">{['Pending','Synced','All'].map(f=><button key={f} className={`chip ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>{f}</button>)}</div>
 {!visible.length && <p className="work-empty">{filter==='Pending'?'No pending uploads.':'No submissions in this view.'}</p>}
 {visible.map(x=><article className={`work-list-item ${x.state==='error'?'attention':''}`} key={x.localKey}><div><strong>{x.payload.label || 'Inspection'}</strong><p>{new Date(x.createdAt).toLocaleString()} · {x.payload.inspection_id?'Correction':'New inspection'}</p>{x.error && <p className="sync-error">{x.error}</p>}<details><summary>Saved answers</summary>{x.payload.details.map(d=><p key={d.parameter_name}>{d.parameter_name}: <strong>{d.value || 'Not checked'}</strong></p>)}</details>{x.state==='synced' && <Link to={`/inspection/${x.payload.kind}/${x.result.inspectionId}`}>View inspection →</Link>}{x.state==='error' && x.payload.inspection_id && <Link to={`/inspection/${x.payload.kind}/${x.payload.inspection_id}`}>Open current inspection to review the conflict →</Link>}</div><span className={`pill ${x.state==='synced'?'pill-ok':x.state==='error'?'pill-danger':'pill-warn'}`}>{labels[x.state]}</span></article>)}
 </div>
}
