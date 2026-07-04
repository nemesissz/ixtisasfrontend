import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { userDb, selectionDb, addLog } from '../db'
import { TopbarProvider, useTopbar } from '../contexts/TopbarContext'
import { PATH_PERM, hasPerm, pathAllowed } from '../permissions'

const NAV = [
  { section: 'Əsas' },
  { to: '/admin/dashboard',    icon: '📊', label: 'Statistika və analitika' },
  { section: 'İdarəetmə' },
  { to: '/admin/users',        icon: '👥', label: 'Təhsilalanlar' },
  { to: '/admin/specialties',  icon: '🎓', label: 'Müəssisə/İxtisaslar' },
  { to: '/admin/selections',   icon: '🗳',  label: 'Seçimlər' },
  { to: '/admin/distribution', icon: '⚖️', label: 'Yerləşdirmə', badge: () => (userDb.getAll() as any[]).filter((u:any) => !u.institution).length || undefined },
  { to: '/admin/redistribute', icon: '🔧', label: 'Qismən Yerləşdirmə' },
  { to: '/admin/results',      icon: '📋', label: 'Nəticələr' },
  { section: 'Sistem' },
  { to: '/admin/archive',      icon: '🗄️', label: 'Arxiv',      badge: () => selectionDb.getArchived().length || undefined },
  { to: '/admin/logs',         icon: '📋', label: 'Loglar' },
  { to: '/admin/admins',       icon: '🔐', label: 'Adminlər' },
]

const PAGE_META: Record<string, { title: string; sub: string }> = {
  '/admin/dashboard':   { title: 'Statistika və analitika', sub: 'Ümumi baxış' },
  '/admin/selections':  { title: 'Seçimlər',             sub: 'Seçim sessiyaları' },
  '/admin/selections/new': { title: 'Yeni Seçim',        sub: 'Seçim yarat' },
  '/admin/specialties': { title: 'İxtisas İdarəetməsi',  sub: 'Dinamik ağac strukturu' },
  '/admin/users':       { title: 'Müəssisə & Təhsilalanlar', sub: 'Müəssisələr və təhsilalan siyahıları' },
  '/admin/results':      { title: 'Nəticələr',            sub: 'Yerləşdirmə nəticələri' },
  '/admin/distribution': { title: 'Yerləşdirmə',          sub: 'Təhsilalanları müəssisəyə təyin edin' },
  '/admin/redistribute': { title: 'Qismən Yerləşdirmə',        sub: 'Seçilmiş ixtisasları yenidən böl' },
  '/admin/admins':      { title: 'Adminlər',             sub: 'Sistem administratorları' },
  '/admin/archive':     { title: 'Arxiv',               sub: 'Arxivlənmiş seçimlər və nəticələr' },
  '/admin/logs':        { title: 'Sistem Logları',      sub: 'Admin hərəkətləri və sistem hadisələri' },
}

