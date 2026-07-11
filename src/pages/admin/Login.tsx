import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminDb, addLog } from '../../db'
import { pathAllowed } from '../../permissions'
import { setAdminSession } from '../../api/auth'

export default function AdminLogin() {
  const navigate  = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('İstifadəçi adı və şifrəni daxil edin'); return }
    setLoading(true); setError('')
    try {
      const admin = await adminDb.loginAdmin(username, password)
      if (!admin) {
        setError('İstifadəçi adı və ya şifrə yanlışdır')
        addLog('admin', 'warning', `Uğursuz admin girişi`, `İstifadəçi: ${username}`, username)
        return
      }
      setAdminSession({
        token: admin.token, id: admin.id, name: admin.name, username: admin.username, role: admin.role,
        permissions: admin.permissions || [],
      })
      addLog('admin', 'success', `Admin daxil oldu: ${admin.name}`, `@${admin.username}`, admin.name)
      // İcazəsi olduğu ilk səhifəyə yönləndir
      const firstPage = admin.role === 'superadmin' ? '/admin/dashboard'
        : (['/admin/dashboard','/admin/users','/admin/specialties','/admin/selections','/admin/distribution','/admin/results','/admin/archive','/admin/logs','/admin/admins']
            .find(p => pathAllowed({ role: admin.role, permissions: admin.permissions || [] }, p)) || '/admin/dashboard')
      navigate(firstPage)
    } catch (err: any) {
      setError(err?.message || 'Serverlə əlaqə qurulmadı. Backend işləyir mi yoxlayın.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: '#eef1f5 url(/background.jpeg) center center / cover no-repeat fixed',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Arxa fon dairələri */}
      <div style={{ position:'absolute', top:'10%', left:'8%', width:320, height:320, borderRadius:'50%', background:'radial-gradient(circle,#e0a92e1f 0%,transparent 70%)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'10%', right:'8%', width:280, height:280, borderRadius:'50%', background:'radial-gradient(circle,#b8860b1a 0%,transparent 70%)', pointerEvents:'none' }} />

      {/* Kart */}
      <div style={{
        width: 400, background: '#ffffff',
        border: '1.5px solid #e7eaf0',
        borderRadius: 24, padding: '44px 40px',
        boxShadow: '0 24px 70px #1a1f3c1a',
      }}>
        {/* Logo / Başlıq */}
        <div style={{ textAlign:'center', marginBottom: 36 }}>
          <div style={{
            width: 80, height: 80, margin: '0 auto 16px',
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>
            <img src="/mmu-logo.png" alt="MMU" style={{ width:'100%', height:'100%', objectFit:'contain', filter:'drop-shadow(0 6px 18px #0007)' }} />
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#2b2f3a', letterSpacing: -0.5 }}>Admin Paneli</div>
          <div style={{ fontSize: 13, color: '#8a909c', marginTop: 6 }}>İxtisas Seçim Proqramı</div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin}>
          {/* İstifadəçi adı */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display:'block', fontSize: 11, fontWeight: 700, color:'#5a6070', marginBottom: 7, textTransform:'uppercase', letterSpacing: 0.8 }}>
              İstifadəçi adı
            </label>
            <input
              type="text" value={username} onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              autoComplete="username"
              style={{
                width: '100%', padding: '13px 16px', borderRadius: 12, fontSize: 14,
                background: '#f8f9fd', border: `1.5px solid ${error ? '#ff4d4f88' : '#e0e4f0'}`,
                color: '#2b2f3a', outline: 'none', boxSizing: 'border-box',
                transition: 'border-color .2s',
              }}
              onFocus={e => e.currentTarget.style.borderColor = '#e0a92e'}
              onBlur={e => e.currentTarget.style.borderColor = error ? '#ff4d4f88' : '#e0e4f0'}
            />
          </div>

          {/* Şifrə */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display:'block', fontSize: 11, fontWeight: 700, color:'#5a6070', marginBottom: 7, textTransform:'uppercase', letterSpacing: 0.8 }}>
              Şifrə
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                style={{
                  width: '100%', padding: '13px 46px 13px 16px', borderRadius: 12, fontSize: 14,
                  background: '#f8f9fd', border: `1.5px solid ${error ? '#ff4d4f88' : '#e0e4f0'}`,
                  color: '#2b2f3a', outline: 'none', boxSizing: 'border-box',
                  transition: 'border-color .2s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = '#e0a92e'}
                onBlur={e => e.currentTarget.style.borderColor = error ? '#ff4d4f88' : '#e0e4f0'}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} title={showPw ? 'Gizlət' : 'Göstər'}
                style={{ position:'absolute', right: 12, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'#9aa0ac', cursor:'pointer', padding: 4, lineHeight: 0, display:'flex', alignItems:'center' }}>
                {showPw
                  ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
              </button>
            </div>
          </div>

          {/* Xəta */}
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ff4d4f18', border: '1px solid #ff4d4f44', color: '#ff7875', fontSize: 12, fontWeight: 600, marginBottom: 18, textAlign: 'center' }}>
              ⚠ {error}
            </div>
          )}

          {/* Giriş düyməsi */}
          <button type="submit" disabled={loading}
            style={{
              width: '100%', padding: '14px', borderRadius: 12, border: 'none',
              background: loading ? '#cfd2da' : 'linear-gradient(135deg,#b8860b,#e0a92e)',
              color: '#fff', fontWeight: 800, fontSize: 15, cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: loading ? 'none' : '0 6px 20px #e0a92e55',
              transition: 'all .2s', letterSpacing: 0.3,
            }}>
            {loading ? '⏳ Yoxlanılır...' : '→ Daxil ol'}
          </button>
        </form>

        <div style={{ textAlign:'center', marginTop: 22 }}>
          <button onClick={() => navigate('/student')}
            style={{ background:'none', border:'none', cursor:'pointer', color:'#9a7b1e', fontSize: 12.5, fontWeight: 700 }}>
            🎓 Təhsilalan girişi →
          </button>
        </div>
        <div style={{ textAlign:'center', marginTop: 14, fontSize: 11, color:'#aab' }}>
          İxtisas Seçim Proqramı
        </div>
      </div>
    </div>
  )
}
