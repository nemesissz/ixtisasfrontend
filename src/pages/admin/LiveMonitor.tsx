import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { monitorDb, addLog } from '../../db'
import { getAdminSession } from '../../api/auth'

// Canlı nəzarət (docs/PLAN-canli-nezaret.md) — yalnız superadmin.
// Yüngül endpoint 5 saniyədən bir çəkilir; saniyə sayğacları arada brauzerdə
// hesablanır (server vaxtına görə düzəldilmiş), əlavə sorğu olmadan.
const POLL_MS = 5000

function fmt(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return '—'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export default function LiveMonitor() {
  const session = getAdminSession()
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  // Son cavabın gəldiyi an (brauzer saatı) — sayğaclar buna nisbətən artırılır
  const fetchedAt = useRef(Date.now())
  const inFlight = useRef(false)
  // Hər seçimin öz seansı var — admin hansına baxdığını seçir (null = ən son açıq)
  const pickedRef = useRef<number | null>(null)

  async function load() {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const want = pickedRef.current
      const d = await monitorDb.live(want)
      // Sorğu gedərkən başqa seans seçilibsə köhnə cavabı atırıq
      if (want !== pickedRef.current) return
      fetchedAt.current = Date.now()
      setData(d); setErr('')
    } catch { setErr('Serverlə əlaqə yoxdur — yenidən cəhd edilir…') }
    finally { inFlight.current = false }
  }

  useEffect(() => {
    load()
    const iv = setInterval(() => { if (!document.hidden) load() }, POLL_MS)
    const t = setInterval(() => setTick(x => x + 1), 1000)
    return () => { clearInterval(iv); clearInterval(t) }
  }, [])

  function pick(id: number) {
    pickedRef.current = id
    inFlight.current = false
    load()
  }

  if (session?.role !== 'superadmin') {
    return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Bu bölmə yalnız baş admin üçündür.</div>
  }
  if (!data) return <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>{err || 'Yüklənir…'}</div>

  const drift = Math.floor((Date.now() - fetchedAt.current) / 1000)
  const cfg = data.config
  const sess = data.session
  const running = sess?.status === 'running'
  const sessSec = sess ? sess.elapsedSec + (running ? drift : 0) : null
  const active: any[] = data.active || []
  const abandoned: any[] = data.abandoned || []
  const st = data.stats || {}
  const sessions: any[] = data.sessions || []
  const selName = (x: any) => x?.selectionName || 'Adsız seçim'

  async function act(op: 'pause' | 'resume' | 'end') {
    if (!sess) return
    if (op === 'end' && !confirm(`"${selName(sess)}" seansı bitirilsin? Sayğac dayanacaq, statistika qalacaq. Bu seçimə yeni təhsilalan girəndə yeni seans başlayacaq.`)) return
    setBusy(true)
    try {
      await monitorDb.session(sess.id, op)
      addLog('system', 'info', `Canlı nəzarət seansı (${selName(sess)}): ${op === 'pause' ? 'dayandırıldı' : op === 'resume' ? 'davam etdirildi' : 'bitirildi'}`)
      await load()
    } catch { setErr('Əməliyyat alınmadı') }
    setBusy(false)
  }

  // Seansı bütün qeydləri (aktiv, yarımçıq, təsdiqləyənlər, statistika) ilə silir
  async function removeSession() {
    if (!sess) return
    const open = sess.status !== 'ended'
    if (!confirm(`"${selName(sess)}" seansı silinsin? Seansın bütün qeydləri və statistikası silinəcək, geri qaytarıla bilməz.`
      + (open ? '\n\nSeans hələ açıqdır: təhsilalanlar seçimdə qalarsa, növbəti siqnalda bu seçim üçün yeni seans başlayacaq.' : ''))) return
    setBusy(true)
    try {
      await monitorDb.deleteSession(sess.id)
      addLog('system', 'warning', `Canlı nəzarət seansı silindi: ${selName(sess)}`,
        `Təsdiqləyən: ${st.submitted ?? 0} · Aktiv: ${active.length} · Yarımçıq: ${abandoned.length}`)
      pickedRef.current = null
      setData(null)
      await load()
    } catch { setErr('Seans silinmədi') }
    setBusy(false)
  }

  const statusBadge = !sess ? { t: 'Seans yoxdur', bg: '#f0f1f5', c: '#6b7080' }
    : sess.status === 'running' ? { t: '● Davam edir', bg: '#e8f8ee', c: '#1f6f43' }
    : sess.status === 'paused' ? { t: '❚❚ Dayandırılıb', bg: '#fff5e0', c: '#a86b00' }
    : { t: '■ Bitib', bg: '#f0f1f5', c: '#4a5060' }

  const kpi = (icon: string, label: string, val: string, sub?: string) => (
    <div className="card" style={{ padding: '16px 18px', flex: '1 1 170px', minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 6 }}>{icon} {label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#2b2f3a', fontVariantNumeric: 'tabular-nums' }}>{val}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
  )

  const th: React.CSSProperties = { textAlign: 'left', padding: '10px 14px', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.4, borderBottom: '1.5px solid var(--border)' }
  const td: React.CSSProperties = { padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #f0f1f5' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!cfg.enabled && (
        <div className="card" style={{ padding: '16px 20px', background: '#fff8e6', border: '1.5px solid #f1dca0', fontSize: 13.5 }}>
          ⚠️ Canlı nəzarət <b>sönülüdür</b> — təhsilalan səhifələri siqnal göndərmir.{' '}
          <Link to="/admin/super-settings" style={{ fontWeight: 700 }}>Superadmin parametrləri</Link>-ndən yandırın.
        </div>
      )}
      {err && <div style={{ fontSize: 12.5, color: '#c0392b', fontWeight: 700 }}>{err}</div>}

      {/* Seans seçicisi — hər seçimin öz seansı */}
      {sessions.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sessions.map(x => {
            const on = sess?.id === x.id
            return (
              <button key={x.id} className={on ? 'btn btn-primary' : 'btn'} onClick={() => pick(x.id)}
                style={{ fontWeight: 700, color: !on && x.status === 'ended' ? 'var(--muted)' : undefined }}>
                {x.status === 'running' ? '● ' : x.status === 'paused' ? '❚❚ ' : '■ '}{selName(x)}
              </button>
            )
          })}
        </div>
      )}

      {/* Seans sayğacı */}
      <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 220px' }}>
          {sess && (
            <div style={{ fontSize: 18, fontWeight: 800, color: '#2b2f3a', marginBottom: 6 }}>📋 {selName(sess)}</div>
          )}
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>⏱️ Seansın ümumi müddəti</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: '#2b2f3a', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{fmt(sessSec)}</div>
          <span style={{ display: 'inline-block', marginTop: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 800, background: statusBadge.bg, color: statusBadge.c }}>{statusBadge.t}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {sess?.status === 'running' && <button className="btn" disabled={busy} onClick={() => act('pause')}>❚❚ Dayandır</button>}
          {sess?.status === 'paused' && <button className="btn btn-primary" disabled={busy} onClick={() => act('resume')}>▶ Davam et</button>}
          {sess && sess.status !== 'ended' && <button className="btn" disabled={busy} onClick={() => act('end')} style={{ color: '#c0392b' }}>■ Bitir</button>}
          {sess && <button className="btn" disabled={busy} onClick={removeSession}
            title="Seansı bütün qeydləri ilə sil"
            style={{ color: '#cf1322', borderColor: '#ffccc7', background: '#fff5f5' }}>🗑 Sil</button>}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', flexBasis: '100%' }}>
          Hər seçimin öz seansı var: seçimə ilk təhsilalan girəndə başlayır, yalnız «Bitir» basılanda bitir.
        </div>
      </div>

      {/* Statistika */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {kpi('👥', 'Hazırda seçimdə', String(active.length), active.some(a => a.offline) ? `${active.filter(a => a.offline).length} nəfər əlaqəsiz` : undefined)}
        {kpi('✅', 'Təsdiqləyib', String(st.submitted ?? 0))}
        {kpi('⚡', 'Ən tez', fmt(st.fastest?.sec), st.fastest?.name)}
        {kpi('🐢', 'Ən gec', fmt(st.slowest?.sec), st.slowest?.name)}
        {kpi('📊', 'Orta müddət', fmt(st.averageSec))}
        {kpi('⚠️', 'Yarımçıq', String(abandoned.length), `${cfg.abandonMin} dəq siqnal yoxdursa`)}
      </div>

      {/* Aktiv siyahı */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 18px', fontWeight: 800, fontSize: 14, borderBottom: '1.5px solid var(--border)' }}>
          🟢 Hazırda seçim edənlər <span style={{ color: 'var(--muted)', fontWeight: 600 }}>· {active.length}</span>
        </div>
        {active.length === 0 ? (
          <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>Hazırda seçimdə heç kim yoxdur</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>№</th><th style={th}>Ad soyad</th><th style={th}>FİN</th><th style={th}>Qrup</th><th style={th}>Müəssisə</th><th style={th}>Seçimdə</th>
              </tr></thead>
              <tbody>
                {active.map((a, i) => (
                  <tr key={a.studentId} style={{ background: a.offline ? '#f6f6f8' : undefined, color: a.offline ? '#8a8f9c' : undefined }}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontWeight: 700 }}>
                      <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, marginRight: 8, background: a.offline ? '#b0b4c0' : '#34a36b' }} />
                      {a.name}
                      {a.offline && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: '#8a8f9c' }}>əlaqə kəsilib</span>}
                    </td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{a.fin || '—'}</td>
                    <td style={td}>{a.group || '—'}</td>
                    <td style={td}>{a.institution || '—'}</td>
                    <td style={{ ...td, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{fmt(a.elapsedSec + drift)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Yarımçıq */}
      {abandoned.length > 0 && (
        <div className="card" style={{ overflow: 'hidden', border: '1.5px solid #f3c6c0' }}>
          <div style={{ padding: '14px 18px', fontWeight: 800, fontSize: 14, borderBottom: '1.5px solid #f3c6c0', background: '#fff5f3', color: '#a8321f' }}>
            ⚠️ Yarımçıq qalanlar · {abandoned.length}
            <span style={{ fontWeight: 600, fontSize: 12, marginLeft: 8, color: '#b0645a' }}>(yenidən girsə avtomatik aktiv siyahıya qayıdır)</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Ad soyad</th><th style={th}>FİN</th><th style={th}>Qrup</th><th style={th}>Müəssisə</th><th style={th}>Seçimdə olub</th><th style={th}>Son siqnal</th>
              </tr></thead>
              <tbody>
                {abandoned.map(a => (
                  <tr key={a.studentId}>
                    <td style={{ ...td, fontWeight: 700 }}>{a.name}</td>
                    <td style={{ ...td, fontFamily: 'monospace' }}>{a.fin || '—'}</td>
                    <td style={td}>{a.group || '—'}</td>
                    <td style={td}>{a.institution || '—'}</td>
                    <td style={td}>{fmt(a.elapsedSec)}</td>
                    <td style={td}>{new Date(a.lastSeenAt.endsWith('Z') ? a.lastSeenAt : a.lastSeenAt + 'Z').toLocaleTimeString('az-AZ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
