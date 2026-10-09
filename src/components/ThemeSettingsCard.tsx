import { useEffect, useState } from 'react'
import { addLog } from '../db'
import { getAdminSession } from '../api/auth'
import { ThemeMode, fetchTheme, getThemeMode, saveTheme } from '../theme'

const OPTIONS: { key: ThemeMode; label: string; hint: string }[] = [
  { key: 'light',  label: 'Açıq',   hint: 'Ağ fon və kartlar' },
  { key: 'dark',   label: 'Tünd',   hint: 'Tünd fon, açıq mətn' },
  { key: 'system', label: 'Sistem', hint: 'Hər istifadəçinin cihaz temasına görə' },
]

/**
 * Görünüş rejimi — yalnız superadmin görür və dəyişir.
 * Seçim bütün proqrama (admin və təhsilalan səhifələrinə) tətbiq olunur.
 */
export default function ThemeSettingsCard() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null)

  useEffect(() => { fetchTheme().then(setMode) }, [])

  async function choose(m: ThemeMode) {
    if (m === mode || busy) return
    setBusy(true); setMsg(null)
    try {
      await saveTheme(m)
      setMode(m)
      setMsg({ ok: true, t: '✅ Yadda saxlanıldı' })
      setTimeout(() => setMsg(null), 2000)
      await addLog('admin', 'success', 'Görünüş rejimi dəyişdirildi', OPTIONS.find(o => o.key === m)?.label || m, getAdminSession()?.name)
    } catch {
      setMsg({ ok: false, t: 'Yadda saxlanmadı' })
    } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg,#1f3f6b,#4a6f8f)', padding: '20px 28px' }}>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>🌓 Görünüş rejimi</div>
        <div style={{ fontSize: 12, color: '#ffffffcc' }}>Açıq və ya tünd rejim — bütün proqrama (adminlər və təhsilalanlar) tətbiq olunur</div>
      </div>
      <div style={{ padding: '22px 28px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div role="group" aria-label="Görünüş rejimi"
          style={{ display: 'inline-flex', border: '1.5px solid #c9d4e2', borderRadius: 10, overflow: 'hidden' }}>
          {OPTIONS.map((o, i) => {
            const on = mode === o.key
            return (
              <button key={o.key} type="button" aria-pressed={on} disabled={busy} title={o.hint} onClick={() => choose(o.key)}
                style={{
                  padding: '9px 20px', border: 'none', borderLeft: i ? '1.5px solid #c9d4e2' : 'none',
                  background: on ? '#1f3f6b' : '#fff', color: on ? '#fff' : '#2b2f3a',
                  fontWeight: 700, fontSize: 13, cursor: busy ? 'progress' : 'pointer', fontFamily: 'inherit',
                }}>{o.label}</button>
            )
          })}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{OPTIONS.find(o => o.key === mode)?.hint}</span>
        {msg && <span style={{ fontSize: 12.5, fontWeight: 800, color: msg.ok ? '#237804' : '#cf1322' }}>{msg.t}</span>}
      </div>
    </div>
  )
}
