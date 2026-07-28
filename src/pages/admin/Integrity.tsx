import { useState, useEffect } from 'react'
import { integrityDb, addLog, type IntegritySeal } from '../../db'
import { can } from '../../permissions'

const GOLD = '#c9962a'
const SEAL_KEY = 'isp_integrity_seal'

interface SavedSeal { hash: string; students: number; submissions: number; at: string }

export default function Integrity() {
  const canView = can('integrity.view')
  const [saved, setSaved] = useState<SavedSeal | null>(null)
  const [current, setCurrent] = useState<IntegritySeal | null>(null)
  const [loading, setLoading] = useState(false)
  const [checkInput, setCheckInput] = useState('')
  const [checkResult, setCheckResult] = useState<null | { same: boolean; now: string }>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    try { const s = localStorage.getItem(SEAL_KEY); if (s) setSaved(JSON.parse(s)) } catch { /* */ }
  }, [])

  async function computeSeal(): Promise<IntegritySeal | null> {
    setErr('')
    try { return await integrityDb.seal() }
    catch (e: any) { setErr(e?.message || 'Möhür alına bilmədi'); return null }
  }

  // ── Möhürlə: hesabla və yadda saxla ──
  async function handleSeal() {
    setLoading(true)
    const r = await computeSeal()
    setLoading(false)
    if (!r) return
    const s: SavedSeal = { hash: r.hash, students: r.students, submissions: r.submissions, at: r.at }
    localStorage.setItem(SEAL_KEY, JSON.stringify(s))
    setSaved(s)
    setCurrent(r)
    addLog('admin', 'success', 'Bazanın bütövlük möhürü alındı', `SHA-256: ${r.hash.slice(0, 24)}… · ${r.students} təhsilalan`)
  }

  // ── Yoxla: cari hash-i əvvəlki ilə müqayisə et ──
  async function handleVerify() {
    setLoading(true)
    const r = await computeSeal()
    setLoading(false)
    if (!r) return
    const expected = (checkInput.match(/[a-fA-F0-9]{64}/)?.[0] || saved?.hash || '').toLowerCase()
    if (!expected) { setErr('Müqayisə üçün əvvəlki möhür yoxdur — əvvəlcə möhürlə, ya da SHA-256 kodunu daxil et.'); return }
    const same = r.hash === expected
    setCheckResult({ same, now: r.hash })
    addLog('admin', same ? 'info' : 'warning',
      same ? 'Bütövlük yoxlaması: baza dəyişməyib' : 'Bütövlük yoxlaması: BAZADA DƏYİŞİKLİK',
      `Cari: ${r.hash.slice(0, 24)}… · Möhür: ${expected.slice(0, 24)}…`)
  }

  function downloadSeal() {
    if (!saved) return
    const content = `${saved.hash}\r\nTəhsilalan: ${saved.students}\r\nSubmission: ${saved.submissions}\r\nTarix: ${saved.at}\r\nAlqoritm: SHA-256\r\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    a.download = `baza-mohur-${new Date().toISOString().slice(0, 10)}.seal.txt`
    a.click()
  }

  function copyHash(h: string) { navigator.clipboard?.writeText(h).catch(() => {}) }

  if (!canView) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>İcazəniz yoxdur.</div>

  return (
    <div className="page-body" style={{ maxWidth: 1080 }}>
      <div className="card" style={{ padding: '14px 18px', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 30 }}>🛡️</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>SHA-256</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              Bazanın SHA-256 barmaq izini çıxarır. Sonra yenidən yoxlayıb məlumatların dəyişmədiyini sübut edirsən.
            </div>
          </div>
        </div>
      </div>

      {err && (
        <div className="card" style={{ padding: 14, background: '#fdeeec', border: '1.5px solid #f2a49c', color: '#c0281a', fontSize: 13 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16, alignItems: 'start' }}>
      {/* ── 1. MÖHÜRLƏ ── */}
      <div className="card" style={{ padding: 18, marginBottom: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🔒 1. Möhürlə</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          Tədbirin sonunda bir dəfə bas — bazanın hazırkı vəziyyətini möhürlə.
        </div>
        <button onClick={handleSeal} disabled={loading}
          style={{ padding: '11px 22px', borderRadius: 10, border: 'none', background: GOLD, color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: loading ? 'default' : 'pointer', opacity: loading ? .6 : 1 }}>
          {loading ? 'Hesablanır…' : '🔒 Bazanı möhürlə'}
        </button>

        {saved && (
          <div style={{ marginTop: 16, background: '#faf7ef', border: `1.5px solid ${GOLD}55`, borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5 }}>SHA-256 möhürü</div>
            <div style={{ fontFamily: 'Consolas, monospace', fontSize: 14, wordBreak: 'break-all', margin: '8px 0', userSelect: 'all', lineHeight: 1.5 }}>{saved.hash}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{saved.students} təhsilalan · {saved.submissions} seçim · {saved.at}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button onClick={downloadSeal} style={btnGhost}>💾 Möhürü yüklə</button>
              <button onClick={() => copyHash(saved.hash)} style={btnGhost}>📋 Kopyala</button>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
              ⚠ Möhürü təhlükəsiz yerə də köçür (yüklə / kopyala / foto). Kod kənarda olsa heç kim onu saxtalaşdıra bilməz.
            </div>
          </div>
        )}
      </div>

      {/* ── 2. YOXLA ── */}
      <div className="card" style={{ padding: 18, marginBottom: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>✔️ 2. Yoxla</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          Sonra istənilən vaxt bas — indiki baza möhürlənmiş vəziyyətlə müqayisə olunur.
          {saved ? '' : ' (Müqayisə üçün əvvəlcə möhürlə, ya da aşağıya əvvəlki SHA-256 kodunu yapışdır.)'}
        </div>
        <textarea value={checkInput} onChange={e => setCheckInput(e.target.value)}
          placeholder={saved ? 'Yadda saxlanmış möhürlə müqayisə olunacaq (istəsən başqa SHA-256 kodu yapışdır)' : 'Əvvəlki SHA-256 kodunu bura yapışdır'}
          style={{ width: '100%', minHeight: 56, border: '1.5px solid #d9e1ef', borderRadius: 10, padding: '10px 12px', fontFamily: 'Consolas, monospace', fontSize: 13, resize: 'vertical', marginBottom: 12 }} />
        <button onClick={handleVerify} disabled={loading}
          style={{ padding: '11px 22px', borderRadius: 10, border: 'none', background: '#2b579a', color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: loading ? 'default' : 'pointer', opacity: loading ? .6 : 1 }}>
          {loading ? 'Hesablanır…' : '✔️ Eyniliyi yoxla'}
        </button>

        {checkResult && (
          <div style={{ marginTop: 16, borderRadius: 12, padding: 18, textAlign: 'center',
            background: checkResult.same ? '#eafaf0' : '#fdeeec',
            border: `2px solid ${checkResult.same ? '#7fd6a0' : '#f2a49c'}`,
            color: checkResult.same ? '#147a44' : '#c0281a' }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {checkResult.same ? '✓  EYNİDİR — baza dəyişməyib' : '✕  FƏRQLİDİR — bazada dəyişiklik olub'}
            </div>
            <div style={{ fontSize: 12.5, marginTop: 6, opacity: .85 }}>
              {checkResult.same
                ? 'Məlumatlar möhürləndiyi andakı ilə tam eynidir. Bütövlük təsdiqləndi.'
                : `İndiki: ${checkResult.now.slice(0, 24)}…`}
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

const btnGhost: React.CSSProperties = {
  padding: '9px 16px', borderRadius: 9, border: '1.5px solid #e4e7f0',
  background: '#f4f6fb', color: '#3a4056', fontWeight: 700, fontSize: 12.5, cursor: 'pointer',
}