function AdminLayoutInner() {
  const { pathname, search } = useLocation()
  const { slot } = useTopbar()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('admin_sidebar_collapsed') === '1')
  const toggleCollapsed = () => setCollapsed(c => { localStorage.setItem('admin_sidebar_collapsed', c ? '0' : '1'); return !c })
  const navigate = useNavigate()

  const session = (() => { try { return JSON.parse(sessionStorage.getItem('admin_session') || 'null') } catch { return null } })()

  function handleLogout() {
    addLog('admin', 'info', `Sistemdən çıxış: ${session?.name || 'Admin'}`, `Rol: ${session?.role || 'admin'}`)
    sessionStorage.removeItem('admin_session')
    navigate('/admin/login')
  }

  const meta = PAGE_META[pathname] ?? { title: 'Seçim Detalı', sub: 'Seçimi idarə et' }
  // Bu səhifələrdə yuxarı başlıq gizlədilir (məzmun yuxarı qalxsın)
  const hideHeaderText = pathname === '/admin/dashboard' || pathname === '/admin/users' || pathname === '/admin/specialties' || pathname === '/admin/selections' || pathname === '/admin/distribution' || pathname === '/admin/redistribute' || pathname === '/admin/results'
  // Arxa fonda background şəkli göstərilən səhifələr (ağ deyil, şəffaf)
  const showBgImage = pathname === '/admin/dashboard' || pathname === '/admin/specialties' || pathname === '/admin/users' || pathname === '/admin/selections' || pathname === '/admin/distribution' || pathname === '/admin/redistribute' || pathname === '/admin/results'

  // ── İcazəyə görə nav filtri (boş qalan bölmə başlıqları da gizlədilir) ──
  const visibleNav = (() => {
    const items = NAV.filter(item => {
      if ('section' in item) return true
      const perm = PATH_PERM[(item as any).to]
      return !perm || hasPerm(session, perm)
    })
    return items.filter((item, i) => {
      if (!('section' in item)) return true
      const next = items[i + 1]
      return next && !('section' in next)
    })
  })()

  // ── Route qoruması: icazəsiz səhifəyə birbaşa URL ilə giriş ──
  const allowed = pathAllowed(session, pathname)

  return (
    <div className="admin-shell">
      {/* ── Mobile overlay ── */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar yığ/aç oxu (kənarda) ── */}
      <button
        className="sidebar-toggle"
        style={{ left: collapsed ? 53 : 227 }}
        onClick={toggleCollapsed}
        title={collapsed ? 'Yan paneli aç' : 'Yan paneli bağla'}
        aria-label="Yan paneli aç/bağla"
      >
        {collapsed ? '›' : '‹'}
      </button>

      {/* ── Sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}${collapsed ? ' collapsed' : ''}`}>
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
          </div>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, paddingTop: 8 }}>
          {visibleNav.map((item, i) => {
            if ('section' in item) {
              return <div key={i} className="nav-section">{item.section}</div>
            }
            const badge = item.badge?.()
            const [itemPath, itemQuery] = item.to.split('?')
            const isActive = pathname === itemPath && (!itemQuery || search === `?${itemQuery}`)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={() => `nav-item${isActive ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {badge !== undefined && <span className="nav-badge">{badge}</span>}
              </NavLink>
            )
          })}
        </div>

        {/* Alt hissə */}
        <div className="sidebar-bottom">
          <div className="admin-info">
            <div className="admin-avatar" style={{ background:'#fff', padding:2, overflow:'hidden' }}>
              <img src="/mmu-logo.png" alt="MMU" style={{ width:'100%', height:'100%', objectFit:'contain' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="admin-name" style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{session?.name || 'Admin'}</div>
              <div className="admin-role">{session?.role === 'superadmin' ? 'Super Admin' : session?.role || 'Admin'}</div>
            </div>
          </div>
          <button onClick={handleLogout} title="Çıxış"
            style={{ width:'100%', marginTop: 10, padding:'8px', borderRadius: 10, border:'1.5px solid #e7eaf0', background:'transparent', color:'#5a6080', fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7, transition:'all .15s' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background='#ff4d4f18'; (e.currentTarget as HTMLElement).style.color='#ff4d4f'; (e.currentTarget as HTMLElement).style.borderColor='#ff4d4f44' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background='transparent'; (e.currentTarget as HTMLElement).style.color='#5a6080'; (e.currentTarget as HTMLElement).style.borderColor='#e7eaf0' }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span className="logout-label">Çıxış</span>
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="admin-content">
        <header className={`topbar${hideHeaderText ? ' topbar--bare' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Hamburger (yalnız mobil) */}
            <button
              className="hamburger-btn"
              onClick={() => setSidebarOpen(o => !o)}
              aria-label="Menyu"
            >
              <span /><span /><span />
            </button>
            {slot ?? (!hideHeaderText && (
              <div>
                <div className="topbar-title">{meta.title}</div>
                <div className="topbar-sub">{meta.sub}</div>
              </div>
            ))}
          </div>
        </header>

        <div className={`page-body${hideHeaderText ? (showBgImage ? '' : ' page-body--white') : ''}`}>
          {allowed ? <Outlet /> : (
            <div style={{ background: '#fff', border: '1.5px dashed #ffccc7', borderRadius: 16, padding: '56px 32px', textAlign: 'center', marginTop: 24 }}>
              <div style={{ fontSize: 44, marginBottom: 12 }}>🔒</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#cf1322', marginBottom: 6 }}>Bu bölməyə icazəniz yoxdur</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>İcazə üçün Baş Adminə müraciət edin.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AdminLayout() {
  return (
    <TopbarProvider>
      <AdminLayoutInner />
    </TopbarProvider>
  )
}
