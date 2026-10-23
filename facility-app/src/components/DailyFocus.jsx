import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { db } from '../lib/db'
import { useAuth } from '../context/AuthContext'
import { useOffline } from '../context/OfflineContext'
import { localDate } from '../lib/inspectionModel'
export default function DailyFocus(){
 const {profile}=useAuth(),{drafts,items,online}=useOffline(),[tasks,setTasks]=useState([]),[returned,setReturned]=useState([]),[error,setError]=useState('')
 useEffect(()=>{if(!profile?.id || !navigator.onLine)return;let alive=true;async function load(){
  const [t,r,f]=await Promise.all([db.from('tasks').select('*').eq('completed',false).eq('assigned_to',profile.id).order('due_date').limit(200),db.from('inspection_headers').select('id,status,equipment:equipment(equipment_name)').eq('technician_id',profile.id).eq('status','Returned'),db.from('fe_inspections').select('id,status,asset:fire_extinguishers(fe_code)').eq('technician_id',profile.id).eq('status','Returned')])
  if(alive){if(t.error||r.error||f.error)setError('Some personal work could not be loaded.');setTasks((t.data || []));setReturned([...(r.data || []).map(x=>({...x,kind:'equipment',label:x.equipment?.equipment_name})),...(f.data || []).map(x=>({...x,kind:'fe',label:x.asset?.fe_code}))])}
 }load();return()=>{alive=false}},[profile?.id])
 const pending=items.filter(x=>x.state!=='synced').length
 return <section className="daily-focus"><div className="work-section-head"><h2>Pick up where you left off</h2><Link to="/sync">Sync Centre →</Link></div><div className="focus-grid"><Link to="/sync" className="focus-tile"><span>Saved drafts</span><strong>{drafts.length}</strong><small>Continue an unfinished inspection →</small></Link><Link to="/sync" className="focus-tile"><span>Pending sync</span><strong>{pending}</strong><small>{pending?'Open to check delivery':'All local submissions sent'} →</small></Link><Link to="/tasks" className="focus-tile"><span>My open tasks</span><strong>{online?tasks.length:'—'}</strong><small>{!online?'Connect to refresh tasks':tasks.filter(t=>t.due_date && t.due_date<localDate()).length + ' overdue'} →</small></Link>{['Admin','Supervisor'].includes(profile?.role)&&<Link to="/signoff" className="focus-tile focus-review"><span>Supervisor</span><strong>Review</strong><small>Approvals & corrections →</small></Link>}</div>
 {error&&<p role="status">{error}</p>}{drafts.slice(0,3).map(d=><Link className="work-list-item" to={d.route} key={d.localKey}><strong>{d.label}</strong><span>Resume draft →</span></Link>)}{returned.map(r=><Link className="work-list-item attention" key={r.id} to={`/inspection/${r.kind}/${r.id}`}><strong>{r.label}</strong><span>Returned — review feedback →</span></Link>)}
 </section>
}
