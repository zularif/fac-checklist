import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'
export default function SignOff(){
 const {inspectionId}=useParams(),{profile}=useAuth(),[rows,setRows]=useState([]),[error,setError]=useState(''),[filter,setFilter]=useState('All'),[loading,setLoading]=useState(true)
 useEffect(()=>{async function load(){try{
  const [eq,fe,cor]=await Promise.all([
   db.from('inspection_headers').select('id,status,inspection_date,asset:equipment(equipment_name),details:inspection_details(computed_status)').eq('status','Pending Sign-off').order('inspection_date').limit(200),
   db.from('fe_inspections').select('id,status,inspection_date,asset:fire_extinguishers(fe_code),details:fe_inspection_details(computed_status)').eq('status','Pending Sign-off').order('inspection_date').limit(200),
   db.from('inspection_corrections').select('id,kind,inspection_id,requested_at,payload').eq('status','Pending').order('requested_at').limit(200),
  ]);for(const r of [eq,fe,cor])if(r.error)throw r.error
  setRows([...eq.data.map(r=>({...r,kind:'equipment'})),...fe.data.map(r=>({...r,kind:'fe'})),...cor.data.map(c=>({id:c.inspection_id,kind:c.kind,inspection_date:c.requested_at,asset:{equipment_name:c.payload.label},correction:true}))])
 }catch(e){setError(e.message)}finally{setLoading(false)}}load()},[])
 if(inspectionId)return <Navigate replace to={`/inspection/equipment/${inspectionId}`}/>
 if(!['Admin','Supervisor'].includes(profile?.role))return <div className="screen"><p>Supervisor access is required for approvals.</p><Link to="/history">View inspection history</Link></div>
 const visible=rows.filter(r=>filter==='All'||(filter==='Corrections'?r.correction:!r.correction))
 return <div className="screen"><header className="work-heading"><span className="work-eyebrow">SUPERVISOR WORKSPACE</span><h1>Review & approve</h1><p>Review readings and evidence before signing. Oldest entries appear first within each inspection group.</p></header><div className="chip-row">{['All','Inspections','Corrections'].map(f=><button key={f} className={`chip ${filter===f?'active':''}`} onClick={()=>setFilter(f)}>{f}</button>)}</div>{error&&<p role="alert" className="banner-danger">{error}</p>}{loading?<p>Loading reviews…</p>:!visible.length?<p className="work-empty">No pending reviews in this view.</p>:visible.map(r=><Link key={`${r.kind}:${r.id}`} className="work-list-item" to={`/inspection/${r.kind}/${r.id}`}><div><strong>{r.asset?.equipment_name || r.asset?.fe_code}</strong><p>{new Date(r.inspection_date).toLocaleString()} · {r.kind==='fe'?'Fire extinguisher':'Equipment'}</p></div><span className="pill pill-warn">{r.correction?'Correction':'Review'} →</span></Link>)}{rows.length>=200&&<p>Showing up to 200 entries per group. Review these to bring older pending work forward.</p>}</div>
}
