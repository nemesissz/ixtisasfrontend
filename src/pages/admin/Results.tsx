import { useState, useMemo, Fragment } from 'react'
import * as XLSX from 'xlsx'
import { selectionDb, treeDb, userDb, submissionDb, buildNameMap, institutionDb, addLog } from '../../db'
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
  const allSelections = selectionDb.getAll().filter((s: any) => s.status !== 'draft')
  const allUsers      = userDb.getAll() as any[]
  const institutions  = institutionDb.getAll() as any[]
  const instMap: Record<string, any> = {}
  for (const inst of institutions) instMap[inst.id] = inst

  const [selId, setSelId]   = useState<string>(allSelections[0]?.id || '')
  const [search, setSearch] = useState('')
  const [instFlt, setInstFlt] = useState('all')
  const [statusFlt, setStatusFlt] = useState<'all' | 'placed' | 'unplaced'>('all')
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'spec'>('score')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpand = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const sel  = allSelections.find((s: any) => s.id === selId)
  const tree = sel ? treeDb.get(sel.treeId) : null
  const subs = sel ? (submissionDb.getBySelection(sel.id) as any[]) : []
  const nameMap = tree ? buildNameMap(tree) : {}
  // Hər leaf üçün tam yol (Qoşun növü → ... → İxtisas) və təhsil alan üzrə seçim sıralaması
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
      '#': i + 1, 'Təhsil alan': u.name, 'FİN': u.fin || '—', 'İş nömrəsi': u.workNumber || '—',
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
    addLog('distribution', 'info', `Nəticələr Excel-ə ixrac edildi`, `${data.length} təhsil alan · ${sel?.name || ''}`)
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
    { label: 'Ümumi təhsil alan', val: stats.total, icon: '👥', color: '#c9962a' },
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
          <button onClick={exportExcel}
            style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#1d6f42', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
            📥 <span className="res-export-label">Excelə ixrac</span>
          </button>
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
                <th style={{ width: 40 }}>#</th>
                <th>TƏHSİL ALAN</th>
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
