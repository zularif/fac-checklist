import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useOffline } from '../context/OfflineContext'
import { useAuth } from '../context/AuthContext'

const sections = [
  {
    label: 'Main',
    items: [
      { to: '/', icon: 'ti-checkbox', label: 'Today' },
      { to: '/scan', icon: 'ti-qrcode', label: 'Scan equipment' },
      { to: '/sync', icon: 'ti-cloud-upload', label: 'Sync Centre' },
      { to: '/signoff', icon: 'ti-signature', label: 'Review & approve', reviewerOnly: true },
      { to: '/dashboard', icon: 'ti-layout-dashboard', label: 'Tracker' },
      { to: '/parameter-chart', icon: 'ti-chart-line', label: 'Parameter chart' },
      { to: '/history', icon: 'ti-history', label: 'History' },
      { to: '/tasks', icon: 'ti-checklist', label: 'Tasks' },
      { to: '/fe', icon: 'ti-fire-extinguisher', label: 'Fire extinguishers' },
      { to: '/fe/list', icon: 'ti-list-details', label: 'FE list & expiry' },
      { to: '/fe/expiry', icon: 'ti-calendar-exclamation', label: 'FE renewal & vendor' },
    ],
  },
  {
    label: 'More',
    items: [
      { to: '/admin', icon: 'ti-settings', label: 'Admin' },
      { to: '/change-pin', icon: 'ti-key', label: 'Change my PIN' },
      { to: '/help', icon: 'ti-help-circle', label: 'Help & guide' },
    ],
  },
]

function initials(name) {
  if (!name) return 'U'
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}

export default function Header() {
  const { profile, logout } = useAuth()
  const { online, items, drafts } = useOffline()
  const pending = items.filter(x=>x.state !== 'synced').length
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('facility_sidebar_collapsed') === '1' } catch { return false }
  })
  const navigate = useNavigate()
  const isAdmin = profile?.role === 'Admin'

  useEffect(() => {
    try { localStorage.setItem('facility_sidebar_collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
    document.body.classList.toggle('sidebar-collapsed', collapsed)
  }, [collapsed])

  async function handleSignOut() {
    if ((pending || drafts.length) && !window.confirm(`You have ${drafts.length} draft(s) and ${pending} pending upload(s). They stay on this device for your account. Sign out?`)) return
    await logout()
    navigate('/login')
  }

  function renderItems(onNavigate) {
    return sections.map((sec) => {
      const items = sec.items.filter((item) => (!item.adminOnly || isAdmin) && (!item.reviewerOnly || ['Admin','Supervisor'].includes(profile?.role)))
      if (!items.length) return null
      return (
        <div key={sec.label}>
          <p className="nav-sec">{sec.label}</p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => 'nav-it' + (isActive ? ' active' : '')}
              onClick={onNavigate}
              title={item.label}
            >
              <i className={'ti ' + item.icon} aria-hidden="true" />
              <span className="nav-text">{item.label}</span>
            </NavLink>
          ))}
        </div>
      )
    })
  }

  return (
    <>
      <NavLink to="/sync" className={`connection-strip ${!online?'is-offline':''}`} aria-live="polite">{!online?'Offline — saved work stays on this device':pending?`${pending} upload(s) pending · View status`:'Online · Open Sync Centre'}</NavLink>
      <nav className="work-bottom-nav" aria-label="Quick navigation">{[['/','Today'],['/scan','Scan QR'],['/sync','Sync'],['/history','History']].map(([to,label])=><NavLink key={to} to={to} end>{label}{to==='/sync'&&pending>0&&<span>{pending}</span>}</NavLink>)}</nav>
      {/* ---------- mobile / tablet top bar ---------- */}
      <header className="top-header">
        <button className="burger" aria-label="Open menu" onClick={() => setOpen(true)}>
          <span className="burger-lines" aria-hidden="true"><span /><span /><span /></span>
        </button>
        <div className="brand">
          <i className="ti ti-device-desktop-analytics" style={{ fontSize: 18 }} aria-hidden="true" />
          <span>Facility Maintenance</span>
        </div>
        <div className="avatar">{initials(profile?.name)}</div>
      </header>

      {/* ---------- mobile drawer ---------- */}
      {open && (
        <>
          <div className="drawer-overlay" onClick={() => setOpen(false)} />
          <nav className="drawer">
            <div className="drawer-head">
              <span style={{ fontSize: 13, fontWeight: 500 }}>Menu</span>
              <button className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <i className="ti ti-x" style={{ fontSize: 18 }} aria-hidden="true" />
              </button>
            </div>

            <div className="drawer-user">
              <p className="n">{profile?.name || 'User'}</p>
              <p className="r">{profile?.role || 'Technician'}</p>
            </div>

            {renderItems(() => setOpen(false))}

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 8 }}>
              <button className="nav-it" onClick={handleSignOut}>
                <i className="ti ti-logout" aria-hidden="true" />
                <span className="nav-text">Sign out</span>
              </button>
            </div>
          </nav>
        </>
      )}

      {/* ---------- desktop sidebar ---------- */}
      <aside className={'side-nav' + (collapsed ? ' collapsed' : '')}>
        <div className="side-brand">
          <div className="side-logo"><i className="ti ti-device-desktop-analytics" aria-hidden="true" /></div>
          <span className="nav-text side-title">Facility Maintenance</span>
          <button
            className="side-collapse"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <i className={collapsed ? 'ti ti-chevron-right' : 'ti ti-chevron-left'} aria-hidden="true" />
          </button>
        </div>

        <div className="side-user">
          <div className="avatar">{initials(profile?.name)}</div>
          <div className="nav-text">
            <p className="n">{profile?.name || 'User'}</p>
            <p className="r">{profile?.role || 'Technician'}</p>
          </div>
        </div>

        <div className="side-scroll">{renderItems()}</div>

        <div className="side-foot">
          <button className="nav-it" onClick={handleSignOut} title="Sign out">
            <i className="ti ti-logout" aria-hidden="true" />
            <span className="nav-text">Sign out</span>
          </button>
        </div>
      </aside>
    </>
  )
}
