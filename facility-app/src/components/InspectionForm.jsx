import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'
import { useOffline } from '../context/OfflineContext'
import { localGet, localPut } from '../lib/localStore'
import { lookupByEquipId, lookupFeByCode, rememberAsset } from '../lib/offlineCache'
import { submitInspection } from '../lib/offlineQueue'
import { choices, isFlagged, localDate, statusFor, validateAnswers } from '../lib/inspectionModel'

async function photoData(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  const bitmap = await createImageBitmap(file)
  const ratio = Math.min(1, 960 / Math.max(bitmap.width,bitmap.height))
  const canvas=document.createElement('canvas'); canvas.width=bitmap.width*ratio;canvas.height=bitmap.height*ratio
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close()
  let photo=canvas.toDataURL('image/jpeg',.65)
  if(photo.length>440000) photo=canvas.toDataURL('image/jpeg',.35)
  if(photo.length>440000) throw new Error('This image is too large. Choose a smaller photo.')
  return photo
}
export default function InspectionForm({kind='equipment'}) {
 const params=useParams(), [search]=useSearchParams(), navigate=useNavigate()
 const code=kind==='fe'?params.feCode:params.equipId
 const correction=search.get('correct'), {session,profile}=useAuth(), {online}=useOffline()
 const userId=session?.user.id, draftKey=`draft:${userId}:${kind}:${code}:${correction || 'new'}`
 const [asset,setAsset]=useState(null),[templates,setTemplates]=useState([]),[loading,setLoading]=useState(true)
 const [form,setForm]=useState({values:{},comments:{},photos:{},notes:'',date:localDate(),reason:'',request_id:crypto.randomUUID()})
 const [original,setOriginal]=useState(null),[previous,setPrevious]=useState(null),[error,setError]=useState(''),[saved,setSaved]=useState('')
 const [busy,setBusy]=useState(false),[result,setResult]=useState(null),[filter,setFilter]=useState('All'),[restored,setRestored]=useState(false),[review,setReview]=useState(false)
 const write=useRef(Promise.resolve()), active=useRef(false)
 const route=kind==='fe'?`/fe/checklist/${encodeURIComponent(code)}`:`/checklist/${encodeURIComponent(code)}`
 useEffect(()=>{
  let alive=true;active.current=false
  async function load() {
   setLoading(true);setError('');setResult(null);setReview(false)
   try {
    const fromReference=()=>{const c=kind==='fe'?lookupFeByCode(code):lookupByEquipId(code);return c?{asset:c.unit || c.equipment,templates:c.templates}:null}
    let record
    if(navigator.onLine) {
     try {
      const table=kind==='fe'?'fire_extinguishers':'equipment'
      const {data:a,error:e}=await db.from(table).select(kind==='fe'?'*,floor:fe_floors(building,floor_name)':'*,area:areas(area_name)').eq(kind==='fe'?'fe_code':'equip_id',code).single()
      if(e) throw e
      const {data:t,error:te}=await db.from(kind==='fe'?'fe_checklist_templates':'checklist_templates').select('*').eq(kind==='fe'?'fe_type':'equipment_id',kind==='fe'?a.fe_type:a.id).order('sort_order')
      if(te) throw te
      record={asset:a,templates:t,cachedAt:Date.now()}
      await localPut(`asset:${userId}:${kind}:${code}`,record)
      await rememberAsset(kind,record)
     } catch(e) {
      record=await localGet(`asset:${userId}:${kind}:${code}`)
      if(!record) record=fromReference()
      if(!record) throw e
     }
    } else record=await localGet(`asset:${userId}:${kind}:${code}`)
    if(!record) {
      const c=kind==='fe'?lookupFeByCode(code):lookupByEquipId(code)
      if(c) record={asset:c.unit || c.equipment,templates:c.templates}
    }
    if(!record) throw new Error('This checklist is not downloaded. Connect once and open it, or download equipment from Today.')
    let initial={values:{},comments:{},photos:{},notes:'',date:localDate(),reason:'',expiry:record.asset.expiry_date || '',request_id:crypto.randomUUID()}
    let orig=null, prev=null
    const ht=kind==='fe'?'fe_inspections':'inspection_headers',dt=kind==='fe'?'fe_inspection_details':'inspection_details'
    if(correction) {
      if(!navigator.onLine) {
        const cached=await localGet(`inspection:${userId}:${kind}:${correction}`)
        if(!cached) throw new Error('Open this inspection online once before correcting it offline.')
        orig=cached
      } else {
        const {data,error:e}=await db.from(ht).select(`*,details:${dt}(*)`).eq('id',correction).single()
        if(e) throw e
        orig=data
        await localPut(`inspection:${userId}:${kind}:${correction}`,orig)
      }
      if(orig[kind==='fe'?'fe_id':'equipment_id']!==record.asset.id) throw new Error('This correction does not belong to this equipment.')
      if(orig.technician_id!==profile?.id && !['Admin','Supervisor'].includes(profile?.role)) throw new Error('You can only correct your own inspection.')
      if(orig.template_snapshot) record.templates=orig.template_snapshot
      initial={...initial,values:Object.fromEntries(orig.details.map(d=>[d.parameter_name,d.value])),comments:Object.fromEntries(orig.details.map(d=>[d.parameter_name,d.comment || ''])),photos:Object.fromEntries(orig.details.filter(d=>d.evidence).map(d=>[d.parameter_name,d.evidence])),notes:orig.notes || orig.remarks || '',date:localDate(new Date(orig.inspection_date))}
    } else if(navigator.onLine) {
      const {data}=await db.from(ht).select(`id,inspection_date,status,details:${dt}(parameter_name,value)`).eq(kind==='fe'?'fe_id':'equipment_id',record.asset.id).order('inspection_date',{ascending:false}).limit(1)
      prev=data?.[0] || null
    }
    const draft=await localGet(draftKey)
    if(draft) {initial=draft.form;if(correction && draft.original){orig=draft.original;if(orig.template_snapshot)record.templates=orig.template_snapshot}}
    if(alive) {setAsset(record.asset);setTemplates(record.templates);setForm(initial);setOriginal(orig);setPrevious(prev);setRestored(!!draft);setSaved(draft?'Draft restored from this device':'');active.current=true}
   } catch(e) {if(alive)setError(e.message)}
   finally {if(alive)setLoading(false)}
  }
  if(userId && profile) load()
  return ()=>{alive=false;active.current=false}
 },[code,kind,correction,userId,profile,draftKey])
 useEffect(()=>{
  if(!active.current || !asset || result) return
  const entry={form,original,label:asset.equipment_name || asset.fe_code,route:route+(correction?`?correct=${correction}`:''),updatedAt:Date.now(),kind}
  setSaved('Saving draft…')
  write.current=write.current.catch(()=>{}).then(()=>localPut(draftKey,entry)).then(()=>setSaved('Saved on this device')).catch(e=>{setSaved('Draft could not be saved');setError(e.message)})
 },[form,asset,draftKey,result,correction,kind,route,original])
 useEffect(()=>{
   const warn=e=>{if(active.current && saved==='Saving draft…'){e.preventDefault();e.returnValue=''}}
   window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)
 },[saved])
 const set=(key,value)=>setForm(f=>({...f,[key]:value}))
 const answer=(name,value)=>setForm(f=>({...f,values:{...f.values,[name]:value}}))
 async function submit(e) {
  e.preventDefault();if(busy)return;setError('')
  const validation=validateAnswers(templates,form.values)
  if(validation) {setError(validation);setReview(false);return}
  if(correction && form.reason.trim().length<3) {setError('Enter a short correction reason.');return}
  if(!review) {setReview(true);return}
  setBusy(true)
  await write.current
  const payload={request_id:form.request_id,kind,asset_id:asset.id,inspection_id:correction || undefined,expected_revision:original?.revision,reason:form.reason,label:asset.equipment_name || asset.fe_code,location:asset.area?.area_name || asset.location_desc,draftKey,route,
    header:{notes:form.notes,observed_expiry_date:kind==='fe'?(form.expiry || null):undefined,expected_expiry_date:kind==='fe'?(asset.expiry_date || null):undefined,inspection_date:original?.inspection_date || new Date(`${form.date}T12:00:00`).toISOString()},
    details:templates.map(t=>({parameter_name:t.parameter_name,value:String(form.values[t.parameter_name]??''),computed_status:statusFor(t,form.values[t.parameter_name]),comment:form.comments[t.parameter_name] || '',evidence:form.photos[t.parameter_name] || null}))}
  const res=await submitInspection(payload)
  setBusy(false)
  if(res.success || res.queued) {active.current=false;setResult(res)} else setError(res.error)
 }
 if(loading) return <div className="screen"><div className="work-skeleton"/><p role="status">Opening checklist…</p></div>
 if(!asset) return <div className="screen"><p className="banner-danger" role="alert">{error}</p><Link to="/sync">Open Sync Centre</Link></div>
 if(result) return <div className="screen"><section className="work-success"><span className="success-symbol">✓</span><h1>{result.success?'Inspection received':'Saved on this device'}</h1><p>{result.correctionPending?'Your correction is awaiting supervisor approval. The signed entry remains unchanged.':result.needsAttention?'Your entry is safe on this device but needs attention before it can sync.':result.queued?'Open this app when connected to finish syncing.':'You can continue to the next equipment.'}</p><div className="work-actions"><button className="btn-primary" onClick={()=>navigate('/scan')}>Scan next equipment</button><Link className="btn-secondary" to={result.success?`/inspection/${kind}/${result.inspectionId}`:'/sync'}>{result.success?'View inspection':'View sync status'}</Link><Link to="/">Back to Today</Link></div></section></div>
 const answered=templates.filter(t=>form.values[t.parameter_name]!=='' && form.values[t.parameter_name]!=null).length
 const flagged=templates.filter(t=>isFlagged(statusFor(t,form.values[t.parameter_name]))).length
 const visible=templates.filter(t=>filter==='All'||(filter==='Unanswered'?!form.values[t.parameter_name]:isFlagged(statusFor(t,form.values[t.parameter_name]))))
 return <div className="screen inspection-workspace">
  <div className="work-topline"><button className="btn-secondary" onClick={()=>navigate(-1)}>← Back</button><span className="save-status" role="status">{saved} · {online?'Online':'Offline'}</span></div>
  <header className="work-heading"><span className="work-eyebrow">{correction?'CORRECT ENTRY':'INSPECTION'}</span><h1>{asset.equipment_name || asset.fe_code}</h1><p>{code} · {asset.area?.area_name || asset.location_desc || asset.floor?.floor_name}</p><Link to={`/asset/${kind}/${encodeURIComponent(code)}`}>Equipment history & details →</Link></header>
  {restored && <div className="work-notice">Your saved draft has been restored. Continue where you stopped.</div>}
  {!correction && previous && <div className="work-notice">Last inspected {new Date(previous.inspection_date).toLocaleString()}. <Link to={`${route}?correct=${previous.id}`}>Correct that entry</Link> or continue below to record a new inspection.</div>}
  {correction && <div className="work-notice">Correcting revision {original?.revision}. {['Signed','Completed'].includes(original?.status)?'The signed entry stays in place until a supervisor approves this correction.':'Changes will be recorded in history and submitted for sign-off.'}</div>}
  <div className="check-progress"><div><strong>{answered} / {templates.length} answered</strong><span>{flagged} flagged</span></div><progress value={answered} max={templates.length || 1}/></div>
  <form onSubmit={submit}>
   {!correction && <label className="work-field">Inspection date<input type="date" required max={localDate()} value={form.date} onChange={e=>set('date',e.target.value)}/></label>}
   {correction && <label className="work-field">Reason for correction <span>*</span><input required minLength={3} value={form.reason} placeholder="For example: typed 50 instead of 5.0" onChange={e=>set('reason',e.target.value)}/></label>}
   {!review && <div className="chip-row">{['All','Unanswered','Flagged'].map(f=><button type="button" className={`chip ${filter===f?'active':''}`} aria-pressed={filter===f} key={f} onClick={()=>setFilter(f)}>{f}</button>)}</div>}
   {(review?templates:visible).map((t,i)=>{
    const name=t.parameter_name,value=form.values[name]??'',status=statusFor(t,value),bad=isFlagged(status)
    const last=previous?.details?.find(d=>d.parameter_name===name)
    return <fieldset className={`check-card ${bad?'check-flagged':''}`} key={t.id || name}><legend><span className="check-number">{i+1}</span>{name}{t.required && ' *'}</legend><div className="check-meta">{t.unit && <strong>{t.unit}</strong>}{t.type==='numeric' && <span>Allowed: {t.min_value??'—'} to {t.max_value??'—'}</span>}<span className={`pill ${bad?'pill-danger':value!==''?'pill-ok':''}`}>{status}</span></div>
     {last && !correction && <p className="previous-reading">Previous: {last.value} {t.unit} · {new Date(previous.inspection_date).toLocaleDateString()}</p>}
     {review?<p className="review-value">{value || 'Not checked'} {t.unit}</p>:t.type==='numeric'?<input aria-label={name} inputMode="decimal" type="number" step="any" required={t.required} value={value} onChange={e=>answer(name,e.target.value)}/>:<div className="choices">{choices(t).map(o=><button type="button" key={o} aria-pressed={value===o} className={`ch ${value===o?'active':''} ${value===o&&bad?'fail':''}`} onClick={()=>answer(name,o)}>{o}</button>)}</div>}
     {(bad || form.comments[name] || form.photos[name]) && <div className="check-evidence">{review?<p>{form.comments[name]}</p>:<><label>Observation<textarea rows={2} value={form.comments[name] || ''} onChange={e=>setForm(f=>({...f,comments:{...f.comments,[name]:e.target.value}}))}/></label><label className="photo-control">Attach photo<input type="file" accept="image/*" capture="environment" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try {const data=await photoData(file);setForm(f=>({...f,photos:{...f.photos,[name]:data}}))}catch(err){setError(err.message)}}}/></label></>}{form.photos[name] && <><img className="evidence-photo" src={form.photos[name]} alt={`Observation for ${name}`}/>{!review&&<button type="button" className="btn-secondary" onClick={()=>setForm(f=>({...f,photos:{...f.photos,[name]:null}}))}>Remove photo</button>}</>}</div>}
    </fieldset>
   })}
   {kind==='fe' && <label className="work-field">Expiry date on the extinguisher<input type="date" value={form.expiry || ''} disabled={review} onChange={e=>set('expiry',e.target.value)}/><small>Recorded expiry: {asset.expiry_date || 'Not recorded'}. Verify the date against the label.</small></label>}
   <label className="work-field">Notes<textarea rows={3} value={form.notes} readOnly={review} onChange={e=>set('notes',e.target.value)} placeholder="Additional observations"/></label>
   {error && <div className="banner-danger" role="alert">{error}</div>}
   <div className="check-submit">{review && <button type="button" className="btn-secondary" onClick={()=>setReview(false)}>Edit answers</button>}<button type="submit" className="btn-primary" disabled={busy || !templates.length}>{busy?'Saving…':review?(correction?'Submit correction':'Confirm & submit'):'Review answers →'}</button></div>
  </form>
 </div>
}
