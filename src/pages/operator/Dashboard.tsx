import { useState } from 'react'
import { selectionDb, userDb, submissionDb, institutionDb, treeDb, buildNameMap, useLocalState, addLog } from '../../db'
import { getOperatorSession } from '../../api/auth'

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
// Yalnız baş hərfi böyük (qalan kiçik) — çap başlıqları üçün
const sentenceCase = (s: any) => { const t = String(s ?? ''); return t.charAt(0) + t.slice(1).toLowerCase() }
const DEFAULT_LEVEL_NAMES = ['Qoşun növü', 'Mülki ixtisas', 'Hərbi uçot ixtisası']
function effectiveLevelNames(tree: any): string[] {
  if (!tree) return []
  let depth = 0
  const walk = (nodes: any[], cur: number) => { for (const n of nodes || []) { depth = Math.max(depth, cur + 1); if (n.children?.length) walk(n.children, cur + 1) } }
  walk(tree.nodes || [], 0)
  const count = Math.max(depth, tree.levelNames?.length || 0)
  return Array.from({ length: count }, (_, i) => tree.levelNames?.[i] || DEFAULT_LEVEL_NAMES[i] || `Səviyyə ${i + 1}`)
}

// ── Seçim vərəqi cədvəli (N səviyyəli dinamik — viewMode-a görə) ───────────────
function buildSheetTable(ranking: string[], pathMap: Record<string, any[]>, nameMap: Record<string, string>, lv: string[], isNested: boolean): string {
  const maxPath = ranking.reduce((m, id) => Math.max(m, (pathMap[id] || []).length), 0)
  const L = Math.max(lv.length || 0, maxPath, 1)
  const levelName = (i: number) => lv[i] || `Səviyyə ${i + 1}`
  const cells = (leafId: string): string[] => {
    const path = pathMap[leafId]
    if (!path || !path.length) {
      const arr = Array(L).fill('—'); arr[L - 1] = nameMap[leafId] || leafId; return arr
    }
    return Array.from({ length: L }, (_, i) => i < path.length ? path[i].name : '—')
  }

  if (isNested) {
    const root: any = { children: [], idx: new Map() }
    for (const id of ranking) {
      const c = cells(id)
      let node = root
      for (let level = 0; level < L; level++) {
        const nm = c[level]
        if (!node.idx.has(nm)) { node.idx.set(nm, node.children.length); node.children.push({ name: nm, order: node.children.length + 1, children: [], idx: new Map() }) }
        node = node.children[node.idx.get(nm)]
      }
    }
    const countRows = (n: any): number => n.children.length ? n.children.reduce((a: number, c: any) => a + countRows(c), 0) : 1
    const emit = (node: any, level: number): string[] => {
      const out: string[] = []
      for (const child of node.children) {
        const isLeafLevel = level === L - 1
        const childRows = isLeafLevel ? [''] : emit(child, level + 1)
        const span = isLeafLevel ? 1 : countRows(child)
        const cls = level === 0 ? 'c-grp' : (isLeafLevel ? '' : 'c-sub')
        const nameTd = cls ? `<td class="${cls}" rowspan="${span}">${esc(child.name)}</td>` : `<td rowspan="${span}">${esc(child.name)}</td>`
        childRows[0] = `<td class="c-ord" rowspan="${span}">${child.order}</td>${nameTd}` + childRows[0]
        out.push(...childRows)
      }
      return out
    }
    const rows = emit(root, 0).map(r => `<tr>${r}</tr>`).join('')
    const header = Array.from({ length: L }, (_, i) =>
      `<th class="t-ord">${esc(levelName(i))}<br/>sırası</th><th>${esc(sentenceCase(levelName(i)))}</th>`).join('')
    return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
  }

  let prev: string[] = Array(L).fill('')
  const rows = ranking.map((id, idx) => {
    const c = cells(id)
    let changed = false
    const tds = c.map((nm, i) => {
      if (nm !== prev[i]) changed = true
      const isLeaf = i === L - 1
      const cls = isLeaf ? '' : (changed ? (i === 0 ? 'c-grp' : 'c-sub') : 'c-rep')
      return cls ? `<td class="${cls}">${esc(nm)}</td>` : `<td>${esc(nm)}</td>`
    }).join('')
    prev = c
    return `<tr><td class="c-ord">${idx + 1}</td>${tds}</tr>`
  }).join('')
  const header = `<th class="t-ord">Seçim sırası</th>` + Array.from({ length: L }, (_, i) => `<th>${esc(sentenceCase(levelName(i)))}</th>`).join('')
  return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`
}

// ── Çap HTML-i (seçim vərəqi — viewMode-a görə dinamik) ───────────────────────
function generatePrintHTML(user: any, sel: any, nameMap: Record<string, string>, _instLabel: string, ranking: string[], tree?: any): string {
  const lvDyn = tree ? effectiveLevelNames(tree) : []
  const lv: string[] = lvDyn.length ? lvDyn : ['Ana Qrup', 'Alt Qrup', 'İxtisas']
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
  .c-ord{text-align:center;font-weight:bold;width:70px}.c-grp{font-weight:normal}.c-sub{font-weight:normal}.c-rep{color:#000}
  .confirm{margin-top:40px;border-top:1px solid #000;padding-top:10px;font-size:12px;font-weight:normal}
  .no-sub{text-align:center;padding:20px;border:1px solid #000;font-size:13px}
  @page{margin:12mm;size:A4 portrait} @media print{body{padding:0}}
</style></head>
<body>
  <div class="doc-title">Təhsilalanın ixtisas seçim vərəqi</div>
  <div class="info">
    <div class="info-left">
      <div class="name">Təhsilalan: ${esc(user.name)}</div>
      <div class="sub">FİN Kod: ${esc(user.fin || '—')}</div>
      <div class="sub">Abituriyentin iş nömrəsi: ${esc(user.workNumber || '—')}</div>
      ${user.group ? `<div class="sub">Qrup: ${esc(user.group)}${user.source ? ' · '+esc(user.source==='mülki'?'Mülki':user.source==='lisey'?'Lisey':user.source) : ''}</div>` : ''}
    </div>
    <div class="info-mid">Topladığı yekun bal: <b>${Number(user.score).toFixed(2)}</b></div>
    <div class="info-right"><div>Sənədin çap tarixi: ${printDate}</div><div class="sign-line">Təhsilalanın imzası</div></div>
  </div>
  ${ranking.length > 0 ? tableHTML : '<div class="no-sub">Bu təhsilalan seçim göndərməyib</div>'}
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

  const activeSels  = ((selections ?? []) as any[]).filter((s: any) => s.status === 'published')
  const _allSubs    = (allSubs ?? []) as any[]
  const insts       = ((institutions ?? []) as any[])
  const activeInsts = insts.filter((inst: any) =>
    activeSels.some((s: any) => s.institution === inst.id)
  )

  const activeTab  = tab || activeInsts[0]?.id || ''
  const activeSel  = activeSels.find((s: any) => s.institution === activeTab)
  const activeInst = insts.find((i: any) => i.id === activeTab)
  const instLabel  = activeInst ? activeInst.label : ''

  const instUsers   = ((users ?? []) as any[]).filter((u: any) => u.institution === activeTab)
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
  async function handlePrint(u: any) {
    const tree = activeSel ? await treeDb.get(activeSel.treeId) : null
    setNameMap(tree ? buildNameMap(tree) : {})
    setPrintUser(u)
  }

  async function confirmPrint() {
    if (!printUser) return
    // Submission-dan ranking-i al
    const sub     = await submissionDb.getByUser(printUser.id, activeSel?.id || '')
    const ranking: string[] = sub?.ranking || []
    // Çap statusunu yenilə
    await userDb.update(printUser.id, { printStatus: 'printed' })
    await refreshUsers()
    await refreshSubs()
    // ── Log yaz ─────────────────────────────────────────────────────────────
    const opName    = getOperatorSession()?.name || 'Operator'
    const wasAlready = printUser.printStatus === 'printed'
    addLog(
      'user',
      wasAlready ? 'warning' : 'success',
      `${wasAlready ? 'Yenidən çap' : 'Çap'}: ${printUser.name}`,
      `FİN: ${printUser.fin || '—'} · Bal: ${Number(printUser.score || 0).toFixed(2)} · ` +
      `Seçim: ${activeSel?.name || '—'} · Müəssisə: ${instLabel} · ` +
      `${wasAlready ? 'Bu təhsilalan əvvəllər də çap edilmişdi.' : `Seçim sırası: ${ranking.length} ixtisas`}`,
      opName,
    )
    // ────────────────────────────────────────────────────────────────────────
    setPrintUser(null)
    // Yeni pəncərədə çap et
    const treeForPrint = activeSel ? await treeDb.get(activeSel.treeId) : null
    const html = generatePrintHTML(printUser, activeSel, nameMap, instLabel, ranking, treeForPrint)
    const win  = window.open('', '_blank', 'width=1000,height=720')
    if (win) { win.document.write(html); win.document.close() }
  }

  if (activeInsts.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 14 }}>
        <div style={{ fontSize: 52 }}>🗳️</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text)' }}>Aktiv seçim yoxdur</div>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>Admin bir seçim yayımladıqda təhsilalanlar burada görünəcək</div>
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
              {/* Təhsilalan məlumatı */}
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
                  ⚠️ Bu təhsilalan hələ seçim göndərməyib. Yenə də çap edə bilərsiniz.
                </div>
              )}

              {printUser.printStatus === 'printed' && (
                <div style={{
                  background: '#f6ffed', border: '1.5px solid #b7eb8f',
                  borderRadius: 10, padding: '10px 14px',
                  fontSize: 12, color: '#237804', marginBottom: 16,
                  display: 'flex', gap: 8,
                }}>
                  ✅ Bu təhsilalan əvvəllər çap edilib. Yenidən çap edəcəksiniz?
                </div>
              )}

              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>
                Təhsilalanın seçim vərəqi çap ediləcək və çap statusu <b>«Çap edilib»</b> kimi qeyd olunacaq.
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
          { label: 'Cəmi təhsilalan',   value: instUsers.length, icon: '👥', color: '#1677ff', bg: '#e8f4ff' },
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

      {/* ── Təhsilalan siyahısı ── */}
      <div className="card">
        <div className="card-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title">{activeInst?.icon} {activeInst?.label} — Təhsilalan Siyahısı</div>
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
                <th style={{ width: 44 }}>№</th>
                <th>TƏHSİLALAN</th>
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
