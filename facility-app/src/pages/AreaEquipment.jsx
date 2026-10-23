import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cachedArea } from '../lib/offlineCache'
import { db } from '../lib/db'

const categoryIcon = (cat) => (cat === 'ACMV' ? 'ti-air-conditioning' : 'ti-bolt')

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export default function AreaEquipment() {
  const { areaId } = useParams()
  const navigate = useNavigate()
  const [area, setArea] = useState(null)
  const [equipment, setEquipment] = useState([])
  const [doneToday, setDoneToday] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      if(!navigator.onLine){const c=cachedArea(areaId);setArea(c?{id:areaId,area_name:c.areaName}:null);setEquipment(c?.equipment || []);setLoading(false);return}
      const { data: ar } = await db
        .from('areas')
        .select('id, area_name, plant:plants(plant_name)')
        .eq('id', areaId)
        .single()
      setArea(ar || null)

      const { data: eq } = await db
        .from('equipment')
        .select('id, equip_id, equipment_name, category, inspection_cycle')
        .eq('area_id', areaId)
        .eq('status', 'Active')
        .order('equip_id')
      setEquipment(eq || [])

      const equipIds = (eq || []).map((e) => e.id)
      if (equipIds.length) {
        const { data: done } = await db
          .from('inspection_headers')
          .select('equipment_id')
          .in('equipment_id', equipIds)
          .gte('inspection_date', startOfToday())
        setDoneToday(new Set((done || []).map((d) => d.equipment_id)))
      }
      setLoading(false)
    }
    load()
  }, [areaId])

  if (loading) return <div className="screen"><p className="center-msg">Loading…</p></div>
  if (!area) return <div className="screen"><p className="center-msg">Area not found.</p></div>

  return (
    <div className="screen">
      <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px', marginBottom: 12 }} onClick={() => navigate(-1)}>
        <i className="ti ti-arrow-left" aria-hidden="true" />Back
      </button>
      <p className="page-title">{area.area_name}</p>
      <p className="page-sub">{area.plant?.plant_name} · {equipment.length} equipment</p>

      {!navigator.onLine && <p className="work-notice">Downloaded equipment. Completion status requires a connection.</p>}
      {equipment.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No active equipment in this area.</div>
      ) : (
        equipment.map((e) => {
          const done = doneToday.has(e.id)
          return (
            <button className="eq-card" key={e.id} onClick={() => navigate(`/checklist/${e.equip_id}`)}>
              <div className="eq-ic"><i className={'ti ' + categoryIcon(e.category)} aria-hidden="true" /></div>
              <div className="eq-body">
                <p className="eq-t">{e.equipment_name}</p>
                <p className="eq-s">{e.equip_id} · {e.inspection_cycle}</p>
              </div>
              <span className={'pill ' + (done ? 'pill-ok' : 'pill-warn')}>{done ? 'Submitted' : 'Inspect'}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
