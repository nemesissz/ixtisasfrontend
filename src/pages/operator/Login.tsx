import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { adminDb, addLog } from '../../db'
import { setOperatorSession } from '../../api/auth'

export default function OperatorLogin() {
  const navigate  = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw,   setShowPw]   = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) { setError('İstifadəçi adı və şifrəni daxil edin'); return }
    setLoading(true)
    setError('')

    try {
      const op = await adminDb.loginOperator(username, password)
      if (!op) {
        setError('İstifadəçi adı və ya şifrə yanlışdır')
        addLog('user', 'warning', `Uğursuz operator girişi`, `İstifadəçi adı: ${username}`, username)
        return
      }
      setOperatorSession({ token: op.token, id: op.id, name: op.name, username: op.username, role: op.role })
      addLog('user', 'success', `Operator daxil oldu: ${op.name}`, `@${op.username}`, op.name)
      navigate('/operator/dashboard')
    } catch (err: any) {
      setError(err?.message || 'Serverlə əlaqə qurulmadı. Backend işləyir mi yoxlayın.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      width: '100vw', minHeight: '100vh',
      background: 'linear-gradient(145deg,#0a1f14 0%,#0f2a1c 50%,#081510 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Arxa fon */}
      <div style={{
        position: 'absolute', top: '10%', left: '8%',
        width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle,#00b96b18 0%,transparent 70%)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '10%', right: '8%',
        width: 260, height: 260, borderRadius: '50%',
        background: 'radial-gradient(circle,#007a4718 0%,transparent 70%)', pointerEvents: 'none',
      }} />

      {/* Kart */}
      <div style={{
        width: 380, background: '#ffffff0a',
        border: '1.5px solid #ffffff10',
        backdropFilter: 'blur(16px)',
        borderRadius: 24, padding: '40px 36px',
        boxShadow: '0 24px 64px #00000044',
        zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 20, margin: '0 auto 16px',
            background: 'linear-gradient(135deg,#00b96b,#007a47)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 30, boxShadow: '0 8px 28px #00b96b44',
          }}>🛠️</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', letterSpacing: -.5 }}>
            Operator Girişi
          </div>
          <div style={{ fontSize: 12, color: '#3a6050', marginTop: 6 }}>
            İxtisas Seçim Proqramı
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Username */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#5a8070', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 7 }}>
              İstifadəçi adı
            </label>
            <input
              type="text"
              placeholder="istifadəci_adı"
              value={username}
              onChange={e => { setUsername(e.target.value); setError('') }}
              autoFocus
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                border: `1.5px solid ${error ? '#ff4d4f44' : '#ffffff18'}`,
                background: '#ffffff0d', color: '#fff',
                fontSize: 14, fontFamily: 'monospace', letterSpacing: 0.5,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Password */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#5a8070', textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 7 }}>
              Şifrə
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => { setPassword(e.target.value); setError('') }}
                style={{
                  width: '100%', padding: '12px 44px 12px 14px', borderRadius: 12,
                  border: `1.5px solid ${error ? '#ff4d4f44' : '#ffffff18'}`,
                  background: '#ffffff0d', color: '#fff',
                  fontSize: 14, outline: 'none', boxSizing: 'border-box',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(p => !p)} title={showPw ? 'Gizlət' : 'Göstər'}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#7088b0', opacity: 0.85, padding: 4, lineHeight: 0, display:'flex', alignItems:'center',
                }}
              >{showPw
                ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              }</button>
            </div>
          </div>

          {/* Xəta */}
          {error && (
            <div style={{
              background: '#ff4d4f18', border: '1px solid #ff4d4f44',
              borderRadius: 10, padding: '9px 14px',
              fontSize: 12, color: '#ff8080', display: 'flex', gap: 8, alignItems: 'center',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Daxil ol düyməsi */}
          <button
            type="submit"
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px 0', borderRadius: 12, border: 'none',
              background: loading ? '#1a4a32' : 'linear-gradient(135deg,#00b96b,#007a47)',
              color: '#fff', fontWeight: 800, fontSize: 15,
              cursor: loading ? 'wait' : 'pointer',
              boxShadow: loading ? 'none' : '0 6px 20px #00b96b44',
              transition: 'all .2s',
            }}
          >
            {loading ? '⏳ Yoxlanır...' : '→ Daxil ol'}
          </button>
        </form>

        {/* Geri */}
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <button
            onClick={() => navigate('/')}
            style={{
              background: 'none', border: 'none', color: '#3a6050',
              fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}
          >
            ← Ana səhifəyə qayıt
          </button>
        </div>
      </div>
    </div>
  )
}
