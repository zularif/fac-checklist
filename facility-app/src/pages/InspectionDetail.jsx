import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import SignatureCanvas from 'react-signature-canvas'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'
import { localGet, localPut } from '../lib/localStore'
import { isFlagged } from '../lib/inspectionModel'
export default function InspectionDetail(){
 const {kind,id}=useParams(), {profile,session}=useAuth(),sig=useRef(null)
 const [record,setRecord]=useState(null),[versions,setVersions]=useState([]),[corrections,setCorrections]=useState([]),[reviews,setReviews]=useState([]),[issues,setIssues]=useState([]),[people,setPeople]=useState({}),[error,setError]=useState(''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[refresh,setRefresh]=useState(0)
 const reviewer=['Supervisor','Admin'].includes(profile?.role)
 useEffect(()=>{let alive=true;async function load(){try{
  const key=`inspection:${session?.user.id}:${kind}:${id}`
  if(!navigator.onLine){const cached=await localGet(key);if(!cached)throw new Error('Open this record online once to make it available offline.');if(alive)setRecord(cached);return}
  const ht=kind==='fe'?'fe_inspections':'inspection_headers',dt=kind==='fe'?'fe_inspection_details':'inspection_details'
  const result=await db.from(ht).select(`*,technician:technicians(name),asset:${kind==='fe'?'fire_extinguishers(fe_code,location_desc)':'equipment(equip_id,equipment_name)'},details:${dt}(*)`).eq('id',id).single()
  if(result.error)throw result.error
  const [v,c,r,i,peopleResult]=await Promise.all([
   db.from('inspection_versions').select('*').eq('kind',kind).eq('inspection_id',id).order('revision',{ascending:false}),
   db.from('inspection_corrections').select('*').eq('kind',kind).eq('inspection_id',id).order('requested_at',{ascending:false}),
   db.from('inspection_reviews').select('*').eq('kind',kind).eq('inspection_id',id).order('created_at',{ascending:false}),
   db.from('issues').select('id,issue,status,correction_review_required').eq('source_kind',kind).eq('source_inspection_id',id),
   db.from('technicians').select('auth_uid,name'),
  ])
  for(const x of [v,c,r,i])if(x.error)throw x.error
  await localPut(key,result.data)
  if(alive){setRecord(result.data);setVersions(v.data);setCorrections(c.data);setReviews(r.data);setIssues(i.data);setPeople(Object.fromEntries((peopleResult.data || []).map(t=>[t.auth_uid,t.name])));setError('')}
 }catch(e){if(alive)setError(e.message)}}load();return()=>{alive=false}},[kind,id,session?.user.id,refresh])
 async function act(action,correction){
  const approving=action==='approve'||action==='approve-correction'
  if(approving&&(!sig.current||sig.current.isEmpty())){setError('Add your signature before approving.');return}
  if(!approving&&note.trim().length<3){setError('Enter a reason before returning or rejecting.');return}
  setBusy(true)
  try{const {error:e}=await db.rpc('facility_review',{kind,inspection:id,expected_revision:record.revision,action,note,signature:approving?sig.current.getCanvas().toDataURL('image/png'):null,correction:correction || null});if(e)throw e;setNote('');sig.current?.clear();setRefresh(x=>x+1)}catch(e){setError(e.message)}finally{setBusy(false)}
 }
 const showDetails=details=><div className="inspection-values">{(details || []).map(d=><div className="inspection-value" key={d.parameter_name}><div><strong>{d.parameter_name}</strong><p>{d.comment}</p></div><div><strong>{d.value || 'Not checked'}</strong><span className={`pill ${isFlagged(d.computed_status)?'pill-danger':'pill-ok'}`}>{d.computed_status}</span></div>{d.evidence&&<img className="evidence-photo" src={d.evidence} alt={`Observation for ${d.parameter_name}`}/>}</div>)}</div>
 if(!record)return <div className="screen"><p role={error?'alert':'status'}>{error || 'Loading inspection…'}</p></div>
 const code=record.asset?.fe_code || record.asset?.equip_id
 const route=kind==='fe'?`/fe/checklist/${encodeURIComponent(code)}`:`/checklist/${encodeURIComponent(code)}`
 const pending=corrections.find(c=>c.status==='Pending')
 return <div className="screen"><Link to="/history">← History</Link><header className="work-heading"><span className="work-eyebrow">INSPECTION RECORD · REVISION {record.revision}</span><h1>{record.asset?.equipment_name || code}</h1><p>{new Date(record.inspection_date).toLocaleString()} · {record.technician?.name}</p><span className="pill pill-warn">{record.status}</span></header>
 {error && <div role="alert" className="banner-danger">{error}</div>}
 {!navigator.onLine&&<p className="work-notice">Saved record. Connect to view the latest review and revision history.</p>}
 <div className="work-actions">{code&&!pending&&(record.technician_id===profile?.id||reviewer)&&<Link className="btn-primary" to={`${route}?correct=${id}`}>Correct this entry</Link>}{code&&<Link className="btn-secondary" to={route}>Record a new inspection</Link>}</div>
 {showDetails(record.details)}<p>{record.notes || record.remarks}</p>
 {issues.length>0&&<section className="work-panel"><h2>Linked defects</h2>{issues.map(i=><p key={i.id}>{i.issue} <span className="pill pill-warn">{i.status}</span>{i.correction_review_required&&<strong> · Review required after correction</strong>}</p>)}</section>}
 {pending&&<section className="work-panel correction-panel"><span className="work-eyebrow">CORRECTION AWAITING REVIEW</span><h2>{pending.payload.reason}</h2><p>The values above remain the current record until approval.</p>{showDetails(pending.payload.details)}{reviewer&&<div className="work-actions"><button className="btn-primary" disabled={busy||!navigator.onLine} onClick={()=>act('approve-correction',pending.id)}>Approve correction & sign</button><button className="btn-secondary" disabled={busy||!navigator.onLine} onClick={()=>act('reject-correction',pending.id)}>Reject correction</button></div>}</section>}
 {reviewer&&(pending||record.status==='Pending Sign-off')&&<section className="work-panel"><h2>Supervisor review</h2><label className="work-field">Review note<textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="Required when returning or rejecting"/></label><p>Signature for revision {pending?record.revision+1:record.revision}</p><div className="sig-pad"><SignatureCanvas ref={sig} canvasProps={{className:'sig-canvas','aria-label':'Supervisor signature'}}/></div><button className="btn-secondary" onClick={()=>sig.current?.clear()}>Clear signature</button>{!pending&&<div className="work-actions"><button className="btn-primary" disabled={busy||!navigator.onLine} onClick={()=>act('approve')}>Approve & sign</button><button className="btn-secondary" disabled={busy||!navigator.onLine} onClick={()=>act('return')}>Return for correction</button></div>}</section>}
 <section className="work-panel"><h2>Revision history</h2>{versions.length===0&&<p>No revisions recorded by this version of the app.</p>}{versions.map(v=><details className="revision-row" key={v.id}><summary>Revision {v.revision} · {v.reason} · {new Date(v.created_at).toLocaleString()}</summary><p>Changed by: {people[v.changed_by] || 'Unavailable user'}</p>{showDetails(v.snapshot.details)}</details>)}</section>
 <section className="work-panel"><h2>Review history</h2>{reviews.length===0&&<p>No review events recorded by this version of the app.</p>}{reviews.map(r=><div className="revision-row" key={r.id}><strong>{r.action.replaceAll('-',' ')} · Revision {r.revision}</strong><p>{new Date(r.created_at).toLocaleString()} · {r.note}</p><small>Reviewer: {people[r.reviewer_id] || 'Unavailable user'}</small>{r.signature&&<img className="review-signature" src={r.signature} alt="Supervisor signature"/>}</div>)}{corrections.filter(c=>c.status!=='Pending').map(c=><p key={c.id}>Correction {c.status.toLowerCase()}: {c.review_note || c.payload.reason} · {new Date(c.reviewed_at).toLocaleString()}</p>)}</section>
 </div>
}
