import { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { selectionDb, treeDb, userDb, submissionDb, buildNameMap, institutionDb, addLog, usePoll } from '../../db'
import InstIcon from '../../components/InstIcon'

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

function getLeavesWithPath(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes || []) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeavesWithPath(n.children, [...anc, n]))
  }
  return res
}

const choiceBadge = (c: number) => {
  if (!c) return null
  const col = c === 1 ? { bg: '#f6ffed', tx: '#237804', bd: '#b7eb8f' }
    : c <= 3 ? { bg: '#e6f4ff', tx: '#0958d9', bd: '#91caff' }
    : { bg: '#fff7e6', tx: '#d46b08', bd: '#ffd591' }
  return <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: col.bg, color: col.tx, border: `1px solid ${col.bd}`, whiteSpace: 'nowrap' }}>{c}-ci seçim</span>
}

export default function Results() {
  const [allSelections, setAllSelections] = useState<any[]>([])
  const [allUsers,      setAllUsers]      = useState<any[]>([])
  const [institutions,  setInstitutions]  = useState<any[]>([])
  const [loaded,        setLoaded]        = useState(false)

  const loadBase = useCallback(() => {
    Promise.all([selectionDb.getAll(), userDb.getAll(), institutionDb.getAll()]).then(([sels, users, insts]) => {
      setAllSelections(sels.filter((s: any) => s.status !== 'draft'))
      setAllUsers(users)
      setInstitutions(insts)
      setLoaded(true)
    })
  }, [])
  useEffect(() => { loadBase() }, [loadBase])
  usePoll(loadBase)   // real-time: yerləşdirmə/status dəyişiklikləri avtomatik görünür

  const instMap: Record<string, any> = {}
  for (const inst of institutions) instMap[inst.id] = inst

  const [selId, setSelId]   = useState<string>('')
  useEffect(() => {
    if (!selId && allSelections.length > 0) setSelId(allSelections[0].id)
  }, [allSelections])
  const [search, setSearch] = useState('')
  const [instFlt, setInstFlt] = useState('all')
  const [statusFlt, setStatusFlt] = useState<'all' | 'placed' | 'unplaced'>('all')
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'spec'>('score')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const sel  = allSelections.find((s: any) => s.id === selId)

  const [tree, setTree] = useState<any>(null)
  const [subs, setSubs] = useState<any[]>([])
  const loadSel = useCallback(() => {
    if (!sel) { setTree(null); setSubs([]); return }
    Promise.all([treeDb.get(sel.treeId), submissionDb.getBySelection(sel.id)]).then(([t, s]) => {
      setTree(t); setSubs(s)
    })
  }, [sel?.id, sel?.treeId])
  useEffect(() => { loadSel() }, [loadSel])
  usePoll(loadSel)   // real-time: yeni seçim göndərişləri avtomatik görünür

  const nameMap = tree ? buildNameMap(tree) : {}
  // Hər leaf üçün tam yol (Qoşun növü → ... → İxtisas) və təhsilalan üzrə seçim sıralaması
  const leafPaths = useMemo(() => {
    const m: Record<string, string> = {}
    if (tree) for (const { leaf, path } of getLeavesWithPath(tree.nodes || [])) m[leaf.id] = path.map((n: any) => n.name).join(' → ')
    return m
  }, [tree])
  const subsByUser = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const s of subs) m[s.userId] = s.ranking || []
    return m
  }, [subs])

  const submittedUsers = useMemo(() => allUsers.filter(u => subs.find((s: any) => s.userId === u.id)), [allUsers, subs])
  const showGroup = submittedUsers.some((u: any) => u.group)
  const isPlaced = (u: any) => !!(u.placedSpecialtyId || u.placedSpecialty)
  const specName = (u: any) => (u.placedSpecialty ? (nameMap[u.placedSpecialty] || u.placedSpecialty) : '')

  // ── Statistika ──
  const stats = useMemo(() => {
    const total = submittedUsers.length
    const placed = submittedUsers.filter(isPlaced)
    const top1 = placed.filter(u => u.choiceNum === 1).length
    const avg = total ? submittedUsers.reduce((s, u) => s + (u.score || 0), 0) / total : 0
    return { total, placed: placed.length, unplaced: total - placed.length, rate: pct(placed.length, total), sat: pct(top1, placed.length), avg }
  }, [submittedUsers])

  const rows = useMemo(() => {
    const q = search.toLowerCase()
    const arr = submittedUsers.filter(u => {
      if (q && !(u.name.toLowerCase().includes(q) || (u.fin || '').toLowerCase().includes(q))) return false
      if (instFlt !== 'all' && u.institution !== instFlt) return false
      if (statusFlt === 'placed' && !isPlaced(u)) return false
      if (statusFlt === 'unplaced' && isPlaced(u)) return false
      return true
    })
    arr.sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '')
      if (sortBy === 'spec') return specName(a).localeCompare(specName(b))
      return (b.score || 0) - (a.score || 0)
    })
    return arr
  }, [submittedUsers, search, instFlt, statusFlt, sortBy, nameMap])

  function exportExcel() {
    const data = rows.map((u, i) => ({
      '№': i + 1, 'Təhsilalan': u.name, 'FİN': u.fin || '—', 'İş nömrəsi': u.workNumber || '—',
      'Müəssisə': (u.institution && instMap[u.institution]?.label) || '—', 'Bal': Number(u.score).toFixed(2),
      ...(showGroup ? { 'Qrup': u.group || '—' } : {}),
      'Seçim sırası': u.choiceNum ? `${u.choiceNum}-ci` : '—',
      'Yerləşdiyi ixtisas': isPlaced(u) ? specName(u) : 'Yerləşdirilməyib',
      'Status': isPlaced(u) ? 'Yerləşdi' : 'Yerləşmədi',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, ...(showGroup ? [{ wch: 6 }] : []), { wch: 11 }, { wch: 32 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Nəticələr')
    XLSX.writeFile(wb, `Neticeler_${new Date().toLocaleDateString('az-AZ').replace(/\./g, '-')}.xlsx`)
    addLog('distribution', 'info', `Nəticələr Excel-ə ixrac edildi`, `${data.length} təhsilalan · ${sel?.name || ''}`)
  }

  if (!loaded) return null

  // ── AKT üçün məlumat yığımı ─────────────────────────────────────────────
  const buildActData = () => {
    const instId = sel?.institution
    const actUsers = submittedUsers.filter(u => !instId || u.institution === instId)
    const placedArr = actUsers.filter(isPlaced)
    const total = actUsers.length
    const placed = placedArr.length
    const unplaced = total - placed
    const top1 = placedArr.filter(u => u.choiceNum === 1).length
    const scoresAll = actUsers.map(u => u.score || 0).filter(s => s > 0)
    const avg = scoresAll.length ? scoresAll.reduce((a, b) => a + b, 0) / scoresAll.length : 0
    const minS = scoresAll.length ? Math.min(...scoresAll) : 0
    const maxS = scoresAll.length ? Math.max(...scoresAll) : 0

    // İxtisas üzrə (tam yol + kvota + yerləşənlər)
    const lwp = tree ? getLeavesWithPath(tree.nodes || []) : []
    const perSpec = lwp.map(({ leaf, path }) => {
      const us = placedArr.filter(u => (u.placedSpecialtyId || u.placedSpecialty) === leaf.id || u.placedSpecialty === leaf.id)
        .sort((a, b) => (b.score || 0) - (a.score || 0))
      return {
        id: leaf.id,
        name: leaf.name,
        path: path.slice(0, -1).map((n: any) => n.name).join(' → '),
        quota: leaf.quota || 0,
        students: us,
      }
    }).filter(s => s.quota > 0 || s.students.length > 0)
    const totalQuota = perSpec.reduce((s, x) => s + x.quota, 0)

    // Qrup bölgüsü
    const groupMap: Record<string, any[]> = {}
    for (const u of actUsers) { const g = (u.group ?? '').toString().trim(); if (g) (groupMap[g] ||= []).push(u) }
    const groupStats = Object.keys(groupMap).sort((a, b) => a.localeCompare(b, 'az', { numeric: true })).map(g => {
      const us = groupMap[g]; const sc = us.map(u => u.score || 0).filter(s => s > 0)
      return { name: g, count: us.length, placed: us.filter(isPlaced).length, avg: sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : 0 }
    })

    // Mənbə bölgüsü
    const mulki = actUsers.filter(u => u.source === 'mülki')
    const lisey = actUsers.filter(u => u.source === 'lisey')
    const sourceStats = [
      { name: 'Mülki', count: mulki.length, placed: mulki.filter(isPlaced).length },
      { name: 'Lisey', count: lisey.length, placed: lisey.filter(isPlaced).length },
    ].filter(s => s.count > 0)

    return {
      instLabel: (instId && instMap[instId]?.label) || '—',
      selName: sel?.name || '',
      total, placed, unplaced, top1,
      rate: pct(placed, total), sat: pct(top1, placed),
      avg, minS, maxS, totalQuota, quotaFill: pct(placed, totalQuota),
      perSpec, groupStats, sourceStats,
    }
  }

  const nowStr = () => new Date().toLocaleDateString('az-AZ', { day: '2-digit', month: 'long', year: 'numeric' })

  function generateActHTML() {
    const d = buildActData()
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
    const f2 = (n: number) => Number(n).toFixed(2)

    const specSections = d.perSpec.map((s, si) => `
      <div class="spec">
        <div class="spec-head">
          <span class="spec-no">${si + 1}</span>
          <div>
            <div class="spec-name">${esc(s.name)}</div>
            ${s.path ? `<div class="spec-path">${esc(s.path)}</div>` : ''}
          </div>
          <div class="spec-fill">${s.students.length} / ${s.quota}</div>
        </div>
        ${s.students.length === 0 ? `<div class="empty">Yerləşdirilən təhsilalan yoxdur</div>` : `
        <table class="tbl">
          <thead><tr><th>№</th><th>Soyad, ad, ata adı</th><th>FİN</th><th>İş №</th><th class="c">Bal</th><th class="c">Seçim</th></tr></thead>
          <tbody>
            ${s.students.map((u: any, i: number) => `<tr>
              <td class="c">${i + 1}</td>
              <td>${esc(u.name)}${u.parentName ? ' ' + esc(u.parentName) : ''}</td>
              <td>${esc(u.fin || '—')}</td>
              <td>${esc(u.workNumber || '—')}</td>
              <td class="c b">${f2(u.score || 0)}</td>
              <td class="c">${u.choiceNum ? u.choiceNum + '-ci' : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>`).join('')

    const groupTable = d.groupStats.length ? `
      <h2>Qrup üzrə bölgü</h2>
      <table class="tbl stat">
        <thead><tr><th>Qrup</th><th class="c">Təhsilalan</th><th class="c">Yerləşdi</th><th class="c">Orta bal</th></tr></thead>
        <tbody>${d.groupStats.map(g => `<tr><td class="b">${esc(g.name)}</td><td class="c">${g.count}</td><td class="c">${g.placed}</td><td class="c">${f2(g.avg)}</td></tr>`).join('')}</tbody>
      </table>` : ''

    const sourceTable = d.sourceStats.length ? `
      <h2>Mənbə üzrə bölgü</h2>
      <table class="tbl stat">
        <thead><tr><th>Mənbə</th><th class="c">Təhsilalan</th><th class="c">Yerləşdi</th></tr></thead>
        <tbody>${d.sourceStats.map(s => `<tr><td class="b">${esc(s.name)}</td><td class="c">${s.count}</td><td class="c">${s.placed}</td></tr>`).join('')}</tbody>
      </table>` : ''

    const html = `<!DOCTYPE html><html lang="az"><head><meta charset="utf-8">
    <title>Yerləşdirmə aktı — ${esc(d.instLabel)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', Georgia, serif; color: #1a1a1a; margin: 0; padding: 32px 40px; font-size: 12px; line-height: 1.45; }
      .doc-head { text-align: center; border-bottom: 2.5px solid #1a1a1a; padding-bottom: 14px; margin-bottom: 20px; }
      .doc-head .org { font-size: 13px; letter-spacing: .5px; text-transform: uppercase; }
      .doc-head .title { font-size: 20px; font-weight: bold; margin: 10px 0 4px; letter-spacing: 1px; }
      .doc-head .meta { font-size: 12px; color: #333; margin-top: 6px; }
      h2 { font-size: 13.5px; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1.5px solid #888; padding-bottom: 5px; margin: 24px 0 12px; }
      .sum { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 6px; }
      .sum .box { border: 1px solid #bbb; border-radius: 6px; padding: 9px 11px; }
      .sum .v { font-size: 19px; font-weight: bold; }
      .sum .l { font-size: 10.5px; color: #555; margin-top: 2px; }
      table.tbl { width: 100%; border-collapse: collapse; margin-bottom: 4px; }
      table.tbl th, table.tbl td { border: 1px solid #999; padding: 4px 7px; text-align: left; font-size: 11px; }
      table.tbl th { background: #ececec; font-weight: bold; }
      table.tbl td.c, table.tbl th.c { text-align: center; }
      table.tbl td.b { font-weight: bold; }
      table.stat { width: auto; min-width: 55%; }
      .spec { margin-bottom: 16px; page-break-inside: avoid; }
      .spec-head { display: flex; align-items: center; gap: 10px; background: #f4f4f4; border: 1px solid #999; border-bottom: none; padding: 7px 10px; }
      .spec-no { background: #1a1a1a; color: #fff; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; flex-shrink: 0; }
      .spec-name { font-weight: bold; font-size: 13px; }
      .spec-path { font-size: 10.5px; color: #666; }
      .spec-fill { margin-left: auto; font-weight: bold; font-size: 13px; white-space: nowrap; }
      .empty { border: 1px solid #999; border-top: none; padding: 8px 10px; color: #888; font-style: italic; }
      .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 34px 60px; margin-top: 46px; page-break-inside: avoid; }
      .sign .row { border-top: 1px solid #1a1a1a; padding-top: 5px; font-size: 11.5px; }
      .sign .role { font-weight: bold; }
      .sign .hint { color: #777; font-size: 10px; }
      .foot { margin-top: 30px; font-size: 10.5px; color: #777; text-align: center; border-top: 1px solid #ccc; padding-top: 8px; }
      @media print { body { padding: 14mm 16mm; } .noprint { display: none; } }
      .noprint { text-align: center; margin-bottom: 18px; }
      .noprint button { font-family: sans-serif; font-size: 13px; padding: 9px 22px; border-radius: 8px; border: none; background: #1d6f42; color: #fff; font-weight: 700; cursor: pointer; }
    </style></head><body>
      <div class="noprint"><button onclick="window.print()">🖨️ Çap et / PDF yadda saxla</button></div>
      <div class="doc-head">
        <div class="org">İxtisas Seçim Proqramı</div>
        <div class="title">YERLƏŞDİRMƏ AKTI</div>
        <div class="meta">${esc(d.instLabel)} &nbsp;·&nbsp; ${esc(d.selName)} &nbsp;·&nbsp; ${nowStr()}</div>
      </div>

      <p style="margin:0 0 14px">Aşağıda göstərilən nəticələr üzrə <b>${esc(d.instLabel)}</b> müəssisəsində ixtisas seçimi və yerləşdirmə prosesi yekunlaşdırılmış, təhsilalanların topladıqları ballara və seçim üstünlüklərinə əsasən aşağıdakı bölgü aparılmışdır.</p>

      <h2>Ümumi xülasə</h2>
      <div class="sum">
        <div class="box"><div class="v">${d.total}</div><div class="l">Ümumi təhsilalan</div></div>
        <div class="box"><div class="v">${d.placed}</div><div class="l">Yerləşdirildi (${d.rate}%)</div></div>
        <div class="box"><div class="v">${d.unplaced}</div><div class="l">Yerləşdirilmədi</div></div>
        <div class="box"><div class="v">${d.sat}%</div><div class="l">1-ci seçimə düşdü</div></div>
        <div class="box"><div class="v">${d.totalQuota}</div><div class="l">Ümumi kvota (${d.quotaFill}% dolu)</div></div>
        <div class="box"><div class="v">${f2(d.avg)}</div><div class="l">Orta bal</div></div>
        <div class="box"><div class="v">${f2(d.minS)}</div><div class="l">Ən aşağı bal</div></div>
        <div class="box"><div class="v">${f2(d.maxS)}</div><div class="l">Ən yüksək bal</div></div>
      </div>

      ${groupTable}
      ${sourceTable}

      <h2>İxtisas üzrə yerləşdirmə siyahısı</h2>
      ${specSections || '<div class="empty">Yerləşdirmə aparılmayıb.</div>'}

      <h2>Komissiya</h2>
      <div class="sign">
        <div class="row"><span class="role">Komissiya sədri</span><br><span class="hint">(ad, soyad, imza)</span></div>
        <div class="row"><span class="role">Komissiya üzvü</span><br><span class="hint">(ad, soyad, imza)</span></div>
        <div class="row"><span class="role">Komissiya üzvü</span><br><span class="hint">(ad, soyad, imza)</span></div>
        <div class="row"><span class="role">Komissiya üzvü</span><br><span class="hint">(ad, soyad, imza)</span></div>
      </div>

      <div class="foot">Bu akt İxtisas Seçim Proqramı tərəfindən ${nowStr()} tarixində avtomatik formalaşdırılmışdır.</div>
    </body></html>`

    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
    addLog('distribution', 'info', 'Yerləşdirmə aktı hazırlandı', `${d.instLabel} · ${d.selName} · ${d.placed}/${d.total} yerləşdi`)
  }

  function exportActExcel() {
    const d = buildActData()
    const f2 = (n: number) => Number(n).toFixed(2)
    const wb = XLSX.utils.book_new()

    // Vərəq 1: Xülasə
    const sumRows = [
      ['YERLƏŞDİRMƏ AKTI'], [],
      ['Müəssisə', d.instLabel], ['Seçim', d.selName], ['Tarix', nowStr()], [],
      ['Ümumi təhsilalan', d.total],
      ['Yerləşdirildi', `${d.placed} (${d.rate}%)`],
      ['Yerləşdirilmədi', d.unplaced],
      ['1-ci seçimə düşdü', `${d.sat}%`],
      ['Ümumi kvota', `${d.totalQuota} (${d.quotaFill}% dolu)`],
      ['Orta bal', f2(d.avg)], ['Ən aşağı bal', f2(d.minS)], ['Ən yüksək bal', f2(d.maxS)],
    ]
    if (d.groupStats.length) {
      sumRows.push([], ['QRUP ÜZRƏ BÖLGÜ'], ['Qrup', 'Təhsilalan', 'Yerləşdi', 'Orta bal'])
      d.groupStats.forEach(g => sumRows.push([g.name, g.count, g.placed, f2(g.avg)]))
    }
    if (d.sourceStats.length) {
      sumRows.push([], ['MƏNBƏ ÜZRƏ BÖLGÜ'], ['Mənbə', 'Təhsilalan', 'Yerləşdi'])
      d.sourceStats.forEach(s => sumRows.push([s.name, s.count, s.placed]))
    }
    const ws1 = XLSX.utils.aoa_to_sheet(sumRows)
    ws1['!cols'] = [{ wch: 24 }, { wch: 16 }, { wch: 12 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Xülasə')

    // Vərəq 2: İxtisas üzrə tam siyahı
    const listRows: any[] = []
    d.perSpec.forEach((s, si) => {
      listRows.push({ '№': `${si + 1}. ${s.name}${s.path ? ' (' + s.path + ')' : ''}`, 'Soyad, ad, ata adı': `Kvota: ${s.quota} · Yerləşdi: ${s.students.length}`, 'FİN': '', 'İş №': '', 'Bal': '', 'Seçim': '' })
      s.students.forEach((u: any, i: number) => listRows.push({
        '№': i + 1, 'Soyad, ad, ata adı': `${u.name}${u.parentName ? ' ' + u.parentName : ''}`,
        'FİN': u.fin || '—', 'İş №': u.workNumber || '—', 'Bal': f2(u.score || 0), 'Seçim': u.choiceNum ? `${u.choiceNum}-ci` : '—',
      }))
    })
    const ws2 = XLSX.utils.json_to_sheet(listRows, { header: ['№', 'Soyad, ad, ata adı', 'FİN', 'İş №', 'Bal', 'Seçim'] })
    ws2['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 9 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'İxtisas üzrə siyahı')

    XLSX.writeFile(wb, `Yerlesdirme_Akti_${d.instLabel}_${new Date().toLocaleDateString('az-AZ').replace(/\./g, '-')}.xlsx`)
    addLog('distribution', 'info', 'Yerləşdirmə aktı (Excel) ixrac edildi', `${d.instLabel} · ${d.placed}/${d.total} yerləşdi`)
  }

  if (allSelections.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">📋</div>
        <div className="empty-title">Nəticə yoxdur</div>
        <div className="empty-sub">Seçim yayımlandıqdan sonra burada görünəcək</div>
      </div>
    )
  }

  const KPIS = [
    { label: 'Ümumi təhsilalan', val: stats.total, icon: '👥', color: '#c9962a' },
    { label: 'Yerləşdi', val: stats.placed, sub: `${stats.rate}%`, icon: '✅', color: '#52c41a' },
    { label: 'Yerləşməyib', val: stats.unplaced, icon: '⏳', color: '#fa8c16' },
    { label: '1-ci seçim', val: stats.placed ? `${stats.sat}%` : '—', icon: '🏆', color: '#722ed1' },
    { label: 'Orta bal', val: stats.avg.toFixed(2), icon: '📊', color: '#13c2c2' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Seçim keçiricisi */}
      {allSelections.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {allSelections.map((s: any) => (
            <button key={s.id} onClick={() => setSelId(s.id)}
              style={{ padding: '8px 18px', borderRadius: 9, border: `1.5px solid ${selId === s.id ? 'var(--blue)' : 'var(--border)'}`, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                background: selId === s.id ? 'var(--blue)' : '#fff', color: selId === s.id ? '#fff' : 'var(--text)' }}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* KPI */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {KPIS.map(s => (
          <div key={s.label} style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 13, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 11, background: s.color + '14', color: s.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{s.label}{s.sub ? ` · ${s.sub}` : ''}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Yerləşmə faizi bar */}
      <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 13, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 8, fontWeight: 600 }}>
          <span style={{ color: 'var(--text)' }}>Yerləşmə dərəcəsi</span>
          <span style={{ color: 'var(--muted)' }}>{stats.placed} / {stats.total} yerləşdi · {stats.rate}%</span>
        </div>
        <div style={{ background: '#f0f2f8', borderRadius: 8, height: 14, overflow: 'hidden', display: 'flex' }}>
          <div style={{ width: `${stats.rate}%`, background: 'linear-gradient(90deg,#52c41a,#237804)', transition: 'width .5s' }} />
          <div style={{ width: `${100 - stats.rate}%`, background: '#ffe7ba' }} />
        </div>
      </div>

      {/* Cədvəl */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-head" style={{ padding: '14px 18px', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="card-title">Yerləşdirmə nəticələri</div>
            <div className="card-sub">{sel?.name} · {rows.length} nəticə</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={generateActHTML}
              style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#1a1a1a', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              📄 <span className="res-export-label">Akt (çap / PDF)</span>
            </button>
            <button onClick={exportActExcel}
              style={{ padding: '8px 16px', borderRadius: 9, border: '1.5px solid #1d6f42', background: '#fff', color: '#1d6f42', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              📊 <span className="res-export-label">Akt (Excel)</span>
            </button>
            <button onClick={exportExcel}
              style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#1d6f42', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
              📥 <span className="res-export-label">Excelə ixrac</span>
            </button>
          </div>
        </div>

        {/* Filtrlər */}
        <div style={{ display: 'flex', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="search-input" placeholder="🔍  Ad və ya FİN..." value={search} onChange={e => setSearch(e.target.value)} style={{ minWidth: 160, flex: 1 }} />
          <select className="filter-select" value={instFlt} onChange={e => setInstFlt(e.target.value)}>
            <option value="all">Bütün müəssisələr</option>
            {institutions.map((inst: any) => <option key={inst.id} value={inst.id}>{inst.label}</option>)}
          </select>
          <select className="filter-select" value={statusFlt} onChange={e => setStatusFlt(e.target.value as any)}>
            <option value="all">Bütün statuslar</option>
            <option value="placed">✅ Yerləşdi</option>
            <option value="unplaced">⏳ Yerləşməyib</option>
          </select>
          <select className="filter-select" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
            <option value="score">Bala görə</option>
            <option value="name">Ada görə</option>
            <option value="spec">İxtisasa görə</option>
          </select>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ width: 40 }}>№</th>
                <th>TƏHSİLALAN</th>
                <th>FİN</th>
                <th style={{ width: 80 }}>BAL</th>
                <th>MÜƏSSİSƏ</th>
                {showGroup && <th style={{ width: 60 }}>QRUP</th>}
                <th>YERLƏŞDİYİ İXTİSAS</th>
                <th style={{ width: 110 }}>STATUS</th>
                <th style={{ width: 90, textAlign: 'center' }}>SEÇİMLƏRİ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={showGroup ? 9 : 8} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontSize: 13 }}>Nəticə tapılmadı</td></tr>
              )}
              {rows.map((u, i) => {
                const inst = u.institution ? instMap[u.institution] : null
                const placed = isPlaced(u)
                const ranking = subsByUser[u.id] || []
                const isOpen = expanded.has(u.id)
                return (
                  <Fragment key={u.id}>
                  <tr style={{ background: isOpen ? '#fafbff' : undefined }}>
                    <td style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.parentName || '—'} · {u.workNumber || '—'}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 }}>{u.fin || '—'}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ background: '#e8f4ff', color: 'var(--blue)', borderRadius: 20, padding: '3px 12px', fontWeight: 800, fontSize: 13 }}>{Number(u.score).toFixed(2)}</span>
                    </td>
                    <td>
                      {inst
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 8, background: '#edfdf4', color: '#1d6f42', fontWeight: 700, fontSize: 12 }}><InstIcon icon={inst.icon} size={13} /> {inst.label}</span>
                        : <span style={{ fontSize: 12, color: '#ccc' }}>—</span>}
                    </td>
                    {showGroup && <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 13 }}>{u.group || '—'}</td>}
                    <td style={{ fontSize: 12.5, color: placed ? 'var(--text)' : '#bbb', fontWeight: placed ? 600 : 400 }}>
                      {placed
                        ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>{specName(u)} {choiceBadge(u.choiceNum)}</span>
                        : 'Yerləşdirilməyib'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {placed
                        ? <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#f6ffed', color: '#237804', border: '1px solid #b7eb8f' }}>✅ Yerləşdi</span>
                        : <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#fff7e6', color: '#d46b08', border: '1px solid #ffd591' }}>⏳ Gözləyir</span>}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {ranking.length > 0 ? (
                        <button onClick={() => toggleExpand(u.id)}
                          style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${isOpen ? '#c9962a' : '#c5d0ff'}`, background: isOpen ? '#c9962a' : '#fbf1d6', color: isOpen ? '#fff' : '#c9962a', whiteSpace: 'nowrap' }}>
                          {ranking.length} seçim {isOpen ? '▲' : '▼'}
                        </button>
                      ) : <span style={{ color: '#ccc' }}>—</span>}
                    </td>
                  </tr>
                  {isOpen && ranking.length > 0 && (
                    <tr key={u.id + '_d'}>
                      <td colSpan={showGroup ? 9 : 8} style={{ background: '#f7f9ff', padding: '12px 18px' }}>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>📋 {u.name} — prioritet sırası ilə seçimləri:</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 6 }}>
                          {ranking.map((rid, idx) => {
                            const isPlacedHere = (u.placedSpecialtyId || '') === rid
                            return (
                              <div key={rid + idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, padding: '4px 8px', borderRadius: 7, background: isPlacedHere ? '#f6ffed' : '#fff', border: `1px solid ${isPlacedHere ? '#b7eb8f' : '#eef0f7'}` }}>
                                <span style={{ fontWeight: 800, color: idx === 0 ? '#237804' : 'var(--muted)', minWidth: 20 }}>{idx + 1}.</span>
                                <span style={{ color: 'var(--text)', flex: 1 }}>{leafPaths[rid] || nameMap[rid] || rid}{isPlacedHere && <b style={{ color: '#237804' }}> ✅</b>}</span>
                              </div>
                            )
                          })}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
