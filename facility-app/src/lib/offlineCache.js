import { db } from './db'
import { localGet, localPut } from './localStore'
let owner=null
let cache={equipment:{},fe:{},areas:{},meta:null}
const empty=()=>({equipment:{},fe:{},areas:{},meta:null})
export async function prepareCache(userId){
 owner=userId;cache=empty()
 if(userId){const value=await localGet(`reference:${userId}`);if(owner===userId)cache=value || empty()}
}
async function persist(next,user=owner){
 if(!user || user!==owner)throw new Error('Account changed. Download again after signing in.')
 await localPut(`reference:${user}`,next)
 if(owner===user)cache=next
}
export const isAreaCached=id=>!!cache.areas[id]
export const areaCachedAt=id=>cache.areas[id]?.cachedAt || null
export const allCacheInfo=()=>cache.meta
export const cachedArea=id=>cache.areas[id] || null
export const lookupByEquipId=id=>Object.values(cache.equipment).find(x=>x.equipment.equip_id===id) || null
export const lookupByQr=qr=>Object.values(cache.equipment).find(x=>x.equipment.qr_code===qr || x.equipment.equip_id===qr) || null
export const lookupFeByCode=code=>Object.values(cache.fe).find(x=>x.unit.fe_code===code) || null
export const lookupFeByQr=qr=>Object.values(cache.fe).find(x=>x.unit.qr_code===qr || x.unit.fe_code===qr) || null
export const isOnline=()=>navigator.onLine
export async function fetchAllRows(table,select,extra=q=>q){
 const rows=[]
 for(let from=0;;from+=500){
  const {data,error}=await extra(db.from(table).select(select).order('id').range(from,from+499))
  if(error)throw error
  rows.push(...data)
  if(data.length<500)return rows
 }
}
export async function cacheArea(areaId,areaName){
 const user=owner
 const eq=await fetchAllRows('equipment','*,area:areas(area_name)',q=>q.eq('area_id',areaId).eq('status','Active'))
 const templates=[]
 for(let start=0;start<eq.length;start+=100)templates.push(...await fetchAllRows('checklist_templates','*',q=>q.in('equipment_id',eq.slice(start,start+100).map(e=>e.id))))
 const next=structuredClone(cache)
 for(const [id,x] of Object.entries(next.equipment))if(x.equipment.area_id===areaId)delete next.equipment[id]
 for(const e of eq)next.equipment[e.id]={equipment:e,templates:templates.filter(t=>t.equipment_id===e.id).sort((a,b)=>a.sort_order-b.sort_order)}
 next.areas[areaId]={areaId,areaName,cachedAt:Date.now(),equipment:eq}
 next.meta=null
 await persist(next,user)
 return {equipmentCount:eq.length}
}
export async function removeAreaCache(areaId){
 const next=structuredClone(cache)
 for(const [id,x] of Object.entries(next.equipment))if(x.equipment.area_id===areaId)delete next.equipment[id]
 delete next.areas[areaId];next.meta=null
 await persist(next)
 return true
}
export async function cacheEverything(onProgress=()=>{}){
 const user=owner,next=empty()
 onProgress('Downloading equipment…')
 const eq=await fetchAllRows('equipment','*,area:areas(area_name)',q=>q.eq('status','Active'))
 onProgress('Downloading checklists…')
 const templates=await fetchAllRows('checklist_templates','*')
 for(const e of eq){
  next.equipment[e.id]={equipment:e,templates:templates.filter(t=>t.equipment_id===e.id).sort((a,b)=>a.sort_order-b.sort_order)}
  const area=next.areas[e.area_id] ||= {areaId:e.area_id,areaName:e.area?.area_name,cachedAt:Date.now(),equipment:[]}
  area.equipment.push(e)
 }
 onProgress('Downloading extinguishers…')
 const fe=await fetchAllRows('fire_extinguishers','*,floor:fe_floors(building,floor_name)',q=>q.eq('status','Active'))
 const ft=await fetchAllRows('fe_checklist_templates','*')
 for(const unit of fe)next.fe[unit.id]={unit,templates:ft.filter(t=>t.fe_type===unit.fe_type).sort((a,b)=>a.sort_order-b.sort_order)}
 next.meta={cachedAt:Date.now(),equipmentCount:eq.length,feCount:fe.length}
 onProgress('Saving on this device…')
 await persist(next,user)
 onProgress('Done')
 return next.meta
}

export async function rememberAsset(kind,record){
 const next=structuredClone(cache)
 if(kind==='fe')next.fe[record.asset.id]={unit:record.asset,templates:record.templates}
 else next.equipment[record.asset.id]={equipment:record.asset,templates:record.templates}
 await persist(next)
}
