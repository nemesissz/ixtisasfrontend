import { useState, useMemo, useEffect, useCallback, Fragment } from 'react'
import { readActiveInst, writeActiveInst } from '../../activeInst'
import * as XLSX from 'xlsx'
import { selectionDb, treeDb, userDb, submissionDb, buildNameMap, institutionDb, addLog, usePoll } from '../../db'
import InstIcon from '../../components/InstIcon'
import { AppDialog, useDialog } from '../../components/AppDialog'
import { can } from '../../permissions'
import { today } from '../../utils-date'
import { ord } from '../../ordinal'
import { P } from '../../palette'

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
  return <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: col.bg, color: col.tx, border: `1px solid ${col.bd}`, whiteSpace: 'nowrap' }}>{ord(c)} seçim</span>
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
    if (!selId && allSelections.length > 0) {
      // Son seçilmiş müəssisənin ilk seçimi — yoxdursa ümumi birinci
      const last = readActiveInst()
      const first = allSelections.find((s: any) => (s.institutionId || s.institution) === last) || allSelections[0]
      setSelId(first.id)
    }
  }, [allSelections])
  const [search, setSearch] = useState('')
  const [aktMenu, setAktMenu] = useState(false)
  const [instFlt, setInstFlt] = useState('all')
  const [statusFlt, setStatusFlt] = useState<'all' | 'placed' | 'unplaced'>('all')
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'spec'>('score')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const sel  = allSelections.find((s: any) => s.id === selId)
  // Müəssisə → seçim iki pilləli keçid
  const selInsts: string[] = []
  for (const s of allSelections) { const k = s.institutionId || s.institution || ''; if (!selInsts.includes(k)) selInsts.push(k) }
  const curInst = (sel?.institutionId || sel?.institution || '') as string
  const instSelections = allSelections.filter((s: any) => (s.institutionId || s.institution || '') === curInst)

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

  const { dialog, showConfirm, showInfo, closeDialog } = useDialog()
  const [resetDone, setResetDone] = useState(false)

  // Bu seçimə aid yerləşdirmə nəticələrini təmizləyir.
  // Yalnız 4 yerləşdirmə sahəsi sıfırlanır — təhsilalanın seçim sıralaması (submission),
  // balı və statusu toxunulmur, yəni yenidən yerləşdirmə dərhal aparıla bilər.
  // Ekranda "Yerləşdi" kimi görünən dəstənin eyniə — bu seçimdə sıralama göndərmiş və
  // yerləşdirilmiş təhsilalanlar. (Seçim silinib yenidən yaradılıbsa PlacedSelectionId
  //  boş qala bilər, ona görə təkcə o sahəyə güvənilmir.)
  const placedHere = submittedUsers.filter(isPlaced)

  function handleResetResults() {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Nəticələri sıfırla',
      message: `"${sel?.name}" seçimi üzrə ${placedHere.length} təhsilalanın yerləşdirmə nəticəsi silinəcək. `
        + `Təhsilalanların seçim sıralamasına və ballarına toxunulmayacaq — yerləşdirməni yenidən apara bilərsiniz. `
        + `Bu əməliyyat geri alına bilməz.`,
      confirmLabel: 'Sıfırla', confirmColor: '#ff4d4f',
      onConfirm: async () => {
        const n = placedHere.length
        await userDb.bulkUpdate(placedHere.map((u: any) => ({
          id: u.id, placedSpecialty: null, choiceNum: null,
          placedSpecialtyId: null, placedSelectionId: null,
        })), 'reset')
        // Paket bölgüsü qeydi də silinir — statistika köhnə bölgünü göstərməsin
        try {
          const store = JSON.parse(localStorage.getItem('dist_packet_alloc') || '{}')
          delete store[selId]
          localStorage.setItem('dist_packet_alloc', JSON.stringify(store))
        } catch { /* localStorage əlçatmazdırsa sıfırlamaya mane olma */ }
        addLog('distribution', 'warning', `Yerləşdirmə nəticələri sıfırlandı: "${sel?.name}"`,
          `${n} təhsilalanın yerləşdirməsi silindi`)
        loadBase()
        setResetDone(true)
        setTimeout(() => setResetDone(false), 4000)
        showInfo({
          icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
          title: 'Nəticələr sıfırlandı',
          message: `${n} təhsilalanın yerləşdirmə nəticəsi silindi. Yerləşdirməni yenidən apara bilərsiniz.`,
        })
      },
    })
  }

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
      'Seçim sırası': u.choiceNum ? ord(u.choiceNum) : '—',
      'Yerləşdiyi ixtisas': isPlaced(u) ? specName(u) : 'Yerləşdirilməyib',
      'Status': isPlaced(u) ? 'Yerləşdi' : 'Yerləşmədi',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, ...(showGroup ? [{ wch: 6 }] : []), { wch: 11 }, { wch: 32 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Nəticələr')
    XLSX.writeFile(wb, `Neticeler_${fileDate()}.xlsx`)
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

  const nowStr = () => today()          // 01.09.2026
  const fileDate = () => today('-')     // fayl adı: 01-09-2026

  // Rəsmi akt HTML-i (kargüzarlıq rekvizitləri ilə) — həm çap, həm Word üçün.
  // Word uyğunluğu üçün layout cədvəl-əsaslıdır (grid/flex yerinə).
  function buildActHtml(forPrint: boolean): string {
    const d = buildActData()
    const esc = (s: any) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
    const f2 = (n: number) => Number(n).toFixed(2)

    const specSections = d.perSpec.map((s, si) => `
      <div class="spec">
        <div class="spec-head"><b>${si + 1}. ${esc(s.name)}</b>${s.path ? ` <span class="spec-path">(${esc(s.path)})</span>` : ''}
          <span class="spec-fill">Kvota: ${s.quota} · Yerləşdi: ${s.students.length}</span></div>
        ${s.students.length === 0 ? `<div class="empty">Yerləşdirilən təhsilalan yoxdur</div>` : `
        <table class="tbl">
          <thead><tr><th style="width:34px">№</th><th>Soyad, ad, ata adı</th><th>FİN</th><th>İş №</th><th class="c">Bal</th><th class="c">Seçim</th></tr></thead>
          <tbody>
            ${s.students.map((u: any, i: number) => `<tr>
              <td class="c">${i + 1}</td>
              <td>${esc(u.name)}${u.parentName ? ' ' + esc(u.parentName) : ''}</td>
              <td>${esc(u.fin || '—')}</td>
              <td>${esc(u.workNumber || '—')}</td>
              <td class="c b">${f2(u.score || 0)}</td>
              <td class="c">${u.choiceNum ? ord(u.choiceNum) : '—'}</td>
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

    const printBtn = forPrint
      ? `<div class="noprint"><button onclick="window.print()">🖨️ Çap et / PDF yadda saxla</button></div>` : ''

    return `<!DOCTYPE html><html lang="az"><head><meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
    <title>Yerləşdirmə aktı — ${esc(d.instLabel)}</title>
    <style>
      * { box-sizing: border-box; }
      body { font-family: 'Times New Roman', serif; color: #000; margin: 0; padding: 30px 40px; font-size: 12pt; line-height: 1.4; }
      .center { text-align: center; }
      .akt-title { font-size: 17pt; font-weight: bold; letter-spacing: 6px; margin: 12px 0 4px; }
      h2 { font-size: 12pt; text-transform: uppercase; letter-spacing: .5px; border-bottom: 1px solid #000; padding-bottom: 4px; margin: 20px 0 10px; }
      p { margin: 0 0 12px; text-align: justify; }
      table.tbl { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
      table.tbl th, table.tbl td { border: 1px solid #000; padding: 4px 7px; text-align: left; font-size: 10.5pt; }
      table.tbl th { background: #e8e8e8; font-weight: bold; }
      table.tbl td.c, table.tbl th.c { text-align: center; }
      table.tbl td.b { font-weight: bold; }
      table.sum td { border: 1px solid #000; padding: 6px 9px; font-size: 10.5pt; }
      table.sum .lab { background: #f2f2f2; font-weight: bold; }
      table.stat { width: auto; min-width: 60%; }
      .spec { margin-bottom: 12px; page-break-inside: avoid; }
      .spec-head { background: #f2f2f2; border: 1px solid #000; padding: 5px 8px; font-size: 11pt; }
      .spec-path { font-weight: normal; color: #333; font-size: 10pt; }
      .spec-fill { float: right; font-weight: bold; }
      .empty { border: 1px solid #000; border-top: none; padding: 6px 8px; font-style: italic; }
      @media print { body { padding: 14mm 16mm; } .noprint { display: none; } }
      .noprint { text-align: center; margin-bottom: 18px; }
      .noprint button { font-family: sans-serif; font-size: 13px; padding: 9px 22px; border-radius: 8px; border: none; background: #1d6f42; color: #fff; font-weight: 700; cursor: pointer; }
    </style></head><body>
      ${printBtn}

      <!-- Məzmun Excel ixracı ilə eyni saxlanılır: başlıq + Müəssisə/Seçim/Tarix,
           xülasə, bölgülər, ixtisas üzrə siyahı. Rəsmi kargüzarlıq elementləri
           (təsdiq grifi, «Əsas:», nüsxə sətri, komissiya imzaları) qəsdən yoxdur. -->
      <div class="center">
        <div class="akt-title">YERLƏŞDİRMƏ AKTI</div>
      </div>

      <table class="sum" style="margin-bottom:14px">
        <tr><td class="lab">Müəssisə</td><td>${esc(d.instLabel)}</td></tr>
        <tr><td class="lab">Seçim</td><td>${esc(d.selName || '—')}</td></tr>
        <tr><td class="lab">Tarix</td><td>${nowStr()}</td></tr>
      </table>

      <h2>Ümumi xülasə</h2>
      <table class="sum">
        <tr><td class="lab">Ümumi təhsilalan</td><td>${d.total}</td><td class="lab">Yerləşdirildi</td><td>${d.placed} (${d.rate}%)</td></tr>
        <tr><td class="lab">Yerləşdirilmədi</td><td>${d.unplaced}</td><td class="lab">1-ci seçimə düşdü</td><td>${d.sat}%</td></tr>
        <tr><td class="lab">Ümumi kvota</td><td>${d.totalQuota} (${d.quotaFill}% dolu)</td><td class="lab">Orta bal</td><td>${f2(d.avg)}</td></tr>
        <tr><td class="lab">Ən aşağı bal</td><td>${f2(d.minS)}</td><td class="lab">Ən yüksək bal</td><td>${f2(d.maxS)}</td></tr>
      </table>

      ${groupTable}
      ${sourceTable}

      <h2>İxtisas üzrə yerləşdirmə siyahısı</h2>
      ${specSections || '<div class="empty">Yerləşdirmə aparılmayıb.</div>'}

    </body></html>`
  }

  function generateActHTML() {
    const d = buildActData()
    const w = window.open('', '_blank')
    if (w) { w.document.write(buildActHtml(true)); w.document.close() }
    addLog('distribution', 'info', 'Yerləşdirmə aktı (çap) hazırlandı', `${d.instLabel} · ${d.selName} · ${d.placed}/${d.total} yerləşdi`)
  }

  // Word (.doc) — eyni HTML Word MIME ilə yüklənir, redaktə oluna bilir
  function exportActWord() {
    const d = buildActData()
    const html = buildActHtml(false)
    const blob = new Blob(['﻿' + html], { type: 'application/msword;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Yerlesdirme_Akti_${d.instLabel}_${fileDate()}.doc`
    a.click()
    URL.revokeObjectURL(url)
    addLog('distribution', 'info', 'Yerləşdirmə aktı (Word) ixrac edildi', `${d.instLabel} · ${d.placed}/${d.total} yerləşdi`)
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
        'FİN': u.fin || '—', 'İş №': u.workNumber || '—', 'Bal': f2(u.score || 0), 'Seçim': u.choiceNum ? ord(u.choiceNum) : '—',
      }))
    })
    const ws2 = XLSX.utils.json_to_sheet(listRows, { header: ['№', 'Soyad, ad, ata adı', 'FİN', 'İş №', 'Bal', 'Seçim'] })
    ws2['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 9 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'İxtisas üzrə siyahı')

    XLSX.writeFile(wb, `Yerlesdirme_Akti_${d.instLabel}_${fileDate()}.xlsx`)
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
    { label: 'Ümumi təhsilalan', val: stats.total, icon: '👥', color: `${P.navy}` },
    { label: 'Yerləşdi', val: stats.placed, sub: `${stats.rate}%`, icon: '✅', color: '#52c41a' },
    { label: 'Yerləşməyib', val: stats.unplaced, icon: '⏳', color: '#fa8c16' },
    { label: '1-ci seçim', val: stats.placed ? `${stats.sat}%` : '—', icon: '🏆', color: '#722ed1' },
    { label: 'Orta bal', val: stats.avg.toFixed(2), icon: '📊', color: '#13c2c2' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}
      {/* Müəssisə keçiricisi */}
      {selInsts.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2, #888)', marginRight: 2 }}>🏛️ Müəssisə:</span>
          {selInsts.map(iid => {
            const active = iid === curInst
            const first = allSelections.find((s: any) => (s.institutionId || s.institution || '') === iid)
            return (
              <button key={iid || '_'} onClick={() => { if (first) { setSelId(first.id); writeActiveInst(iid) } }}
                style={{ padding: '8px 18px', borderRadius: 9, border: `1.5px solid ${active ? '#2b2f3a' : 'var(--border)'}`, cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  background: active ? '#2b2f3a' : '#fff', color: active ? '#fff' : 'var(--text)' }}>
                {(iid && instMap[iid]?.label) || 'Digər'}
              </button>
            )
          })}
        </div>
      )}
      {/* Seçim (qrup) keçiricisi — seçilmiş müəssisə daxilində */}
      {instSelections.length > 1 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2, #888)', marginRight: 2 }}>📋 Qrup:</span>
          {instSelections.map((s: any) => (
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
            {can('results.export') && (
            <div style={{ position: 'relative' }}>
              <button onClick={() => setAktMenu(v => !v)}
                style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#1a1a1a', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                📋 <span className="res-export-label">Akt</span> <span style={{ fontSize: 9 }}>{aktMenu ? '▲' : '▼'}</span>
              </button>
              {aktMenu && (
                <>
                  <div onClick={() => setAktMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div style={{ position: 'absolute', right: 0, top: '112%', zIndex: 41, background: '#fff', border: '1.5px solid #e8eaf5', borderRadius: 12, boxShadow: '0 12px 32px #0002', overflow: 'hidden', minWidth: 210, whiteSpace: 'nowrap' }}>
                    {[
                      { icon: '📄', label: 'Akt (PDF / çap)', sub: 'Çap pəncərəsi açılır', color: '#1a1a1a', fn: generateActHTML },
                      { icon: '📝', label: 'Akt (Word)', sub: 'Redaktə oluna bilən sənəd', color: '#2b579a', fn: exportActWord },
                      { icon: '📊', label: 'Akt (Excel)', sub: 'Cədvəl formatı', color: '#1d6f42', fn: exportActExcel },
                    ].map((o, i) => (
                      <button key={o.label} onClick={() => { o.fn(); setAktMenu(false) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 11, width: '100%', padding: '11px 14px', border: 'none', borderTop: i ? '1px solid #f0f2f8' : 'none', background: '#fff', cursor: 'pointer', textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#f8f9fd')}
                        onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                        <span style={{ fontSize: 19, width: 24, textAlign: 'center', flexShrink: 0 }}>{o.icon}</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontSize: 12.5, fontWeight: 800, color: o.color }}>{o.label}</span>
                          <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{o.sub}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            )}
            {can('results.reset') && (
              <button onClick={handleResetResults} disabled={placedHere.length === 0}
                title={placedHere.length === 0 ? 'Bu seçim üzrə yerləşdirmə nəticəsi yoxdur' : 'Yerləşdirmə nəticələrini sil'}
                style={{ padding: '8px 16px', borderRadius: 9, fontWeight: 700, fontSize: 12.5, whiteSpace: 'nowrap',
                  border: `1.5px solid ${resetDone ? '#b7eb8f' : '#ffccc7'}`,
                  background: resetDone ? '#f0fff4' : '#fff0f0',
                  color: resetDone ? '#237804' : '#cf1322',
                  cursor: placedHere.length === 0 ? 'not-allowed' : 'pointer',
                  opacity: placedHere.length === 0 ? .5 : 1 }}>
                {resetDone ? '✅ Sıfırlandı!' : `🗑 Nəticələri sıfırla${placedHere.length ? ` (${placedHere.length})` : ''}`}
              </button>
            )}
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
                          style={{ padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${isOpen ? `${P.navy}` : '#c5d0ff'}`, background: isOpen ? `${P.navy}` : `${P.tint}`, color: isOpen ? '#fff' : `${P.navy}`, whiteSpace: 'nowrap' }}>
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
