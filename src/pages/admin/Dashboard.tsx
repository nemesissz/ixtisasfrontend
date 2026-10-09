import { useState, useEffect, useMemo, useCallback, Fragment } from 'react'
import { useActiveInst } from '../../activeInst'
import * as XLSX from 'xlsx'
import { institutionDb, userDb, treeDb, selectionDb, submissionDb, cohortDb, POLL_MS, usePoll } from '../../db'
import InstIcon from '../../components/InstIcon'
import InstTabs from '../../components/InstTabs'
import { formatDate } from '../../utils-date'
import { canChoose } from '../../quota-pool'
import { ord } from '../../ordinal'
import { P, O, IS_OLD_PALETTE, hexRgb } from '../../palette'

// ── Köməkçilər ────────────────────────────────────────────────────────────────
function getLeaves(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes || []) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeaves(n.children, [...anc, n]))
  }
  return res
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

// Ekranda göstərmək üçün faiz mətni. `pct` böyük məxrəclərdə yanıldır: 687 nəfərdən
// 1-i seçim etdikdə 0.15% → Math.round → "0%", yəni real fəaliyyət yoxa çıxır.
// Sıfır YALNIZ pay həqiqətən sıfır olduqda görünməlidir; kiçik paylar onda kəsr
// dəqiqliyi ilə, çox kiçikləri isə "<0.1" kimi verilir.
const pctText = (a: number, b: number): string => {
  if (b <= 0 || a <= 0) return '0'
  const v = (a / b) * 100
  if (v >= 1) return String(Math.round(v))
  return v >= 0.1 ? v.toFixed(1) : '<0.1'
}

// Donut seqmentinin və legend nişanının «Hesabatı yüklə» düyməsindəki qradiyentlə çəkilməsi
const GRAD = 'grad'
const GRAD_CSS = `linear-gradient(135deg,${P.navy},${P.steel})`

// ── SVG halqa (donut) ─────────────────────────────────────────────────────────
function Donut({ segments, size = 150, stroke = 20, center }: {
  segments: { value: number; color: string; label: string }[]; size?: number; stroke?: number; center?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          {/* «Hesabatı yüklə» düyməsi ilə eyni parlaq qradiyent */}
          <linearGradient id="donut-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={P.navy} />
            <stop offset="100%" stopColor={P.steel} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f7" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / total) * circ
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color === GRAD ? 'url(#donut-grad)' : s.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset}
              style={{ transition: 'stroke-dasharray .6s' }} />
          )
          offset += len
          return el
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {center}
      </div>
    </div>
  )
}

// ── Üfüqi sütun ─────────────────────────────────────────────────────────────
// Navy + polad palitrası — ardıcıl şkala: ən böyük dəyər tünd göy, kiçikləri fona doğru açılır
const SEQ_BASE = hexRgb(P.navy), SEQ_TO = hexRgb(P.seqTo)
function seqColor(rank: number, n: number): string {
  const t = n <= 1 ? 0 : (rank / (n - 1)) * 0.68
  return '#' + SEQ_BASE.map((v, i) => Math.round(v + (SEQ_TO[i] - v) * t).toString(16).padStart(2, '0')).join('')
}
function seqColors(values: number[]): string[] {
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a])
  const out: string[] = []
  order.forEach((idx, rank) => { out[idx] = seqColor(rank, values.length) })
  return out
}

function Bars({ data, max }: { data: { label: string; value: number; color: string; sub?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value))
  // Köhnə rejimdə hər bar öz rəngindədir, yenidə dəyərə görə ardıcıl şkala
  const cols = IS_OLD_PALETTE ? data.map(d => d.color) : seqColors(data.map(d => d.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 120, fontSize: 12, color: 'var(--text)', fontWeight: 600, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
          <div style={{ flex: 1, background: O('#e8ecf2', '#f0f2f8'), borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
            <div style={{ width: `${pct(d.value, m)}%`, background: cols[i], height: '100%', borderRadius: 6, minWidth: d.value > 0 ? 3 : 0, transition: 'width .5s' }} />
          </div>
          <div style={{ minWidth: 64, fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0, whiteSpace: 'nowrap' }}>{d.value}{d.sub ? <span style={{ color: 'var(--muted)', fontWeight: 500 }}> {d.sub}</span> : ''}</div>
        </div>
      ))}
    </div>
  )
}

