import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectionDb, userDb, systemSettingsDb, institutionDb, addLog } from '../../db'

export default function Landing() {
  const navigate     = useNavigate()
  const allPublished = selectionDb.getAll().filter((s: any) => s.status === 'published')
  const institutions = institutionDb.getAll() as any[]

  // İlk aktiv seçimdən müəssisəni tap, konfiqurasiyanı al
  const firstInst    = allPublished[0]?.institution || institutions[0]?.id || ''
  const cfg          = systemSettingsDb.getInstConfig(firstInst)

  const [fin,     setFin]     = useState('')
  const [wNum,    setWNum]    = useState('')
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  // Artıq session varsa birbaşa müəssisəyə uyğun seçimə yönləndir
  useEffect(() => {
    const stored = sessionStorage.getItem('mmu_student')
    if (!stored) return
    const s = JSON.parse(stored)
    const mySelection = allPublished.find(
      (sel: any) => sel.institution === s.institution
    )
    if (mySelection) {
      navigate(`/student/${mySelection.id}`, { replace: true })
    }
  }, [])

  function login() {
    setError('')
    const finT = fin.trim().replace(/İ/g,'I').replace(/ı/g,'I').toUpperCase()
    const wT   = wNum.trim().replace(/İ/g,'I').replace(/ı/g,'I').toUpperCase()

    // Məcburi sahə + uzunluq yoxlamaları
    if (cfg.field1.required && !finT) { setError(`${cfg.field1.label} daxil edin`); return }
    if (cfg.field2.required && !wT)   { setError(`${cfg.field2.label} daxil edin`); return }
    if (finT && finT.length < cfg.field1.min) { setError(`${cfg.field1.label} ən azı ${cfg.field1.min} simvol olmalıdır`); return }
    if (finT && finT.length > cfg.field1.max) { setError(`${cfg.field1.label} maksimum ${cfg.field1.max} simvol ola bilər`); return }
    if (wT && wT.length < cfg.field2.min)     { setError(`${cfg.field2.label} ən azı ${cfg.field2.min} simvol olmalıdır`); return }
    if (wT && wT.length > cfg.field2.max)     { setError(`${cfg.field2.label} maksimum ${cfg.field2.max} simvol ola bilər`); return }

    setLoading(true)
    setTimeout(() => {
      const users = userDb.getAll() as any[]
      const norm = (s: string) => s.trim()
        .replace(/İ/g, 'I').replace(/ı/g, 'I').replace(/i/g, 'I')
        .toUpperCase()

      const insts = institutionDb.getAll() as any[]
      let found: any = null

      // Hər müəssisənin konfiqurasiyasına görə yoxla
      for (const inst of insts) {
        const ic = systemSettingsDb.getInstConfig(inst.id)
        const c1 = ic.field1.column
        const c2 = ic.field2.column
        const match = users.find((u: any) => {
          if (u.institution !== inst.id) return false
          const v1 = norm(String(u[c1] ?? ''))
          const v2 = norm(String(u[c2] ?? ''))
          return (v1 === norm(finT) && v2 === norm(wT)) ||
                 (v1 === norm(wT)   && v2 === norm(finT))
        })
        if (match) { found = match; break }
      }

      // Fallback: fin + workNumber ilə yoxla
      if (!found) {
        found = users.find((u: any) => {
          const v1 = norm(String(u.fin || ''))
          const v2 = norm(String(u.workNumber || ''))
          return (v1 === norm(finT) && v2 === norm(wT)) ||
                 (v1 === norm(wT)   && v2 === norm(finT))
        })
      }

      setLoading(false)
      if (!found) {
        setError(`${cfg.field1.label} və ya ${cfg.field2.label} yanlışdır`)
        addLog('user', 'warning', `Uğursuz təhsil alan girişi`, `${cfg.field1.label}: ${finT} · ${cfg.field2.label}: ${wT}`)
        return
      }

      sessionStorage.setItem('mmu_student', JSON.stringify(found))
      addLog('user', 'success', `Təhsil alan daxil oldu: ${found.name}`, `FİN: ${found.fin || '—'}`, found.name)

      // Təhsil alanın müəssisəsinə uyğun aktiv seçimi tap
      const mySelection = allPublished.find(
        (s: any) => s.institution === found.institution
      )
      if (mySelection) {
        navigate(`/student/${mySelection.id}`)
      } else {
        setError('Sizin müəssisəyə aid aktiv seçim tapılmadı')
      }
    }, 400)
  }

  const GOLD = '#e0a92e'
  const inputStyle: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '13px 16px',
    borderRadius: 8, border: '1.5px solid #d9dde6', background: '#fdfdfe',
    fontSize: 15, color: '#2b2f3a', outline: 'none', transition: 'border-color .15s',
  }
  const onFocus = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = GOLD }
  const onBlur  = (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#d9dde6' }

  return (
    <div style={{
      position: 'fixed', inset: 0, overflowY: 'auto',
      background: '#eef1f5',
      backgroundImage: 'repeating-linear-gradient(135deg,#ffffff 0px,#ffffff 1px,transparent 1px,transparent 26px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '40px 20px',
    }}>
      <div style={{ position: 'relative', width: '100%', maxWidth: 1080, margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Gerb */}
        <img src="/mmu-logo.png" alt="MMU"
          style={{ width: 110, height: 110, objectFit: 'contain', marginBottom: 10, filter: 'drop-shadow(0 4px 10px #0002)' }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        <div style={{ fontSize: 30, fontWeight: 800, color: '#2b2f3a', letterSpacing: 0.2 }}>
          Milli Müdafiə Universiteti
        </div>
        <div style={{ fontSize: 15, color: '#8a909c', marginTop: 2, marginBottom: 18 }}>
          İxtisas Seçimi Formu
        </div>

        {/* Mərhələ göstəricisi */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
          {[1, 2, 3].map((n, i) => (
            <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                background: n === 1 ? GOLD : '#d6dae3',
                color: n === 1 ? '#fff' : '#8a909c',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 13,
                boxShadow: n === 1 ? `0 3px 10px ${GOLD}66` : 'none',
              }}>{n}</div>
              {i < 2 && <div style={{ width: 46, height: 3, background: '#d6dae3' }} />}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#9aa0ac', marginBottom: 22 }}>Mərhələ 1 / 3</div>

        {/* Forma kartı */}
        <div style={{
          width: '100%', background: '#fff', borderRadius: 14,
          border: '1px solid #e7eaf0', boxShadow: '0 10px 40px #1a1f3c12',
          padding: '26px 30px',
        }}>
          {/* FİN */}
          <div style={{ marginBottom: 18 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#5a6070', marginBottom: 7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8a909c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
              {cfg.field1.label}{cfg.field1.required ? ' *' : ''}
            </label>
            <input
              style={inputStyle} onFocus={onFocus} onBlur={onBlur} autoFocus
              value={fin}
              onChange={e => { setFin(e.target.value.toUpperCase()); setError('') }}
              onKeyDown={e => e.key === 'Enter' && login()}
              maxLength={cfg.field1.max}
            />
          </div>

          {/* İş nömrəsi */}
          <div style={{ marginBottom: error ? 16 : 22 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: '#5a6070', marginBottom: 7 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8a909c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 12 0v1"/></svg>
              {cfg.field2.label}{cfg.field2.required ? ' *' : ''}
            </label>
            <input
              style={inputStyle} onFocus={onFocus} onBlur={onBlur}
              value={wNum}
              onChange={e => { setWNum(e.target.value.toUpperCase()); setError('') }}
              onKeyDown={e => e.key === 'Enter' && login()}
              maxLength={cfg.field2.max}
            />
          </div>

          {error && (
            <div style={{ background: '#fff2f0', border: '1.5px solid #ffccc7', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#cf1322', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠️</span> {error}
            </div>
          )}

          {/* Düymə */}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={login} disabled={loading}
              style={{
                padding: '12px 28px', borderRadius: 8, border: 'none',
                background: loading ? '#e8d39a' : GOLD, color: '#fff',
                fontWeight: 800, fontSize: 15, cursor: loading ? 'default' : 'pointer',
                boxShadow: loading ? 'none' : `0 4px 14px ${GOLD}55`, transition: 'all .2s',
              }}
            >
              {loading ? 'Yoxlanılır...' : 'Növbəti →'}
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ fontSize: 12, color: '#a6abb6', marginTop: 26, textAlign: 'center' }}>
          © {new Date().getFullYear()} Milli Müdafiə Universiteti. Bütün hüquqlar qorunur.
        </div>
      </div>
    </div>
  )
}
