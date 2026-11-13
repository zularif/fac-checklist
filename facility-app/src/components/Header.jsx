import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useOffline } from '../context/OfflineContext'
import { useAuth } from '../context/AuthContext'

// Menu tree. Top items are always shown; each group opens and closes.
// adminOnly / reviewerOnly items are hidden from other roles; a group with no
// visible items is hidden.
const TOP = [
  { to: '/', icon: 'ti-checkbox', label: 'Today' },
  { to: '/scan', icon: 'ti-qrcode', label: 'Scan equipment' },
  { to: '/sync', icon: 'ti-cloud-upload', label: 'Sync Centre' },
]
const GROUPS = [
  { id: 'insp', icon: 'ti-clipboard-check', label: 'Inspections', items: [
    { to: '/dashboard', icon: 'ti-layout-dashboard', label: 'Tracker' },
    { to: '/history', icon: 'ti-history', label: 'History' },
    { to: '/parameter-chart', icon: 'ti-chart-line', label: 'Parameter chart' },
    { to: '/signoff', icon: 'ti-signature', label: 'Review & approve', reviewerOnly: true },
  ] },
  { id: 'tasks', icon: 'ti-checklist', label: 'Tasks', items: [
    { to: '/tasks', icon: 'ti-list-check', label: 'Task list' },
    { to: '/tasks/stages', icon: 'ti-adjustments-horizontal', label: 'Task stages', adminOnly: true },
  ] },
  { id: 'parts', icon: 'ti-package', label: 'Spare Parts', items: [
    { to: '/parts/dashboard', icon: 'ti-chart-bar', label: 'Dashboard' },
    { to: '/parts', icon: 'ti-list-details', label: 'Parts list' },
    { to: '/parts?view=Low+stock', icon: 'ti-alert-triangle', label: 'Low stock' },
    { to: '/parts/count', icon: 'ti-clipboard-check', label: 'Stock count', adminOnly: true },
    { to: '/parts/import', icon: 'ti-file-import', label: 'Import parts', adminOnly: true },
    { to: '/parts/photos', icon: 'ti-photo-plus', label: 'Import photos', adminOnly: true },
    { to: '/parts/labels', icon: 'ti-qrcode', label: 'QR labels', adminOnly: true },
  ] },
  { id: 'fire', icon: 'ti-flame', label: 'Fire Safety', items: [
    { to: '/fe', icon: 'ti-map-pin', label: 'FE map' },
    { to: '/fe/list', icon: 'ti-fire-extinguisher', label: 'FE list & expiry' },
    { to: '/fe/expiry', icon: 'ti-calendar-exclamation', label: 'FE renewal & vendor', also: ['/fe/expiry-bulk'] },
    { to: '/fe/report', icon: 'ti-report', label: 'FE report' },
    { to: '/fe/qr-labels', icon: 'ti-qrcode', label: 'FE QR labels', adminOnly: true },
    { to: '/fe/admin', icon: 'ti-map-2', label: 'FE map setup', adminOnly: true },
    // A separate standalone page (public/fire-alarm-sim.html), opened with a normal link.
    { href: '/fire-alarm-sim.html', icon: 'ti-alarm-smoke', label: 'Fire Alarm Simulator' },
  ] },
  { id: 'permit', icon: 'ti-file-certificate', label: 'Vendor Permit', items: [
    // A separate standalone page (public/vendor-permit.html). Vendors can open the same link directly; files go to Google Drive.
    { to: '/permits', icon: 'ti-inbox', label: 'Received applications' },
    { href: '/vendor-permit.html', icon: 'ti-file-certificate', label: 'Vendor application form' },
  ] },
  { id: 'admin', icon: 'ti-settings', label: 'Admin', items: [
    { to: '/admin', icon: 'ti-home-cog', label: 'Admin home', adminOnly: true },
    { to: '/admin/areas', icon: 'ti-building', label: 'Areas', adminOnly: true },
    { to: '/admin/equipment', icon: 'ti-tool', label: 'Equipment', adminOnly: true },
    { to: '/staff', icon: 'ti-users', label: 'Staff', adminOnly: true },
    { to: '/admin/reports', icon: 'ti-file-analytics', label: 'Reports', adminOnly: true },
    { to: '/admin/qr-labels', icon: 'ti-qrcode', label: 'QR labels', adminOnly: true },
    { to: '/admin/database', icon: 'ti-database', label: 'Database update', adminOnly: true },
  ] },
  { id: 'me', icon: 'ti-user-circle', label: 'Me', items: [
    { to: '/change-pin', icon: 'ti-key', label: 'Change my PIN' },
    { to: '/help', icon: 'ti-help-circle', label: 'Help & guide' },
  ] },
]
const ALL_ITEMS = [...TOP, ...GROUPS.flatMap((g) => g.items)].filter((i) => i.to)

