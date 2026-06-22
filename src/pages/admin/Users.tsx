import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { userDb, submissionDb, institutionDb, userArchiveDb, selectionDb, treeDb, adminDb, buildNameMap, useLocalState, addLog } from '../../db'
import InstIcon, { isImageIcon } from '../../components/InstIcon'
import { AppDialog, useDialog } from '../../components/AppDialog'
import { can } from '../../permissions'

// ── Tree-dən hər yarpaq üçün tam yol (node adları) ────────────────────────────
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
    // ── Qrup görünüşü: hər səviyyədə ayrıca seçim sırası + rowspan ──
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
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
  }

  // ── Siyahı görünüşü: vahid sıra (1..N) ──
  let rows = ''
  let prevG = '', prevS = ''
  ranking.forEach((id, i) => {
    const { g, s, l } = resolve(id)
    const gCh = g !== prevG, sCh = gCh || s !== prevS
    rows += `<tr>
      <td class="c-ord">${i + 1}</td>
      <td class="${gCh ? 'c-grp' : 'c-rep'}">${esc(g)}</td>
      <td class="${sCh ? 'c-sub' : 'c-rep'}">${esc(s)}</td>
      <td>${esc(l)}</td>
    </tr>`
    prevG = g; prevS = s
  })
  return `<table>
    <thead><tr>
      <th class="t-ord">Seçim sırası</th><th>${esc(lv0).toUpperCase()}</th><th>${esc(lv1).toUpperCase()}</th><th>${esc(lv2).toUpperCase()}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

// ── Çap HTML generasiyası (seçim vərəqi — viewMode-a görə dinamik) ────────────
function generatePrintHTML(user: any, sel: any, nameMap: Record<string, string>, _instLabel: string, ranking: string[], tree: any): string {
  const lv: string[] = tree?.levelNames?.length ? tree.levelNames : ['Ana Qrup', 'Alt Qrup', 'İxtisas']
  const pathMap = tree ? buildLeafPaths(tree.nodes || []) : {}
  const isNested = sel?.viewMode === 'nested'
  const tableHTML = buildSheetTable(ranking, pathMap, nameMap, [lv[0]||'Ana Qrup', lv[1]||'Alt Qrup', lv[2]||'İxtisas'], isNested)

  const printDate = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` })()

  return `<!DOCTYPE html>
<html lang="az"><head><meta charset="UTF-8"/>
<title>Seçim Vərəqi — ${esc(user.name)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Times New Roman',Georgia,serif;padding:18px 24px;color:#000;font-size:12px}
  .doc-title{text-align:center;font-size:16px;font-weight:bold;letter-spacing:.5px;margin-bottom:14px}
  .info{border:1px solid #000;padding:12px 16px;display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  .info-left .name{font-size:14px;font-weight:bold}
  .info-left .sub{font-size:11px;margin-top:3px}
  .info-mid{text-align:center;font-size:12px;padding-top:4px}
  .info-right{text-align:right;font-size:11px}
  .sign-line{margin-top:34px;border-top:1px solid #000;width:200px;margin-left:auto;text-align:center;padding-top:4px;font-size:11px}
  table{width:100%;border-collapse:collapse;margin-bottom:18px}
  th,td{border:1px solid #000;padding:6px 10px;vertical-align:middle;color:#000}
  th{background:#fff;font-size:11px;font-weight:bold;text-align:left;line-height:1.3}
  th.t-ord{text-align:center;width:70px}
  .c-ord{text-align:center;font-weight:bold;width:70px}
  .c-grp{font-weight:bold}
  .c-sub{font-weight:bold}
  .c-rep{color:#000}
  .confirm{margin-top:14px;padding-top:10px;font-size:12px;font-weight:bold}
  .no-sub{text-align:center;padding:20px;border:1px solid #000;font-size:13px}
  @page{margin:12mm;size:A4 portrait} @media print{body{padding:0}}
</style></head>
<body>
  <div class="doc-title">KURSANTIN İXTİSAS SEÇİM VƏRƏQİ</div>

  <div class="info">
    <div class="info-left">
      <div class="name">Kursant: ${esc(user.name)}</div>
      <div class="sub">FİN Kod: ${esc(user.fin || '—')}</div>
      <div class="sub">Abituriyentin iş nömrəsi: ${esc(user.workNumber || '—')}</div>
      ${user.group ? `<div class="sub">Qrup: ${esc(user.group)}${user.source ? ' · '+esc(user.source==='mülki'?'Mülki':user.source==='lisey'?'Lisey':user.source) : ''}</div>` : ''}
    </div>
    <div class="info-mid">Topladığı Yekun Bal: <b>${Number(user.score).toFixed(2)}</b></div>
    <div class="info-right">
      <div>Sənədin Çap Tarixi: ${printDate}</div>
      <div class="sign-line">Kursantın İmzası</div>
    </div>
  </div>

  ${ranking.length > 0 ? tableHTML : '<div class="no-sub">Bu kursant seçim göndərməyib</div>'}

  <div class="confirm">Yuxarıdakı seçimlərin mənə aid olduğunu öz imzamla təsdiq edirəm.</div>
</body>
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close()}}</script>
</html>`
}

// ── Excel export ──────────────────────────────────────────────────────────────
function exportToExcel(rows: any[], instLabel: string, instId: string, subCountMap: Record<string, number>, included?: Set<string>) {
  const inc = (c: string) => c === '#' || !included || included.has(c)
  // ── Kursant seçimlərini hazırla (müəssisənin seçimi üzrə) ──
  const allSels = selectionDb.getAll() as any[]
  const sel = allSels.find((s: any) => s.institution === instId && s.status === 'published')
          || allSels.find((s: any) => s.institution === instId && s.status !== 'draft')
          || allSels.find((s: any) => s.institution === instId)
  const tree = sel ? treeDb.get(sel.treeId) : null
  const pathMap = tree ? buildLeafPaths(tree.nodes || []) : {}
  const subsByUser: Record<string, string[]> = {}
  if (sel) {
    for (const sub of submissionDb.getBySelection(sel.id) as any[]) {
      subsByUser[sub.userId] = sub.ranking || []
    }
  }
  const formatChoices = (uid: string): string => {
    const rk = subsByUser[uid]
    if (!rk || rk.length === 0) return ''
    return rk.map((leafId, idx) => {
      const path = pathMap[leafId]
      const txt = path ? path.map((n: any) => n.name).join(' → ') : leafId
      return `${idx + 1}. ${txt}`
    }).join('\n')
  }

  // ── Cədvəldəki bütün dinamik sütunları rows-dan çıxar ──
  const subjectKeys = (() => {
    const ks = new Set<string>()
    rows.forEach((u: any) => { if (u.subjects) Object.keys(u.subjects).forEach(k => { if (u.subjects[k] != null) ks.add(k) }) })
    return Array.from(ks)
  })()
  const hasGroups  = rows.some((u: any) => u.group)
  const hasSources = rows.some((u: any) => u.source)
  const hasGender  = rows.some((u: any) => u.gender)

  const data = rows.map((u: any, i: number) => {
    const hasSub = subCountMap[u.id] > 0
    const nameParts = (u.name || '').trim().split(/\s+/)
    const firstName = nameParts[0] || ''
    const lastName  = nameParts.slice(1).join(' ') || ''
    const base: any = { '#': i + 1 }
    if (inc('Ad'))               base['Ad'] = firstName
    if (inc('Soyad'))            base['Soyad'] = lastName
    if (inc('Ata adı'))          base['Ata adı'] = u.parentName || '—'
    if (inc('İş nömrəsi'))       base['İş nömrəsi'] = u.workNumber || '—'
    if (inc('FİN'))              base['FİN'] = u.fin || '—'
    if (inc('Təhsil müəssisəsi')) base['Təhsil müəssisəsi'] = instLabel
    if (inc('Tədris ili'))       base['Tədris ili'] = u.year || '—'
    if (hasGroups  && inc('Qrup'))  base['Qrup']  = u.group  || '—'
    if (hasSources && inc('Mənbə')) base['Mənbə'] = u.source || '—'
    if (hasGender  && inc('Cins'))  base['Cins']  = u.gender ? (u.gender === 'qadın' ? 'Qadın' : 'Kişi') : '—'
    if (inc('Ümumi imtahan nəticəsi')) base['Ümumi imtahan nəticəsi'] = Number(u.score || 0).toFixed(2)
    subjectKeys.forEach(k => { if (inc(k)) base[k] = (u.subjects?.[k] != null) ? Number(u.subjects[k]).toFixed(2) : '—' })
    if (inc('Seçim statusu'))    base['Seçim statusu'] = hasSub ? 'Seçim edildi' : 'Seçim gözləyir'
    if (inc('Çap statusu'))      base['Çap statusu'] = u.printStatus === 'printed' ? 'Çap edilib' : 'Çap edilməyib'
    if (inc('Yerləşdiyi ixtisas')) base['Yerləşdiyi ixtisas'] = u.placedSpecialty || 'Yerləşdirilməyib'
    if (inc('Kursantın seçimləri (prioritetlə)')) base['Kursantın seçimləri (prioritetlə)'] = formatChoices(u.id)
    return base
  })
  const ws = XLSX.utils.json_to_sheet(data)
  // ── Sütun enləri (sütun adına görə dinamik) ──
  const colKeys = Object.keys(data[0] || {})
  ws['!cols'] = colKeys.map(k =>
    k === 'Kursantın seçimləri (prioritetlə)' ? { wch: 70 }
    : k === 'Yerləşdiyi ixtisas'   ? { wch: 24 }
    : k === 'Ümumi imtahan nəticəsi' ? { wch: 18 }
    : k === 'Təhsil müəssisəsi' || k === 'Seçim statusu' || k === 'Çap statusu' ? { wch: 15 }
    : k === '#' ? { wch: 4 }
    : { wch: 13 }
  )
  const choiceColIdx = colKeys.indexOf('Kursantın seçimləri (prioritetlə)')
  if (choiceColIdx >= 0) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    for (let r = 1; r <= range.e.r; r++) {
      const addr = XLSX.utils.encode_cell({ r, c: choiceColIdx })
      if (ws[addr]) ws[addr].s = { alignment: { wrapText: true, vertical: 'top' } }
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, instLabel)
  const date = new Date().toLocaleDateString('az-AZ').replace(/\./g, '-')
  XLSX.writeFile(wb, `${instLabel}_Tələbələr_${date}.xlsx`)
}

