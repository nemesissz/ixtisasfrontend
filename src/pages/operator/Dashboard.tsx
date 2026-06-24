import { useState } from 'react'
import { selectionDb, userDb, submissionDb, institutionDb, treeDb, buildNameMap, useLocalState, addLog } from '../../db'

// ── Qrup rəngləri ─────────────────────────────────────────────────────────────
const GRP_COLORS: Record<string, { bg: string; color: string }> = {
  '1': { bg: '#e8f4ff', color: '#1677ff' },
  '2': { bg: '#f0fff4', color: '#237804' },
  '3': { bg: '#fff7e6', color: '#d46b08' },
  '4': { bg: '#fff0f6', color: '#c41d7f' },
  '5': { bg: '#f9f0ff', color: '#531dab' },
}

// ── Tree-dən hər yarpaq üçün tam yol ──────────────────────────────────────────
function buildLeafPaths(nodes: any[], prefix: any[] = [], map: Record<string, any[]> = {}): Record<string, any[]> {
  for (const n of nodes) {
    const path = [...prefix, n]
    if (n.children?.length) buildLeafPaths(n.children, path, map)
    else map[n.id] = path
  }
  return map
}
const esc = (s: any) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')

// ── Seçim vərəqi cədvəli (viewMode-a görə dinamik) ────────────────────────────
function buildSheetTable(ranking: string[], pathMap: Record<string, any[]>, nameMap: Record<string, string>, lv: string[], isNested: boolean): string {
  const lv0 = lv[0], lv1 = lv[1], lv2 = lv[2]
  const resolve = (leafId: string) => {
    const path = pathMap[leafId]
    if (path && path.length >= 3)      return { g: path[0].name, s: path[1].name, l: path[path.length-1].name }
    if (path && path.length === 2)     return { g: path[0].name, s: '—',          l: path[1].name }
    if (path && path.length === 1)     return { g: '—',          s: '—',          l: path[0].name }
    return { g: '—', s: '—', l: (nameMap[leafId] || leafId) }
  }

  if (isNested) {
    const groups: any[] = []
    const gIdx = new Map<string, number>()
    for (const id of ranking) {
      const { g, s, l } = resolve(id)
      if (!gIdx.has(g)) { gIdx.set(g, groups.length); groups.push({ name: g, order: groups.length + 1, subs: [], sIdx: new Map() }) }
      const G = groups[gIdx.get(g)!]
      if (!G.sIdx.has(s)) { G.sIdx.set(s, G.subs.length); G.subs.push({ name: s, order: G.subs.length + 1, leaves: [] }) }
      G.subs[G.sIdx.get(s)!].leaves.push({ name: l, order: G.subs[G.sIdx.get(s)!].leaves.length + 1 })
    }
    let rows = ''
    for (const G of groups) {
      const gSpan = G.subs.reduce((a: number, x: any) => a + x.leaves.length, 0)
      let gP = false
      for (const S of G.subs) {
        let sP = false
        for (const leaf of S.leaves) {
          rows += '<tr>'
          if (!gP) { rows += `<td class="c-ord" rowspan="${gSpan}">${G.order}</td><td class="c-grp" rowspan="${gSpan}">${esc(G.name)}</td>`; gP = true }
          if (!sP) { rows += `<td class="c-ord" rowspan="${S.leaves.length}">${S.order}</td><td class="c-sub" rowspan="${S.leaves.length}">${esc(S.name)}</td>`; sP = true }
          rows += `<td class="c-ord">${leaf.order}</td><td>${esc(leaf.name)}</td></tr>`
        }
      }
    }
    return `<table>
      <thead><tr>
        <th class="t-ord">${esc(lv0)}<br/>sırası</th><th>${esc(lv0).toUpperCase()}</th>
        <th class="t-ord">${esc(lv1)}<br/>sırası</th><th>${esc(lv1).toUpperCase()}</th>
        <th class="t-ord">${esc(lv2)}<br/>sırası</th><th>${esc(lv2).toUpperCase()}</th>
      </tr></thead><tbody>${rows}</tbody></table>`
  }

  let rows = ''
  let prevG = '', prevS = ''
  ranking.forEach((id, i) => {
    const { g, s, l } = resolve(id)
    const gCh = g !== prevG, sCh = gCh || s !== prevS
    rows += `<tr><td class="c-ord">${i + 1}</td><td class="${gCh ? 'c-grp' : 'c-rep'}">${esc(g)}</td><td class="${sCh ? 'c-sub' : 'c-rep'}">${esc(s)}</td><td>${esc(l)}</td></tr>`
    prevG = g; prevS = s
  })
  return `<table>
    <thead><tr>
      <th class="t-ord">Seçim sırası</th><th>${esc(lv0).toUpperCase()}</th><th>${esc(lv1).toUpperCase()}</th><th>${esc(lv2).toUpperCase()}</th>
    </tr></thead><tbody>${rows}</tbody></table>`
}

