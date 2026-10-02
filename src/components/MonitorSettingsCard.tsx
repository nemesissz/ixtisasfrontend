import { useEffect, useState } from 'react'
import { monitorDb, addLog, type MonitorConfig } from '../db'

// Superadmin parametrləri → Canlı nəzarət: ümumi açar və interval tənzimləri.
// Açarı dəyişmək sistemin bütün canlı məlumatını sıfırlayır (server tərəfdə).
export default function MonitorSettingsCard() {
  const [cfg, setCfg] = useState<MonitorConfig | null>(null)
  const [draft, setDraft] = useState<MonitorConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    monitorDb.getConfig().then(c => { setCfg(c); setDraft(c) }).catch(() => setErr('Parametrlər yüklənmədi'))
  }, [])

  if (!draft || !cfg) {
    return <div className="card" style={{ marginTop: 20, padding: 24, color: 'var(--muted)' }}>{err || 'Yüklənir…'}</div>
  }

  async function save(next: MonitorConfig) {
    const toggled = next.enabled !== cfg!.enabled
    if (toggled && !confirm(next.enabled
      ? 'Canlı nəzarət yandırılsın? Sayğaclar sıfırdan başlayacaq.'
      : 'Canlı nəzarət söndürülsün? Cari seansa aid bütün məlumat (aktiv siyahı, müddətlər, statistika) silinəcək. Seçim prosesinə təsir etmir.')) return
    setBusy(true); setErr('')
    try {
      await monitorDb.setConfig(next)
      setCfg(next); setDraft(next)
      addLog('system', 'info', toggled
        ? `Canlı nəzarət ${next.enabled ? 'yandırıldı' : 'söndürüldü'}`
        : 'Canlı nəzarət parametrləri dəyişdirildi',
        `Heartbeat ${next.heartbeatSec} san · əlaqə kəsildi ${next.offlineSec} san · yarımçıq ${next.abandonMin} dəq`)
      setSaved(true); setTimeout(() => setSaved(false), 2500)
    } catch { setErr('Yadda saxlanmadı') }
    setBusy(false)
  }

  const num = (k: keyof MonitorConfig, label: string, unit: string, min: number, max: number, hint: string) => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 180, flex: 1 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: '#4a5060' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="number" min={min} max={max} value={draft[k] as number}
          onChange={e => setDraft({ ...draft, [k]: Number(e.target.value) })}
          style={{ width: 90, padding: '8px 10px', borderRadius: 8, border: '1.5px solid var(--border)', fontSize: 14, fontWeight: 700 }} />
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{unit}</span>
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{hint}</span>
    </label>
  )

  const dirty = draft.heartbeatSec !== cfg.heartbeatSec || draft.offlineSec !== cfg.offlineSec || draft.abandonMin !== cfg.abandonMin
  const perSec = (n: number) => (n / Math.max(5, draft.heartbeatSec)).toFixed(1)

  return (
    <div className="card" style={{ marginTop: 20, overflow: 'hidden' }}>
      <div style={{ background: 'linear-gradient(135deg,#1f6f43,#34a36b)', padding: '20px 28px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', marginBottom: 3 }}>📡 Canlı Nəzarət</div>
          <div style={{ fontSize: 12, color: '#e6fff0' }}>Seçim edən təhsilalanları canlı izləmək — «Canlı nəzarət» səhifəsində görünür</div>
        </div>
        <button disabled={busy} onClick={() => save({ ...cfg, enabled: !cfg.enabled })}
          style={{ padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13.5,
            background: cfg.enabled ? '#fff' : 'rgba(255,255,255,.18)', color: cfg.enabled ? '#1f6f43' : '#fff',
            boxShadow: cfg.enabled ? '0 0 0 3px rgba(255,255,255,.35)' : 'none' }}>
          {cfg.enabled ? '● Yanılıdır — söndür' : '○ Sönülüdür — yandır'}
        </button>
      </div>
      <div style={{ padding: '22px 28px' }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          {num('heartbeatSec', 'Siqnal intervalı (heartbeat)', 'saniyə', 5, 600,
            `50 kompüter ≈ ${perSec(50)} sorğu/san · 200 ≈ ${perSec(200)}`)}
          {num('offlineSec', '«Əlaqə kəsildi» həddi', 'saniyə', 15, 3600, 'Bu qədər siqnal gəlməsə boz göstərilir')}
          {num('abandonMin', '«Yarımçıq» həddi', 'dəqiqə', 1, 240, 'Bu qədər siqnal gəlməsə yarımçıq sayılır')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => save({ ...draft, enabled: cfg.enabled })}>
            💾 Yadda saxla
          </button>
          {saved && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#237804' }}>✅ Yadda saxlanıldı</span>}
          {err && <span style={{ fontSize: 12.5, fontWeight: 800, color: '#c0392b' }}>{err}</span>}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            Interval dəyişikliyi açıq təhsilalan səhifələrinə növbəti siqnalda avtomatik çatır.
            Kompüter sayı artdıqca intervalı böyüdün (200+ üçün 60 san).
          </span>
        </div>
      </div>
    </div>
  )
}