// The one menu item that matches the current page best (longest path; a ?view=
// item only matches that view), so a parent never lights up with its child.
function activeTo(pathname, search) {
  let best = null, score = -1
  for (const it of ALL_ITEMS) {
    const [path, query] = it.to.split('?')
    const hit = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/') || (it.also || []).includes(pathname)
    if (!hit) continue
    const q = new URLSearchParams(query || '')
    const cur = new URLSearchParams(search)
    if (query && [...q].some(([k, v]) => cur.get(k) !== v)) continue
    if (!query && pathname === path && cur.get('view') && ALL_ITEMS.some((o) => o.to.startsWith(path + '?view=' + encodeURIComponent(cur.get('view')).replace(/%20/g, '+')))) continue
    const sc = ((it.also || []).includes(pathname) ? pathname.length : path.length) * 2 + (query ? 1 : 0)
    if (sc > score) { score = sc; best = it.to }
  }
  return best
}

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
  const location = useLocation()
  const isAdmin = profile?.role === 'Admin'
  const isReviewer = ['Admin', 'Supervisor'].includes(profile?.role)
  const current = activeTo(location.pathname, location.search)
  const [openGroups, setOpenGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('facility_nav_open') || '[]')) } catch { return new Set() }
  })
  const [fly, setFly] = useState(null) // collapsed sidebar: { id, top }
  const flyRef = useRef(null)

  const visible = (item) => (!item.adminOnly || isAdmin) && (!item.reviewerOnly || isReviewer)
  const groups = GROUPS.map((g) => ({ ...g, items: g.items.filter(visible) })).filter((g) => g.items.length)
  const currentGroup = groups.find((g) => g.items.some((i) => i.to === current))?.id

  // the group holding the page you are on opens by itself
  useEffect(() => {
    if (currentGroup) setOpenGroups((s) => (s.has(currentGroup) ? s : new Set(s).add(currentGroup)))
  }, [currentGroup])
  useEffect(() => { setFly(null) }, [location.pathname, location.search])
  useEffect(() => {
    try { localStorage.setItem('facility_nav_open', JSON.stringify([...openGroups])) } catch { /* ignore */ }
  }, [openGroups])
  useEffect(() => {
    if (!fly) return
    const close = (e) => { if (!flyRef.current?.contains(e.target) && !e.target.closest?.('.nav-grp')) setFly(null) }
    const esc = (e) => { if (e.key === 'Escape') setFly(null) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [fly])
  useEffect(() => { if (!collapsed) setFly(null) }, [collapsed])

  function toggleGroup(id) {
    setOpenGroups((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  useEffect(() => {
    try { localStorage.setItem('facility_sidebar_collapsed', collapsed ? '1' : '0') } catch { /* ignore */ }
    document.body.classList.toggle('sidebar-collapsed', collapsed)
  }, [collapsed])

  async function handleSignOut() {
    if ((pending || drafts.length) && !window.confirm(`You have ${drafts.length} draft(s) and ${pending} pending upload(s). They stay on this device for your account. Sign out?`)) return
    await logout()
    navigate('/login')
  }

  function renderLink(item, onNavigate, sub) {
    const cls = 'nav-it' + (sub ? ' nav-sub-it' : '')
    const inner = <><i className={'ti ' + item.icon} aria-hidden="true" /><span className="nav-text">{item.label}</span></>
    if (item.href) return <a key={item.href} href={item.href} className={cls} onClick={onNavigate} title={item.label}>{inner}</a>
    const active = item.to === current
    return (
      <Link key={item.to} to={item.to} className={cls + (active ? ' active' : '')} aria-current={active ? 'page' : undefined} onClick={onNavigate} title={item.label}>
        {inner}
      </Link>
    )
  }

  // inSidebar: when the sidebar is collapsed, a group opens as a flyout list
  function renderItems(onNavigate, inSidebar) {
    const asFly = inSidebar && collapsed
    return (
      <>
        <p className="nav-sec">Main</p>
        {TOP.map((item) => renderLink(item, onNavigate))}
        <p className="nav-sec">Menu</p>
        {groups.map((g) => {
          const isOpen = asFly ? fly?.id === g.id : openGroups.has(g.id)
          const hasActive = g.id === currentGroup
          return (
            <div key={g.id} className={'nav-group' + (isOpen ? ' open' : '')}>
              <button
                type="button"
                className={'nav-it nav-grp' + (hasActive && (asFly || !isOpen) ? ' has-active' : '')}
                aria-expanded={isOpen}
                title={g.label}
                onClick={(e) => {
                  if (asFly) { const r = e.currentTarget.getBoundingClientRect(); setFly(fly?.id === g.id ? null : { id: g.id, top: r.top }) }
                  else toggleGroup(g.id)
                }}
              >
                <i className={'ti ' + g.icon} aria-hidden="true" />
                <span className="nav-text">{g.label}</span>
                <i className="ti ti-chevron-down nav-chev nav-text" aria-hidden="true" />
              </button>
              {isOpen && !asFly && <div className="nav-sub">{g.items.map((item) => renderLink(item, onNavigate, true))}</div>}
              {isOpen && asFly && (
                <div className="nav-fly" ref={flyRef} style={{ top: Math.min(fly.top, window.innerHeight - 56 - g.items.length * 42) }} role="menu">
                  <p className="nav-fly-title">{g.label}</p>
                  {g.items.map((item) => renderLink(item, () => setFly(null), true))}
                </div>
              )}
            </div>
          )
        })}
      </>
    )
  }

  return (
    <>
      <NavLink to="/sync" className={`connection-strip ${!online?'is-offline':pending?'is-pending':'is-ok'}`} aria-live="polite">{!online?'Offline — saved work stays on this device':pending?`${pending} upload(s) pending · View status`:<><span className="conn-dot" aria-hidden="true" />Online · all work sent</>}</NavLink>
      <nav className="work-bottom-nav" aria-label="Quick navigation">{[['/','Today','ti-checkbox'],['/scan','Scan','ti-qrcode'],['/sync','Sync','ti-cloud-upload'],['/history','History','ti-history']].map(([to,label,icon])=><NavLink key={to} to={to} end className={to==='/scan'?'nav-scan':undefined}><i className={`ti ${icon}`} aria-hidden="true" /><b>{label}</b>{to==='/sync'&&pending>0&&<span>{pending}</span>}</NavLink>)}</nav>
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

        <div className="side-scroll">{renderItems(undefined, true)}</div>

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
