import { useNavigate } from 'react-router-dom'
import { useIsAdmin } from '../lib/useIsAdmin'

// Grouped admin tools. `admin: true` items only show to administrators.
const GROUPS = [
  {
    title: 'Equipment & checklists',
    items: [
      { to: '/admin/equipment', icon: 'ti-tools', label: 'Equipment manager', desc: 'Add, edit, retire, or delete equipment and edit checklists', admin: true },
    ],
  },
  {
    title: 'Labels',
    items: [
      { to: '/admin/qr-labels', icon: 'ti-qrcode', label: 'Equipment QR labels', desc: 'Print equipment QR labels by area' },
      { to: '/fe/qr-labels', icon: 'ti-qrcode', label: 'FE QR labels', desc: 'Print fire-extinguisher labels' },
    ],
  },
  {
    title: 'Reports',
    items: [
      { to: '/admin/reports', icon: 'ti-file-text', label: 'Inspection report', desc: 'PDF/CSV with supervisor e-signature' },
      { to: '/fe/report', icon: 'ti-fire-extinguisher', label: 'FE report', desc: 'Monthly fire-extinguisher checklist' },
      { to: '/signoff', icon: 'ti-signature', label: 'Sign-off', desc: 'Review and approve inspections' },
    ],
  },
  {
    title: 'Fire extinguishers',
    items: [
      { to: '/fe/admin', icon: 'ti-settings', label: 'FE admin', desc: 'Floors, floor-plan images, CSV import', admin: true },
      { to: '/fe/expiry', icon: 'ti-calendar-exclamation', label: 'FE renewal & vendor', desc: 'Expiry summary, vendor email, batch renewal' },
    ],
  },
  {
    title: 'People & account',
    items: [
      { to: '/staff', icon: 'ti-users', label: 'Manage staff', desc: 'Add, edit roles, reset PINs, deactivate', admin: true },
      { to: '/change-pin', icon: 'ti-key', label: 'Change my PIN', desc: 'Update your own 4-digit PIN' },
      { to: '/help', icon: 'ti-help-circle', label: 'Help & guide', desc: 'How to use the app' },
    ],
  },
]

export default function Admin() {
  const navigate = useNavigate()
  const isAdmin = useIsAdmin()

  return (
    <div className="screen">
      <p className="page-title">Admin</p>
      <p className="page-sub">Everything for managing the system in one place.</p>

      {GROUPS.map((group) => {
        const items = group.items.filter((it) => !it.admin || isAdmin)
        if (items.length === 0) return null
        return (
          <div key={group.title} style={{ marginBottom: 18 }}>
            <p className="section-label">{group.title}</p>
            <div className="admin-hub-grid">
              {items.map((it) => (
                <button className="admin-hub-card" key={it.to} onClick={() => navigate(it.to)}>
                  <div className="eq-ic"><i className={'ti ' + it.icon} aria-hidden="true" /></div>
                  <div className="eq-body">
                    <p className="eq-t">{it.label}</p>
                    <p className="eq-s">{it.desc}</p>
                  </div>
                  <i className="ti ti-chevron-right" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {!isAdmin && (
        <p className="page-sub" style={{ marginTop: 4 }}>Some tools are available to administrators only.</p>
      )}
    </div>
  )
}
