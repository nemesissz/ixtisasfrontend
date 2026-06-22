import { useNavigate } from 'react-router-dom'
import { selectionDb } from '../db'

export default function Home() {
  const navigate  = useNavigate()
  const published = selectionDb.getAll().filter((s: any) => s.status === 'published')
  const hasActive = published.length > 0

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: 'linear-gradient(145deg, #0f1229 0%, #1a1f3c 50%, #0d1117 100%)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>

      {/* Arxa fon bəzəkləri */}
      <div style={{
        position: 'absolute', top: '15%', left: '10%',
        width: 320, height: 320, borderRadius: '50%',
        background: 'radial-gradient(circle, #c9962a18 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '15%', right: '10%',
        width: 280, height: 280, borderRadius: '50%',
        background: 'radial-gradient(circle, #b8860b18 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Logo + Başlıq */}
      <div style={{ textAlign: 'center', marginBottom: 52, zIndex: 1 }}>
        <div style={{
          width: 96, height: 96, margin: '0 auto 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src="/mmu-logo.png" alt="MMU" style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 6px 20px #0006)' }} />
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', letterSpacing: -.5 }}>
          MMU İxtisas Sistemi
        </div>
        <div style={{ fontSize: 13, color: '#5a6080', marginTop: 8, fontWeight: 500 }}>
          Daxil olmaq üçün rol seçin
        </div>
      </div>

      {/* Kartlar — 2 giriş */}
      <div style={{ display: 'flex', gap: 28, zIndex: 1, flexWrap: 'wrap', justifyContent: 'center' }}>

        {/* İdarəetmə girişi — admin / superadmin / operator */}
        <RoleCard
          icon="🔐"
          iconBg="linear-gradient(135deg,#c9962a,#3a5ecc)"
          iconShadow="#c9962a44"
          title="İdarəetmə Girişi"
          subtitle="Admin · Operator"
          accentColor="#c9962a"
          active={true}
          onClick={() => navigate('/admin/login')}
        />

        {/* Kursant portalı */}
        <RoleCard
          icon="🎓"
          iconBg="linear-gradient(135deg,#b8860b,#5a33cc)"
          iconShadow="#b8860b44"
          title="Kursant Girişi"
          subtitle={hasActive ? `${published.length} aktiv seçim` : 'Aktiv seçim yoxdur'}
          accentColor="#b8860b"
          active={hasActive}
          onClick={() => hasActive && navigate('/student')}
        />
      </div>

      {!hasActive && (
        <div style={{
          marginTop: 32, fontSize: 12, color: '#3a4060',
          background: '#ffffff08', border: '1px solid #ffffff10',
          borderRadius: 10, padding: '10px 20px', zIndex: 1,
        }}>
          ℹ️ Kursant portalı üçün admin aktiv seçim yayımlamalıdır
        </div>
      )}

      {/* Alt yazı */}
      <div style={{ position: 'absolute', bottom: 24, fontSize: 11, color: '#2a304a', zIndex: 1 }}>
        MMU İxtisas Seçim Sistemi © {new Date().getFullYear()}
      </div>
    </div>
  )
}

// ── Kart komponenti ───────────────────────────────────────────────────────────
function RoleCard({ icon, iconBg, iconShadow, title, subtitle, accentColor, active, onClick }: {
  icon: string; iconBg: string; iconShadow: string
  title: string; subtitle: string; accentColor: string
  active: boolean; onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 210, background: '#ffffff08',
        border: '1.5px solid #ffffff12',
        backdropFilter: 'blur(12px)',
        borderRadius: 24, padding: '36px 28px',
        textAlign: 'center',
        cursor: active ? 'pointer' : 'not-allowed',
        opacity: active ? 1 : 0.45,
        transition: 'transform .18s, box-shadow .18s, border-color .18s',
        position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => {
        if (!active) return
        const el = e.currentTarget as HTMLElement
        el.style.transform = 'translateY(-6px)'
        el.style.boxShadow = `0 20px 48px ${iconShadow}`
        el.style.borderColor = accentColor + '66'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.transform = 'translateY(0)'
        el.style.boxShadow = 'none'
        el.style.borderColor = '#ffffff12'
      }}
    >
      {/* İkon */}
      <div style={{
        width: 60, height: 60, borderRadius: 18, margin: '0 auto 18px',
        background: iconBg, display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontSize: 28,
        boxShadow: `0 6px 20px ${iconShadow}`,
      }}>{icon}</div>

      <div style={{ fontSize: 17, fontWeight: 800, color: '#fff', marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, color: '#5a6080', lineHeight: 1.4 }}>{subtitle}</div>

      {active && (
        <div style={{
          marginTop: 22,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: 12, fontWeight: 700, color: accentColor,
          background: accentColor + '18', borderRadius: 8, padding: '5px 14px',
        }}>
          Daxil ol →
        </div>
      )}
    </div>
  )
}
