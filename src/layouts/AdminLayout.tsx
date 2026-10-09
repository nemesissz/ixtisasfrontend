import { useState, useEffect, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { userDb, selectionDb, addLog } from '../db'
import { TopbarProvider, useTopbar } from '../contexts/TopbarContext'
import { PATH_PERM, hasPerm, pathAllowed } from '../permissions'
import { getAdminSession, clearAdminSession } from '../api/auth'
import { IS_LIGHT_MODE } from '../palette'

// Açıq rejimdə emoji əvəzinə xətti ikonlar (İSP dizayn sistemi)
const LINE_ICONS: Record<string, ReactNode> = {
  '/admin/dashboard':   <path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>,
  '/admin/users':       <><circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 1 0 0-6M22 21c0-3-2-5-5-5"/></>,
  '/admin/specialties': <path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5"/>,
  '/admin/selections':  <><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
  '/admin/distribution': <path d="M12 3v18M5 7h14M3 14l2-7 2 7a2 2 0 0 1-4 0zM17 14l2-7 2 7a2 2 0 0 1-4 0z"/>,
  '/admin/redistribute': <path d="M12 3v18M3 12h18"/>,
  '/admin/results':     <path d="M6 3h9l4 4v14H6zM9 12l2 2 4-4"/>,
  '/admin/archive':     <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/></>,
  '/admin/logs':        <path d="M4 6h16M4 12h16M4 18h10"/>,
  '/admin/integrity':   <path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>,
  '/admin/admins':      <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></>,
  '/admin/super-settings': <><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/></>,
  '/admin/live':        <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></>,
}

const NAV = [
  { section: 'Əsas' },
  { to: '/admin/dashboard',    icon: '📊', label: 'Statistika və analitika' },
  { section: 'İdarəetmə' },
  { to: '/admin/users',        icon: '👥', label: 'Təhsilalanlar' },
  { to: '/admin/specialties',  icon: '🎓', label: 'Müəssisə/İxtisaslar' },
  { to: '/admin/selections',   icon: '🗳',  label: 'Seçimlər' },
  { to: '/admin/distribution', icon: '⚖️', label: 'Yerləşdirmə', badgeKey: 'distribution' },
  { to: '/admin/redistribute', icon: '🔧', label: 'Qismən Yerləşdirmə' },
  { to: '/admin/results',      icon: '📋', label: 'Nəticələr' },
  { section: 'Sistem' },
  { to: '/admin/archive',      icon: '🗄️', label: 'Arxiv',      badgeKey: 'archive' },
  { to: '/admin/logs',         icon: '📋', label: 'Loglar' },
  { to: '/admin/integrity',    icon: '🛡️', label: 'SHA-256' },
  { to: '/admin/admins',       icon: '🔐', label: 'Adminlər' },
  { to: '/admin/super-settings', icon: '⚙️', label: 'Superadmin parametrləri', superOnly: true },
  { to: '/admin/live',         icon: '📡', label: 'Canlı nəzarət', superOnly: true },
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
  '/admin/integrity':   { title: 'SHA-256',             sub: 'Bazanın SHA-256 möhürü və dəyişiklik yoxlaması' },
  '/admin/super-settings': { title: 'Superadmin parametrləri', sub: 'Təhsilalan girişi, təsdiq elanı və canlı nəzarət — yalnız baş admin' },
  '/admin/live':        { title: 'Canlı nəzarət',       sub: 'Hazırda seçim edən təhsilalanlar və seans müddəti' },
}

function AdminLayoutInner() {
  const { pathname, search } = useLocation()
  const { slot } = useTopbar()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('admin_sidebar_collapsed') === '1')
  const toggleCollapsed = () => setCollapsed(c => { localStorage.setItem('admin_sidebar_collapsed', c ? '0' : '1'); return !c })
  const navigate = useNavigate()

  const session = getAdminSession()

  const [badges, setBadges] = useState<Record<string, number | undefined>>({})
  useEffect(() => {
    let cancelled = false
    Promise.all([userDb.getAll(), selectionDb.getArchived()]).then(([users, archived]) => {
      if (cancelled) return
      setBadges({
        distribution: (users as any[]).filter((u: any) => !u.institution).length || undefined,
        archive: archived.length || undefined,
      })
    })
    return () => { cancelled = true }
  }, [])

  function handleLogout() {
    addLog('admin', 'info', `Sistemdən çıxış: ${session?.name || 'Admin'}`, `Rol: ${session?.role || 'admin'}`)
    clearAdminSession()
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
      // Yalnız baş admin üçün olan bölmələr
      if ((item as any).superOnly && session?.role !== 'superadmin') return false
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
        style={{ left: collapsed ? 53 : (IS_LIGHT_MODE ? 235 : 227) }}
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
            width: IS_LIGHT_MODE ? 40 : 44, height: IS_LIGHT_MODE ? 40 : 44, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img src="/mmu-logo.png" alt="MMU" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
          <div>
            <div className="sidebar-logo-title">{IS_LIGHT_MODE ? <>İxtisas Seçim<br />Proqramı</> : 'İxtisas Seçim Proqramı'}</div>
          </div>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, paddingTop: 8 }}>
          {visibleNav.map((item, i) => {
            if ('section' in item) {
              return <div key={i} className="nav-section">{item.section}</div>
            }
            const badge = (item as any).badgeKey ? badges[(item as any).badgeKey] : undefined
            const [itemPath, itemQuery] = item.to.split('?')
            const isActive = pathname === itemPath && (!itemQuery || search === `?${itemQuery}`)
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={() => `nav-item${isActive ? ' active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <span className="nav-icon">{IS_LIGHT_MODE && LINE_ICONS[item.to]
                  ? <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">{LINE_ICONS[item.to]}</svg>
                  : item.icon}</span>
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
