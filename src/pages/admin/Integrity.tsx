import { useState, useEffect, useRef } from 'react'
import { integrityDb, addLog } from '../../db'
import { can } from '../../permissions'
import { P } from '../../palette'

const GOLD = `${P.navy}`
const SEAL_KEY = 'isp_integrity_seal'
type Src = 'db' | 'file'

interface SavedSeal { hash: string; label: string; at: string }

// ── SHA-256: brauzerin öz crypto-su, olmasa daxili JS impl ──
async function sha256(buf: ArrayBuffer): Promise<string> {
  if (window.crypto?.subtle) {
    try {
      const h = await crypto.subtle.digest('SHA-256', buf)
      return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('')
    } catch { /* fallback */ }
  }
  return sha256js(new Uint8Array(buf))
}
function sha256js(data: Uint8Array): string {
  const rr = (n: number, x: number) => (x >>> n) | (x << (32 - n))
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
  let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]
  const l = data.length, bl = ((l + 8 >> 6) + 1) * 64, m = new Uint8Array(bl)
  m.set(data); m[l] = 0x80
  const bits = l * 8, dv = new DataView(m.buffer)
  dv.setUint32(bl - 4, bits >>> 0); dv.setUint32(bl - 8, Math.floor(bits / 0x100000000))
  const w = new Uint32Array(64)
  for (let i = 0; i < bl; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(i + t * 4)
    for (let t = 16; t < 64; t++) {
      const s0 = rr(7, w[t-15]) ^ rr(18, w[t-15]) ^ (w[t-15] >>> 3)
      const s1 = rr(17, w[t-2]) ^ rr(19, w[t-2]) ^ (w[t-2] >>> 10)
      w[t] = (w[t-16] + s0 + w[t-7] + s1) | 0
    }
    let [a,b,c,d,e,f,g,h] = H
    for (let t = 0; t < 64; t++) {
      const S1 = rr(6,e) ^ rr(11,e) ^ rr(25,e), ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0
      const S0 = rr(2,a) ^ rr(13,a) ^ rr(22,a), mj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + mj) | 0
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0
    }
    H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0]
  }
  return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}
function readFile(file: File): Promise<ArrayBuffer> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = rej; r.readAsArrayBuffer(file) })
}