// ── Versiya 2/3 üçün ortaq köməkçi: birləşmiş başlıqlı vərəq qur ──────────────
function buildLeveledSheet(
  rows: any[], instLabel: string, instId: string, subCountMap: Record<string, number>,
  included: Set<string> | undefined, selMode: 'levels' | 'flat',
) {
  const inc = (c: string) => c === '#' || !included || included.has(c)
  const allSels = selectionDb.getAll() as any[]
  const sel = allSels.find((s: any) => s.institution === instId && s.status === 'published')
          || allSels.find((s: any) => s.institution === instId && s.status !== 'draft')
          || allSels.find((s: any) => s.institution === instId)
  const tree = sel ? treeDb.get(sel.treeId) : null
  const pathMap = tree ? buildLeafPaths(tree.nodes || []) : {}
  const lv: string[] = (tree?.levelNames && tree.levelNames.length) ? tree.levelNames : ['Qoşun növü', 'Orta ixtisas təhsili üzrə ixtisaslar', 'Hərbi Uçot İxtisası']
  const nLv = lv.length
  const lvName = (i: number) => lv[i] || `Səviyyə ${i + 1}`
  const subsByUser: Record<string, string[]> = {}
  if (sel) for (const s of submissionDb.getBySelection(sel.id) as any[]) subsByUser[s.userId] = s.ranking || []

  const subjectKeys = (() => {
    const ks = new Set<string>()
    rows.forEach((u: any) => { if (u.subjects) Object.keys(u.subjects).forEach(k => { if (u.subjects[k] != null) ks.add(k) }) })
    return Array.from(ks)
  })()
  const hasGroups  = rows.some((u: any) => u.group)
  const hasSources = rows.some((u: any) => u.source)
  const hasGender  = rows.some((u: any) => u.gender)

  // Bütün tək sütunlar, sonra seçilənlərə süz
  const singleAll = ['#', 'Ad', 'Soyad', 'Ata adı', 'İş nömrəsi', 'FİN', 'Təhsil müəssisəsi', 'Tədris ili']
  if (hasGroups)  singleAll.push('Qrup')
  if (hasSources) singleAll.push('Mənbə')
  if (hasGender)  singleAll.push('Cins')
  singleAll.push('Ümumi imtahan nəticəsi')
  subjectKeys.forEach(k => singleAll.push(k))
  singleAll.push('Seçim statusu', 'Çap statusu')
  const singleCols = singleAll.filter(inc)

  const showPlaced = inc('Yerləşdiyi ixtisas')
  const showSel    = inc('Kursantın seçimləri (prioritetlə)')

  const row1: any[] = [...singleCols]
  const row2: any[] = singleCols.map(() => '')
  let placedStart = -1, selStart = -1
  if (showPlaced) {
    placedStart = row1.length
    row1.push('Yerləşdiyi ixtisas'); for (let i = 1; i < nLv; i++) row1.push('')
    for (let i = 0; i < nLv; i++) row2.push(lvName(i))
  }
  if (showSel) {
    selStart = row1.length
    if (selMode === 'levels') {
      row1.push('Kursantın seçimləri (prioritetlə)'); for (let i = 1; i < nLv; i++) row1.push('')
      for (let i = 0; i < nLv; i++) row2.push(lvName(i))
    } else {
      row1.push('Kursantın seçimləri (prioritetlə)'); row2.push('')
    }
  }

  const placedNames = (u: any): string[] => {
    if (u.placedSpecialtyId && pathMap[u.placedSpecialtyId]) return pathMap[u.placedSpecialtyId].map((n: any) => n.name)
    if (u.placedSpecialty) return String(u.placedSpecialty).split('→').map(s => s.trim()).filter(Boolean)
    return []
  }
  const flat = (uid: string) => {
    const rk = subsByUser[uid]
    if (!rk || !rk.length) return ''
    return rk.map((leafId, idx) => { const p = pathMap[leafId]; return `${idx + 1}. ${p ? p.map((n: any) => n.name).join(' → ') : leafId}` }).join('\n')
  }

  const aoa: any[][] = [row1, row2]
  rows.forEach((u: any, idx: number) => {
    const hasSub = subCountMap[u.id] > 0
    const parts = (u.name || '').trim().split(/\s+/)
    const vmap: Record<string, any> = {
      '#': idx + 1, 'Ad': parts[0] || '', 'Soyad': parts.slice(1).join(' ') || '',
      'Ata adı': u.parentName || '—', 'İş nömrəsi': u.workNumber || '—', 'FİN': u.fin || '—',
      'Təhsil müəssisəsi': instLabel, 'Tədris ili': u.year || '—',
      'Qrup': u.group || '—', 'Mənbə': u.source || '—',
      'Cins': u.gender ? (u.gender === 'qadın' ? 'Qadın' : 'Kişi') : '—',
      'Ümumi imtahan nəticəsi': Number(u.score || 0).toFixed(2),
      'Seçim statusu': hasSub ? 'Seçim edildi' : 'Seçim gözləyir',
      'Çap statusu': u.printStatus === 'printed' ? 'Çap edilib' : 'Çap edilməyib',
    }
    subjectKeys.forEach(k => { vmap[k] = u.subjects?.[k] != null ? Number(u.subjects[k]).toFixed(2) : '—' })
    const r: any[] = singleCols.map(k => vmap[k])
    if (showPlaced) {
      const pn = placedNames(u)
      for (let i = 0; i < nLv; i++) r.push(pn[i] || (i === 0 && pn.length === 0 ? 'Yerləşdirilməyib' : ''))
    }
    if (showSel) {
      if (selMode === 'levels') {
        const rk = subsByUser[u.id] || []
        for (let i = 0; i < nLv; i++) {
          const lines = rk.map((leafId, ci) => { const p = pathMap[leafId]; const nm = p && p[i] ? p[i].name : (p ? p[p.length - 1]?.name : leafId); return `${ci + 1}. ${nm}` })
          r.push(lines.join('\n'))
        }
      } else {
        r.push(flat(u.id))
      }
    }
    aoa.push(r)
  })

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const merges: any[] = []
  for (let c = 0; c < singleCols.length; c++) merges.push({ s: { r: 0, c }, e: { r: 1, c } })
  if (showPlaced) merges.push({ s: { r: 0, c: placedStart }, e: { r: 0, c: placedStart + nLv - 1 } })
  if (showSel) {
    if (selMode === 'levels') merges.push({ s: { r: 0, c: selStart }, e: { r: 0, c: selStart + nLv - 1 } })
    else merges.push({ s: { r: 0, c: selStart }, e: { r: 1, c: selStart } })
  }
  ws['!merges'] = merges

  const cols: any[] = singleCols.map(k => k === '#' ? { wch: 4 } : k === 'Ümumi imtahan nəticəsi' ? { wch: 16 } : { wch: 13 })
  if (showPlaced) for (let i = 0; i < nLv; i++) cols.push({ wch: 26 })
  if (showSel) {
    if (selMode === 'levels') for (let i = 0; i < nLv; i++) cols.push({ wch: 40 })
    else cols.push({ wch: 70 })
  }
  ws['!cols'] = cols

  if (showSel) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
    const wrapFrom = selStart
    const wrapTo   = selMode === 'levels' ? selStart + nLv - 1 : selStart
    for (let r = 2; r <= range.e.r; r++) {
      for (let c = wrapFrom; c <= wrapTo; c++) {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (ws[addr]) ws[addr].s = { alignment: { wrapText: true, vertical: 'top' } }
      }
    }
  }
  return ws
}

// ── Versiya 2: hər ikisi səviyyəli ──
function exportToExcelV2(rows: any[], instLabel: string, instId: string, subCountMap: Record<string, number>, included?: Set<string>) {
  const ws = buildLeveledSheet(rows, instLabel, instId, subCountMap, included, 'levels')
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, instLabel)
  const date = new Date().toLocaleDateString('az-AZ').replace(/\./g, '-')
  XLSX.writeFile(wb, `${instLabel}_Tələbələr_v2_${date}.xlsx`)
}

// ── Versiya 3: yerləşmə səviyyəli, seçimlər düz xətt ──
function exportToExcelV3(rows: any[], instLabel: string, instId: string, subCountMap: Record<string, number>, included?: Set<string>) {
  const ws = buildLeveledSheet(rows, instLabel, instId, subCountMap, included, 'flat')
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, instLabel)
  const date = new Date().toLocaleDateString('az-AZ').replace(/\./g, '-')
  XLSX.writeFile(wb, `${instLabel}_Tələbələr_v3_${date}.xlsx`)
}

// ── Excel import ──────────────────────────────────────────────────────────────
// Açarlar normalizeColKey() ilə emal edilmiş formada saxlanılır
const COL_MAP: Record<string, string> = {
  'ad soyad':           'name',
  'ad':                 'firstName',
  'soyad':              'lastName',
  'ata adi':            'parentName',
  'is nomresi':         'workNumber',
  'fin':                'fin',
  'imtahan neticesi':         'score',
  'umumi imtahan neticesi':   'score',
  'qrup':               'group',
  'menbe':              'source',
  'mənbə':              'source',
  'cins':               'gender',
  'cinsi':              'gender',
  'gender':             'gender',
  'cap statusu':        'printStatus',
  'yerlesdiy ixtisas':  'placedSpecialty',
  'yerlesdiyi ixtisas': 'placedSpecialty',
}

// Sabit (həmişə daxil olan) sütunlar
const BASE_COLS = ['Ad', 'Soyad', 'Ata adı', 'İş nömrəsi', 'FİN', 'Ümumi imtahan nəticəsi']

// Hər sütun üçün nümunə dəyərlər (ön izləmədə göstərilir)
const COL_EXAMPLES: Record<string, string[]> = {
  'Ad':                   ['Əli',            'Nigar'],
  'Soyad':                ['Həsənov',        'Quliyeva'],
  'Ata adı':              ['Həsən',          'Rauf'],
  'İş nömrəsi':           ['1042',           '2187'],
  'FİN':                  ['AB1C2D3',        'XY9Z0W1'],
  'Ümumi imtahan nəticəsi':     ['87.50',          '91.25'],
  'Qrup':                 ['1',              '3'],
  'Mənbə':                ['mülki',          'lisey'],
  'Cins':                 ['Qadın',          'Kişi'],
  'Prioritet':            ['1',              '2'],
  'Seçim statusu':        ['Seçim edildi',   'Seçim gözləyir'],
  'Çap statusu':          ['Çap edilib',     'Çap edilməyib'],
  'Yerləşdiyi ixtisas':   ['Yerləşdirilməyib', 'Yerləşdirilməyib'],
}

// Həmişə şablona daxil olan (amma kilidli deyil, toggle-da görünmür)
const DEFAULT_ALWAYS_COLS: string[] = []

// Əlavə sütun seçiciləri — ad (Excel başlığı) + field (COL_MAP açarı)
const EXTRA_COLS = [
  { label: 'Qrup',  col: 'Qrup' },
  { label: 'Mənbə', col: 'Mənbə' },
  { label: 'Cins',  col: 'Cins' },
]

const SUBJ_COLORS = [
  '#c9962a','#52c41a','#f5a623','#ff4d4f',
  '#722ed1','#13c2c2','#c41d7f','#1677ff','#d46b08','#389e0d',
]

// Tədris ili seçimləri (SelectionNew ilə eyni)
const currentYear = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => {
  const y = currentYear - 1 + i
  return `${y}–${y + 1}`
})

// Azərbaycan hərflərini (İ, ı və s.) düzgün normalize et
function normalizeColKey(s: string): string {
  return s.trim()
    .replace(/İ/g, 'I').replace(/Ğ/g, 'G').replace(/Ü/g, 'U')
    .replace(/Ş/g, 'S').replace(/Ö/g, 'O').replace(/Ç/g, 'C')
    .replace(/ə/g, 'e').replace(/Ə/g, 'E')   // şva → e
    .replace(/ı/g, 'i')                        // nöqtəsiz i → i
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // birləşdirici işarələri sil
}

// Cins dəyərini normalize et → 'qadın' | 'kişi' | null
export function normGender(v: any): 'qadın' | 'kişi' | null {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return null
  if (['qadın', 'qadin', 'q', 'f', 'female', 'qız', 'qiz', 'w'].includes(s)) return 'qadın'
  if (['kişi', 'kisi', 'k', 'm', 'male', 'oğlan', 'oglan'].includes(s)) return 'kişi'
  return null
}

function parseExcel(file: File, instId: string, subjectCols: string[] = [], levelNames: string[] = []): Promise<{ ok: any[]; errors: string[] }> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb   = XLSX.read(e.target?.result, { type: 'array' })
        const ws   = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as any[]
        const ok: any[] = []; const errors: string[] = []
        rows.forEach((row, i) => {
          const norm: any = {}
          const subjects: Record<string, number | null> = {}
          const branchByLevel: Record<number, string> = {}
          for (const [k, v] of Object.entries(row)) {
            const nk    = normalizeColKey(k)
            const field = COL_MAP[nk]
            if (field) {
              norm[field] = String(v).trim()
            } else {
              // Ağacın səviyyə adı ilə eyni sütun → əvvəlcədən bölgü dəyəri
              const lvIdx = levelNames.findIndex(ln => normalizeColKey(ln) === nk)
              if (lvIdx >= 0) {
                const bv = String(v).trim()
                if (bv) branchByLevel[lvIdx] = bv
              } else {
                // subjectCols içindən tap, tapılmasa sütun adının özünü işlət
                const matchedSubj = subjectCols.find(s => normalizeColKey(s) === nk) || k.trim()
                const strVal = String(v).trim()
                if (strVal !== '') {
                  const val = parseFloat(strVal)
                  subjects[matchedSubj] = isNaN(val) ? null : val
                }
              }
            }
          }
          // Ayrı "Ad" + "Soyad" sütunları varsa birləşdir
          if (!norm.name && (norm.firstName || norm.lastName)) {
            norm.name = [norm.firstName, norm.lastName].filter(Boolean).join(' ')
          }
          if (!norm.name) { errors.push(`Sətir ${i + 2}: Ad Soyad boşdur`); return }
          if (!norm.fin)  { errors.push(`Sətir ${i + 2}: FİN boşdur`); return }
          const score = parseFloat(norm.score || '0')
          ok.push({
            institution: instId, name: norm.name, parentName: norm.parentName || '',
            workNumber: norm.workNumber || '', fin: norm.fin,
            score: isNaN(score) ? 0 : score, group: norm.group || null,
            source: norm.source || null,
            gender: normGender(norm.gender),
            packet: 1, status: 'pending',
            printStatus: norm.printStatus === 'Çap edilib' ? 'printed' : 'not_printed',
            placedSpecialty: norm.placedSpecialty && norm.placedSpecialty !== 'Yerləşdirilməyib'
              ? norm.placedSpecialty : null,
            ...(Object.keys(subjects).length > 0 ? { subjects } : {}),
            ...(Object.keys(branchByLevel).length > 0 ? { branchByLevel } : {}),
          })
        })
        resolve({ ok, errors })
      } catch { resolve({ ok: [], errors: ['Fayl oxuna bilmədi.'] }) }
    }
    reader.readAsArrayBuffer(file)
  })
}

