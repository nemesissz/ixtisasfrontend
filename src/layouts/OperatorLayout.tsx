import { NavLink, Outlet, useLocation, useNavigate, Navigate } from 'react-router-dom'

const NAV = [
  { section: 'Əsas' },
  { to: '/operator/dashboard', icon: '🛠️', label: 'İdarə paneli' },
]

const PAGE_META: Record<string, { title: string; sub: string }> = {
  '/operator/dashboard': { title: 'Aktiv Seçim', sub: 'Təhsil alan seçim statusları' },
}

export default function OperatorLayout() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // Session yoxla
  const sessionRaw = sessionStorage.getItem('operator_session')
  const session    = sessionRaw ? JSON.parse(sessionRaw) : null
  if (!session) return <Navigate to="/operator/login" replace />

  const meta = PAGE_META[pathname] ?? { title: 'Operator', sub: '' }

  function handleLogout() {
    sessionStorage.removeItem('operator_session')
    navigate('/')
  }

  return (
    <div className="admin-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        {/* Logo */}
        <div className="sidebar-logo">
          <div style={{
            width: 44, height: 44, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src="/mmu-logo.png" alt="MMU" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div className="sidebar-logo-title">İxtisas Seçim Proqramı</div>
            <div className="sidebar-logo-sub">Operator Panel</div>
          </div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, paddingTop: 8 }}>
          {NAV.map((item, i) => {
            if ('section' in item) {
              return <div key={i} className="nav-section">{item.section}</div>
            }
            const isActive = pathname === item.to
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={() => `nav-item${isActive ? ' active' : ''}`}
                style={isActive ? { background: '#00b96b18', color: '#00b96b', borderColor: '#00b96b' } : {}}
              >
                <span className="nav-icon">{item.icon}</span>
                {item.label}
              </NavLink>
            )
          })}
        </div>

        {/* Alt hissə — operator məlumatı + çıxış */}
        <div className="sidebar-bottom">
          <div className="admin-info">
            <div className="admin-avatar" style={{
              background: 'linear-gradient(135deg,#00b96b,#007a47)',
              fontSize: 14,
            }}>🛠️</div>
            <div style={{ flex: 1 }}>
              <div className="admin-name">{session.name}</div>
              <div className="admin-role" style={{ color: '#00b96b' }}>@{session.username}</div>
            </div>
            <button
              onClick={handleLogout}
              title="Çıxış"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 16, padding: '4px 6px', borderRadius: 6,
                color: 'var(--muted)', transition: 'color .15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ff4d4f')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
            >⏻</button>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="admin-content">
        <header className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 4, height: 28, borderRadius: 4,
              background: 'linear-gradient(180deg,#00b96b,#007a47)',
              flexShrink: 0,
            }} />
            <div>
              <div className="topbar-title">{meta.title}</div>
              <div className="topbar-sub">{meta.sub}</div>
            </div>
          </div>
        </header>

        <div className="page-body">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