// ── Çap HTML-i (seçim vərəqi — viewMode-a görə dinamik) ───────────────────────
function generatePrintHTML(user: any, sel: any, nameMap: Record<string, string>, _instLabel: string, ranking: string[], tree?: any): string {
  const lv: string[] = tree?.levelNames?.length ? tree.levelNames : ['Ana Qrup', 'Alt Qrup', 'İxtisas']
  const pathMap = tree ? buildLeafPaths(tree.nodes || []) : {}
  const isNested = sel?.viewMode === 'nested'
  const tableHTML = buildSheetTable(ranking, pathMap, nameMap, [lv[0]||'Ana Qrup', lv[1]||'Alt Qrup', lv[2]||'İxtisas'], isNested)

  const d = new Date()
  const printDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`

  return `<!DOCTYPE html>
<html lang="az"><head><meta charset="UTF-8"/>
<title>Seçim Vərəqi — ${esc(user.name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Times New Roman',Georgia,serif;padding:18px 24px;color:#000;font-size:12px}
  .doc-title{text-align:center;font-size:16px;font-weight:bold;letter-spacing:.5px;margin-bottom:14px}
  .info{border:1px solid #000;padding:12px 16px;display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  .info-left .name{font-size:14px;font-weight:bold}.info-left .sub{font-size:11px;margin-top:3px}
  .info-mid{text-align:center;font-size:12px;padding-top:4px}.info-right{text-align:right;font-size:11px}
  .sign-line{margin-top:34px;border-top:1px solid #000;width:200px;margin-left:auto;text-align:center;padding-top:4px;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-bottom:18px}
  th,td{border:1px solid #000;padding:6px 10px;vertical-align:middle;color:#000}
  th{background:#fff;font-size:11px;font-weight:bold;text-align:left;line-height:1.3}
  th.t-ord{text-align:center;width:70px}
  .c-ord{text-align:center;font-weight:bold;width:70px}.c-grp{font-weight:bold}.c-sub{font-weight:bold}.c-rep{color:#000}
  .confirm{margin-top:14px;padding-top:10px;font-size:12px;font-weight:bold}
  .no-sub{text-align:center;padding:20px;border:1px solid #000;font-size:13px}
  @page{margin:12mm;size:A4 portrait} @media print{body{padding:0}}
</style></head>
<body>
  <div class="doc-title">TƏHSİL ALANIN İXTİSAS SEÇİM VƏRƏQİ</div>
  <div class="info">
    <div class="info-left">
      <div class="name">Təhsil alan: ${esc(user.name)}</div>
      <div class="sub">FİN Kod: ${esc(user.fin || '—')}</div>
      <div class="sub">Abituriyentin iş nömrəsi: ${esc(user.workNumber || '—')}</div>
      ${user.group ? `<div class="sub">Qrup: ${esc(user.group)}${user.source ? ' · '+esc(user.source==='mülki'?'Mülki':user.source==='lisey'?'Lisey':user.source) : ''}</div>` : ''}
    </div>
    <div class="info-mid">Topladığı Yekun Bal: <b>${Number(user.score).toFixed(2)}</b></div>
    <div class="info-right"><div>Sənədin Çap Tarixi: ${printDate}</div><div class="sign-line">Təhsil alanın İmzası</div></div>
  </div>
  ${ranking.length > 0 ? tableHTML : '<div class="no-sub">Bu təhsil alan seçim göndərməyib</div>'}
  <div class="confirm">Yuxarıdakı seçimlərin mənə aid olduğunu öz imzamla təsdiq edirəm.</div>
</body>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}</script>
</html>`
}

// ─────────────────────────────────────────────────────────────────────────────
export default function OperatorDashboard() {
  const [selections,   refreshSels]  = useLocalState(selectionDb.getAll)
  const [users,        refreshUsers] = useLocalState(userDb.getAll)
  const [institutions]               = useLocalState(institutionDb.getAll)
  const [allSubs,      refreshSubs]  = useLocalState(submissionDb.getAll)

  const [tab,        setTab]        = useState('')
  const [search,     setSearch]     = useState('')
  const [statusFlt,  setStatusFlt]  = useState<'all' | 'submitted' | 'pending'>('all')
  const [printFlt,   setPrintFlt]   = useState<'all' | 'printed' | 'not_printed'>('all')
  const [printUser,  setPrintUser]  = useState<any>(null)   // çap modalı
  const [nameMap,    setNameMap]    = useState<Record<string, string>>({})

  const activeSels  = (selections as any[]).filter((s: any) => s.status === 'published')
  const _allSubs    = allSubs as any[]
  const insts       = (institutions as any[])
  const activeInsts = insts.filter((inst: any) =>
    activeSels.some((s: any) => s.institution === inst.id)
  )

  const activeTab  = tab || activeInsts[0]?.id || ''
  const activeSel  = activeSels.find((s: any) => s.institution === activeTab)
  const activeInst = insts.find((i: any) => i.id === activeTab)
  const instLabel  = activeInst ? activeInst.label : ''

  const instUsers   = (users as any[]).filter((u: any) => u.institution === activeTab)
  const hasGroups   = instUsers.some((u: any) => u.group)
  const hasYears    = instUsers.some((u: any) => u.year)
  const hasSources  = instUsers.some((u: any) => u.source)

  const subSet = new Set(
    _allSubs
      .filter((s: any) => activeSel && s.selectionId === activeSel.id)
      .map((s: any) => s.userId)
  )

  const q = search.toLowerCase().trim()

  const filtered = instUsers
    .filter((u: any) => {
      const matchSearch = !q ||
        u.name.toLowerCase().includes(q) ||
        (u.fin  || '').toLowerCase().includes(q) ||
        (u.workNumber || '').includes(q)

      const hasSub = subSet.has(u.id)
      const matchStatus =
        statusFlt === 'all' ||
        (statusFlt === 'submitted' &&  hasSub) ||
        (statusFlt === 'pending'   && !hasSub)

      const isPrinted = u.printStatus === 'printed'
      const matchPrint =
        printFlt === 'all' ||
        (printFlt === 'printed'     &&  isPrinted) ||
        (printFlt === 'not_printed' && !isPrinted)

      return matchSearch && matchStatus && matchPrint
    })
    .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))

  const totalSub     = instUsers.filter((u: any) =>  subSet.has(u.id)).length
  const totalPend    = instUsers.length - totalSub
  const totalPrinted = instUsers.filter((u: any) => u.printStatus === 'printed').length
  const pct          = instUsers.length ? Math.round((totalSub / instUsers.length) * 100) : 0

  // ── Çap et ──────────────────────────────────────────────────────────────────
  function handlePrint(u: any) {
    const tree = activeSel ? treeDb.get(activeSel.treeId) : null
    setNameMap(tree ? buildNameMap(tree) : {})
    setPrintUser(u)
  }

  function confirmPrint() {
    if (!printUser) return
    // Submission-dan ranking-i al
    const sub     = submissionDb.getByUser(printUser.id, activeSel?.id || '')
    const ranking: string[] = sub?.ranking || []
    // Çap statusunu yenilə
    userDb.update(printUser.id, { printStatus: 'printed' })
    refreshUsers()
    refreshSubs()
    // ── Log yaz ─────────────────────────────────────────────────────────────
    const opSession = sessionStorage.getItem('operator_session')
    const opName    = opSession ? JSON.parse(opSession).name : 'Operator'
    const wasAlready = printUser.printStatus === 'printed'
    addLog(
      'user',
      wasAlready ? 'warning' : 'success',
      `${wasAlready ? 'Yenidən çap' : 'Çap'}: ${printUser.name}`,
      `FİN: ${printUser.fin || '—'} · Bal: ${Number(printUser.score || 0).toFixed(2)} · ` +
      `Seçim: ${activeSel?.name || '—'} · Müəssisə: ${instLabel} · ` +
      `${wasAlready ? 'Bu təhsil alan əvvəllər də çap edilmişdi.' : `Seçim sırası: ${ranking.length} ixtisas`}`,
      opName,
    )
    // ────────────────────────────────────────────────────────────────────────
    setPrintUser(null)
    // Yeni pəncərədə çap et
    const treeForPrint = activeSel ? treeDb.get(activeSel.treeId) : null
    const html = generatePrintHTML(printUser, activeSel, nameMap, instLabel, ranking, treeForPrint)
    const win  = window.open('', '_blank', 'width=1000,height=720')
    if (win) { win.document.write(html); win.document.close() }
  }

  if (activeInsts.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 14 }}>
        <div style={{ fontSize: 52 }}>🗳️</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Aktiv seçim yoxdur</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Admin bir seçim yayımladıqda təhsil alanlar burada görünəcək</div>
      </div>
    )
  }

  return (
    <>
      {/* ── Çap təsdiq modalı ── */}
      {printUser && (
        <div className="modal-overlay open" onClick={() => setPrintUser(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">🖨️ Çap et</span>
              <button className="modal-close" onClick={() => setPrintUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              {/* Təhsil alan məlumatı */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '14px 16px', borderRadius: 12,
                background: '#f4f7ff', border: '1.5px solid #f3e3b8',
                marginBottom: 16,
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: 'linear-gradient(135deg,#00b96b,#007a47)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22,
                }}>👤</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{printUser.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    FİN: {printUser.fin || '—'} · Bal: {Number(printUser.score).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Seçim statusu */}
              {!subSet.has(printUser.id) && (
                <div style={{
                  background: '#fff7e6', border: '1.5px solid #ffd591',
                  borderRadius: 10, padding: '10px 14px',
                  fontSize: 12, color: '#d46b08', marginBottom: 16,
                  display: 'flex', gap: 8,
                }}>
                  ⚠️ Bu təhsil alan hələ seçim göndərməyib. Yenə də çap edə bilərsiniz.
                </div>
              )}

              {printUser.printStatus === 'printed' && (
                <div style={{
                  background: '#f6ffed', border: '1.5px solid #b7eb8f',
                  borderRadius: 10, padding: '10px 14px',
                  fontSize: 12, color: '#237804', marginBottom: 16,
                  display: 'flex', gap: 8,
                }}>
                  ✅ Bu təhsil alan əvvəllər çap edilib. Yenidən çap edəcəksiniz?
                </div>
              )}

              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                Təhsil alanın seçim vərəqi çap ediləcək və çap statusu <b>«Çap edilib»</b> kimi qeyd olunacaq.
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setPrintUser(null)}>
                  Ləğv et
                </button>
                <button
                  style={{
                    flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
                    background: 'linear-gradient(135deg,#00b96b,#007a47)',
                    color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                    boxShadow: '0 4px 14px #00b96b44', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}
                  onClick={confirmPrint}
                >
                  🖨️ Çap et
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Müəssisə tabları ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {activeInsts.map((inst: any) => {
          const sel      = activeSels.find((s: any) => s.institution === inst.id)
          const isActive = activeTab === inst.id
          return (
            <button key={inst.id}
              onClick={() => { setTab(inst.id); setSearch(''); setStatusFlt('all'); setPrintFlt('all') }}
              style={{
                padding: '10px 22px', borderRadius: 10, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: 14, transition: 'all .15s',
                background: isActive ? '#00b96b' : '#f0f2fa',
                color:      isActive ? '#fff'     : 'var(--muted)',
                boxShadow:  isActive ? '0 2px 10px #00b96b33' : 'none',
              }}
            >
              {inst.icon} {inst.label}
              {sel && (
                <span style={{
                  marginLeft: 8, fontSize: 11, fontWeight: 600,
                  background: isActive ? '#ffffff33' : '#e0f5eb',
                  color: isActive ? '#fff' : '#00b96b',
                  borderRadius: 6, padding: '1px 7px',
                }}>
                  {sel.name}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── Statistika kartları ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Cəmi təhsil alan',   value: instUsers.length, icon: '👥', color: '#1677ff', bg: '#e8f4ff' },
          { label: 'Seçim etdi',     value: totalSub,          icon: '✅', color: '#237804', bg: '#f0fff4' },
          { label: 'Gözləyir',       value: totalPend,         icon: '⏳', color: '#d46b08', bg: '#fff7e6' },
          { label: 'Çap edildi',     value: totalPrinted,      icon: '🖨️', color: '#b8860b', bg: '#f4f0ff' },
          { label: 'Tamamlanma',     value: `${pct}%`,         icon: '📊', color: '#00b96b', bg: '#f0fff8' },
        ].map(item => (
          <div key={item.label} style={{
            padding: '14px 16px', borderRadius: 14,
            background: item.bg, border: `1.5px solid ${item.color}22`,
          }}>
            <div style={{ fontSize: 18, marginBottom: 5 }}>{item.icon}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: item.color, lineHeight: 1 }}>{item.value}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontWeight: 600 }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* ── Progress bar ── */}
      <div style={{ marginBottom: 16, background: '#fff', border: '1.5px solid var(--border)', borderRadius: 12, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Seçim tamamlanması</span>
          <span style={{ fontSize: 13, fontWeight: 800, color: '#00b96b' }}>{totalSub} / {instUsers.length}</span>
        </div>
        <div style={{ height: 10, borderRadius: 10, background: '#f0f2fa', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 10, transition: 'width .4s',
            width: `${pct}%`,
            background: pct === 100 ? '#237804' : pct >= 70 ? '#00b96b' : pct >= 40 ? '#d46b08' : '#ff4d4f',
          }} />
        </div>
      </div>

      {/* ── Təhsil alan siyahısı ── */}
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title">{activeInst?.icon} {activeInst?.label} — Təhsil alan Siyahısı</div>
            <div className="card-sub">{activeSel?.name} · {filtered.length} nəticə</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* Seçim filteri */}
            {(['all','submitted','pending'] as const).map(f => (
              <button key={f}
                className={`btn btn-sm ${statusFlt === f ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setStatusFlt(f)}
                style={statusFlt === f ? { background: '#00b96b', borderColor: '#00b96b' } : {}}
              >
                {f === 'all' ? 'Hamısı' : f === 'submitted' ? '✅ Seçim etdi' : '⏳ Gözləyir'}
              </button>
            ))}
            <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
            {/* Çap filteri */}
            {(['all','not_printed','printed'] as const).map(f => (
              <button key={f}
                className={`btn btn-sm ${printFlt === f ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPrintFlt(f)}
                style={printFlt === f ? { background: '#b8860b', borderColor: '#b8860b' } : {}}
              >
                {f === 'all' ? 'Çap: Hamısı' : f === 'printed' ? '🖨️ Çap edildi' : '📄 Çap edilməyib'}
              </button>
            ))}
          </div>
        </div>

        <div className="search-row">
          <input className="search-input" placeholder="🔍  Ad, FİN və ya iş nömrəsi..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div className="card-body" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>TƏHSİL ALAN</th>
                <th>İŞ NÖMRƏSİ</th>
                <th>FİN</th>
                {hasSources && <th style={{ width: 90, textAlign: 'center' }}>MƏNBƏYİ</th>}
                {hasYears  && <th style={{ width: 110 }}>TƏDRİS İLİ</th>}
                {hasGroups && <th style={{ width: 70, textAlign: 'center' }}>QRUP</th>}
                <th style={{ width: 100, textAlign: 'center' }}>BAL</th>
                <th>SEÇİM STATUSU</th>
                <th>ÇAP STATUSU</th>
                <th style={{ width: 60, textAlign: 'center' }}>ÇAP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u: any, i: number) => {
                const hasSub     = subSet.has(u.id)
                const isPrinted  = u.printStatus === 'printed'
                const grpStyle   = GRP_COLORS[String(u.group || '')] || { bg: '#f4f4f4', color: '#999' }

                return (
                  <tr key={u.id}>
                    <td style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                          background: isPrinted ? '#e6f9f0' : hasSub ? '#eef1ff' : '#f4f4f4',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                        }}>
                          {isPrinted ? '🖨️' : hasSub ? '✅' : '👤'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.parentName || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.workNumber || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 }}>{u.fin || '—'}</td>
                    {hasSources && (
                      <td style={{ textAlign: 'center' }}>
                        {u.source === 'mülki'
                          ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: '#e8f4ff', color: '#1677ff', fontWeight: 700, fontSize: 11, border: '1px solid #bae0ff' }}>Mülki</span>
                          : u.source === 'lisey'
                          ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: '#f9f0ff', color: '#531dab', fontWeight: 700, fontSize: 11, border: '1px solid #d3adf7' }}>Lisey</span>
                          : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        }
                      </td>
                    )}
                    {hasYears && (
                      <td style={{ textAlign: 'center' }}>
                        {u.year
                          ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: 'linear-gradient(145deg,#f0f3ff,#e4eaff)', color: '#9a7b1e', fontWeight: 700, fontSize: 11, border: '1px solid #d0d8f8' }}>{u.year}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                    )}
                    {hasGroups && (
                      <td style={{ textAlign: 'center' }}>
                        {u.group
                          ? <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, background: grpStyle.bg, color: grpStyle.color, fontWeight: 800, fontSize: 13 }}>{u.group}</span>
                          : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        }
                      </td>
                    )}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, background: '#e8f4ff', color: '#1677ff', fontWeight: 800, fontSize: 13 }}>
                        {Number(u.score).toFixed(2)}
                      </span>
                    </td>
                    <td>
                      {hasSub
                        ? <span className="badge badge-green">✓ Seçim edildi</span>
                        : <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#d46b08' }}>⚠ Seçim gözləyir</span>
                      }
                    </td>
                    <td>
                      {isPrinted
                        ? <span className="badge badge-green">🖨️ Çap edilib</span>
                        : <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' }}>📄 Çap edilməyib</span>
                      }
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => handlePrint(u)}
                        title="Çap et"
                        style={{
                          width: 34, height: 34, borderRadius: 9,
                          border: isPrinted ? '1.5px solid #b7eb8f' : '1.5px solid #d0d8ff',
                          background: isPrinted ? '#f6ffed' : '#f4f7ff',
                          color: isPrinted ? '#237804' : '#9a7b1e',
                          cursor: 'pointer', fontSize: 16,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all .15s',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isPrinted ? '#d9f7be' : '#e8eeff' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isPrinted ? '#f6ffed' : '#f4f7ff' }}
                      >
                        🖨️
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8 + (hasGroups ? 1 : 0) + (hasYears ? 1 : 0)}
                    style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px', fontSize: 13 }}>
                    Nəticə tapılmadı
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="pagination">
          <span className="page-info">
            {filtered.length} nəticə ·
            <span style={{ color: '#00b96b', fontWeight: 700 }}> {totalSub} seçim etdi</span> ·
            <span style={{ color: '#d46b08' }}> {totalPend} gözləyir</span> ·
            <span style={{ color: '#b8860b', fontWeight: 700 }}> {totalPrinted} çap edildi</span>
          </span>
        </div>
      </div>
    </>
  )
}