function ImportModal({ instId, instLabel, onClose, onImported }: {
  instId: string; instLabel: string; onClose: () => void; onImported: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview,    setPreview]    = useState<any[]>([])
  const [errors,     setErrors]     = useState<string[]>([])
  const [loading,    setLoading]    = useState(false)
  const [done,       setDone]       = useState(false)
  const [mode,       setMode]       = useState<'add' | 'replace'>('add')
  const [year,       setYear]       = useState<string>(YEAR_OPTIONS[1])
  const [customYear, setCustomYear] = useState('')
  const [useCustom,  setUseCustom]  = useState(false)
  // ── Şablon konfiqurasiyasını localStorage-dan yüklə ──
  const TMPL_KEY = `mmu_import_tmpl_${instId}`
  function loadTmpl() {
    try { return JSON.parse(localStorage.getItem(TMPL_KEY) || '{}') } catch { return {} }
  }
  const initTmpl = loadTmpl()

  const [extraCols,      setExtraCols]      = useState<string[]>(initTmpl.extraCols   || [])
  const [customCol,      setCustomCol]      = useState('')
  const [subjectCols,    setSubjectCols]    = useState<string[]>(initTmpl.subjectCols || [])
  const [showSubjModal,  setShowSubjModal]  = useState(false)
  const [subjInput,      setSubjInput]      = useState('')

  // ── Hər dəyişiklikdə localStorage-a yaz ──
  useEffect(() => {
    localStorage.setItem(TMPL_KEY, JSON.stringify({ extraCols, subjectCols }))
  }, [extraCols, subjectCols])

  const selectedYear = useCustom ? customYear : year
  const customValid  = /^\d{4}[-–]\d{4}$/.test(customYear)

  // ── İxtisas strukturundan oxunan səviyyə adları → əlavə şablon sütunları ──
  const instTreeForCols = (treeDb.getAll() as any[]).find((t: any) => t.institution === instId)
  const levelCols: { label: string; col: string }[] = (instTreeForCols?.levelNames || []).map((ln: string) => ({ label: ln, col: ln }))
  const predefCols = [...EXTRA_COLS, ...levelCols]
  // Səviyyə sütunları üçün nümunə dəyərlər (həmin səviyyədəki ilk node adları)
  const levelExamples: Record<string, string[]> = {}
  levelCols.forEach((lc, idx) => {
    const names: string[] = []
    const walk = (nodes: any[], cur: number) => { for (const n of nodes || []) { if (cur === idx) { if (!names.includes(n.name)) names.push(n.name) } else if (n.children?.length) walk(n.children, cur + 1) } }
    walk(instTreeForCols?.nodes || [], 0)
    levelExamples[lc.col] = [names[0] || '...', names[1] || names[0] || '...']
  })

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setLoading(true)
    const instTree = (treeDb.getAll() as any[]).find((t: any) => t.institution === instId)
    const { ok, errors: errs } = await parseExcel(f, instId, subjectCols, instTree?.levelNames || [])
    setPreview(ok); setErrors(errs); setLoading(false)
  }

  function handleImport() {
    const yr = useCustom ? customYear : year
    const existing = userDb.getAll() as any[]
    const withYear = preview.map(u => ({ ...u, year: yr || null }))
    if (mode === 'replace') {
      const others   = existing.filter((u: any) => u.institution !== instId)
      const newUsers = withYear.map((u, i) => ({ ...u, id: `imp_${instId}_${Date.now()}_${i}` }))
      localStorage.setItem('mmu_users', JSON.stringify([...others, ...newUsers]))
    } else {
      const fins  = new Set(existing.filter((u: any) => u.institution === instId).map((u: any) => u.fin))
      const toAdd = withYear.filter(u => !fins.has(u.fin)).map((u, i) => ({ ...u, id: `imp_${instId}_${Date.now()}_${i}` }))
      const updated = existing.map((u: any) => {
        const match = withYear.find(p => p.fin === u.fin && u.institution === instId)
        return match ? { ...u, ...match } : u
      })
      localStorage.setItem('mmu_users', JSON.stringify([...updated, ...toAdd]))
    }
    // Prioritet fənlərini qlobal yadda saxla
    if (subjectCols.length > 0) {
      localStorage.setItem('mmu_priority_subjects', JSON.stringify(subjectCols))
    }
    setDone(true); onImported()
    addLog('user', 'success', `Excel idxal: ${preview.length} kursant (${mode === 'replace' ? 'əvəzlə' : 'əlavə et'})`,
      `Müəssisə: ${instLabel} · İl: ${selectedYear}`)
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">📤 Excel İdxal — {instLabel}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!done ? (<>

            {/* ── Tədris ili seçimi ── */}
            <div className="form-group">
              <label className="form-label">📅 Tədris İli *</label>
              <select
                className="form-input"
                value={useCustom ? '__custom__' : year}
                onChange={e => {
                  if (e.target.value === '__custom__') { setUseCustom(true); setCustomYear('') }
                  else { setUseCustom(false); setYear(e.target.value) }
                }}
                style={{ cursor: 'pointer' }}
              >
                {YEAR_OPTIONS.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
                <option value="__custom__">✏️ Özüm yazım...</option>
              </select>
              {useCustom && (
                <div style={{ marginTop: 8 }}>
                  <input
                    className="form-input"
                    placeholder="2031-2032"
                    value={customYear}
                    maxLength={9}
                    autoFocus
                    onChange={e => {
                      let v = e.target.value.replace(/[^\d\-–]/g, '')
                      if (/^\d{5,}$/.test(v)) v = v.slice(0, 4) + '-' + v.slice(4, 8)
                      setCustomYear(v)
                    }}
                    style={{ borderColor: customYear === '' ? 'var(--border)' : customValid ? '#52c41a' : '#ff4d4f' }}
                  />
                  <div style={{ fontSize: 11, marginTop: 5, color: customYear === '' ? 'var(--muted)' : customValid ? '#52c41a' : '#ff4d4f' }}>
                    {customYear === '' ? '📝 Format: 2025-2026' : customValid ? '✅ Düzgün format' : '❌ Format: 2025-2026'}
                  </div>
                </div>
              )}
            </div>

            {/* ── Şablon konfiquratoru ── */}
            {(() => {
              const allTemplateCols = [...BASE_COLS, ...extraCols, ...subjectCols, ...DEFAULT_ALWAYS_COLS]
              const customOnly = extraCols.filter(c => !predefCols.find(x => x.col === c))
              return (
                <div style={{ background: '#f4f7ff', border: '1.5px solid #f3e3b8', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12 }}>📋 Excel şablon sütunları</div>

                  {/* ── Canlı ön izləmə ── */}
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#3a4560', marginBottom: 6 }}>📊 Canlı ön izləmə:</div>
                    <div style={{
                      overflowX: 'auto', borderRadius: 8,
                      border: '1.5px solid #c5d0ff', background: '#fff',
                      boxShadow: '0 2px 8px #c9962a18',
                    }}>
                      <table style={{ borderCollapse: 'collapse', minWidth: '100%', fontSize: 11 }}>
                        <thead>
                          <tr>
                            {allTemplateCols.map((col, i) => {
                              const isBase    = BASE_COLS.includes(col)
                              const isAlways  = DEFAULT_ALWAYS_COLS.includes(col)
                              const subjIdx   = subjectCols.indexOf(col)
                              const isSubj    = subjIdx >= 0
                              const subjClr   = isSubj ? SUBJ_COLORS[subjIdx % SUBJ_COLORS.length] : ''
                              const isCustom  = !predefCols.find(x => x.col === col) && !isBase && !isAlways && !isSubj
                              const accent    = isBase ? '#c9962a' : isAlways ? '#f5a623' : isSubj ? subjClr : isCustom ? '#c41d7f' : '#52c41a'
                              const bgHead    = isBase ? '#eef1ff' : isAlways ? '#fff8e6' : isSubj ? `${subjClr}14` : isCustom ? '#fff0f6' : '#f0fff4'
                              return (
                                <th key={col} style={{
                                  padding: '7px 12px', fontWeight: 800, color: accent,
                                  background: bgHead, whiteSpace: 'nowrap',
                                  borderRight: i < allTemplateCols.length - 1 ? '1px solid #e4e8f8' : 'none',
                                  borderBottom: `2.5px solid ${accent}`,
                                  textAlign: 'left', letterSpacing: 0.2,
                                }}>
                                  <span style={{ marginRight: 4, fontSize: 10 }}>
                                    {isBase ? '🔒' : isAlways ? '★' : isSubj ? '🎯' : isCustom ? '✦' : '✓'}
                                  </span>
                                  {col}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {[0, 1].map(rowIdx => (
                            <tr key={rowIdx} style={{ background: rowIdx === 1 ? '#fafbff' : '#fff' }}>
                              {allTemplateCols.map((col, i) => {
                                const examples = COL_EXAMPLES[col] || levelExamples[col]
                                const val      = examples ? examples[rowIdx] : '...'
                                const isCustom = !predefCols.find(x => x.col === col) && !BASE_COLS.includes(col) && !DEFAULT_ALWAYS_COLS.includes(col) && !subjectCols.includes(col)
                                return (
                                  <td key={col} style={{
                                    padding: '5px 12px', color: isCustom ? '#c41d7f' : '#3a4560',
                                    fontStyle: isCustom ? 'italic' : 'normal',
                                    borderRight: i < allTemplateCols.length - 1 ? '1px solid #f0f2fa' : 'none',
                                    borderTop: '1px solid #f0f2fa',
                                    whiteSpace: 'nowrap', fontSize: 11,
                                  }}>
                                    {val}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ── Bütün sütunlar (toggle) ── */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#3a4560', marginBottom: 8 }}>Sütunları seçin / çıxarın:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>

                      {/* Sabit sütunlar — kilidli */}
                      {BASE_COLS.map(col => (
                        <div key={col} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '5px 13px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          background: '#e8f0ff', color: '#c9962a',
                          border: '1.5px solid #bfd0ff',
                          userSelect: 'none',
                        }}>
                          🔒 {col}
                        </div>
                      ))}

                      {/* Əlavə predefined sütunlar (Qrup/Mənbə/Cins + struktur səviyyə adları) — toggleable */}
                      {predefCols.map(({ label, col }) => {
                        const active = extraCols.includes(col)
                        return (
                          <button key={col}
                            onClick={() => setExtraCols(p => active ? p.filter(c => c !== col) : [...p, col])}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '5px 13px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                              cursor: 'pointer',
                              border: `1.5px solid ${active ? '#52c41a' : '#c5d0ff'}`,
                              background: active ? '#f0fff4' : '#fff',
                              color: active ? '#237804' : '#9a7b1e',
                              transition: 'all .15s',
                            }}>
                            <span style={{ fontSize: 13, lineHeight: 1 }}>{active ? '☑' : '☐'}</span>
                            {label}
                          </button>
                        )
                      })}

                      {/* Xüsusi əlavə edilmiş sütunlar */}
                      {customOnly.map(c => (
                        <span key={c} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '5px 10px 5px 13px', borderRadius: 20,
                          background: '#fff0f6', border: '1.5px solid #ffadd2',
                          color: '#c41d7f', fontSize: 11, fontWeight: 700,
                        }}>
                          ✦ {c}
                          <button onClick={() => setExtraCols(p => p.filter(x => x !== c))}
                            style={{ background: '#ffadd2', border: 'none', cursor: 'pointer', color: '#c41d7f', fontSize: 11, lineHeight: 1, padding: '1px 4px', borderRadius: '50%', marginLeft: 2, fontWeight: 900 }}>✕</button>
                        </span>
                      ))}

                      {/* Prioritet fənləri chip-ləri */}
                      {subjectCols.map((col, idx) => {
                        const clr = SUBJ_COLORS[idx % SUBJ_COLORS.length]
                        return (
                          <span key={col} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '5px 10px 5px 13px', borderRadius: 20,
                            background: `${clr}14`, border: `1.5px solid ${clr}55`,
                            color: clr, fontSize: 11, fontWeight: 700,
                          }}>
                            ★ {col}
                            <button onClick={() => setSubjectCols(p => p.filter(x => x !== col))}
                              style={{ background: `${clr}33`, border: 'none', cursor: 'pointer', color: clr, fontSize: 11, lineHeight: 1, padding: '1px 4px', borderRadius: '50%', marginLeft: 2, fontWeight: 900 }}>✕</button>
                          </span>
                        )
                      })}

                      {/* Prioritet düyməsi */}
                      <button
                        onClick={() => setShowSubjModal(true)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          padding: '5px 13px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                          cursor: 'pointer',
                          border: `1.5px solid ${subjectCols.length > 0 ? '#f5a623' : '#c5d0ff'}`,
                          background: subjectCols.length > 0 ? '#fff8e6' : '#fff',
                          color: subjectCols.length > 0 ? '#d46b08' : '#9a7b1e',
                          transition: 'all .15s',
                        }}>
                        🎯 Prioritet{subjectCols.length > 0 ? ` (${subjectCols.length})` : ''}
                      </button>
                    </div>
                  </div>

                  {/* ── Prioritet fənləri modalı ── */}
                  {showSubjModal && (
                    <div style={{ position: 'fixed', inset: 0, background: '#0007', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
                      onClick={() => setShowSubjModal(false)}>
                      <div style={{ background: '#fff', borderRadius: 18, width: 440, maxWidth: '94vw', boxShadow: '0 24px 80px #0003', overflow: 'hidden' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ background: 'linear-gradient(135deg,#1a1f3c,#2d3561)', padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div>
                            <div style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>🎯 Prioritet Fənləri</div>
                            <div style={{ color: '#8892b0', fontSize: 11, marginTop: 2 }}>Hər fən şablonda ayrı sütun olacaq</div>
                          </div>
                          <button onClick={() => setShowSubjModal(false)}
                            style={{ background: 'transparent', border: 'none', color: '#8892b0', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                        </div>
                        <div style={{ padding: '18px 22px' }}>
                          {/* Input */}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                            <input
                              className="form-input"
                              placeholder="Fən adı (məs: Riyaziyyat, Fizika...)"
                              value={subjInput}
                              autoFocus
                              onChange={e => setSubjInput(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') {
                                  const v = subjInput.trim()
                                  if (v && !subjectCols.includes(v)) { setSubjectCols(p => [...p, v]); setSubjInput('') }
                                }
                              }}
                              style={{ flex: 1, fontSize: 13 }}
                            />
                            <button
                              onClick={() => {
                                const v = subjInput.trim()
                                if (v && !subjectCols.includes(v)) { setSubjectCols(p => [...p, v]); setSubjInput('') }
                              }}
                              disabled={!subjInput.trim() || subjectCols.includes(subjInput.trim())}
                              style={{
                                padding: '9px 18px', borderRadius: 9, border: 'none',
                                background: subjInput.trim() ? 'var(--blue)' : '#eee',
                                color: subjInput.trim() ? '#fff' : '#bbb',
                                fontWeight: 700, fontSize: 13, cursor: subjInput.trim() ? 'pointer' : 'default',
                                transition: 'all .15s', whiteSpace: 'nowrap',
                              }}>
                              + Əlavə et
                            </button>
                          </div>

                          {/* Əlavə edilmiş fənlər */}
                          {subjectCols.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '24px 0', color: '#bbb', fontSize: 13 }}>
                              Hələ fən əlavə edilməyib
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                              {subjectCols.map((col, idx) => {
                                const clr = SUBJ_COLORS[idx % SUBJ_COLORS.length]
                                return (
                                  <span key={col} style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    padding: '7px 12px 7px 14px', borderRadius: 20,
                                    background: `${clr}18`, border: `1.5px solid ${clr}66`,
                                    color: clr, fontSize: 12, fontWeight: 700,
                                  }}>
                                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: clr, flexShrink: 0 }} />
                                    {col}
                                    <button onClick={() => setSubjectCols(p => p.filter(x => x !== col))}
                                      style={{ background: `${clr}33`, border: 'none', cursor: 'pointer', color: clr, fontSize: 12, lineHeight: 1, padding: '2px 5px', borderRadius: '50%', fontWeight: 900, marginLeft: 2 }}>✕</button>
                                  </span>
                                )
                              })}
                            </div>
                          )}

                          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
                            <button onClick={() => setShowSubjModal(false)} className="btn btn-outline">Ləğv et</button>
                            <button
                              onClick={() => setShowSubjModal(false)}
                              className="btn btn-primary"
                              disabled={subjectCols.length === 0}
                              style={{ opacity: subjectCols.length === 0 ? 0.5 : 1 }}>
                              ✓ Təsdiqlə ({subjectCols.length} fən)
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}


                  {/* ── Endir düyməsi ── */}
                  <button onClick={() => {
                    const cols: any = {}
                    allTemplateCols.forEach(c => { cols[c] = '' })
                    const ws = XLSX.utils.json_to_sheet([cols])
                    ws['!cols'] = allTemplateCols.map(() => ({ wch: 20 }))
                    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, instLabel)
                    XLSX.writeFile(wb, `${instLabel}_Şablon.xlsx`)
                  }} style={{
                    padding: '9px 20px', borderRadius: 9, border: 'none',
                    background: 'linear-gradient(135deg, #c9962a, #7b5ea7)',
                    color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    width: '100%', boxShadow: '0 2px 10px #c9962a33',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  }}>
                    <span>⬇</span>
                    <span>Şablonu endir</span>
                    <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 20, padding: '1px 9px', fontSize: 11 }}>
                      {allTemplateCols.length} sütun
                    </span>
                  </button>
                </div>
              )
            })()}
            <label style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '24px', border: '2px dashed #c5d0ff', borderRadius: 12, background: '#f8f9fd', cursor: 'pointer', marginBottom: 12 }}>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFile} />
              <span style={{ fontSize: 32 }}>📂</span>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--blue)' }}>Excel faylını seçin</span>
            </label>
            {loading && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 12 }}>⏳ Fayl oxunur...</div>}
            {errors.length > 0 && (
              <div style={{ background: '#fff1f0', border: '1.5px solid #ffccc7', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#cf1322', marginBottom: 4 }}>⚠ {errors.length} xəta:</div>
                {errors.slice(0, 5).map((e, i) => <div key={i} style={{ fontSize: 11, color: '#cf1322' }}>{e}</div>)}
              </div>
            )}
            {preview.length > 0 && (<>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#237804' }}>
                  ✓ {preview.length} tələbə ·{' '}
                  <span style={{ color: '#b8860b', fontWeight: 700 }}>
                    📅 {selectedYear || '—'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {(['add', 'replace'] as const).map(m => (
                    <button key={m} onClick={() => setMode(m)} style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1.5px solid ' + (mode === m ? 'var(--blue)' : '#dde'), background: mode === m ? 'var(--blue)' : '#fff', color: mode === m ? '#fff' : 'var(--muted)' }}>
                      {m === 'add' ? 'Əlavə et / yenilə' : 'Hamısını əvəz et'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #eef0fa', borderRadius: 8, marginBottom: 14 }}>
                <table style={{ width: '100%', fontSize: 11 }}>
                  <thead><tr style={{ background: '#f4f7ff' }}>
                    <th style={{ padding: '6px 10px', textAlign: 'left' }}>Ad Soyad</th>
                    <th style={{ padding: '6px 10px' }}>FİN</th>
                    <th style={{ padding: '6px 10px' }}>Bal</th>
                  </tr></thead>
                  <tbody>
                    {preview.slice(0, 8).map((u, i) => (
                      <tr key={i} style={{ borderTop: '1px solid #f0f2fa' }}>
                        <td style={{ padding: '5px 10px', fontWeight: 600 }}>{u.name}</td>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace', textAlign: 'center' }}>{u.fin}</td>
                        <td style={{ padding: '5px 10px', textAlign: 'center', color: 'var(--blue)', fontWeight: 700 }}>{Number(u.score).toFixed(2)}</td>
                      </tr>
                    ))}
                    {preview.length > 8 && <tr><td colSpan={3} style={{ padding: '6px 10px', color: 'var(--muted)', textAlign: 'center' }}>... və daha {preview.length - 8} sətir</td></tr>}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
                <button
                  className="btn btn-primary"
                  onClick={handleImport}
                  disabled={useCustom && !customValid}
                  style={{ opacity: (useCustom && !customValid) ? 0.5 : 1 }}
                >
                  ✓ {preview.length} tələbəni idxal et
                </button>
              </div>
            </>)}
          </>) : (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>İdxal uğurla tamamlandı!</div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24 }}>{preview.length} tələbə əlavə edildi</div>
              <button className="btn btn-primary" onClick={onClose}>Bağla</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Kursant redaktə modalı ───────────────────────────────────────────────────
function EditUserModal({ user, instLabel, activeSel, hasSub, onClose, onSaved }: {
  user: any; instLabel: string; activeSel: any; hasSub: boolean; onClose: () => void; onSaved: () => void
}) {
  const [selStatus, setSelStatus] = useState<'submitted' | 'pending'>(hasSub ? 'submitted' : 'pending')
  const _nameParts = (user.name || '').trim().split(/\s+/)
  const [form, setForm] = useState({
    firstName:   _nameParts[0] || '',
    lastName:    _nameParts.slice(1).join(' ') || '',
    name:        user.name        || '',
    parentName:  user.parentName  || '',
    workNumber:  user.workNumber  || '',
    fin:         user.fin         || '',
    score:       String(user.score ?? ''),
    group:       user.group       || '',
    source:      user.source      || '',
    gender:      user.gender      || '',
    year:        user.year        || '',
    printStatus: user.printStatus || 'not_printed',
    placedSpecialty: user.placedSpecialty || '',
  })
  // Fənn balları (kursantın subjects sahəsi)
  const subjectKeys = Object.keys(user.subjects || {})
  const [subjects, setSubjects] = useState<Record<string, string>>(
    Object.fromEntries(subjectKeys.map(k => [k, String(user.subjects[k] ?? '')]))
  )

  // ── Əvvəlcədən bölgü (branch) — aktiv seçimin preAssignLevel-inə görə ──
  const preTree   = activeSel ? treeDb.get(activeSel.treeId) : null
  const preLevel: number | null = (activeSel && activeSel.preAssignLevel != null) ? activeSel.preAssignLevel : null
  const preLevelName = (preLevel != null && preTree?.levelNames?.[preLevel]) ? preTree.levelNames[preLevel] : ''
  const branchOptions = (() => {
    if (preLevel == null || !preTree) return [] as string[]
    const acc = new Set<string>()
    const walk = (nodes: any[], cur: number) => { for (const n of nodes || []) { if (cur === preLevel) acc.add(n.name); else if (n.children?.length) walk(n.children, cur + 1) } }
    walk(preTree.nodes || [], 0)
    return [...acc]
  })()
  const [branch, setBranch] = useState<string>(user.branchByLevel?.[preLevel ?? -1] || '')

  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const setSubj = (k: string, v: string) => setSubjects(p => ({ ...p, [k]: v }))

  function handleSave() {
    const fullName = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ')
    const changed: string[] = []
    if (fullName         !== (user.name        || '')) changed.push(`Ad Soyad: "${user.name}" → "${fullName}"`)
    if (form.parentName  !== (user.parentName  || '')) changed.push(`Ata adı: "${user.parentName}" → "${form.parentName}"`)
    if (form.workNumber  !== (user.workNumber  || '')) changed.push(`İş nömrəsi: "${user.workNumber}" → "${form.workNumber}"`)
    if (form.fin         !== (user.fin         || '')) changed.push(`FİN: "${user.fin}" → "${form.fin}"`)
    if (form.score       !== String(user.score ?? '')) changed.push(`Bal: ${user.score} → ${form.score}`)
    if (form.group       !== (user.group       || '')) changed.push(`Qrup: "${user.group}" → "${form.group}"`)
    if (form.source      !== (user.source      || '')) changed.push(`Mənbə: "${user.source}" → "${form.source}"`)
    if (form.gender      !== (user.gender      || '')) changed.push(`Cins: "${user.gender || '—'}" → "${form.gender || '—'}"`)
    if (form.year        !== (user.year        || '')) changed.push(`İl: "${user.year}" → "${form.year}"`)
    if (form.printStatus !== (user.printStatus || 'not_printed')) changed.push(`Çap statusu: "${user.printStatus}" → "${form.printStatus}"`)
    if (form.placedSpecialty !== (user.placedSpecialty || '')) changed.push(`İxtisas: "${user.placedSpecialty}" → "${form.placedSpecialty}"`)

    // Fənn balları
    const newSubjects: Record<string, number | null> = {}
    for (const k of subjectKeys) {
      const v = subjects[k]
      const num = v === '' ? null : parseFloat(v)
      newSubjects[k] = (num != null && !isNaN(num)) ? num : null
      if (String(user.subjects?.[k] ?? '') !== String(v ?? '')) changed.push(`${k}: ${user.subjects?.[k] ?? '—'} → ${v || '—'}`)
    }

    userDb.update(user.id, {
      name:            fullName,
      parentName:      form.parentName,
      workNumber:      form.workNumber,
      fin:             form.fin,
      score:           parseFloat(form.score) || 0,
      group:           form.group || null,
      source:          form.source || undefined,
      gender:          form.gender || null,
      year:            form.year || null,
      printStatus:     form.printStatus,
      placedSpecialty: form.placedSpecialty || null,
      ...(subjectKeys.length > 0 ? { subjects: newSubjects } : {}),
      ...(preLevel != null ? { branchByLevel: { ...(user.branchByLevel || {}), [preLevel]: branch || undefined } } : {}),
    })

    // ── Seçim statusu dəyişibsə submission yarat/sil ──
    if (selStatus !== (hasSub ? 'submitted' : 'pending')) {
      if (selStatus === 'pending') {
        // Kursantın BÜTÜN seçimlərini sil (tam sıfırla) + yerləşdirməni təmizlə
        const all = submissionDb.getAll() as any[]
        const filtered = all.filter((s: any) => s.userId !== user.id)
        localStorage.setItem('mmu_submissions', JSON.stringify(filtered))
        userDb.update(user.id, {
          status: 'pending',
          placedSpecialty: null, choiceNum: null, placedSpecialtyId: null, placedSelectionId: null,
        })
        changed.push('Seçim statusu: Seçim etdi → Seçim etmədi (sıfırlandı)')
      } else if (activeSel) {
        // Avtomatik seçim yarat (ağacın yarpaqlarından)
        const tree = treeDb.get(activeSel.treeId)
        const leafIds = tree ? Object.keys(buildLeafPaths(tree.nodes || [])) : []
        if (leafIds.length) {
          submissionDb.save({ selectionId: activeSel.id, userId: user.id, userName: fullName, ranking: leafIds })
          userDb.update(user.id, { status: 'submitted' })
          changed.push('Seçim statusu: Seçim etmədi → Seçim etdi (avtomatik sıralama)')
        }
      }
    }

    if (changed.length > 0) {
      addLog('user', 'success',
        `Kursant redaktə edildi: ${fullName}`,
        `Müəssisə: ${instLabel}\n${changed.join('\n')}`
      )
    }

    onSaved()
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">✏️ Kursant Redaktəsi — {user.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px' }}>

            {/* Ad */}
            <div className="form-group">
              <label className="form-label">Ad *</label>
              <input className="form-input" value={form.firstName} onChange={e => set('firstName', e.target.value)} />
            </div>

            {/* Soyad */}
            <div className="form-group">
              <label className="form-label">Soyad *</label>
              <input className="form-input" value={form.lastName} onChange={e => set('lastName', e.target.value)} />
            </div>

            {/* Ata adı */}
            <div className="form-group">
              <label className="form-label">Ata adı</label>
              <input className="form-input" value={form.parentName} onChange={e => set('parentName', e.target.value)} />
            </div>

            {/* İş nömrəsi */}
            <div className="form-group">
              <label className="form-label">İş nömrəsi</label>
              <input className="form-input" value={form.workNumber} onChange={e => set('workNumber', e.target.value)} />
            </div>

            {/* FİN */}
            <div className="form-group">
              <label className="form-label">FİN *</label>
              <input className="form-input" value={form.fin} onChange={e => set('fin', e.target.value.toUpperCase())} maxLength={7} style={{ fontFamily: 'monospace', letterSpacing: 1 }} />
            </div>

            {/* İmtahan balı */}
            <div className="form-group">
              <label className="form-label">İmtahan balı</label>
              <input className="form-input" type="number" step="0.01" min="0" max="100" value={form.score} onChange={e => set('score', e.target.value)} />
            </div>

            {/* Tədris ili — yalnız təyin olunubsa */}
            {user.year && (
              <div className="form-group">
                <label className="form-label">Tədris ili</label>
                <input className="form-input" value={form.year} placeholder="2025–2026" onChange={e => set('year', e.target.value)} />
              </div>
            )}

            {/* Qrup — yalnız təyin olunubsa */}
            {user.group && (
              <div className="form-group">
                <label className="form-label">Qrup</label>
                <input className="form-input" value={form.group} onChange={e => set('group', e.target.value)} />
              </div>
            )}

            {/* Mənbə — yalnız təyin olunubsa */}
            {user.source && (
              <div className="form-group">
                <label className="form-label">Mənbə</label>
                <select className="form-input" value={form.source} onChange={e => set('source', e.target.value)} style={{ cursor: 'pointer' }}>
                  <option value="mülki">Mülki</option>
                  <option value="lisey">Lisey</option>
                </select>
              </div>
            )}

            {/* Cins */}
            <div className="form-group">
              <label className="form-label">Cins</label>
              <select className="form-input" value={form.gender} onChange={e => set('gender', e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="">— Təyin edilməyib —</option>
                <option value="qadın">Qadın</option>
                <option value="kişi">Kişi</option>
              </select>
            </div>

            {/* Əvvəlcədən bölgü (branch) — yalnız seçimdə preAssignLevel təyin olunubsa */}
            {preLevel != null && (
              <div className="form-group">
                <label className="form-label">{preLevelName || 'Əvvəlcədən bölmə'}</label>
                <select className="form-input" value={branch} onChange={e => setBranch(e.target.value)} style={{ cursor: 'pointer' }}>
                  <option value="">— Təyin edilməyib (bütün ixtisaslar) —</option>
                  {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
            )}

            {/* Seçim statusu */}
            <div className="form-group">
              <label className="form-label">Seçim statusu</label>
              <select className="form-input" value={selStatus} onChange={e => setSelStatus(e.target.value as any)} style={{ cursor: 'pointer' }}>
                <option value="pending">Seçim etmədi</option>
                <option value="submitted">Seçim etdi</option>
              </select>
            </div>

            {/* Çap statusu */}
            <div className="form-group">
              <label className="form-label">Çap statusu</label>
              <select className="form-input" value={form.printStatus} onChange={e => set('printStatus', e.target.value)} style={{ cursor: 'pointer' }}>
                <option value="not_printed">Çap edilməyib</option>
                <option value="printed">Çap edilib</option>
              </select>
            </div>

            {/* Fənn balları */}
            {subjectKeys.length > 0 && (
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label" style={{ marginBottom: 8 }}>📚 Fənn balları</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 12px' }}>
                  {subjectKeys.map(k => (
                    <div key={k}>
                      <label style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, display: 'block', marginBottom: 4, textTransform: 'capitalize' }}>{k}</label>
                      <input className="form-input" type="number" step="0.01" min="0" max="100"
                        value={subjects[k]} onChange={e => setSubj(k, e.target.value)}
                        style={{ textAlign: 'center' }} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Yerləşdiyi ixtisas */}
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label className="form-label">Yerləşdiyi ixtisas</label>
              <input className="form-input" value={form.placedSpecialty} placeholder="Yerləşdirilməyib" onChange={e => set('placedSpecialty', e.target.value)} />
            </div>

          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary" disabled={!form.firstName.trim() || !form.fin.trim()} onClick={handleSave}
              style={{ opacity: (!form.firstName.trim() || !form.fin.trim()) ? 0.5 : 1 }}>
              ✓ Yadda saxla
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Yeni müəssisə modalı ─────────────────────────────────────────────────────
const ICONS = ['🎓','🏛️','⚔️','🛡️','🚀','🏫','🏢','🌐','🔰','📋']

function NewInstModal({ onClose, onCreated }: { onClose: () => void; onCreated: (inst: any) => void }) {
  const [label,    setLabel]    = useState('')
  const [icon,     setIcon]     = useState('🏫')
  const [tab,      setTab]      = useState<'emoji' | 'image'>('emoji')
  const [imgPreview, setImgPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const result = ev.target?.result as string
      setImgPreview(result)
      setIcon(result)
    }
    reader.readAsDataURL(file)
  }

  function handleCreate() {
    const l = label.trim()
    if (!l) return
    const inst = institutionDb.create(l, icon)
    addLog('admin', 'success', `Yeni müəssisə yaradıldı: "${l}"`)
    onCreated(inst)
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">🏫 Yeni Müəssisə</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* Ad */}
          <div className="form-group">
            <label className="form-label">Müəssisə adı *</label>
            <input className="form-input" autoFocus placeholder="Məs: Hərbi Akademiya"
              value={label} onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()} />
          </div>

          {/* İkon seçim tabları */}
          <div className="form-group">
            <label className="form-label">Logo / İkon</label>

            {/* Tab toggle */}
            <div style={{ display: 'flex', gap: 4, background: '#f0f2fa', borderRadius: 10, padding: 3, marginBottom: 12 }}>
              {(['emoji','image'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: 12, transition: 'all .15s',
                  background: tab === t ? '#fff' : 'transparent',
                  color:      tab === t ? '#c9962a' : '#9090a8',
                  boxShadow:  tab === t ? '0 1px 6px #0001' : 'none',
                }}>
                  {t === 'emoji' ? '😀 Emoji seç' : '🖼 Şəkil yüklə'}
                </button>
              ))}
            </div>

            {/* Emoji tab */}
            {tab === 'emoji' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ICONS.map(ic => (
                  <button key={ic} onClick={() => { setIcon(ic); setImgPreview(null) }} style={{
                    width: 44, height: 44, borderRadius: 10, fontSize: 22, border: 'none',
                    background: icon === ic && !imgPreview ? '#c9962a' : '#f0f2fa',
                    cursor: 'pointer', transition: 'background .15s',
                  }}>{ic}</button>
                ))}
              </div>
            )}

            {/* Image tab */}
            {tab === 'image' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Preview */}
                <div style={{
                  width: 72, height: 72, borderRadius: 14, flexShrink: 0,
                  background: '#f0f2fa', border: '2px dashed #d0d4f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  overflow: 'hidden',
                }}>
                  {imgPreview
                    ? <img src={imgPreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 28, opacity: .4 }}>🖼</span>
                  }
                </div>

                <div style={{ flex: 1 }}>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                  />
                  <button
                    className="btn btn-outline"
                    onClick={() => fileRef.current?.click()}
                    style={{ width: '100%', marginBottom: 6 }}
                  >
                    📁 Şəkil seç (PNG, JPG, SVG)
                  </button>
                  {imgPreview && (
                    <button
                      className="btn btn-ghost"
                      style={{ width: '100%', color: '#ef4444', fontSize: 11 }}
                      onClick={() => { setImgPreview(null); setIcon('🏫'); if (fileRef.current) fileRef.current.value = '' }}
                    >
                      ✕ Şəkili sil
                    </button>
                  )}
                  <div style={{ fontSize: 10, color: '#bbb', marginTop: 4 }}>
                    Tövsiyə: kvadrat format, maks 2MB
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Önizləmə */}
          {label.trim() && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 12,
              background: '#f8f9fd', border: '1.5px solid #eef0ff',
              borderRadius: 12, padding: '10px 14px', marginBottom: 8,
            }}>
              <div style={{
                width: 40, height: 40, borderRadius: 10, background: '#fff',
                border: '1.5px solid #e0e4f0', display: 'flex', alignItems: 'center',
                justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
              }}>
                {imgPreview
                  ? <img src={imgPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  : <span style={{ fontSize: 22 }}>{icon}</span>
                }
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginBottom: 2 }}>ÖNİZLƏMƏ</div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a2e' }}>{label.trim()}</div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary" disabled={!label.trim()} onClick={handleCreate}>
              + Yarat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Müəssisəni redaktə et modalı ─────────────────────────────────────────────
function EditInstModal({ inst, onClose, onSaved }: { inst: any; onClose: () => void; onSaved: () => void }) {
  const [label,      setLabel]      = useState(inst.label || '')
  const [icon,       setIcon]       = useState(inst.icon  || '🏫')
  const [tab,        setTab]        = useState<'emoji' | 'image'>('emoji')
  const [imgPreview, setImgPreview] = useState<string | null>(isImageIcon(inst.icon) ? inst.icon : null)
  const fileRef = useRef<HTMLInputElement>(null)

  // ── Tədris ili ──
  const initCustom = !!(inst.year && !YEAR_OPTIONS.includes(inst.year))
  const [useCustom,  setUseCustom]  = useState(initCustom)
  const [year,       setYear]       = useState(initCustom ? '' : (inst.year || ''))
  const [customYear, setCustomYear] = useState(initCustom ? inst.year : '')
  const [applyAll,   setApplyAll]   = useState(true)
  const instUserCount = (userDb.getAll() as any[]).filter((u: any) => u.institution === inst.id).length
  const effYear = (useCustom ? customYear.trim() : year).trim()

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { const r = ev.target?.result as string; setImgPreview(r); setIcon(r) }
    reader.readAsDataURL(file)
  }

  function handleSave() {
    const l = label.trim(); if (!l) return
    institutionDb.update(inst.id, { ...inst, label: l, icon, year: effYear || undefined })
    // Tədris ilini kursantlara tətbiq et (istəyə görə)
    if (effYear && applyAll) {
      const list = (userDb.getAll() as any[]).map((u: any) =>
        u.institution === inst.id ? { ...u, year: effYear } : u)
      localStorage.setItem('mmu_users', JSON.stringify(list))
    }
    addLog('admin', 'info', `Müəssisə yeniləndi: "${l}"`,
      effYear ? `Tədris ili: ${effYear}${applyAll ? ` · ${instUserCount} kursanta tətbiq edildi` : ''}` : undefined)
    onSaved(); onClose()
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">✏️ Müəssisəni Redaktə Et</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Müəssisə adı *</label>
            <input className="form-input" autoFocus value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()} />
          </div>

          <div className="form-group">
            <label className="form-label">📅 Tədris ili</label>
            {!useCustom ? (
              <select className="form-input" value={year}
                onChange={e => { if (e.target.value === '__custom__') { setUseCustom(true) } else setYear(e.target.value) }}
                style={{ cursor: 'pointer' }}>
                <option value="">— seçilməyib —</option>
                {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
                <option value="__custom__">✏️ Digər (özüm yazım)...</option>
              </select>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input className="form-input" autoFocus value={customYear} placeholder="məs. 2025–2026"
                  onChange={e => setCustomYear(e.target.value)} style={{ flex: 1 }} />
                <button className="btn btn-outline" type="button"
                  onClick={() => { setUseCustom(false); setCustomYear('') }}>↩</button>
              </div>
            )}
            {effYear && instUserCount > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#5a6080', cursor: 'pointer' }}>
                <input type="checkbox" checked={applyAll} onChange={e => setApplyAll(e.target.checked)} />
                Bu ili müəssisənin bütün kursantlarına tətbiq et ({instUserCount} kursant)
              </label>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Logo / İkon</label>
            <div style={{ display: 'flex', gap: 4, background: '#f0f2fa', borderRadius: 10, padding: 3, marginBottom: 12 }}>
              {(['emoji','image'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
                  fontWeight: 700, fontSize: 12, transition: 'all .15s',
                  background: tab === t ? '#fff' : 'transparent',
                  color:      tab === t ? '#c9962a' : '#9090a8',
                  boxShadow:  tab === t ? '0 1px 6px #0001' : 'none',
                }}>
                  {t === 'emoji' ? '😀 Emoji seç' : '🖼 Şəkil yüklə'}
                </button>
              ))}
            </div>

            {tab === 'emoji' && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ICONS.map(ic => (
                  <button key={ic} onClick={() => { setIcon(ic); setImgPreview(null) }} style={{
                    width: 44, height: 44, borderRadius: 10, fontSize: 22, border: 'none',
                    background: icon === ic && !imgPreview ? '#c9962a' : '#f0f2fa',
                    cursor: 'pointer', transition: 'background .15s',
                  }}>{ic}</button>
                ))}
              </div>
            )}

            {tab === 'image' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <div style={{
                  width: 72, height: 72, borderRadius: 14, flexShrink: 0,
                  background: '#f0f2fa', border: '2px dashed #d0d4f0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                }}>
                  {imgPreview
                    ? <img src={imgPreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    : <span style={{ fontSize: 28, opacity: .4 }}>🖼</span>
                  }
                </div>
                <div style={{ flex: 1 }}>
                  <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFileChange} />
                  <button className="btn btn-outline" style={{ width: '100%', marginBottom: 8 }}
                    onClick={() => fileRef.current?.click()}>
                    📁 Şəkil seç
                  </button>
                  {imgPreview && (
                    <button className="btn btn-ghost" style={{ width: '100%', color: '#ef4444', fontSize: 11 }}
                      onClick={() => { setImgPreview(null); setIcon('🏫'); if (fileRef.current) fileRef.current.value = '' }}>
                      ✕ Şəkili sil
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Önizləmə */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: '#f8f9fd', border: '1.5px solid #eef0ff',
            borderRadius: 12, padding: '10px 14px', marginBottom: 8,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: '#fff',
              border: '1.5px solid #e0e4f0', display: 'flex', alignItems: 'center',
              justifyContent: 'center', overflow: 'hidden', flexShrink: 0,
            }}>
              {imgPreview
                ? <img src={imgPreview} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                : <span style={{ fontSize: 22 }}>{icon}</span>
              }
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#aaa', fontWeight: 600, marginBottom: 2 }}>ÖNİZLƏMƏ</div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a2e' }}>{label.trim() || '—'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary" disabled={!label.trim()} onClick={handleSave}>
              ✓ Yadda saxla
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Qrup rəngləri ─────────────────────────────────────────────────────────────
const GRP_COLORS: Record<string, { bg: string; color: string }> = {
  '1': { bg: '#e8f4ff', color: '#1677ff' },
  '2': { bg: '#f0fff4', color: '#237804' },
  '3': { bg: '#fff7e6', color: '#d46b08' },
  '4': { bg: '#fff0f6', color: '#c41d7f' },
  '5': { bg: '#f9f0ff', color: '#531dab' },
}

// ── Cədvəl ────────────────────────────────────────────────────────────────────
function UserTable({ instId, instLabel, instIcon, onDelete, onReset }: { instId: string; instLabel: string; instIcon?: string; onDelete: () => void; onReset: () => void }) {
  const [archiveDone, setArchiveDone] = useState(false)
  const { dialog, showConfirm, closeDialog } = useDialog()

  function handleArchiveUsers(instUsers: any[]) {
    if (!instUsers.length) return
    showConfirm({
      icon: '🗄️', iconBg: '#f0f2fa', iconColor: '#9a7b1e',
      title: 'Kursantları arxivlə',
      message: `${instLabel} üçün ${instUsers.length} kursantın siyahısı arxivlənəcək. Arxiv bölməsindən baxıla bilər.`,
      confirmLabel: 'Arxivlə', confirmColor: '#9a7b1e',
      onConfirm: () => {
        userArchiveDb.save({ label: instLabel, institution: instId, snapshot: instUsers })
        userDb.deleteMany(instUsers.map((u: any) => u.id))
        refreshUsers()
        setArchiveDone(true)
        setTimeout(() => setArchiveDone(false), 3000)
        addLog('user', 'warning', `Kursantlar arxivləndi: ${instUsers.length} nəfər`, `Müəssisə: ${instLabel}`)
      },
    })
  }
  const [users, refreshUsers] = useLocalState(userDb.getAll)
  const tableWrapRef  = useRef<HTMLDivElement>(null)

  const [search,     setSearch]     = useState('')
  const [filter,      setFilter]      = useState('all')
  const [printFilter, setPrintFilter] = useState('all')
  const [grpFilter,   setGrpFilter]   = useState('all')
  const [yearFilter,  setYearFilter]  = useState('all')
  const [sortKey,     setSortKey]     = useState<string | null>(null)   // 'score' və ya fənn adı
  const [sortDir,     setSortDir]     = useState<'asc' | 'desc'>('desc')
  function toggleSort(key: string) {
    if (sortKey !== key)      { setSortKey(key); setSortDir('desc') }   // 1-ci klik: çoxdan aza
    else if (sortDir === 'desc') setSortDir('asc')                      // 2-ci klik: azdan çoxa
    else                       setSortKey(null)                          // 3-cü klik: söndür
  }
  const sortIcon  = (key: string) => sortKey !== key ? '⇅' : sortDir === 'asc' ? '▲' : '▼'
  // default → göy · çoxdan aza (▼) → yaşıl · azdan çoxa (▲) → qırmızı
  const sortColor = (key: string) => sortKey !== key ? '#c9962a' : sortDir === 'desc' ? '#23a55a' : '#ff4d4f'
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [excludedCols, setExcludedCols] = useState<Set<string>>(new Set())   // export-da çıxarılan sütunlar
  const [editUser,   setEditUser]   = useState<any>(null)
  const [printUser,  setPrintUser]  = useState<any>(null)
  const [nameMap,    setNameMap]    = useState<Record<string, string>>({})

  const allSubs = submissionDb.getAll() as any[]

  const subCountMap: Record<string, number> = {}
  for (const s of allSubs) subCountMap[s.userId] = (subCountMap[s.userId] || 0) + 1

  const instUsers = (users as any[]).filter((u: any) => u.institution === instId)
  const hasGroups = instUsers.some((u: any) => u.group)
  const hasYears  = instUsers.some((u: any) => u.year)
  const allYears  = [...new Set(instUsers.map((u: any) => u.year).filter(Boolean))].sort() as string[]
  const allGroups = [...new Set(instUsers.map((u: any) => String(u.group || '')).filter(Boolean))].sort((a, b) => {
    if (a === '*') return 1
    if (b === '*') return -1
    return isNaN(Number(a)) || isNaN(Number(b)) ? a.localeCompare(b) : Number(a) - Number(b)
  })
  const hasSources = instUsers.some((u: any) => u.source)
  const hasGender  = instUsers.some((u: any) => u.gender)
  // ── Əvvəlcədən bölgü (branch) sütunları — datada olan səviyyələr ──
  const instTreeU    = (treeDb.getAll() as any[]).find((t: any) => t.institution === instId)
  const branchLevels = [...new Set(instUsers.flatMap((u: any) => Object.keys(u.branchByLevel || {}).map(Number)))].sort((a, b) => a - b)
  const branchLevelName = (i: number) => instTreeU?.levelNames?.[i] || `Səviyyə ${i + 1}`
  // Yerləşdirmə tamamlanıbsa branch sütunu lazım deyil — "Yerləşdiyi ixtisas" bəs edir
  const placementDone = instUsers.length > 0 && instUsers.every((u: any) => u.placedSpecialty)
  const showBranch    = branchLevels.length > 0 && !placementDone
  const allSubjectKeys: string[] = (() => {
    const keys = new Set<string>()
    instUsers.forEach((u: any) => { if (u.subjects) Object.keys(u.subjects).forEach(k => keys.add(k)) })
    return Array.from(keys)
  })()

  // ── Export üçün seçilə bilən sütunlar ──
  const exportCols: string[] = [
    'Ad', 'Soyad', 'Ata adı', 'İş nömrəsi', 'FİN', 'Təhsil müəssisəsi', 'Tədris ili',
    ...(hasGroups ? ['Qrup'] : []), ...(hasSources ? ['Mənbə'] : []), ...(hasGender ? ['Cins'] : []),
    'Ümumi imtahan nəticəsi', ...allSubjectKeys, 'Seçim statusu', 'Çap statusu',
    'Yerləşdiyi ixtisas', 'Kursantın seçimləri (prioritetlə)',
  ]
  const includedCols = new Set(exportCols.filter(c => !excludedCols.has(c)))
  const toggleCol = (c: string) => setExcludedCols(prev => {
    const n = new Set(prev); n.has(c) ? n.delete(c) : n.add(c); return n
  })

  const filtered = instUsers.filter((u: any) => {
    const q           = search.toLowerCase()
    const matchSearch = u.name.toLowerCase().includes(q) || (u.fin || '').toLowerCase().includes(q) || (u.workNumber || '').includes(q)
    const hasSub      = subCountMap[u.id] > 0
    const matchStatus = filter === 'all' || (filter === 'submitted' && hasSub) || (filter === 'pending' && !hasSub)
    const matchPrint  = printFilter === 'all' || (printFilter === 'printed' && u.printStatus === 'printed') || (printFilter === 'not_printed' && u.printStatus !== 'printed')
    const matchGroup  = grpFilter === 'all' || String(u.group) === grpFilter
    const matchYear   = yearFilter === 'all' || u.year === yearFilter
    return matchSearch && matchStatus && matchPrint && matchGroup && matchYear
  })

  // ── Sıralama (fənn / ümumi bal üzrə) ──
  const sorted = sortKey
    ? [...filtered].sort((a: any, b: any) => {
        const va = sortKey === 'score' ? Number(a.score || 0) : Number(a.subjects?.[sortKey] ?? -Infinity)
        const vb = sortKey === 'score' ? Number(b.score || 0) : Number(b.subjects?.[sortKey] ?? -Infinity)
        return sortDir === 'asc' ? va - vb : vb - va
      })
    : filtered

  const totalSub  = instUsers.filter((u: any) => subCountMap[u.id] > 0).length
  const totalPend = instUsers.length - totalSub

  const activeSel = (selectionDb.getAll() as any[]).find(
    (s: any) => s.institution === instId && s.status === 'published'
  )

  function handlePrint(u: any) {
    const tree = activeSel ? treeDb.get(activeSel.treeId) : null
    setNameMap(tree ? buildNameMap(tree) : {})
    setPrintUser(u)
  }

  function confirmPrint() {
    if (!printUser) return
    // Kursantın hər hansı submissionunu tap (active olmasa belə)
    const allSubs2 = submissionDb.getAll() as any[]
    const sub = allSubs2.find((s: any) => s.userId === printUser.id) || null
    const ranking: string[] = sub?.ranking || []
    // Submissionun aid olduğu seçimi tap (active deyilsə belə)
    const allSels = selectionDb.getAll() as any[]
    const selForPrint = sub
      ? (allSels.find((s: any) => s.id === sub.selectionId) || activeSel)
      : activeSel
    // Həmin seçimin tree-sini yüklə
    const tree = selForPrint ? treeDb.get(selForPrint.treeId) : null
    const nm   = tree ? buildNameMap(tree) : nameMap
    userDb.update(printUser.id, { printStatus: 'printed' })
    refreshUsers()
    addLog('user', printUser.printStatus === 'printed' ? 'warning' : 'success',
      `${printUser.printStatus === 'printed' ? 'Yenidən çap' : 'Çap'}: ${printUser.name}`,
      `FİN: ${printUser.fin || '—'} · Bal: ${Number(printUser.score || 0).toFixed(2)} · Seçim: ${selForPrint?.name || '—'} · Admin tərəfindən çap edildi`)
    setPrintUser(null)
    const html = generatePrintHTML(printUser, selForPrint, nm, instLabel, ranking, tree)
    const win  = window.open('', '_blank', 'width=1000,height=720')
    if (win) { win.document.write(html); win.document.close() }
  }

  return (
    <>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}

      {/* ── Çap modalı ── */}
      {printUser && (
        <div className="modal-overlay open" onClick={() => setPrintUser(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">🖨️ Çap et</span>
              <button className="modal-close" onClick={() => setPrintUser(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', borderRadius: 12, background: '#f4f7ff', border: '1.5px solid #f3e3b8', marginBottom: 16 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(135deg,#c9962a,#b8860b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>👤</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{printUser.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>FİN: {printUser.fin || '—'} · Bal: {Number(printUser.score || 0).toFixed(2)}</div>
                </div>
              </div>
              {!activeSel && (
                <div style={{ background: '#fff7e6', border: '1.5px solid #ffd591', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#d46b08', marginBottom: 16 }}>
                  ⚠️ Bu müəssisə üçün aktiv seçim yoxdur. Seçim siyahısı boş çap ediləcək.
                </div>
              )}
              {!subCountMap[printUser.id] && (
                <div style={{ background: '#fff7e6', border: '1.5px solid #ffd591', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#d46b08', marginBottom: 16 }}>
                  ⚠️ Bu kursant hələ seçim göndərməyib.
                </div>
              )}
              {printUser.printStatus === 'printed' && (
                <div style={{ background: '#f6ffed', border: '1.5px solid #b7eb8f', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#237804', marginBottom: 16 }}>
                  ✅ Bu kursant əvvəllər çap edilib. Yenidən çap edəcəksiniz?
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setPrintUser(null)}>Ləğv et</button>
                <button onClick={confirmPrint} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#c9962a,#b8860b)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  🖨️ Çap et
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportModal instId={instId} instLabel={instLabel}
          onClose={() => setShowImport(false)}
          onImported={() => { refreshUsers(); setShowImport(false) }} />
      )}
      {editUser && (
        <EditUserModal user={editUser} instLabel={instLabel}
          activeSel={activeSel}
          hasSub={subCountMap[editUser.id] > 0}
          onClose={() => setEditUser(null)}
          onSaved={() => { refreshUsers(); setEditUser(null) }} />
      )}
      {/* ── Excel Export modalı (versiya seçimi) ── */}
      {showExport && (
        <div className="modal-overlay open" onClick={() => setShowExport(false)}>
          <div className="modal" style={{ maxWidth: 820, width: '94vw' }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">📥 Excel Export — versiya seçin</span>
              <button className="modal-close" onClick={() => setShowExport(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                {sorted.length} kursant ixrac olunacaq.
              </div>

              {/* Sütun seçimi */}
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, background: '#f8f9fd', border: '1.5px solid #eef0fa' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#9a7b1e', textTransform: 'uppercase', letterSpacing: .5 }}>📋 Çap olunacaq sütunlar</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setExcludedCols(new Set())} style={{ fontSize: 11, fontWeight: 700, color: '#c9962a', background: 'none', border: 'none', cursor: 'pointer' }}>Hamısı</button>
                    <button onClick={() => setExcludedCols(new Set(exportCols))} style={{ fontSize: 11, fontWeight: 700, color: '#999', background: 'none', border: 'none', cursor: 'pointer' }}>Heç biri</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: 8 }}>
                  {exportCols.map(c => {
                    const checked = !excludedCols.has(c)
                    return (
                      <label key={c} onClick={() => toggleCol(c)} style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 9, cursor: 'pointer',
                        fontSize: 12, fontWeight: 600, userSelect: 'none', overflow: 'hidden',
                        background: checked ? '#fbf1d6' : '#fff',
                        border: `1.5px solid ${checked ? '#bcceff' : '#e6e8f2'}`,
                        color: checked ? '#3a4cad' : '#9aa0b4',
                        transition: 'all .12s',
                      }}>
                        <span style={{ fontSize: 14, color: checked ? '#c9962a' : '#c2c7d6', flexShrink: 0, lineHeight: 1 }}>{checked ? '☑' : '☐'}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, fontWeight: 700 }}>Format seçin:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                {/* Versiya 1 */}
                <button
                  onClick={() => { exportToExcel(sorted, instLabel, instId, subCountMap, includedCols); addLog('user', 'info', `Excel ixrac (Versiya 1): ${sorted.length} kursant`, `Müəssisə: ${instLabel}`); setShowExport(false) }}
                  style={{ textAlign: 'left', padding: '16px 18px', borderRadius: 14, border: '1.5px solid #b7eb8f', background: '#f6ffed', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: '#1d6f42', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>1</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a2e' }}>Versiya 1 — Tam siyahı</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                      Bütün sütunlar (ad, FİN, fənlər, status) + kursantın bütün seçimləri
                    </div>
                  </div>
                </button>
                {/* Versiya 2 — səviyyələrə bölünmüş */}
                <button
                  onClick={() => { exportToExcelV2(sorted, instLabel, instId, subCountMap, includedCols); addLog('user', 'info', `Excel ixrac (Versiya 2): ${sorted.length} kursant`, `Müəssisə: ${instLabel}`); setShowExport(false) }}
                  style={{ textAlign: 'left', padding: '16px 18px', borderRadius: 14, border: '1.5px solid #ecd9a0', background: '#fbf1d6', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: '#c9962a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>2</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a2e' }}>Versiya 2 — Səviyyələrə bölünmüş</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                      Versiya 1-in eynisi, amma "Yerləşdiyi ixtisas" və "Seçimlər" sütunları səviyyə adları ilə (Qoşun növü / Orta ixtisas / Hərbi uçot) alt-alta verilir
                    </div>
                  </div>
                </button>
                {/* Versiya 3 — yerləşmə səviyyəli + seçimlər düz xətt */}
                <button
                  onClick={() => { exportToExcelV3(sorted, instLabel, instId, subCountMap, includedCols); addLog('user', 'info', `Excel ixrac (Versiya 3): ${sorted.length} kursant`, `Müəssisə: ${instLabel}`); setShowExport(false) }}
                  style={{ textAlign: 'left', padding: '16px 18px', borderRadius: 14, border: '1.5px solid #ddd0ff', background: '#f6f2ff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14 }}
                >
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: '#b8860b', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>3</div>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: '#1a1a2e' }}>Versiya 3 — Qarışıq</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2 }}>
                      "Yerləşdiyi ixtisas" səviyyə sütunlarına bölünür (V2 kimi), "Seçimlər" isə tək sütunda düz xətt (V1 kimi)
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div className="card-head" style={{ flexShrink: 0 }}>
          <div>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {instIcon && <InstIcon icon={instIcon} size={18} />}
              {instLabel} — Tələbə Siyahısı
            </div>
            <div className="card-sub">
              {instUsers.length} qeydiyyatlı ·
              <span style={{ color: '#237804', fontWeight: 700 }}> {totalSub} göndərdi</span> ·
              <span style={{ color: 'var(--muted)' }}> {totalPend} gözləyir</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {/* ── Arxivlə düyməsi ── */}
            {can('users.delete') && (
            <button
              onClick={() => handleArchiveUsers(instUsers)}
              disabled={instUsers.length === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '9px 16px', borderRadius: 10, cursor: instUsers.length ? 'pointer' : 'not-allowed',
                border: archiveDone ? '1.5px solid #52c41a' : '1.5px solid #b0bae8',
                background: archiveDone ? '#f0fff4' : '#f4f6ff',
                color: archiveDone ? '#237804' : '#9a7b1e',
                fontWeight: 700, fontSize: 13,
                opacity: instUsers.length === 0 ? 0.4 : 1,
                transition: 'all .2s',
              }}
            >
              <span style={{ fontSize: 15 }}>{archiveDone ? '✅' : '🗄️'}</span>
              {archiveDone ? 'Arxivləndi!' : 'Arxivlə'}
            </button>
            )}
            {can('users.import') && (
            <button onClick={() => setShowImport(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: '1.5px solid var(--blue)', background: '#fff', color: 'var(--blue)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <span style={{ fontSize: 15 }}>📤</span> Excel İdxal
            </button>
            )}
            {can('users.export') && (
            <button onClick={() => setShowExport(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#1d6f42', color: '#fff', fontWeight: 700, fontSize: 13, boxShadow: '0 2px 8px #1d6f4233' }}>
              <span style={{ fontSize: 15 }}>📥</span> Excel Export
              <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>({sorted.length})</span>
            </button>
            )}
            {can('users.delete') && (
            <button onClick={onReset} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 10, border: '1.5px solid #ffd591', background: '#fffbe6', color: '#d46b08', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              title="Kursant siyahısını sıfırla">
              🔄 Sıfırla
            </button>
            )}
            {can('inst.delete') && (
            <button onClick={onDelete} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 10, border: '1.5px solid #ffccc7', background: '#fff5f5', color: '#cf1322', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              title="Müəssisəni sil">
              🗑 Sil
            </button>
            )}
          </div>
        </div>

        <div className="search-row" style={{ flexShrink: 0 }}>
          <input className="search-input" placeholder="🔍  Ad, FİN və ya iş nömrəsi..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="filter-select" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">Seçim statusu</option>
            <option value="submitted">Seçim etdi</option>
            <option value="pending">Seçim etmədi</option>
          </select>
          <select className="filter-select" value={printFilter} onChange={e => setPrintFilter(e.target.value)}>
            <option value="all">Çap statusu</option>
            <option value="printed">Çap edilib</option>
            <option value="not_printed">Çap edilməyib</option>
          </select>
          {hasGroups && (
            <select className="filter-select" value={grpFilter} onChange={e => setGrpFilter(e.target.value)}>
              <option value="all">Bütün qruplar</option>
              {allGroups.map(g => (
                <option key={g} value={g}>Qrup {g}</option>
              ))}
            </select>
          )}
          {hasYears && (
            <select className="filter-select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
              <option value="all">Bütün illər</option>
              {allYears.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
        </div>

        <div className="card-body" style={{ padding: 0, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div ref={tableWrapRef} className="adaptive-table-wrap" style={{ flex: 1, minHeight: 0, maxHeight: 'none' }}>
          <table className="adaptive-table">
            <thead>
              <tr>
                <th className="sticky-col sticky-col-1" style={{ textAlign: 'center' }}>#</th>
                <th className="sticky-col sticky-col-2"></th>
                <th className="sticky-col sticky-col-3">İstifadəçi</th>
                <th>İş Nömrəsi</th>
                <th>FİN</th>
                <th style={{ textAlign: 'center' }}>Tədris İli</th>
                {hasGroups  && <th style={{ textAlign: 'center' }}>Qrup</th>}
                {hasSources && <th>Mənbə</th>}
                {hasGender  && <th style={{ textAlign: 'center' }}>Cins</th>}
                {showBranch && branchLevels.map(i => <th key={'bl'+i} style={{ textAlign: 'center' }}>{branchLevelName(i)}</th>)}
                <th style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort('score')} title="Sırala">
                  Ümumi İmtahan Nəticəsi <span style={{ color: sortColor('score'), fontSize: 16, fontWeight: 900, verticalAlign: 'middle' }}>{sortIcon('score')}</span>
                </th>
                {allSubjectKeys.map(k => (
                  <th key={k} style={{ textAlign: 'center', cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(k)} title="Sırala">
                    {k} <span style={{ color: sortColor(k), fontSize: 16, fontWeight: 900, verticalAlign: 'middle' }}>{sortIcon(k)}</span>
                  </th>
                ))}
                <th>Seçim Statusu</th>
                <th>Çap Statusu</th>
                <th>Yerləşdiyi İxtisas</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u: any, i: number) => {
                const hasSub    = subCountMap[u.id] > 0
                const isPrinted = u.printStatus === 'printed'
                const grp       = String(u.group || '')
                const grpStyle  = GRP_COLORS[grp] || { bg: '#f4f4f4', color: '#999' }
                return (
                  <tr key={u.id}>
                    <td className="sticky-col sticky-col-1" style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</td>
                    <td className="sticky-col sticky-col-2" style={{ textAlign: 'center' }}>
                      {can('users.edit') && (
                      <button onClick={() => setEditUser(u)} title="Redaktə et"
                        style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px solid #c5d0ff', background: '#f4f7ff', color: '#c9962a', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}
                        onMouseEnter={e => { (e.currentTarget.style.background = '#e8f0ff'); (e.currentTarget.style.borderColor = 'var(--blue)') }}
                        onMouseLeave={e => { (e.currentTarget.style.background = '#f4f7ff'); (e.currentTarget.style.borderColor = '#c5d0ff') }}
                      >✏️</button>
                      )}
                    </td>
                    <td className="sticky-col sticky-col-3">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: '#eef1ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>👤</div>
                          {hasSub && can('users.print') && (
                            <button
                              onClick={() => handlePrint(u)}
                              title="Seçim vərəqini çap et"
                              style={{
                                position: 'absolute', bottom: -5, right: -5,
                                width: 20, height: 20, borderRadius: 6,
                                border: 'none',
                                background: isPrinted
                                  ? 'linear-gradient(135deg,#52c41a,#237804)'
                                  : 'linear-gradient(135deg,#c9962a,#b8860b)',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: 0,
                                boxShadow: isPrinted ? '0 2px 6px #52c41a66' : '0 2px 6px #c9962a66',
                              }}
                            >
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 6 2 18 2 18 9"/>
                                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                                <rect x="6" y="14" width="12" height="8"/>
                              </svg>
                            </button>
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.parentName || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>{u.workNumber || '—'}</td>
                    <td style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{u.fin || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      {u.year
                        ? <span className="cell-badge" style={{ background: 'linear-gradient(145deg,#f0f3ff,#e4eaff)', color: '#9a7b1e', border: '1px solid #d0d8f8' }}>{u.year}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>
                      }
                    </td>
                    {hasGroups && (
                      <td style={{ textAlign: 'center' }}>
                        {u.group
                          ? <span className="cell-badge" style={{ background: grpStyle.bg, color: grpStyle.color, fontWeight: 800 }}>{u.group}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                    )}
                    {hasSources && (
                      <td>
                        {u.source === 'mülki'
                          ? <span className="cell-badge" style={{ background: '#e8f4ff', color: '#1677ff', border: '1px solid #bae0ff' }}>Mülki</span>
                          : u.source === 'lisey'
                          ? <span className="cell-badge" style={{ background: '#f9f0ff', color: '#531dab', border: '1px solid #d3adf7' }}>Lisey</span>
                          : u.source
                          ? <span className="cell-badge" style={{ background: '#f6ffed', color: '#237804', border: '1px solid #b7eb8f' }}>{u.source}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                    )}
                    {hasGender && (
                      <td style={{ textAlign: 'center' }}>
                        {u.gender === 'qadın'
                          ? <span className="cell-badge" style={{ background: '#fff0f6', color: '#c41d7f', border: '1px solid #ffadd2' }}>Qadın</span>
                          : u.gender === 'kişi'
                          ? <span className="cell-badge" style={{ background: '#e6f4ff', color: '#0958d9', border: '1px solid #91caff' }}>Kişi</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                    )}
                    {showBranch && branchLevels.map(i => (
                      <td key={'bl'+i} style={{ textAlign: 'center' }}>
                        {u.branchByLevel?.[i]
                          ? <span className="cell-badge" style={{ background: '#f0f5ff', color: '#2f54eb', border: '1px solid #adc6ff' }}>{u.branchByLevel[i]}</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>
                        }
                      </td>
                    ))}
                    <td style={{ textAlign: 'center' }}>
                      <span className="cell-score" style={{ background: '#e8f4ff', color: 'var(--blue)' }}>
                        {Number(u.score).toFixed(2)}
                      </span>
                    </td>
                    {allSubjectKeys.map(k => {
                      const val = u.subjects?.[k]
                      return (
                        <td key={k} style={{ textAlign: 'center' }}>
                          {val != null
                            ? <span className="cell-score" style={{ background: '#fff7e6', color: '#d46b08', border: '1px solid #ffd591' }}>{Number(val).toFixed(2)}</span>
                            : <span style={{ color: 'var(--muted)' }}>—</span>
                          }
                        </td>
                      )
                    })}
                    <td>
                      {hasSub
                        ? <span className="cell-badge" style={{ background: '#f6ffed', color: '#237804', border: '1px solid #b7eb8f' }}>✓ Edildi</span>
                        : <span style={{ color: '#d46b08', fontSize: 10 }}>⚠ Gözləyir</span>
                      }
                    </td>
                    <td>
                      {isPrinted
                        ? <span className="cell-badge" style={{ background: '#f6ffed', color: '#237804', border: '1px solid #b7eb8f' }}>✓ Edilib</span>
                        : <span style={{ color: '#d46b08', fontSize: 10 }}>⚠ Edilməyib</span>
                      }
                    </td>
                    <td style={{ color: u.placedSpecialty ? 'var(--text)' : 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.placedSpecialty || 'Yerləşdirilməyib'}
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={11 + (hasGroups ? 1 : 0) + (hasSources ? 1 : 0) + (hasGender ? 1 : 0) + (showBranch ? branchLevels.length : 0) + allSubjectKeys.length} style={{ textAlign: 'center', color: 'var(--muted)', padding: '40px', fontSize: 13 }}>Nəticə tapılmadı</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Ana komponent ─────────────────────────────────────────────────────────────
export default function Users() {
  const [params, setParams] = useSearchParams()
  const [institutions, refreshInstitutions] = useLocalState(institutionDb.getAll)
  const insts = institutions as any[]

  const instParam  = params.get('inst')
  const [tab, setTab] = useState<string>(instParam || (insts[0]?.id ?? ''))
  const [showNewInst,  setShowNewInst]  = useState(false)
  const [editInst,     setEditInst]     = useState<any>(null)
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [delPassword,  setDelPassword]  = useState('')
  const [delError,     setDelError]     = useState('')
  const [resetTarget,  setResetTarget]  = useState<any>(null)

  // Aktif tab mövcud deyilsə birinciyə keç
  const activeInst = insts.find((i: any) => i.id === tab) || insts[0]

  function switchTab(id: string) { setTab(id); setParams({ inst: id }) }

  function handleResetInst(inst: any) {
    const users = JSON.parse(localStorage.getItem('mmu_users') || '[]') as any[]
    const count = users.filter((u: any) => u.institution === inst.id).length
    localStorage.setItem('mmu_users', JSON.stringify(users.filter((u: any) => u.institution !== inst.id)))
    addLog('admin', 'warning', `Müəssisə sıfırlandı: "${inst.label}"`, `${count} kursant silindi`)
    setResetTarget(null)
    // UserTable-i yeniləmək üçün tab-ı yenidən yükləyirik
    const cur = tab
    setTab('')
    setTimeout(() => setTab(cur), 0)
  }

  function handleDeleteInst(inst: any) {
    // Superadmin şifrəsini yoxla
    const superadmin = (adminDb.getAll() as any[]).find((a: any) => a.role === 'superadmin')
    if (!superadmin || delPassword !== superadmin.password) {
      setDelError('Superadmin şifrəsi yanlışdır')
      addLog('admin', 'warning', `Müəssisə silmə cəhdi (yanlış şifrə): "${inst.label}"`)
      return
    }
    // Müəssisəni sil
    const usersInInst = (JSON.parse(localStorage.getItem('mmu_users') || '[]') as any[]).filter((u: any) => u.institution === inst.id)
    institutionDb.delete(inst.id)
    // Müəssisənin kursantlarını da sil
    const users = JSON.parse(localStorage.getItem('mmu_users') || '[]')
    localStorage.setItem('mmu_users', JSON.stringify(users.filter((u: any) => u.institution !== inst.id)))
    addLog('admin', 'error', `Müəssisə silindi: "${inst.label}"`, `${usersInInst.length} kursant da silindi · Superadmin şifrəsi ilə təsdiqləndi`)
    refreshInstitutions()
    setDeleteTarget(null); setDelPassword(''); setDelError('')
    // Başqa taba keç
    const remaining = institutionDb.getAll()
    if (remaining.length > 0) switchTab(remaining[0].id)
    else setTab('')
  }

  return (
    <>
      {/* ── Yeni müəssisə modalı ── */}
      {showNewInst && (
        <NewInstModal
          onClose={() => setShowNewInst(false)}
          onCreated={(inst) => { refreshInstitutions(); switchTab(inst.id) }}
        />
      )}

      {/* ── Silmə təsdiqi (superadmin şifrəsi tələb olunur) ── */}
      {deleteTarget && (
        <div className="modal-overlay open" onClick={() => { setDeleteTarget(null); setDelPassword(''); setDelError('') }}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span style={{ fontSize: 20 }}>🗑️</span>
              <button className="modal-close" onClick={() => { setDeleteTarget(null); setDelPassword(''); setDelError('') }}>✕</button>
            </div>
            <div className="modal-body" style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                Müəssisəni silmək istəyirsiniz?
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.5 }}>
                <b style={{ display:'inline-flex', alignItems:'center', gap:5, verticalAlign:'middle' }}><InstIcon icon={deleteTarget.icon} size={15} /> {deleteTarget.label}</b> müəssisəsi və ona aid <b>bütün kursantlar</b> silinəcək. Bu əməliyyat geri alına bilməz.
              </div>

              {/* Superadmin şifrəsi */}
              <div style={{ marginBottom: 18 }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#cf1322', display: 'block', marginBottom: 6 }}>
                  🔐 Təsdiq üçün superadmin şifrəsini daxil edin
                </label>
                <input
                  className="form-input"
                  type="password"
                  autoFocus
                  placeholder="Superadmin şifrəsi"
                  value={delPassword}
                  onChange={e => { setDelPassword(e.target.value); setDelError('') }}
                  onKeyDown={e => e.key === 'Enter' && handleDeleteInst(deleteTarget)}
                  style={{ borderColor: delError ? '#ff4d4f' : undefined }}
                />
                {delError && <div style={{ fontSize: 12, color: '#cf1322', marginTop: 6, fontWeight: 600 }}>⚠ {delError}</div>}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => { setDeleteTarget(null); setDelPassword(''); setDelError('') }}>Ləğv et</button>
                <button className="btn btn-danger" style={{ padding: '8px 22px', opacity: delPassword ? 1 : 0.5 }} disabled={!delPassword} onClick={() => handleDeleteInst(deleteTarget)}>Sil</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Sıfırlama təsdiqi ── */}
      {resetTarget && (
        <div className="modal-overlay open" onClick={() => setResetTarget(null)}>
          <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
              <span style={{ fontSize: 20 }}>🔄</span>
              <button className="modal-close" onClick={() => setResetTarget(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ paddingTop: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
                Kursant siyahısını sıfırlamaq istəyirsiniz?
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>
                <b style={{ display:'inline-flex', alignItems:'center', gap:5, verticalAlign:'middle' }}><InstIcon icon={resetTarget.icon} size={15} /> {resetTarget.label}</b> müəssisəsinə aid <b>bütün kursantlar</b> silinəcək. Müəssisənin özü saxlanılacaq. Bu əməliyyat geri alına bilməz.
              </div>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-outline" onClick={() => setResetTarget(null)}>Ləğv et</button>
                <button
                  className="btn"
                  style={{ padding: '8px 22px', background: '#ff8c00', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}
                  onClick={() => handleResetInst(resetTarget)}
                >Sıfırla</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Müəssisəni redaktə et ── */}
      {editInst && (
        <EditInstModal
          inst={editInst}
          onClose={() => setEditInst(null)}
          onSaved={() => { refreshInstitutions(); setEditInst(null) }}
        />
      )}

      {/* ── Səhifə flex konteyneri: yalnız cədvəl daxilən scroll olur ── */}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── Tab sətiri ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
        {insts.map((inst: any) => {
          const isActive = tab === inst.id
          return (
            <div key={inst.id} style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                onClick={() => switchTab(inst.id)}
                style={{
                  padding: '10px 40px 10px 22px', borderRadius: 10,
                  border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14,
                  transition: 'all .15s',
                  background: isActive ? 'var(--blue)' : '#f0f2fa',
                  color:      isActive ? '#fff'        : 'var(--muted)',
                  boxShadow:  isActive ? '0 2px 10px #c9962a33' : 'none',
                }}
              >
                <InstIcon icon={inst.icon} size={16} style={{ marginRight: 6 }} />{inst.label}
              </button>
              {/* Redaktə düyməsi */}
              {can('inst.edit') && (
              <button
                onClick={e => { e.stopPropagation(); setEditInst(inst) }}
                title="Redaktə et"
                style={{
                  position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                  width: 24, height: 24, borderRadius: 6, border: 'none',
                  background: isActive ? 'rgba(255,255,255,0.25)' : '#e4e8f5',
                  color: isActive ? '#fff' : '#7a88cc',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, flexShrink: 0,
                }}
              >✏️</button>
              )}
            </div>
          )
        })}

        {/* Yeni müəssisə */}
        {can('inst.create') && (
        <button
          onClick={() => setShowNewInst(true)}
          style={{
            padding: '10px 18px', borderRadius: 10, border: '1.5px dashed #c5d0ff',
            background: '#f8f9ff', color: 'var(--blue)', fontWeight: 700, fontSize: 13,
            cursor: 'pointer', transition: 'all .15s',
          }}
          onMouseEnter={e => { (e.currentTarget.style.background = '#eef1ff'); (e.currentTarget.style.borderColor = 'var(--blue)') }}
          onMouseLeave={e => { (e.currentTarget.style.background = '#f8f9ff'); (e.currentTarget.style.borderColor = '#c5d0ff') }}
        >
          + Yeni Müəssisə
        </button>
        )}
      </div>

      {/* ── Cədvəl ── */}
      {activeInst
        ? <UserTable key={activeInst.id} instId={activeInst.id} instLabel={activeInst.label} instIcon={activeInst.icon} onDelete={() => setDeleteTarget(activeInst)} onReset={() => setResetTarget(activeInst)} />
        : (
          <div className="card">
            <div style={{ padding: '48px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🏛️</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Hələ müəssisə yoxdur</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Yeni müəssisə yaradın</div>
              <button className="btn btn-primary" onClick={() => setShowNewInst(true)}>+ Yeni Müəssisə</button>
            </div>
          </div>
        )
      }
      </div>
    </>
  )
}
