import { useState, useEffect, useMemo, useCallback } from 'react'
import * as XLSX from 'xlsx'
import { institutionDb, userDb, treeDb, selectionDb, submissionDb, POLL_MS, usePoll } from '../../db'
import InstIcon from '../../components/InstIcon'
import InstTabs from '../../components/InstTabs'

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
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f7" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / total) * circ
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
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
function Bars({ data, max }: { data: { label: string; value: number; color: string; sub?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 120, fontSize: 12, color: 'var(--text)', fontWeight: 600, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
          <div style={{ flex: 1, background: '#f0f2f8', borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
            <div style={{ width: `${pct(d.value, m)}%`, background: d.color, height: '100%', borderRadius: 6, minWidth: d.value > 0 ? 3 : 0, transition: 'width .5s' }} />
          </div>
          <div style={{ width: 64, fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{d.value}{d.sub ? <span style={{ color: 'var(--muted)', fontWeight: 500 }}> {d.sub}</span> : ''}</div>
        </div>
      ))}
    </div>
  )
}

// ── Statistik hesabat (yüklənə bilən sənəd: çap/PDF + Word) ─────────────────────
const esc = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function buildStatsReportHtml(A: any, instLabel: string, selName: string): string {
  const today = new Date().toLocaleDateString('az-AZ', { day: '2-digit', month: 'long', year: 'numeric' })
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
        `<tr><td>${c}-ci seçim</td><td class="c">${A.choiceDist[c]}</td><td class="c">${A.placed > 0 ? ((A.choiceDist[c] / A.placed) * 100).toFixed(1) : '0'}%</td></tr>`).join('')}</tbody>
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
      <thead><tr><th>İxtisas</th><th>Kvota</th><th>Yerləşən</th><th>Doluluq</th><th>Ən aşağı</th><th>Orta</th><th>Ən yüksək</th></tr></thead>
      <tbody>${[...A.byLeaf].sort((a: any, b: any) => b.quota - a.quota).map((l: any) =>
        `<tr><td>${esc(l.name)}${l.path ? `<div class="sub">${esc(l.path)}</div>` : ''}</td><td class="c">${l.quota}</td><td class="c">${l.placed}</td><td class="c">${p(l.placed, l.quota)}%</td><td class="c">${l.min ? l.min.toFixed(1) : '—'}</td><td class="c">${l.avg ? l.avg.toFixed(1) : '—'}</td><td class="c">${l.max ? l.max.toFixed(1) : '—'}</td></tr>`).join('')}</tbody>
    </table>` : ''

  // Rəqabət
  const comp = A.byLeaf.length ? `
    <div class="two">
      <div><h3>Ən rəqabətli ixtisaslar</h3>
        <table class="t"><thead><tr><th>#</th><th>İxtisas</th><th>Tələb/Yer</th><th>Rəqabət</th></tr></thead>
        <tbody>${A.mostCompetitive.map((l: any, i: number) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${l.demand}/${l.quota}</td><td class="c">${l.comp.toFixed(1)}×</td></tr>`).join('')}</tbody></table>
      </div>
      <div><h3>Ən az tələb olunan ixtisaslar</h3>
        <table class="t"><thead><tr><th>#</th><th>İxtisas</th><th>Tələb/Yer</th><th>Rəqabət</th></tr></thead>
        <tbody>${A.leastDemanded.map((l: any, i: number) => `<tr><td class="c">${i + 1}</td><td>${esc(l.name)}</td><td class="c">${l.demand}/${l.quota}</td><td class="c">${l.comp.toFixed(1)}×</td></tr>`).join('')}</tbody></table>
      </div>
    </div>` : ''

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
  <div class="foot">Hesabat ${today} tarixində İxtisas Seçim Proqramı tərəfindən avtomatik hazırlanmışdır.</div>
</body></html>`
}

function Card({ title, icon, children, span }: { title: string; icon?: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 16, padding: '18px 20px', gridColumn: span ? `span ${span}` : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span>{icon}</span>}{title}
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
  const [instId, setInstId] = useState<string>('')
  const [sortBy, setSortBy] = useState<'comp' | 'fill' | 'avg' | 'quota'>('quota')
  const [showAllChoices, setShowAllChoices] = useState(false)
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

  useEffect(() => {
    if (loaded && !instId && insts[0]?.id) setInstId(insts[0].id)
  }, [loaded, insts, instId])

  const sel = useMemo(() =>
    allSels.find((s: any) => s.institution === instId && s.status === 'published')
      || allSels.find((s: any) => s.institution === instId),
    [allSels, instId])

  const loadSubs = useCallback(() => {
    if (sel) submissionDb.getBySelection(sel.id).then(setSubs)
    else setSubs([])
  }, [sel?.id])
  useEffect(() => { loadSubs() }, [loadSubs])
  usePoll(loadSubs)   // real-time: yeni göndərişlər statistikada avtomatik görünür

  // ── Qlobal göstəricilər (bütün müəssisələr) ──
  // ── Seçilmiş müəssisə analitikası ──
  const A = useMemo(() => {
    const instUsers = allUsers.filter(u => u.institution === instId)
    const tree = (sel && allTrees.find(t => t.id === sel.treeId)) || allTrees.find(t => t.institution === instId)
    const leaves = tree ? getLeaves(tree.nodes || []) : []
    // Rəqabət "tələbi" yalnız BİRİNCİ seçimə görə hesablanır (daha sərt ölçü):
    // ixtisası 1-ci seçim kimi yazanların sayı. (Əvvəl hər hansı sırada seçmək sayılırdı.)
    const firstChoice: Record<string, number> = {}
    for (const s of subs) {
      const f = s.ranking?.[0]; if (f) firstChoice[f] = (firstChoice[f] || 0) + 1
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
      return {
        id: leaf.id, name: leaf.name, path: path.slice(0, -1).map((n: any) => n.name).join(' › '),
        quota: leaf.quota || 0, placed: us.length,
        avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        min: scores.length ? Math.min(...scores) : 0,
        max: scores.length ? Math.max(...scores) : 0,
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
    const avgScore = instUsers.length ? instUsers.reduce((s, u) => s + (u.score || 0), 0) / instUsers.length : 0

    // bal statistikası (min / max)
    const scores = instUsers.map(u => u.score || 0).filter(s => s > 0).sort((a, b) => a - b)
    const n = scores.length
    const minScore = n ? scores[0] : 0
    const maxScore = n ? scores[n - 1] : 0

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

    return {
      sel, tree, instUsers, leaves, byLeaf, choiceDist, hist, scoreBuckets, totalQuota, avgScore,
      placed: placedUsers.length, submittedCount, pendingCount, unplacedSubmitted,
      fem, mal, hasGender, mulki, lisey, hasSource,
      minScore, maxScore, branchStats, subjectAvg, mostCompetitive, leastDemanded, levelStats,
      groupStats, hasGroups,
      satisfaction: pct(choiceDist[1] || 0, placedUsers.length),
    }
  }, [instId, allUsers, allTrees, sel, subs])

  const sortedLeaves = useMemo(() => {
    const arr = [...A.byLeaf]
    if (sortBy === 'comp') arr.sort((a, b) => (b.demand / (b.quota || 1)) - (a.demand / (a.quota || 1)))
    else if (sortBy === 'fill') arr.sort((a, b) => pct(b.placed, b.quota) - pct(a.placed, a.quota))
    else if (sortBy === 'avg') arr.sort((a, b) => b.avg - a.avg)
    else arr.sort((a, b) => b.quota - a.quota)
    return arr
  }, [A.byLeaf, sortBy])

  const activeInst = insts.find(i => i.id === instId)

  // ── Statistik hesabatı sənəd kimi çıxar (çap/PDF + Word) ──
  const reportName = () => `Statistika_${(activeInst?.label || 'muessise').replace(/[^\wəğıöüçşĞİÖÜÇŞƏ]+/gi, '_')}_${new Date().toISOString().slice(0, 10)}`
  function printReport() {
    const html = buildStatsReportHtml(A, activeInst?.label || '', A.sel?.name || '')
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html); w.document.close()
    w.onload = () => { w.focus(); w.print() }
    setTimeout(() => { try { w.focus(); w.print() } catch {} }, 400)
  }
  function exportReportWord() {
    const html = buildStatsReportHtml(A, activeInst?.label || '', A.sel?.name || '')
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
      choiceKeys.forEach(c => icmal.push([`${c}-ci seçim`, A.choiceDist[c], A.placed > 0 ? `${((A.choiceDist[c] / A.placed) * 100).toFixed(1)}%` : '0%']))
    }
    if (A.hasGender || A.hasSource) {
      icmal.push([], ['DEMOQRAFİYA'], ['Kateqoriya', 'Say', 'Faiz'])
      if (A.hasGender) { icmal.push(['Qadın', A.fem, `${pc(A.fem, N)}%`], ['Kişi', A.mal, `${pc(A.mal, N)}%`]) }
      if (A.hasSource) { icmal.push(['Mülki', A.mulki, `${pc(A.mulki, N)}%`], ['Lisey', A.lisey, `${pc(A.lisey, N)}%`]) }
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(icmal), 'İcmal')

    // İxtisaslar vərəqi
    const perf: any[][] = [['İxtisas', 'Yol', 'Kvota', 'Yerləşən', 'Doluluq %', 'Ən aşağı bal', 'Orta bal', 'Ən yüksək bal'],
      ...[...A.byLeaf].sort((a: any, b: any) => b.quota - a.quota).map((l: any) =>
        [l.name, l.path, l.quota, l.placed, pc(l.placed, l.quota), l.min ? +l.min.toFixed(1) : '', l.avg ? +l.avg.toFixed(1) : '', l.max ? +l.max.toFixed(1) : ''])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perf), 'İxtisaslar')

    // Rəqabət vərəqi (1-ci seçim üzrə)
    const comp: any[][] = [['ƏN RƏQABƏTLİ (1-ci seçim üzrə)'], ['#', 'İxtisas', 'Tələb', 'Yer', 'Rəqabət'],
      ...A.mostCompetitive.map((l: any, i: number) => [i + 1, l.name, l.demand, l.quota, +l.comp.toFixed(1)]),
      [], ['ƏN AZ TƏLƏB OLUNAN'], ['#', 'İxtisas', 'Tələb', 'Yer', 'Rəqabət'],
      ...A.leastDemanded.map((l: any, i: number) => [i + 1, l.name, l.demand, l.quota, +l.comp.toFixed(1)])]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(comp), 'Rəqabət')

    // Qrup vərəqi (varsa)
    if (A.hasGroups) {
      const grp: any[][] = [['Qrup', 'Təhsilalan', 'Yerləşən', 'Qadın', 'Kişi', 'Orta bal'],
        ...A.groupStats.map((g: any) => [g.name, g.count, g.placed, g.fem, g.mal, +g.avg.toFixed(2)])]
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grp), 'Qruplar')
    }

    XLSX.writeFile(wb, `${reportName()}.xlsx`)
  }

  if (!loaded) return <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--muted)' }}>Yüklənir...</div>

  const LEVEL_ICONS = ['⚔️', '🎖️', '🎓', '📘', '📗']
  const INST_KPIS: { label: string; value: any; icon: string; accent: string; sub?: string }[] = [
    { label: 'Təhsilalan', value: A.instUsers.length, icon: '👥', accent: '#722ed1' },
    ...A.levelStats.map((l: any, i: number) => ({ label: l.name, value: l.count, icon: LEVEL_ICONS[i] || '🎓', accent: '#13c2c2' })),
    { label: 'Ümumi kvota', value: A.totalQuota, icon: '🎯', accent: '#fa8c16' },
    { label: 'Yerləşmə', value: `${pct(A.placed, A.instUsers.length)}%`, icon: '✅', accent: '#52c41a', sub: `${A.placed}/${A.instUsers.length}` },
    { label: 'Seçim etdi', value: `${pct(A.submittedCount, A.instUsers.length)}%`, icon: '🗳️', accent: '#eb2f96', sub: `${A.submittedCount}/${A.instUsers.length}` },
  ]

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
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#b8860b,#e0a92e)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 3px 12px #c9962a55' }}>
              📊 Hesabatı yüklə <span style={{ fontSize: 10 }}>{reportMenu ? '▲' : '▼'}</span>
            </button>
            {reportMenu && (
              <>
                <div onClick={() => setReportMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', right: 0, top: '112%', zIndex: 41, background: '#fff', border: '1.5px solid #e8eaf5', borderRadius: 12, boxShadow: '0 12px 32px #0002', overflow: 'hidden', minWidth: 210 }}>
                  {[
                    { icon: '📄', label: 'PDF (çap üçün)', sub: 'Çap pəncərəsi açılır', color: '#b8860b', fn: printReport },
                    { icon: '📝', label: 'Word (.doc)', sub: 'Redaktə oluna bilən sənəd', color: '#2b579a', fn: exportReportWord },
                    { icon: '📊', label: 'Excel (.xlsx)', sub: 'Cədvəllər, 3-4 vərəq', color: '#1d6f42', fn: exportReportExcel },
                  ].map((o, i) => (
                    <button key={o.label} onClick={() => { o.fn(); setReportMenu(false) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 14px', border: 'none', borderTop: i ? '1px solid #f0f2f8' : 'none', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fd')}
                      onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                      <span style={{ fontSize: 20, width: 26, textAlign: 'center', flexShrink: 0 }}>{o.icon}</span>
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

      {!activeInst ? (
        <Card title="Məlumat yoxdur">
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Müəssisə seçin və ya əlavə edin.</div>
        </Card>
      ) : (
        <>
          {/* Müəssisənin fərdi KPI-ları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {INST_KPIS.map(k => (
              <div key={k.label} style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 13 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${k.accent}14`, color: k.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{k.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{k.label}{k.sub ? ` · ${k.sub}` : ''}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Sıra 1: status donut + bal paylanması */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title={`Yerləşmə statusu — ${activeInst.label}`} icon="🎯">
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
                <Donut size={150} segments={[
                  { value: A.placed, color: '#52c41a', label: 'Yerləşdi' },
                  { value: A.unplacedSubmitted, color: '#faad14', label: 'Yerləşmədi' },
                  { value: A.pendingCount, color: '#d9d9d9', label: 'Seçim etmədi' },
                ]} center={<>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{pct(A.placed, A.instUsers.length)}%</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>yerləşdi</div>
                </>} />
                <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { c: '#52c41a', l: 'Yerləşdi', v: A.placed },
                    { c: '#faad14', l: 'Seçim etdi, yerləşdirilmədi', v: A.unplacedSubmitted },
                    { c: '#d9d9d9', l: 'Seçim etmədi', v: A.pendingCount },
                  ].map(x => (
                    <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: x.c, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text)' }}>{x.l}</span>
                      <b style={{ color: 'var(--text)' }}>{x.v}</b>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Kvota doluluğu</span><b style={{ color: '#fa8c16' }}>{pct(A.placed, A.totalQuota)}% ({A.placed}/{A.totalQuota})</b>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    {[['Ən aşağı', A.minScore, '#ff4d4f'], ['Orta', A.avgScore, '#c9962a'], ['Ən yüksək', A.maxScore, '#52c41a']].map(([l, v, c]: any) => (
                      <div key={l} style={{ flex: 1, textAlign: 'center', background: `${c}10`, borderRadius: 8, padding: '6px 2px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: c }}>{Number(v).toFixed(1)}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Bal paylanması" icon="📈">
              <Bars data={A.scoreBuckets.map(([lo, hi], i) => ({
                label: `${lo}–${hi}`, value: A.hist[i], color: '#c9962a',
              }))} />
            </Card>
          </div>

          {/* Sıra 2: seçimlər üzrə qəbul statistikası + demoqrafiya */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title="Seçimlər üzrə qəbul statistikası" icon="📊">
              {Object.keys(A.choiceDist).length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Hələ yerləşdirmə aparılmayıb.</div>
              ) : (
                <>
                  <Bars data={Array.from({ length: Math.max(A.byLeaf.length, 1) }, (_, i) => i + 1)
                    .slice(0, showAllChoices ? undefined : 3)
                    .map(c => ({
                      label: `${c}-ci seçim`, value: A.choiceDist[c] || 0,
                      color: c === 1 ? '#52c41a' : c <= 3 ? '#c9962a' : '#faad14',
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
              <Card title="Təhsil alanların tərkibi" icon="👥">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {A.hasGender && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Cins</div>
                      <Bars data={[
                        { label: 'Qadın', value: A.fem, color: '#eb2f96', sub: `(${pct(A.fem, A.instUsers.length)}%)` },
                        { label: 'Kişi', value: A.mal, color: '#1677ff', sub: `(${pct(A.mal, A.instUsers.length)}%)` },
                      ]} />
                    </div>
                  )}
                  {A.hasSource && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Mənbə</div>
                      <Bars data={[
                        { label: 'Mülki', value: A.mulki, color: '#c9962a', sub: `(${pct(A.mulki, A.instUsers.length)}%)` },
                        { label: 'Lisey', value: A.lisey, color: '#722ed1', sub: `(${pct(A.lisey, A.instUsers.length)}%)` },
                      ]} />
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* Sıra 2.5: qoşun növü + fənn ortalamaları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title={`${A.tree?.levelNames?.[0] || 'Qoşun növü'} üzrə bölgü`} icon="⚔️">
              {A.branchStats.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Struktur tapılmadı.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {A.branchStats.map((b: any) => {
                    const fillP = pct(b.placed, b.quota)
                    const comp = b.quota > 0 ? b.demand / b.quota : 0
                    return (
                      <div key={b.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{b.name}</span>
                          <span style={{ color: 'var(--muted)' }}>{b.placed}/{b.quota} · {b.specs} ixtisas · tələb {b.demand} ({comp.toFixed(1)}×)</span>
                        </div>
                        <div style={{ background: '#f0f2f8', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                          <div style={{ width: `${fillP}%`, height: '100%', background: fillP >= 100 ? '#52c41a' : '#c9962a' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card title="Fənn üzrə orta ballar" icon="📚">
              {A.subjectAvg.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Fənn balı datası yoxdur.</div>
              ) : (
                <Bars data={A.subjectAvg.map((s: any) => ({ label: s.name, value: Math.round(s.avg * 10) / 10, color: '#13c2c2' }))} />
              )}
            </Card>
          </div>

          {/* Sıra 2.7: qrup üzrə bölgü — yalnız qrup məlumatı varsa */}
          {A.hasGroups && (
            <Card title="Qrup üzrə bölgü" icon="🧩">
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
                        <td style={{ padding: '9px 12px', textAlign: 'center', color: g.placed > 0 ? '#237804' : 'var(--muted)' }}>{g.placed}</td>
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
            const PACK_TXT = ['#1f6fb2', '#b8860b', '#237804', '#c41d7f', '#531dab', '#d46b08']
            const PACK_BG  = ['#e8f4ff', '#fbf1d6', '#f0fff4', '#fff0f6', '#f9f0ff', '#fff7e6']
            return (
              <Card title="İxtisas kvota bölgüsü (paketlər üzrə)" icon="📊">
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
          <Card title="İxtisas üzrə performans" icon="🎓">
            {A.byLeaf.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Bu müəssisə üçün ixtisas strukturu tapılmadı.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fd', color: 'var(--muted)', textAlign: 'left' }}>
                      <th style={{ padding: '9px 12px', fontWeight: 700 }}>İxtisas</th>
                      {([['quota', 'Kvota'], ['fill', 'Yerləşən / Doluluq']] as const).map(([k, lbl]) => (
                        <th key={k} onClick={() => setSortBy(k as any)} style={{ padding: '9px 12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', color: sortBy === k ? '#c9962a' : undefined, textAlign: 'center' }}>
                          {lbl} {sortBy === k ? '▾' : ''}
                        </th>
                      ))}
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Ən aşağı bal</th>
                      <th onClick={() => setSortBy('avg')} style={{ padding: '9px 12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', color: sortBy === 'avg' ? '#c9962a' : undefined, textAlign: 'center' }}>Orta bal {sortBy === 'avg' ? '▾' : ''}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Ən yüksək bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeaves.map((l, i) => {
                      const fillP = pct(l.placed, l.quota)
                      return (
                        <tr key={l.id} style={{ borderTop: '1px solid #f0f2fa', background: i % 2 ? '#fafbff' : '#fff' }}>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>{l.name}</div>
                            {l.path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.path}</div>}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{l.quota}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, background: '#f0f2f8', borderRadius: 5, height: 8, overflow: 'hidden', minWidth: 50 }}>
                                <div style={{ width: `${fillP}%`, height: '100%', background: fillP >= 100 ? '#52c41a' : fillP >= 60 ? '#c9962a' : '#faad14' }} />
                              </div>
                              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{l.placed}/{l.quota}</span>
                            </div>
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.min ? '#722ed1' : 'var(--muted)' }}>{l.min ? l.min.toFixed(1) : '—'}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: '#c9962a' }}>{l.avg ? l.avg.toFixed(1) : '—'}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.max ? '#52c41a' : 'var(--muted)' }}>{l.max ? l.max.toFixed(1) : '—'}</td>
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
              <Card title="Ən rəqabətli ixtisaslar" icon="🔥">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
                  {A.mostCompetitive.map((l: any, i: number) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#fff1f0', color: '#cf1322', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.demand} tələb / {l.quota} yer</span>
                      <b style={{ color: l.comp >= 1.5 ? '#cf1322' : '#d46b08', minWidth: 38, textAlign: 'right' }}>{l.comp.toFixed(1)}×</b>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Ən az tələb olunan ixtisaslar" icon="❄️">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
                  {A.leastDemanded.map((l: any, i: number) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#f0f5ff', color: '#2f54eb', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.demand} tələb / {l.quota} yer</span>
                      <b style={{ color: l.comp < 1 ? '#237804' : '#d46b08', minWidth: 38, textAlign: 'right' }}>{l.comp.toFixed(1)}×</b>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