// "Seçimlər üzrə yerləşmə statistikası" üçün: tək grid — ad, bar, say və faiz
// hər sətirdə eyni sütunlarda başlayır, bütün barlar eyni enlidir
function GridBars({ data, max }: { data: { label: string; value: number; color: string; sub?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value))
  // Köhnə rejimdə hər bar öz rəngindədir, yenidə dəyərə görə ardıcıl şkala
  const cols = IS_OLD_PALETTE ? data.map(d => d.color) : seqColors(data.map(d => d.value))
  const hasSub = data.some(d => d.sub)
  return (
    <div style={{
      display: 'grid', alignItems: 'center', columnGap: 10, rowGap: 10,
      gridTemplateColumns: `minmax(0, 120px) minmax(0, 1fr) minmax(4ch, max-content)${hasSub ? ' minmax(8ch, max-content)' : ''}`,
    }}>
      {data.map((d, i) => (
        <Fragment key={i}>
          <div title={d.label} style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
          <div style={{ background: O('#e8ecf2', '#f0f2f8'), borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
            <div style={{ width: `${pct(d.value, m)}%`, background: cols[i], height: '100%', borderRadius: 6, minWidth: d.value > 0 ? 3 : 0, transition: 'width .5s' }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{d.value}</div>
          {hasSub && <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{d.sub || ''}</div>}
        </Fragment>
      ))}
    </div>
  )
}

// ── Statistik hesabat (yüklənə bilən sənəd: çap/PDF + Word) ─────────────────────
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildStatsReportHtml(A: any, instLabel: string, selName: string): string {
  const today = formatDate(new Date())
  const p = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
  const N = A.instUsers.length

  const row = (k: string, v: any) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`

  // KPI icmalı
  const kpi = `
    <table class="t2">
      ${row('Ümumi təhsilalan', N)}
      ${A.levelStats.map((l: any) => row(l.name, l.count)).join('')}
      ${row('Ümumi kvota', A.totalQuota)}
      ${row('Yerləşdirilib', `${A.placed} (${p(A.placed, N)}%)`)}
      ${row('Seçim edib', `${A.submittedCount} (${p(A.submittedCount, N)}%)`)}
      ${row('Seçim etməyib', A.pendingCount)}
      ${row('Kvota doluluğu', `${p(A.placed, A.totalQuota)}% (${A.placed}/${A.totalQuota})`)}
      ${row('Ən aşağı bal', A.minScore.toFixed(1))}
      ${row('Orta bal', A.avgScore.toFixed(1))}
      ${row('Ən yüksək bal', A.maxScore.toFixed(1))}
      ${row('Seçim məmnuniyyəti (1-ci seçiminə düşən)', `${A.satisfaction}%`)}
    </table>`

  // Bal paylanması
  const scoreDist = `
    <table class="t">
      <thead><tr><th>Bal aralığı</th><th>Say</th><th>Faiz</th></tr></thead>
      <tbody>${A.scoreBuckets.map(([lo, hi]: any, i: number) =>
        `<tr><td>${lo}–${hi}</td><td class="c">${A.hist[i]}</td><td class="c">${p(A.hist[i], N)}%</td></tr>`).join('')}</tbody>
    </table>`

  // Seçim məmnuniyyəti (neçənci seçiminə düşdü)
  const choiceKeys = Object.keys(A.choiceDist).map(Number).sort((a, b) => a - b)
  const choice = choiceKeys.length ? `
    <table class="t">
      <thead><tr><th>Seçim sırası</th><th>Yerləşən say</th><th>Faiz</th></tr></thead>
      <tbody>${choiceKeys.map(c =>
        `<tr><td>${ord(Number(c))} seçim</td><td class="c">${A.choiceDist[c]}</td><td class="c">${A.placed > 0 ? ((A.choiceDist[c] / A.placed) * 100).toFixed(1) : '0'}%</td></tr>`).join('')}</tbody>
    </table>` : '<p class="muted">Hələ yerləşdirmə aparılmayıb.</p>'

  // Demoqrafiya
  const demo = (A.hasGender || A.hasSource) ? `
    <table class="t">
      <thead><tr><th>Kateqoriya</th><th>Say</th><th>Faiz</th></tr></thead>
      <tbody>
        ${A.hasGender ? `<tr><td>Qadın</td><td class="c">${A.fem}</td><td class="c">${p(A.fem, N)}%</td></tr>
        <tr><td>Kişi</td><td class="c">${A.mal}</td><td class="c">${p(A.mal, N)}%</td></tr>` : ''}
        ${A.hasSource ? `<tr><td>Mülki</td><td class="c">${A.mulki}</td><td class="c">${p(A.mulki, N)}%</td></tr>
        <tr><td>Lisey</td><td class="c">${A.lisey}</td><td class="c">${p(A.lisey, N)}%</td></tr>` : ''}
      </tbody>
    </table>` : ''

  // Qoşun növü / 1-ci səviyyə bölgüsü
  const branch = A.branchStats.length ? `
    <table class="t">
      <thead><tr><th>${esc(A.tree?.levelNames?.[0] || 'Bölmə')}</th><th>İxtisas</th><th>Kvota</th><th>Yerləşən</th><th>Tələb</th><th>Rəqabət</th></tr></thead>
      <tbody>${A.branchStats.map((b: any) =>
        `<tr><td>${esc(b.name)}</td><td class="c">${b.specs}</td><td class="c">${b.quota}</td><td class="c">${b.placed}</td><td class="c">${b.demand}</td><td class="c">${b.quota > 0 ? (b.demand / b.quota).toFixed(1) : '0'}×</td></tr>`).join('')}</tbody>
    </table>` : ''

  // Fənn ortalamaları
  const subj = A.subjectAvg.length ? `
    <table class="t">
      <thead><tr><th>Fənn</th><th>Orta bal</th><th>Say</th></tr></thead>
      <tbody>${A.subjectAvg.map((s: any) =>
        `<tr><td>${esc(s.name)}</td><td class="c">${s.avg.toFixed(1)}</td><td class="c">${s.count}</td></tr>`).join('')}</tbody>
    </table>` : ''

  // Qrup üzrə bölgü
  const group = A.hasGroups ? `
    <table class="t">
      <thead><tr><th>Qrup</th><th>Təhsilalan</th><th>Yerləşən</th>${A.hasGender ? '<th>Qadın/Kişi</th>' : ''}<th>Orta bal</th></tr></thead>
      <tbody>${A.groupStats.map((g: any) =>
        `<tr><td>${esc(g.name)}</td><td class="c">${g.count}</td><td class="c">${g.placed}</td>${A.hasGender ? `<td class="c">${g.fem}/${g.mal}</td>` : ''}<td class="c">${g.avg.toFixed(2)}</td></tr>`).join('')}</tbody>
    </table>` : ''

  // İxtisas performansı
  const perf = A.byLeaf.length ? `
    <table class="t">
      <thead><tr><th rowspan="2">İxtisas</th><th rowspan="2">Kvota</th><th rowspan="2">Yerləşən</th><th colspan="3">Lisey</th><th colspan="3">Mülki</th></tr>
      <tr><th>ən aşağı</th><th>orta</th><th>ən yuxarı</th><th>ən aşağı</th><th>orta</th><th>ən yuxarı</th></tr></thead>
      <tbody>${[...A.byLeaf].sort((a: any, b: any) => b.quota - a.quota).map((l: any) =>
        `<tr><td>${esc(l.name)}${l.path ? `<div class="sub">${esc(l.path)}</div>` : ''}</td><td class="c">${l.quota}</td><td class="c">${l.placed}</td><td class="c">${l.liseyMin ? l.liseyMin.toFixed(1) : '—'}</td><td class="c">${l.liseyAvg ? l.liseyAvg.toFixed(1) : '—'}</td><td class="c">${l.liseyMax ? l.liseyMax.toFixed(1) : '—'}</td><td class="c">${l.mülkiMin ? l.mülkiMin.toFixed(1) : '—'}</td><td class="c">${l.mülkiAvg ? l.mülkiAvg.toFixed(1) : '—'}</td><td class="c">${l.mülkiMax ? l.mülkiMax.toFixed(1) : '—'}</td></tr>`).join('')}</tbody>
    </table>` : ''

  // Rəqabət
  const comp = A.byLeaf.length ? `
    <div class="two">
      <div><h3>Ən çox rəqabətli ixtisaslar</h3>
        <table class="t"><thead><tr><th>#</th><th>İxtisas</th><th>Tələb/Yer</th><th>Rəqabət</th></tr></thead>
        <tbody>${A.mostCompetitive.map((l: any, i: number) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${l.demand}/${l.quota}</td><td class="c">${l.comp.toFixed(1)}×</td></tr>`).join('')}</tbody></table>
      </div>
      <div><h3>Ən az rəqabətli olan ixtisaslar</h3>
        <table class="t"><thead><tr><th>#</th><th>İxtisas</th><th>Tələb/Yer</th><th>Rəqabət</th></tr></thead>
        <tbody>${A.leastDemanded.map((l: any, i: number) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${l.demand}/${l.quota}</td><td class="c">${l.comp.toFixed(1)}×</td></tr>`).join('')}</tbody></table>
      </div>
    </div>` : ''

  // İxtisaslara maraq sıralaması — kvota nəzərə alınmadan xam tələb.
  // Ekrandakı cədvəllə eyni sütunlar; sıralama 1-ci seçim sayına görədir.
  const interest = A.byInterest.length ? `
    <table class="t">
      <thead><tr><th>#</th><th>İxtisas</th><th>Kvota</th><th>Uyğun namizəd</th><th>1-ci seçim %</th><th>1-ci seçim</th><th>İlk 3 seçim</th></tr></thead>
      <tbody>${A.byInterest.map((l: any, i: number) =>
        `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}${l.path ? `<div class="sub">${esc(l.path)}</div>` : ''}</td><td class="c">${l.quota}</td><td class="c">${l.eligible}</td><td class="c">${l.eligible > 0 ? ((l.demand / l.eligible) * 100).toFixed(1) : '—'}%</td><td class="c">${l.demand}</td><td class="c">${l.top3}</td></tr>`).join('')}</tbody>
    </table>` : ''

  const sec = (title: string, body: string) => body ? `<h2>${esc(title)}</h2>${body}` : ''

  return `<!DOCTYPE html><html lang="az"><head><meta charset="UTF-8"><title>Statistik hesabat — ${esc(instLabel)}</title>
<style>
  body { font-family: 'Times New Roman', serif; color: #111; max-width: 820px; margin: 0 auto; padding: 28px; font-size: 13px; line-height: 1.5; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 18px; }
  .head .t1 { font-size: 20px; font-weight: 800; letter-spacing: 1px; }
  .head .t2 { font-size: 14px; margin-top: 4px; }
  .head .meta { font-size: 12px; color: #444; margin-top: 6px; }
  h2 { font-size: 15px; margin: 22px 0 8px; border-left: 4px solid #2b579a; padding-left: 8px; color: #1a1a2e; }
  h3 { font-size: 13px; margin: 10px 0 6px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 8px; }
  table.t th, table.t td { border: 1px solid #999; padding: 5px 8px; }
  table.t th { background: #eceff5; font-weight: 700; text-align: left; }
  table.t2 td { border: 1px solid #ccc; padding: 5px 10px; }
  table.t2 .k { background: #f6f8fb; font-weight: 600; width: 55%; }
  table.t2 .v { font-weight: 700; }
  .c { text-align: center; }
  .sub { font-size: 11px; color: #666; }
  .muted { color: #777; font-style: italic; }
  .two { display: flex; gap: 16px; } .two > div { flex: 1; }
  .foot { margin-top: 26px; font-size: 11px; color: #555; border-top: 1px solid #ccc; padding-top: 8px; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } table { page-break-inside: avoid; } }
</style></head><body>
  <div class="head">
    <div class="t1">STATİSTİK HESABAT</div>
    <div class="t2">${esc(instLabel)}${selName ? ` — «${esc(selName)}»` : ''}</div>
    <div class="meta">İxtisas seçimi və yerləşdirmə statistikası · Tarix: ${today}</div>
  </div>
  ${sec('1. Ümumi göstəricilər', kpi)}
  ${sec('2. Bal paylanması', scoreDist)}
  ${sec('3. Seçim məmnuniyyəti', choice)}
  ${sec('4. Təhsil alanların tərkibi', demo)}
  ${sec(`5. ${A.tree?.levelNames?.[0] || 'Bölmə'} üzrə bölgü`, branch)}
  ${sec('6. Fənn üzrə orta ballar', subj)}
  ${sec('7. Qrup üzrə bölgü', group)}
  ${sec('8. İxtisas üzrə performans', perf)}
  ${sec('9. Rəqabət təhlili', comp)}
  ${sec('10. İxtisaslara maraq sıralaması', interest)}
  <div class="foot">Hesabat ${today} tarixində İxtisas Seçim Proqramı tərəfindən avtomatik hazırlanmışdır.</div>
</body></html>`
}

function Card({ title, children, span }: { title: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 16, padding: '18px 20px', gridColumn: span ? `span ${span}` : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        {title}
      </div>
      {children}
    </div>
  )
}


export default function Dashboard() {
  const [insts, setInsts] = useState<any[]>([])
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [allTrees, setAllTrees] = useState<any[]>([])
  const [allSels, setAllSels] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [instId, setInstId] = useActiveInst(insts)
  // Statistika HƏMİŞƏ tək bir struktur üzrədir: fərqli təhsilalan qruplarının
  // rəqəmləri bir-birinə qarışmamalıdır (struktur qrupu özündə saxlayır).
  const [treeId, setTreeId] = useState<string>('')
  const [cohorts, setCohorts] = useState<any[]>([])
  const [showAllChoices, setShowAllChoices] = useState(false)
  // maraq cədvəlinin sıralaması: sütun + istiqamət
  const [intSort, setIntSort] = useState<{ k: 'name' | 'ratio' | 'eligible' | 'demand' | 'top3'; asc: boolean }>({ k: 'demand', asc: false })
  const [subs, setSubs] = useState<any[]>([])
  const [reportMenu, setReportMenu] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = () => Promise.all([institutionDb.getAll(), userDb.getAll(), treeDb.getAll(), selectionDb.getAll()])
      .then(([i, u, t, s]) => {
        if (cancelled) return
        setInsts(i); setAllUsers(u); setAllTrees(t); setAllSels(s); setLoaded(true)
      })
    load()
    // real-time: tab aktiv olduqda hər 10 saniyədə avtomatik yenilənmə
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') load() }, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => { cohortDb.getAll().then(setCohorts) }, [])

  useEffect(() => {
    if (loaded && !instId && insts[0]?.id) setInstId(insts[0].id)
  }, [loaded, insts, instId])

  // Müəssisənin arxivlənməmiş strukturları
  const instTrees = useMemo(
    () => allTrees.filter((t: any) => t.institution === instId && !t.isArchived),
    [allTrees, instId])

  // Struktur seçilməyibsə (və ya müəssisə dəyişibsə) birincisinə keçirik
  useEffect(() => {
    if (!instTrees.length) { if (treeId) setTreeId(''); return }
    if (!instTrees.some((t: any) => t.id === treeId)) setTreeId(instTrees[0].id)
  }, [instTrees, treeId])

  const activeTree = useMemo(
    () => instTrees.find((t: any) => t.id === treeId) || null,
    [instTrees, treeId])

  // Strukturun təhsilalanları — qrupu strukturdan gəlir (bax: Specialties.usersForTree)
  const treeUsers = useMemo(() => {
    const inInst = allUsers.filter((u: any) => u.institution === instId)
    const cid = activeTree?.cohort || ''
    return cid ? inInst.filter((u: any) => u.cohort === cid) : inInst
  }, [allUsers, instId, activeTree?.cohort])

  // Seçim də strukturla bağlıdır: statistika hansı struktur seçilibsə, ona aid
  // seçimin göndərişlərini göstərməlidir.
  const sel = useMemo(() => {
    if (treeId) {
      return allSels.find((s: any) => s.treeId === treeId && s.status === 'published')
          || allSels.find((s: any) => s.treeId === treeId)
          || null
    }
    return allSels.find((s: any) => s.institution === instId && s.status === 'published')
        || allSels.find((s: any) => s.institution === instId)
        || null
  }, [allSels, instId, treeId])

  const loadSubs = useCallback(() => {
    if (sel) submissionDb.getBySelection(sel.id).then(setSubs)
    else setSubs([])
  }, [sel?.id])
  useEffect(() => { loadSubs() }, [loadSubs])
  usePoll(loadSubs)   // real-time: yeni göndərişlər statistikada avtomatik görünür

  // ── Qlobal göstəricilər (bütün müəssisələr) ──
  // ── Seçilmiş müəssisə analitikası ──
  const A = useMemo(() => {
    const instUsers = treeUsers
    const tree = activeTree || (sel && allTrees.find(t => t.id === sel.treeId)) || null
    const leaves = tree ? getLeaves(tree.nodes || []) : []
    // Rəqabət "tələbi" yalnız BİRİNCİ seçimə görə hesablanır (daha sərt ölçü):
    // ixtisası 1-ci seçim kimi yazanların sayı. (Əvvəl hər hansı sırada seçmək sayılırdı.)
    const firstChoice: Record<string, number> = {}
    const top3: Record<string, number> = {}
    for (const s of subs) {
      const f = s.ranking?.[0]; if (f) firstChoice[f] = (firstChoice[f] || 0) + 1
      for (const id of (s.ranking || []).slice(0, 3)) top3[id] = (top3[id] || 0) + 1
    }

    const placedUsers = instUsers.filter(u => u.placedSpecialtyId)
    // "Seçim etdi" — status sahəsi etibarsız ola bilər; faktiki göndərilmiş seçimə (submission),
    // status-a və yerləşdirmə faktına görə birləşdirilmiş şəkildə hesablanır
    const submittedIds = new Set(subs.map(s => s.userId))
    const didSubmit = (u: any) => submittedIds.has(u.id) || u.status === 'submitted' || !!u.placedSpecialtyId
    const submittedUsers = instUsers.filter(didSubmit)
    const submittedCount = submittedUsers.length
    const pendingCount = instUsers.length - submittedCount
    const unplacedSubmitted = submittedCount - placedUsers.length

    // leaf üzrə statistika
    const byLeaf = leaves.map(({ leaf, path }) => {
      const us = placedUsers.filter(u => u.placedSpecialtyId === leaf.id)
      const scores = us.map(u => u.score || 0)
      // mənbə üzrə bal aralığı (lisey / mülki ayrıca)
      const bySrc = (src: string) => us.filter(u => u.source === src).map(u => u.score || 0)
      const liseyS = bySrc('lisey'), mülkiS = bySrc('mülki')
      const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
      return {
        id: leaf.id, name: leaf.name, path: path.slice(0, -1).map((n: any) => n.name).join(' › '),
        quota: leaf.quota || 0, placed: us.length,
        avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        min: scores.length ? Math.min(...scores) : 0,
        max: scores.length ? Math.max(...scores) : 0,
        // bu ixtisası seçə bilən namizəd sayı (bütün səviyyələrdəki məhdudiyyətlərlə)
        eligible: instUsers.filter(u => canChoose(u, path, { preAssignLevel: sel?.preAssignLevel ?? null })).length,
        top3: top3[leaf.id] || 0,
        liseyMin: liseyS.length ? Math.min(...liseyS) : 0,
        liseyMax: liseyS.length ? Math.max(...liseyS) : 0,
        liseyAvg: mean(liseyS),
        mülkiAvg: mean(mülkiS),
        mülkiMin: mülkiS.length ? Math.min(...mülkiS) : 0,
        mülkiMax: mülkiS.length ? Math.max(...mülkiS) : 0,
        demand: firstChoice[leaf.id] || 0,
        firstChoice: firstChoice[leaf.id] || 0,
      }
    })

    // seçim məmnuniyyəti (neçənci seçiminə düşdü)
    const choiceDist: Record<number, number> = {}
    for (const u of placedUsers) { const c = u.choiceNum || 0; if (c > 0) choiceDist[c] = (choiceDist[c] || 0) + 1 }

    // bal paylanması — dinamik: ən aşağı baldan ən yüksəyə qədər bərabər hissələrə bölünür
    const allScores = instUsers.map(u => u.score || 0)
    const sMin = allScores.length ? Math.min(...allScores) : 0
    const sMax = allScores.length ? Math.max(...allScores) : 0
    const N_BINS = 5
    const bLo = Math.floor(sMin), bHi = Math.ceil(sMax)
    const bStep = Math.max(1, Math.ceil((bHi - bLo) / N_BINS))
    const scoreBuckets: number[][] = []
    for (let lo = bLo; lo < bHi || scoreBuckets.length === 0; lo += bStep) scoreBuckets.push([lo, lo + bStep])
    const hist = scoreBuckets.map(([lo, hi], idx) => instUsers.filter(u => {
      const s = u.score || 0
      return s >= lo && (idx === scoreBuckets.length - 1 ? s <= hi : s < hi)
    }).length)

    // demoqrafiya
    const fem = instUsers.filter(u => u.gender === 'qadın').length
    const mal = instUsers.filter(u => u.gender === 'kişi').length
    const hasGender = fem + mal > 0
    const mulki = instUsers.filter(u => u.source === 'mülki').length
    const lisey = instUsers.filter(u => u.source === 'lisey').length
    const hasSource = mulki + lisey > 0

    const totalQuota = byLeaf.reduce((s, l) => s + l.quota, 0)

    // Bal statistikası — bütün təhsilalanlar üzrə (qəbul balı profili).
    // ⚠ Üçü də EYNİ çoxluq üzərində hesablanmalıdır: əvvəl orta bala balı olmayanlar da
    // sıfır kimi daxil edilirdi, min/max isə onları kənarlaşdırırdı — nəticədə balsız
    // sətir əlavə olunan kimi orta bal süni şəkildə aşağı düşürdü.
    const scores = instUsers.map(u => u.score || 0).filter(s => s > 0).sort((a, b) => a - b)
    const n = scores.length
    const minScore = n ? scores[0] : 0
    const maxScore = n ? scores[n - 1] : 0
    const avgScore = n ? scores.reduce((s, v) => s + v, 0) / n : 0

    // Yerləşənlərin balı — "Yerləşmə statusu" kartı üçün. Yuxarıdakı ümumi profillə
    // qarışdırılmamalıdır: yerləşdirmə aparılmayıbsa bunlar boş qalır.
    const placedScores = placedUsers.map(u => u.score || 0).filter(s => s > 0).sort((a, b) => a - b)
    const pn = placedScores.length
    const placedMinScore = pn ? placedScores[0] : 0
    const placedMaxScore = pn ? placedScores[pn - 1] : 0
    const placedAvgScore = pn ? placedScores.reduce((s, v) => s + v, 0) / pn : 0

    // səviyyə adlarına görə struktur sayları (qoşun növü, mülki ixtisası, …)
    const levelNames: string[] = tree?.levelNames || []
    const levelCounts: number[] = levelNames.map(() => 0)
    const walkLevels = (nodes: any[], depth: number) => {
      for (const nd of nodes || []) {
        if (depth < levelCounts.length) levelCounts[depth]++
        if (nd.children?.length) walkLevels(nd.children, depth + 1)
      }
    }
    walkLevels(tree?.nodes || [], 0)
    const levelStats = levelNames.map((name, i) => ({ name, count: levelCounts[i] || 0 })).filter(l => l.count > 0)

    // qoşun növü (1-ci səviyyə) üzrə bölgü
    const branchStats = (tree?.nodes || []).map((top: any) => {
      const lv = getLeaves([top])
      const ids = new Set(lv.map(x => x.leaf.id))
      return {
        name: top.name,
        specs: lv.length,
        quota: lv.reduce((s, x) => s + (x.leaf.quota || 0), 0),
        placed: placedUsers.filter(u => ids.has(u.placedSpecialtyId)).length,
        demand: lv.reduce((s, x) => s + (firstChoice[x.leaf.id] || 0), 0),
      }
    }).filter((b: any) => b.quota > 0 || b.specs > 0)

    // qrup (1-k, 1-f, 2, 3-t …) üzrə bölgü — qrup məlumatı varsa
    const groupMap: Record<string, any[]> = {}
    for (const u of instUsers) {
      const g = (u.group ?? '').toString().trim()
      if (!g) continue
      ;(groupMap[g] ||= []).push(u)
    }
    const groupStats = Object.keys(groupMap).sort((a, b) => a.localeCompare(b, 'az', { numeric: true })).map(g => {
      const us = groupMap[g]
      const pl = us.filter(u => u.placedSpecialtyId)
      const sc = us.map(u => u.score || 0).filter(s => s > 0)
      return {
        name: g,
        count: us.length,
        placed: pl.length,
        mulki: us.filter(u => u.source === 'mülki').length,
        lisey: us.filter(u => u.source === 'lisey').length,
        fem: us.filter(u => u.gender === 'qadın').length,
        mal: us.filter(u => u.gender === 'kişi').length,
        avg: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : 0,
      }
    })
    const hasGroups = groupStats.length > 0

    // fənn üzrə orta ballar
    const subjKeys = [...new Set(instUsers.flatMap(u => Object.keys(u.subjects || {}).filter(k => u.subjects[k] != null)))]
    const subjectAvg = subjKeys.map(k => {
      const vals = instUsers.map(u => u.subjects?.[k]).filter((v: any) => v != null) as number[]
      return { name: k, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, count: vals.length }
    }).sort((a, b) => b.avg - a.avg)

    // rəqabət reytinqi
    const ranked = byLeaf.filter(l => l.quota > 0).map(l => ({ ...l, comp: l.demand / l.quota }))
    // Bütün ixtisaslar iki yarıya bölünür: rəqabətli yarı + az tələb olunan yarı (dinamik)
    const byComp = [...ranked].sort((a, b) => b.comp - a.comp)
    const half = Math.ceil(byComp.length / 2)
    const mostCompetitive = byComp.slice(0, half)
    const leastDemanded = byComp.slice(half).reverse()

    // maraq sıralaması — 1-ci seçim sayına görə (rəqabətdən fərqli ölçü)
    const byInterest = [...byLeaf].sort((a, b) => b.demand - a.demand || b.top3 - a.top3)

    return {
      sel, tree, instUsers, leaves, byLeaf, byInterest, choiceDist, hist, scoreBuckets, totalQuota, avgScore,
      placed: placedUsers.length, submittedCount, pendingCount, unplacedSubmitted,
      fem, mal, hasGender, mulki, lisey, hasSource,
      minScore, maxScore, placedMinScore, placedAvgScore, placedMaxScore,
      branchStats, subjectAvg, mostCompetitive, leastDemanded, levelStats,
      groupStats, hasGroups,
      satisfaction: pct(choiceDist[1] || 0, placedUsers.length),
    }
  }, [instId, treeUsers, activeTree, allTrees, sel, subs])

  // performans cedveli sabit siralidir: kvotaya gore azalan
  const sortedLeaves = useMemo(() => [...A.byLeaf].sort((a, b) => b.quota - a.quota), [A.byLeaf])

  // maraq cədvəli — seçilmiş sütuna görə sıralanır
  const sortedInterest = useMemo(() => {
    const val = (l: any) => {
      switch (intSort.k) {
        case 'name':     return l.name || ''
        case 'ratio':    return l.eligible > 0 ? l.demand / l.eligible : -1
        case 'eligible': return l.eligible
        case 'top3':     return l.top3
        default:         return l.demand
      }
    }
    const arr = [...A.byInterest]
    arr.sort((a, b) => {
      const x = val(a), y = val(b)
      const c = typeof x === 'string' ? String(x).localeCompare(String(y), 'az') : (x as number) - (y as number)
      return intSort.asc ? c : -c
    })
    return arr
  }, [A.byInterest, intSort])

  const activeInst = insts.find(i => i.id === instId)

  // ── Statistik hesabatı sənəd kimi çıxar (çap/PDF + Word) ──
  // Hesabat başlığı: müəssisə + struktur (statistika tək struktur üzrədir)
  const reportScope = () => {
    const c = activeTree ? cohortLabelOf(activeTree) : ''
    return [activeInst?.label || '', c || activeTree?.name || ''].filter(Boolean).join(' — ')
  }
  const reportName = () => `Statistika_${(reportScope() || 'muessise').replace(/[^\wəğıöüçşĞİÖÜÇŞƏ]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}`
  function printReport() {
    const html = buildStatsReportHtml(A, reportScope() || activeInst?.label || '', A.sel?.name || '')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html); w.document.close()
    w.onload = () => { w.focus(); w.print() }
    setTimeout(() => { try { w.focus(); w.print() } catch {} }, 400)
  }
  function exportReportWord() {
    const html = buildStatsReportHtml(A, reportScope() || activeInst?.label || '', A.sel?.name || '')
    const blob = new Blob(['﻿', html], { type: 'application/msword' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${reportName()}.doc`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function exportReportExcel() {
    const pc = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)
    const N = A.instUsers.length
    const wb = XLSX.utils.book_new()

    // İcmal vərəqi
    const icmal: any[][] = [
      ['STATİSTİK HESABAT'],
      [activeInst?.label || '', A.sel?.name || ''],
      ['Tarix', new Date().toLocaleDateString('az-AZ')],
      [],
      ['ÜMUMİ GÖSTƏRİCİLƏR'],
      ['Ümumi təhsilalan', N],
      ...A.levelStats.map((l: any) => [l.name, l.count]),
      ['Ümumi kvota', A.totalQuota],
      ['Yerləşdirilib', A.placed, `${pc(A.placed, N)}%`],
      ['Seçim edib', A.submittedCount, `${pc(A.submittedCount, N)}%`],
      ['Seçim etməyib', A.pendingCount],
      ['Kvota doluluğu', `${pc(A.placed, A.totalQuota)}%`],
      ['Ən aşağı bal', +A.minScore.toFixed(1)],
      ['Orta bal', +A.avgScore.toFixed(1)],
      ['Ən yüksək bal', +A.maxScore.toFixed(1)],
      ['Məmnuniyyət (1-ci seçim)', `${A.satisfaction}%`],
      [],
      ['BAL PAYLANMASI'],
      ['Aralıq', 'Say', 'Faiz'],
      ...A.scoreBuckets.map(([lo, hi]: any, i: number) => [`${lo}–${hi}`, A.hist[i], `${pc(A.hist[i], N)}%`]),
    ]
    const choiceKeys = Object.keys(A.choiceDist).map(Number).sort((a, b) => a - b)
    if (choiceKeys.length) {
      icmal.push([], ['SEÇİM MƏMNUNİYYƏTİ'], ['Seçim sırası', 'Yerləşən', 'Faiz'])
      choiceKeys.forEach(c => icmal.push([`${ord(Number(c))} seçim`, A.choiceDist[c], A.placed > 0 ? `${((A.choiceDist[c] / A.placed) * 100).toFixed(1)}%` : '0%']))
    }
    if (A.hasGender || A.hasSource) {
      icmal.push([], ['DEMOQRAFİYA'], ['Kateqoriya', 'Say', 'Faiz'])
      if (A.hasGender) { icmal.push(['Qadın', A.fem, `${pc(A.fem, N)}%`], ['Kişi', A.mal, `${pc(A.mal, N)}%`]) }
      if (A.hasSource) { icmal.push(['Mülki', A.mulki, `${pc(A.mulki, N)}%`], ['Lisey', A.lisey, `${pc(A.lisey, N)}%`]) }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(icmal), 'İcmal')

    // İxtisaslar vərəqi
    const perf: any[][] = [
      // Hər ixtisas üzrə ümumi bal statistikası həmişə; mənbə bölgüsü varsa lisey/mülki ayrıca
      ['İxtisas', 'Yol', 'Kvota', 'Yerləşən', 'Doluluq %', 'Ümumi bal', '', '',
        ...(A.hasSource ? ['Lisey', '', '', 'Mülki', '', ''] : [])],
      ['', '', '', '', '', 'ən aşağı bal', 'orta bal', 'ən yuxarı bal',
        ...(A.hasSource ? ['ən aşağı bal', 'orta bal', 'ən yuxarı bal', 'ən aşağı bal', 'orta bal', 'ən yuxarı bal'] : [])],
      ...[...A.byLeaf].sort((a: any, b: any) => b.quota - a.quota).map((l: any) => {
        const n = (v: number) => (v ? +v.toFixed(1) : '')
        return [l.name, l.path, l.quota, l.placed, pc(l.placed, l.quota),
          n(l.min), n(l.avg), n(l.max),
          ...(A.hasSource ? [n(l.liseyMin), n(l.liseyAvg), n(l.liseyMax), n(l.mülkiMin), n(l.mülkiAvg), n(l.mülkiMax)] : [])]
      })]
    const perfWs = XLSX.utils.aoa_to_sheet(perf)
    // Qrup başlıqlarını birləşdir (Ümumi bal / Lisey / Mülki — hər biri 3 sütun)
    perfWs['!merges'] = [0, ...(A.hasSource ? [1, 2] : [])].map(g => ({ s: { r: 0, c: 5 + g * 3 }, e: { r: 0, c: 7 + g * 3 } }))
    perfWs['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, ...Array(A.hasSource ? 9 : 3).fill({ wch: 12 })]
    XLSX.utils.book_append_sheet(wb, perfWs, 'İxtisaslar')

    // Rəqabət vərəqi (1-ci seçim üzrə)
    const comp: any[][] = [['ƏN RƏQABƏTLİ (1-ci seçim üzrə)'], ['#', 'İxtisas', 'Tələb', 'Yer', 'Rəqabət'],
      ...A.mostCompetitive.map((l: any, i: number) => [i + 1, l.name, l.demand, l.quota, +l.comp.toFixed(1)]),
      [], ['ƏN AZ TƏLƏB OLUNAN'], ['#', 'İxtisas', 'Tələb', 'Yer', 'Rəqabət'],
      ...A.leastDemanded.map((l: any, i: number) => [i + 1, l.name, l.demand, l.quota, +l.comp.toFixed(1)])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comp), 'Rəqabət')

    // Maraq sıralaması vərəqi — kvotadan asılı olmayan xam tələb.
    // Rəqabət vərəqindən fərqlidir: orada tələb/yer nisbəti, burada isə ixtisası
    // seçə bilən namizədlərin neçəsinin onu 1-ci yazdığı göstərilir.
    if (A.byInterest.length) {
      const maraq: any[][] = [
        ['#', 'İxtisas', 'Yol', 'Kvota', 'Uyğun namizəd', '1-ci seçim %', '1-ci seçim', 'İlk 3 seçim'],
        ...A.byInterest.map((l: any, i: number) => [
          i + 1, l.name, l.path, l.quota, l.eligible,
          l.eligible > 0 ? +((l.demand / l.eligible) * 100).toFixed(1) : '',
          l.demand, l.top3,
        ])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(maraq), 'Maraq sıralaması')
    }

    // Qrup vərəqi (varsa)
    if (A.hasGroups) {
      const grp: any[][] = [['Qrup', 'Təhsilalan', 'Yerləşən', 'Qadın', 'Kişi', 'Orta bal'],
        ...A.groupStats.map((g: any) => [g.name, g.count, g.placed, g.fem, g.mal, +g.avg.toFixed(2)])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grp), 'Qruplar')
    }

    XLSX.writeFile(wb, `${reportName()}.xlsx`)
  }

  if (!loaded) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>Yüklənir...</div>

  const INST_KPIS: { label: string; value: any; accent: string; sub?: string }[] = [
    { label: 'Təhsilalan', value: A.instUsers.length, accent: '#722ed1' },
    ...A.levelStats.map((l: any) => ({ label: l.name, value: l.count, accent: '#13c2c2' })),
    { label: 'Ümumi kvota', value: A.totalQuota, accent: O(`${P.navy}`, '#fa8c16') },
    { label: 'Yerləşdirilən', value: A.placed, accent: O(`${P.steel}`, '#52c41a') },
    { label: 'Seçim etdi', value: A.submittedCount, accent: '#eb2f96' },
  ]

  // Strukturun təhsilalan qrupunun adı (nişanda göstərmək üçün)
  const cohortLabelOf = (t: any) =>
    t?.cohort ? (cohorts.find((c: any) => c.id === t.cohort)?.label || '') : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Müəssisə seçicisi + hesabat yükləmə */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <InstTabs insts={insts} activeId={instId} onSelect={setInstId} />
        </div>
        {activeInst && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button onClick={() => setReportMenu(v => !v)} title="Statistik hesabatı yüklə"
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10, border: 'none', background: O(`linear-gradient(135deg,${P.navy},${P.steel})`, 'linear-gradient(135deg,#b8860b,#e0a92e)'), color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: `0 3px 12px ${P.navy}55` }}>
              Hesabatı yüklə <span style={{ fontSize: 10 }}>{reportMenu ? '▲' : '▼'}</span>
            </button>
            {reportMenu && (
              <>
                <div onClick={() => setReportMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', right: 0, top: '112%', zIndex: 41, background: '#fff', border: '1.5px solid #e8eaf5', borderRadius: 12, boxShadow: '0 12px 32px #0002', overflow: 'hidden', minWidth: 210 }}>
                  {[
                    { label: 'PDF (çap üçün)', sub: 'Çap pəncərəsi açılır', color: O(`${P.navyDk}`, '#b8860b'), fn: printReport },
                    { label: 'Word (.doc)', sub: 'Redaktə oluna bilən sənəd', color: '#2b579a', fn: exportReportWord },
                    { label: 'Excel (.xlsx)', sub: 'Cədvəllər, 3-4 vərəq', color: '#1d6f42', fn: exportReportExcel },
                  ].map((o, i) => (
                    <button key={o.label} onClick={() => { o.fn(); setReportMenu(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 14px', border: 'none', borderTop: i ? '1px solid #e8ecf2' : 'none', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fd')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13, fontWeight: 800, color: o.color }}>{o.label}</span>
                        <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{o.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Struktur seçicisi ───────────────────────────────────────────────
          Statistika tək bir struktur üzrədir; struktur öz təhsilalan qrupunu
          gətirir, ona görə fərqli qrupların rəqəmləri qarışmır. Struktur adları
          uzun ola bildiyi üçün sekmə yox, açılan siyahı istifadə olunur. */}
      {activeInst && instTrees.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
            Struktur:
          </span>
          <select
            value={treeId}
            onChange={e => setTreeId(e.target.value)}
            title={activeTree ? activeTree.name : ''}
            style={{
              fontSize: 13, fontWeight: 700, padding: '8px 12px', borderRadius: 10,
              border: '1.5px solid #adc6ff', background: '#f0f5ff', color: '#0958d9',
              cursor: 'pointer', maxWidth: 520, minWidth: 260,
            }}>
            {instTrees.map((t: any) => {
              const lbl = cohortLabelOf(t)
              const cnt = allUsers.filter((u: any) =>
                u.institution === instId && (t.cohort ? u.cohort === t.cohort : true)).length
              return (
                <option key={t.id} value={t.id}>
                  {(lbl || t.name)} ({cnt})
                </option>
              )
            })}
          </select>
          {/* Seçilmiş strukturun tam adı — siyahıda qısa ad göstərilir */}
          {activeTree && (
            <span style={{
              fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 420,
            }}>{activeTree.name}</span>
          )}
        </div>
      )}

      {!activeInst ? (
        <Card title="Məlumat yoxdur">
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Müəssisə seçin və ya əlavə edin.</div>
        </Card>
      ) : (
        <>
          {/* Müəssisənin fərdi KPI-ları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {INST_KPIS.map(k => (
              <div key={k.label} style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '15px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 5, minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{k.value}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', overflowWrap: 'anywhere' }}>{k.label}{k.sub ? ` · ${k.sub}` : ''}</div>
              </div>
            ))}
          </div>

          {/* Sıra 1: status donut + bal paylanması */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            {/* Kart iki rejimlidir: yerləşdirmə bir kliklə aparıldığı üçün ondan ƏVVƏL
                diaqram boş dayanmasın — seçim gedişatını (seçim etdi / etmədi) göstərir.
                Yerləşdirmə aparılan kimi (placed > 0) avtomatik yerləşmə mənzərəsinə keçir. */}
            <Card title="Yerləşdirmə statusu">
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
                <Donut size={150} segments={A.placed ? [
                  { value: A.placed, color: O(GRAD, '#52c41a'), label: 'Yerləşdi' },
                  { value: A.unplacedSubmitted, color: O('#3e7c86', '#faad14'), label: 'Yerləşmədi' },
                  { value: A.pendingCount, color: '#d9d9d9', label: 'Seçim etmədi' },
                ] : [
                  { value: A.submittedCount, color: O(GRAD, '#52c41a'), label: 'Seçim etdi' },
                  { value: A.pendingCount, color: '#d9d9d9', label: 'Seçim etmədi' },
                ]} center={<>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>
                    {A.placed ? pctText(A.placed, A.instUsers.length) : pctText(A.submittedCount, A.instUsers.length)}%
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{A.placed ? 'yerləşdi' : 'seçim etdi'}</div>
                </>} />
                <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {(A.placed ? [
                    { c: O(GRAD_CSS, '#52c41a'), l: 'Yerləşdi', v: A.placed },
                    { c: O('#3e7c86', '#faad14'), l: 'Seçim etdi, yerləşdirilmədi', v: A.unplacedSubmitted },
                    { c: '#d9d9d9', l: 'Seçim etmədi', v: A.pendingCount },
                  ] : [
                    { c: O(GRAD_CSS, '#52c41a'), l: 'Seçim etdi', v: A.submittedCount },
                    { c: '#d9d9d9', l: 'Seçim etmədi', v: A.pendingCount },
                  ]).map(x => (
                    <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: x.c, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text)' }}>{x.l}</span>
                      <b style={{ color: 'var(--text)' }}>{x.v}</b>
                    </div>
                  ))}
                  {/* Bal göstəriciləri: yerləşdirmədən əvvəl bütün təhsilalanların, sonra yalnız yerləşənlərin balı */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginTop: 4, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                    {(A.placed
                      ? [['Ən aşağı bal', A.placedMinScore, O(`${P.slate}`, '#ff4d4f')], ['Orta bal', A.placedAvgScore, O(`${P.steel}`, '#c9962a')], ['Ən yüksək bal', A.placedMaxScore, O(`${P.navy}`, '#52c41a')]]
                      : [['Ən aşağı bal', A.minScore, O(`${P.slate}`, '#ff4d4f')], ['Orta bal', A.avgScore, O(`${P.steel}`, '#c9962a')], ['Ən yüksək bal', A.maxScore, O(`${P.navy}`, '#52c41a')]]
                    ).map(([l, v, c]: any) => (
                      <div key={l} style={{ textAlign: 'center', background: `${c}10`, borderRadius: 10, padding: '12px 4px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
                        <div style={{ fontSize: 18, fontWeight: 800, color: c, lineHeight: 1 }}>{Number(v).toFixed(1)}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Bal bölgüsü">
              {/* Yüksək baldan aşağıya doğru */}
              <Bars data={A.scoreBuckets.map(([lo, hi], i) => ({
                label: `${lo}–${hi}`, value: A.hist[i], color: O(`${P.navy}`, '#c9962a'),
              })).reverse()} />
            </Card>
          </div>

          {/* Sıra 2: seçimlər üzrə qəbul statistikası + demoqrafiya */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title="Seçimlər üzrə yerləşmə statistikası">
              {Object.keys(A.choiceDist).length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Hələ yerləşdirmə aparılmayıb.</div>
              ) : (
                <>
                  <GridBars data={Array.from({ length: Math.max(A.byLeaf.length, 1) }, (_, i) => i + 1)
                    .slice(0, showAllChoices ? undefined : 3)
                    .map(c => ({
                      label: `${ord(Number(c))} seçim`, value: A.choiceDist[c] || 0,
                      color: O(`${P.navy}`, c === 1 ? '#52c41a' : c <= 3 ? '#c9962a' : '#faad14'),
                      sub: `(${A.placed > 0 ? ((A.choiceDist[c] || 0) / A.placed * 100).toFixed(2) : '0.00'}%)`,
                    }))} />
                  {A.byLeaf.length > 3 && (
                    <button onClick={() => setShowAllChoices(v => !v)}
                      style={{ marginTop: 10, width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#f8f9fd', color: 'var(--blue)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      {showAllChoices ? '▲ Yığ' : `▼ Hamısına bax (${A.byLeaf.length})`}
                    </button>
                  )}
                </>
              )}
            </Card>

            {(A.hasGender || A.hasSource) && (
              <Card title="Təhsil alanların tərkibi">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {A.hasGender && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Cins</div>
                      <Bars data={[
                        { label: 'Qadın', value: A.fem, color: O('#7a9a62', '#eb2f96'), sub: `(${pctText(A.fem, A.instUsers.length)}%)` },
                        { label: 'Kişi', value: A.mal, color: O('#2f619c', '#1677ff'), sub: `(${pctText(A.mal, A.instUsers.length)}%)` },
                      ]} />
                    </div>
                  )}
                  {A.hasSource && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Mənbə</div>
                      <Bars data={[
                        { label: 'Mülki', value: A.mulki, color: O('#a39478', '#c9962a'), sub: `(${pctText(A.mulki, A.instUsers.length)}%)` },
                        { label: 'Lisey', value: A.lisey, color: O(`${P.slate}`, '#722ed1'), sub: `(${pctText(A.lisey, A.instUsers.length)}%)` },
                      ]} />
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* Sıra 2.5: qoşun növü + fənn ortalamaları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title={`${A.tree?.levelNames?.[0] || 'Qoşun növü'} üzrə seçim statistikası`}>
              {A.branchStats.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Struktur tapılmadı.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {A.branchStats.map((b: any, bi: number, arr: any[]) => {
                    const fillP = pct(b.placed, b.quota)
                    const barCol = IS_OLD_PALETTE ? (fillP >= 100 ? '#52c41a' : '#c9962a') : seqColors(arr.map((x: any) => x.quota))[bi]
                    const comp = b.quota > 0 ? b.demand / b.quota : 0
                    return (
                      <div key={b.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{b.name}</span>
                          <span style={{ color: 'var(--muted)' }}>{b.quota} kvota · {b.specs} hərbi uçot ixtisası · tələb sayı {b.demand} ({comp.toFixed(1)}×)</span>
                        </div>
                        <div style={{ background: O('#e8ecf2', '#f0f2f8'), borderRadius: 6, height: 10, overflow: 'hidden' }}>
                          <div style={{ width: `${fillP}%`, height: '100%', background: barCol }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card title="Fənn üzrə orta ballar">
              {A.subjectAvg.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Fənn balı datası yoxdur.</div>
              ) : (
                <Bars data={A.subjectAvg.map((s: any) => ({ label: s.name, value: Math.round(s.avg * 10) / 10, color: O(`${P.navy}`, '#13c2c2') }))} />
              )}
            </Card>
          </div>

          {/* Sıra 2.7: qrup üzrə bölgü — yalnız qrup məlumatı varsa */}
          {A.hasGroups && (
            <Card title="Qrup üzrə bölgü">
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fd', color: 'var(--muted)', textAlign: 'left' }}>
                      <th style={{ padding: '9px 12px', fontWeight: 700 }}>Qrup</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Təhsilalan</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Yerləşən</th>
                      {A.hasGender && <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Qadın / Kişi</th>}
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Orta bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {A.groupStats.map((g: any, i: number) => (
                      <tr key={g.name} style={{ borderTop: '1px solid #f0f2fa', background: i % 2 ? '#fafbff' : '#fff' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 800, color: 'var(--text)' }}>{g.name}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{g.count}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: g.placed > 0 ? O(`${P.navyDk}`, '#237804') : 'var(--muted)' }}>{g.placed}</td>
                        {A.hasGender && (
                          <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                            <span style={{ color: '#eb2f96', fontWeight: 700 }}>{g.fem}</span>
                            <span style={{ color: 'var(--muted)' }}> / </span>
                            <span style={{ color: '#1677ff', fontWeight: 700 }}>{g.mal}</span>
                          </td>
                        )}
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{g.avg.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Sıra 2.8: paket kvota bölgüsü — yalnız yerləşdirmə paket üsulu ilə aparılıbsa */}
          {(() => {
            let alloc: any = null
            try { alloc = sel ? (JSON.parse(localStorage.getItem('dist_packet_alloc') || '{}')[sel.id] || null) : null } catch { alloc = null }
            const placementSaved = A.instUsers.some((u: any) => u.placedSelectionId === sel?.id && u.placedSpecialtyId)
            if (!alloc || !placementSaved) return null
            const PACK_TXT = ['#1f6fb2', O(`${P.navyDk}`, '#b8860b'), O(`${P.navyDk}`, '#237804'), '#c41d7f', '#531dab', O(`${P.navyDk}`, '#d46b08')]
            const PACK_BG  = ['#e8f4ff', O('#e8eef6', '#fbf1d6'), O('#e8eef6', '#f0fff4'), '#fff0f6', '#f9f0ff', O('#eef3f9', '#fff7e6')]
            return (
              <Card title="İxtisas kvota bölgüsü (paketlər üzrə)">
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 560 }}>
                    <thead>
                      <tr style={{ background: '#f8f9fd', color: 'var(--muted)', textAlign: 'left' }}>
                        <th style={{ padding: '9px 12px', fontWeight: 700 }}>İxtisas</th>
                        <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Cəmi</th>
                        {alloc.packetNums.map((n: number, i: number) => (
                          <th key={n} style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center', color: PACK_TXT[i % PACK_TXT.length] }}>P{n}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {alloc.rows.map((r: any, ri: number) => (
                        <tr key={r.id} style={{ borderTop: '1px solid #f0f2fa', background: ri % 2 ? '#fafbff' : '#fff' }}>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>{r.name}</div>
                            {r.path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.path}</div>}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 800 }}>{r.quota}</td>
                          {r.perPacket.map((q: number, i: number) => (
                            <td key={i} style={{ padding: '9px 12px', textAlign: 'center' }}>
                              {q > 0
                                ? <span style={{ display: 'inline-block', minWidth: 26, padding: '2px 8px', borderRadius: 8, background: PACK_BG[i % PACK_BG.length], color: PACK_TXT[i % PACK_TXT.length], fontWeight: 800 }}>{q}</span>
                                : <span style={{ color: '#ddd' }}>—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td style={{ padding: '9px 12px', fontWeight: 800 }}>Cəmi kvota</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 900 }}>{alloc.rows.reduce((s: number, r: any) => s + r.quota, 0)}</td>
                        {alloc.packetTotals.map((t: number, i: number) => (
                          <td key={i} style={{ padding: '9px 12px', textAlign: 'center' }}>
                            <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 8, background: PACK_BG[i % PACK_BG.length], color: PACK_TXT[i % PACK_TXT.length], fontWeight: 900 }}>{t}</span>
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </Card>
            )
          })()}

          {/* Sıra 3: ixtisas performans cədvəli */}
          <Card title="İxtisas üzrə performans">
            {A.byLeaf.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Bu müəssisə üçün ixtisas strukturu tapılmadı.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: A.hasSource ? 1040 : 800 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fd', color: 'var(--muted)', textAlign: 'left' }}>
                      <th rowSpan={2} style={{ padding: '9px 12px', fontWeight: 700, verticalAlign: 'bottom' }}>İxtisas</th>
                      <th rowSpan={2} style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'bottom' }}>Kvota</th>
                      <th rowSpan={2} style={{ padding: '9px 12px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'bottom' }}>Yerləşən</th>
                      {A.hasSource
                        ? <>
                            <th colSpan={3} style={{ padding: '7px 12px', fontWeight: 800, textAlign: 'center', borderLeft: '1px solid #e6e9f5', color: '#2f54eb' }}>Lisey</th>
                            <th colSpan={3} style={{ padding: '7px 12px', fontWeight: 800, textAlign: 'center', borderLeft: '1px solid #e6e9f5', color: O(`${P.navy}`, '#c9962a') }}>Mülki</th>
                          </>
                        : <th colSpan={3} style={{ padding: '7px 12px', fontWeight: 800, textAlign: 'center', borderLeft: '1px solid #e6e9f5' }}>Bal</th>}
                    </tr>
                    <tr style={{ background: '#f8f9fd', color: 'var(--muted)' }}>
                      {(A.hasSource ? [0, 1] : [0]).map(g => (
                        <Fragment key={g}>
                          <th style={{ padding: '7px 12px', fontWeight: 700, fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap', borderLeft: '1px solid #e6e9f5' }}>ən aşağı bal</th>
                          <th style={{ padding: '7px 12px', fontWeight: 700, fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap' }}>orta bal</th>
                          <th style={{ padding: '7px 12px', fontWeight: 700, fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap' }}>ən yuxarı bal</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeaves.map((l, i) => {
                      return (
                        <tr key={l.id} style={{ borderTop: '1px solid #f0f2fa', background: i % 2 ? '#fafbff' : '#fff' }}>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>{l.name}</div>
                            {l.path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.path}</div>}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{l.quota}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{l.placed}</td>
                          {!A.hasSource && <>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.min ? '#722ed1' : 'var(--muted)', borderLeft: '1px solid #f0f2fa' }}>{l.min ? l.min.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.avg ? O(`${P.navy}`, '#c9962a') : 'var(--muted)' }}>{l.avg ? l.avg.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.max ? O(`${P.steel}`, '#52c41a') : 'var(--muted)' }}>{l.max ? l.max.toFixed(1) : '—'}</td>
                          </>}
                          {A.hasSource && <>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.liseyMin ? '#722ed1' : 'var(--muted)', borderLeft: '1px solid #f0f2fa' }}>{l.liseyMin ? l.liseyMin.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.liseyAvg ? O(`${P.navy}`, '#c9962a') : 'var(--muted)' }}>{l.liseyAvg ? l.liseyAvg.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.liseyMax ? O(`${P.steel}`, '#52c41a') : 'var(--muted)' }}>{l.liseyMax ? l.liseyMax.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.mülkiMin ? '#722ed1' : 'var(--muted)', borderLeft: '1px solid #f0f2fa' }}>{l.mülkiMin ? l.mülkiMin.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.mülkiAvg ? O(`${P.navy}`, '#c9962a') : 'var(--muted)' }}>{l.mülkiAvg ? l.mülkiAvg.toFixed(1) : '—'}</td>
                            <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.mülkiMax ? O(`${P.steel}`, '#52c41a') : 'var(--muted)' }}>{l.mülkiMax ? l.mülkiMax.toFixed(1) : '—'}</td>
                          </>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Sıra 4: rəqabət highlight */}
          {A.byLeaf.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <Card title="Ən çox rəqabətli ixtisaslar">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
                  {A.mostCompetitive.map((l: any, i: number) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#fff1f0', color: '#cf1322', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.demand} tələb / {l.quota} yer</span>
                      <b style={{ color: l.comp >= 1.5 ? '#cf1322' : O(`${P.navyDk}`, '#d46b08'), minWidth: 38, textAlign: 'right' }}>{l.comp.toFixed(1)}×</b>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Ən az rəqabətli olan ixtisaslar">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
                  {A.leastDemanded.map((l: any, i: number) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#f0f5ff', color: '#2f54eb', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.demand} tələb / {l.quota} yer</span>
                      <b style={{ color: l.comp < 1 ? O(`${P.navyDk}`, '#237804') : O(`${P.navyDk}`, '#d46b08'), minWidth: 38, textAlign: 'right' }}>{l.comp.toFixed(1)}×</b>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Sıra 5: maraq sıralaması — kvota nəzərə alınmadan, xam tələb */}
          {A.byInterest.length > 0 && (
            <Card title="İxtisaslara maraq sıralaması">
              <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>
                Sıralama 1-ci seçim sayına görədir. Faiz — həmin ixtisası seçə bilənlərin
                neçə faizinin onu 1-ci yazdığını göstərir.
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 640 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fd', color: 'var(--muted)', textAlign: 'left' }}>
                      <th style={{ padding: '9px 12px', fontWeight: 700, width: 34, textAlign: 'center' }}>#</th>
                      {([['name', 'İxtisas', 'left']] as const).map(([k, lbl, al]) => (
                        <th key={k}
                          onClick={() => setIntSort(v => v.k === k ? { k, asc: !v.asc } : { k: k as any, asc: true })}
                          title="Sıralamaq üçün klikləyin"
                          style={{ padding: '9px 12px', fontWeight: 700, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: al as any, color: intSort.k === k ? O(`${P.navy}`, '#c9962a') : undefined }}>
                          {lbl}<span style={{ opacity: intSort.k === k ? 1 : 0.25, marginLeft: 4 }}>{intSort.k === k ? (intSort.asc ? '▴' : '▾') : '▾'}</span>
                        </th>
                      ))}
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Kvota</th>
                      {([['eligible', 'Uyğun namizəd', 'center'], ['ratio', '1-ci seçim %', 'center'],
                         ['demand', '1-ci seçim', 'center'], ['top3', 'İlk 3 seçim', 'center']] as const).map(([k, lbl, al]) => (
                        <th key={k}
                          onClick={() => setIntSort(v => v.k === k ? { k, asc: !v.asc } : { k: k as any, asc: false })}
                          title="Sıralamaq üçün klikləyin"
                          style={{ padding: '9px 12px', fontWeight: 700, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', textAlign: al as any, color: intSort.k === k ? O(`${P.navy}`, '#c9962a') : undefined }}>
                          {lbl}<span style={{ opacity: intSort.k === k ? 1 : 0.25, marginLeft: 4 }}>{intSort.k === k ? (intSort.asc ? '▴' : '▾') : '▾'}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedInterest.map((l: any, i: number) => (
                      <tr key={l.id} style={{ borderTop: '1px solid #f0f2fa', background: i % 2 ? '#fafbff' : '#fff' }}>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 800, color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ padding: '9px 12px' }}>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{l.name}</div>
                          {l.path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.path}</div>}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{l.quota}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: '#2f54eb' }}>{l.eligible}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 800, color: '#722ed1' }}>
                          {l.eligible > 0 ? `${((l.demand / l.eligible) * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 800, color: '#cf1322' }}>{l.demand}</td>
                        <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: O(`${P.navy}`, '#c9962a') }}>{l.top3}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