export default function Integrity() {
  const canView = can('integrity.view')
  const [saved, setSaved] = useState<SavedSeal | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [sealSrc, setSealSrc] = useState<Src>('db')
  const [sealFile, setSealFile] = useState<File | null>(null)
  const sealFileRef = useRef<HTMLInputElement>(null)

  const [verifySrc, setVerifySrc] = useState<Src>('db')
  const [verifyFile, setVerifyFile] = useState<File | null>(null)
  const verifyFileRef = useRef<HTMLInputElement>(null)
  const [checkInput, setCheckInput] = useState('')
  const [checkResult, setCheckResult] = useState<null | { same: boolean; now: string }>(null)

  useEffect(() => {
    try { const s = localStorage.getItem(SEAL_KEY); if (s) setSaved(JSON.parse(s)) } catch { /* */ }
  }, [])

  // Mənbədən hash + etiket al (db → API, file → yüklənmiş fayl)
  async function computeHash(src: Src, file: File | null): Promise<{ hash: string; label: string } | null> {
    setErr('')
    try {
      if (src === 'db') {
        const r = await integrityDb.seal()
        return { hash: r.hash, label: `Baza · ${r.students} təhsilalan · ${r.submissions} seçim` }
      } else {
        if (!file) { setErr('Əvvəlcə fayl seç.'); return null }
        const buf = await readFile(file)
        const h = await sha256(buf)
        return { hash: h, label: `Fayl · ${file.name} (${(file.size / 1024).toFixed(1)} KB)` }
      }
    } catch (e: any) { setErr(e?.message || 'Hash alına bilmədi'); return null }
  }

  async function handleSeal() {
    setLoading(true)
    const r = await computeHash(sealSrc, sealFile)
    setLoading(false)
    if (!r) return
    const s: SavedSeal = { hash: r.hash, label: r.label, at: new Date().toLocaleString('az-AZ') }
    localStorage.setItem(SEAL_KEY, JSON.stringify(s))
    setSaved(s)
    addLog('admin', 'success', 'SHA-256 möhürü alındı', `${r.label} · ${r.hash.slice(0, 24)}…`)
  }

  async function handleVerify() {
    setLoading(true)
    const r = await computeHash(verifySrc, verifyFile)
    setLoading(false)
    if (!r) return
    const expected = (checkInput.match(/[a-fA-F0-9]{64}/)?.[0] || saved?.hash || '').toLowerCase()
    if (!expected) { setErr('Müqayisə üçün əvvəlki möhür yoxdur — əvvəlcə möhürlə, ya da SHA-256 kodunu daxil et.'); return }
    const same = r.hash === expected
    setCheckResult({ same, now: r.hash })
    addLog('admin', same ? 'info' : 'warning',
      same ? 'SHA-256 yoxlaması: dəyişməyib' : 'SHA-256 yoxlaması: DƏYİŞİKLİK var',
      `${r.label} · Cari: ${r.hash.slice(0, 16)}… · Möhür: ${expected.slice(0, 16)}…`)
  }

  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null)

  function downloadSeal() {
    if (!saved) return
    const content = `${saved.hash}\r\nMənbə: ${saved.label}\r\nTarix: ${saved.at}\r\nAlqoritm: SHA-256\r\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    a.download = `sha256-mohur-${new Date().toISOString().slice(0, 10)}.seal.txt`
    a.click()
  }
  // navigator.clipboard yalnız təhlükəsiz kontekstdə (https / localhost) mövcuddur.
  // Şəbəkədən http://IP:5174 ilə girildikdə o, undefined olur — ona görə köhnə
  // execCommand üsulu ehtiyat variant kimi saxlanılır.
  async function copyHash(h: string) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(h)
      } else {
        const ta = document.createElement('textarea')
        ta.value = h
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus(); ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('execCommand uğursuz')
      }
      setCopied('ok')
    } catch {
      setCopied('fail')
    }
    setTimeout(() => setCopied(null), 2500)
  }

  if (!canView) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>İcazəniz yoxdur.</div>

  // Mənbə seçici (segmented)
  const SrcToggle = ({ value, onChange }: { value: Src; onChange: (s: Src) => void }) => (
    <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
      {([['db', '🗄️ Hazırkı baza'], ['file', '📄 Fayl yüklə']] as [Src, string][]).map(([v, lbl]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            border: `1.5px solid ${value === v ? GOLD : '#e0e4f0'}`,
            background: value === v ? `${P.tint2}` : '#f8f9fd',
            color: value === v ? `${P.steel}` : '#8890a5',
          }}>{lbl}</button>
      ))}
    </div>
  )
  const FilePick = ({ file, onPick, inputRef }: { file: File | null; onPick: (f: File | null) => void; inputRef: React.RefObject<HTMLInputElement> }) => (
    <div style={{ marginBottom: 12 }}>
      <button onClick={() => inputRef.current?.click()}
        style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1.5px dashed #cfd6e6', background: '#fbfcfe', color: '#5a6178', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>
        {file ? `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)` : '📂 Fayl seç…'}
      </button>
      <input ref={inputRef} type="file" hidden onChange={e => onPick(e.target.files?.[0] || null)} />
    </div>
  )

  return (
    <div className="page-body" style={{ maxWidth: 1080 }}>
      {err && (
        <div className="card" style={{ padding: 14, background: '#fdeeec', border: '1.5px solid #f2a49c', color: '#c0281a', fontSize: 13, marginBottom: 14 }}>
          {err}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16, alignItems: 'start' }}>
        {/* ── 1. MÖHÜRLƏ ── */}
        <div className="card" style={{ padding: 18, marginBottom: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🔒 1. Möhürlə</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            Mənbəni seç və möhür vur.
          </div>
          <SrcToggle value={sealSrc} onChange={setSealSrc} />
          {sealSrc === 'file' && <FilePick file={sealFile} onPick={setSealFile} inputRef={sealFileRef} />}
          <button onClick={handleSeal} disabled={loading}
            style={{ padding: '11px 22px', borderRadius: 10, border: 'none', background: GOLD, color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: loading ? 'default' : 'pointer', opacity: loading ? .6 : 1 }}>
            {loading ? 'Hesablanır…' : '🔒 Möhürlə'}
          </button>

          {saved && (
            <div style={{ marginTop: 16, background: `${P.tint2}`, border: `1.5px solid ${GOLD}55`, borderRadius: 12, padding: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: .5 }}>SHA-256 möhürü</div>
              <div style={{ fontFamily: 'Consolas, monospace', fontSize: 14, wordBreak: 'break-all', margin: '8px 0', userSelect: 'all', lineHeight: 1.5 }}>{saved.hash}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{saved.label} · {saved.at}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={downloadSeal} style={btnGhost}>💾 Möhürü yüklə</button>
                <button onClick={() => copyHash(saved.hash)} style={btnGhost}>
                  {copied === 'ok' ? '✅ Kopyalandı' : copied === 'fail' ? '⚠️ Alınmadı' : '📋 Kopyala'}
                </button>
              </div>
              {copied === 'fail' && (
                <div style={{ fontSize: 11.5, color: '#c0392b', marginTop: 8 }}>
                  Brauzer kopyalamağa icazə vermədi. Yuxarıdakı kodu siçanla seçib
                  <strong> Ctrl+C</strong> et, ya da “💾 Möhürü yüklə” düyməsini işlət.
                </div>
              )}
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10, lineHeight: 1.5 }}>
                ⚠ Möhürü təhlükəsiz yerə də köçür (yüklə / kopyala / foto).
              </div>
            </div>
          )}
        </div>

        {/* ── 2. YOXLA ── */}
        <div className="card" style={{ padding: 18, marginBottom: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>✔️ 2. Yoxla</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            Mənbəni seç, sonra əvvəlki möhürlə müqayisə et.
          </div>
          <SrcToggle value={verifySrc} onChange={setVerifySrc} />
          {verifySrc === 'file' && <FilePick file={verifyFile} onPick={setVerifyFile} inputRef={verifyFileRef} />}
          <textarea value={checkInput} onChange={e => setCheckInput(e.target.value)}
            placeholder={saved ? 'Yadda saxlanmış möhürlə müqayisə olunacaq (istəsən başqa SHA-256 kodu yapışdır)' : 'Əvvəlki SHA-256 kodunu bura yapışdır'}
            style={{ width: '100%', minHeight: 52, border: '1.5px solid #d9e1ef', borderRadius: 10, padding: '10px 12px', fontFamily: 'Consolas, monospace', fontSize: 13, resize: 'vertical', marginBottom: 12 }} />
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
                {checkResult.same ? '✓  EYNİDİR — dəyişməyib' : '✕  FƏRQLİDİR — dəyişiklik olub'}
              </div>
              <div style={{ fontSize: 12.5, marginTop: 6, opacity: .85 }}>
                {checkResult.same
                  ? 'Möhürləndiyi andakı ilə tam eynidir. Bütövlük təsdiqləndi.'
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
