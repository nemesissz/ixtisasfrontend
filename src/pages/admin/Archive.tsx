import { useState, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { selectionDb, treeDb, userDb, submissionDb, userArchiveDb, treeArchiveDb, institutionDb, useLocalState, buildNameMap, addLog } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import { useTopbar } from '../../contexts/TopbarContext'
import InstIcon from '../../components/InstIcon'

function getLeavesWithPath(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeavesWithPath(n.children, [...anc, n]))
  }
  return res
}

const SECTIONS = [
  { id: 'selections',  icon: '🗳',  label: 'Seçimlər' },
  { id: 'users',       icon: '👥', label: 'Təhsil Alanlar' },
  { id: 'specialties', icon: '🎓', label: 'Müəssisə/İxtisaslar' },
]

export default function Archive() {
  const [selList,   refreshSels]  = useLocalState(selectionDb.getArchived)
  const [userArcs,  refreshUArcs] = useLocalState(userArchiveDb.getAll)
  const [treeArcs,  refreshTArcs] = useLocalState(treeArchiveDb.getAll)
  const [users]                   = useLocalState(userDb.getAll)

  const [section,    setSection]    = useState('selections')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [instFlt,    setInstFlt]    = useState<Record<string, string>>({})
  const [search,     setSearch]     = useState<Record<string, string>>({})
  const [activeInst, setActiveInst] = useState<string>('')
  const [instList]                  = useLocalState(institutionDb.getAll)
  const { dialog, showConfirm, showInfo, closeDialog } = useDialog()
  const { setSlot, clearSlot } = useTopbar()

  const allUsers = users    as any[]
  const sels     = selList  as any[]
  const uarcs    = userArcs as any[]
  const tarcs    = treeArcs as any[]
  const insts    = instList as any[]

  function handleRestoreSel(id: string) {
    showConfirm({
      icon: '↩', iconBg: '#f0fff4', iconColor: '#52c41a',
      title: 'Seçimi bərpa et',
      message: 'Bu seçimi arxivdən çıxarıb yenidən aktiv etmək istəyirsiniz?',
      confirmLabel: 'Bərpa et', confirmColor: '#52c41a',
      onConfirm: () => { const s = sels.find((x: any) => x.id === id); selectionDb.restore(id); addLog('selection', 'success', `Seçim arxivdən bərpa edildi: "${s?.name || id}"`); refreshSels() },
    })
  }
  function handleDeleteSel(id: string) {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Seçimi sil',
      message: 'Bu seçim arxivdən tamamilə silinəcək. Əməliyyat geri alına bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: () => { const s = sels.find((x: any) => x.id === id); selectionDb.delete(id); addLog('selection', 'error', `Seçim arxivdən tamamilə silindi: "${s?.name || id}"`); refreshSels() },
    })
  }
  function handleDeleteUArc(id: string) {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Təhsil alan arxivini sil',
      message: 'Bu təhsil alan arxivi tamamilə silinəcək. Əməliyyat geri qaytarıla bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: () => { const a = uarcs.find((x: any) => x.id === id); userArchiveDb.delete(id); addLog('user', 'error', `Təhsil alan arxivi silindi: "${a?.label || id}"`, `${a?.snapshot?.length ?? 0} təhsil alan qeydi`); refreshUArcs() },
    })
  }
  function handleRestoreUserArc(arc: any) {
    showConfirm({
      icon: '👥', iconBg: '#fbf1d6', iconColor: '#c9962a',
      title: 'Təhsil Alanları bərpa et',
      message: `"${arc.label}" arxivindəki ${arc.snapshot?.length ?? 0} təhsil alan aktiv siyahıya əlavə ediləcək.`,
      confirmLabel: 'Bərpa et', confirmColor: '#c9962a',
      onConfirm: () => {
        const existing  = userDb.getAll() as any[]
        const existFins = new Set(existing.map((u: any) => u.fin).filter(Boolean))
        const toAdd     = (arc.snapshot || []).filter((u: any) => !existFins.has(u.fin))
        toAdd.forEach((u: any) => { const { id: _id, ...rest } = u; userDb.create(rest) })
        const skipped = (arc.snapshot?.length ?? 0) - toAdd.length
        userArchiveDb.delete(arc.id)
        addLog('user', 'success', `Təhsil Alanlar arxivdən bərpa edildi: "${arc.label}"`, `${toAdd.length} bərpa${skipped ? ` · ${skipped} mövcud idi` : ''}`)
        refreshUArcs()
        showInfo({
          icon: '✅', iconBg: '#f0fff4', iconColor: '#52c41a',
          title: 'Bərpa tamamlandı',
          message: `${toAdd.length} təhsil alan bərpa edildi.${skipped ? ` ${skipped} təhsil alan artıq mövcud idi.` : ''} Arxivdən silindi.`,
          confirmLabel: 'Bağla',
        })
      },
    })
  }
  function handleRestoreTreeArc(arc: any) {
    showConfirm({
      icon: '🎓', iconBg: '#fbf1d6', iconColor: '#c9962a',
      title: 'Strukturu bərpa et',
      message: `"${arc.name}" ixtisas strukturu Müəssisə/İxtisaslar bölməsinə yeni struktur kimi əlavə ediləcək.`,
      confirmLabel: 'Bərpa et', confirmColor: '#c9962a',
      onConfirm: () => {
        treeDb.create({ name: arc.name + ' (bərpa)', year: arc.year || '', icon: arc.icon || '', nodes: arc.nodes || [] })
        treeArchiveDb.delete(arc.id)
        addLog('system', 'success', `İxtisas strukturu arxivdən bərpa edildi: "${arc.name}"`)
        refreshTArcs()
        showInfo({
          icon: '✅', iconBg: '#f0fff4', iconColor: '#52c41a',
          title: 'Bərpa tamamlandı',
          message: 'Struktur Müəssisə/İxtisaslar bölməsinə uğurla əlavə edildi. Arxivdən silindi.',
          confirmLabel: 'Bağla',
        })
      },
    })
  }
  function handleDeleteTreeArc(id: string) {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'İxtisas arxivini sil',
      message: 'Bu ixtisas strukturu arxivdən tamamilə silinəcək. Əməliyyat geri alına bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: () => { const a = tarcs.find((x: any) => x.id === id); treeArchiveDb.delete(id); addLog('system', 'error', `İxtisas arxivi silindi: "${a?.name || id}"`); refreshTArcs() },
    })
  }

  const instId = activeInst || insts[0]?.id || ''

  const counts: Record<string, number> = {
    selections:  sels.filter((s: any) => s.institution === instId).length,
    users:       uarcs.filter((a: any) => a.institution === instId).length,
    specialties: tarcs.filter((a: any) => a.institution === instId).length,
  }

  // ── Müəssisə tablarını topbar-a inject et ──────────────────────────────────
  useEffect(() => {
    const token = setSlot(
      insts.length === 0
        ? <></>
        : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {insts.map((inst: any) => (
              <button
                key={inst.id}
                onClick={() => { setActiveInst(inst.id); setExpandedId(null) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  transition: 'all .15s',
                  background: instId === inst.id ? 'var(--blue)' : '#f0f2fa',
                  color:      instId === inst.id ? '#fff'        : 'var(--muted)',
                  boxShadow:  instId === inst.id ? '0 2px 8px #c9962a33' : 'none',
                }}
              >
                <InstIcon icon={inst.icon} size={14} />
                {inst.label}
              </button>
            ))}
          </div>
        )
    )
    return () => clearSlot(token)
  }, [insts, instId])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Xüsusi dialog ── */}
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}

      {/* ── Bölmə tabları (content-də) ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {SECTIONS.map(s => {
          const isActive = section === s.id
          return (
            <button
              key={s.id}
              onClick={() => { setSection(s.id); setExpandedId(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 18px', borderRadius: 10, border: 'none',
                cursor: 'pointer', fontWeight: 700, fontSize: 13,
                transition: 'all .15s',
                background: isActive ? 'linear-gradient(135deg,#c9962a,#b8860b)' : '#f0f2fa',
                color:      isActive ? '#fff' : 'var(--muted)',
                boxShadow:  isActive ? '0 4px 14px #c9962a33' : 'none',
              }}
            >
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              {s.label}
              <span style={{
                fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 20,
                background: isActive ? 'rgba(255,255,255,0.25)' : '#f3e9cf',
                color: isActive ? '#fff' : '#9a7b1e', minWidth: 18, textAlign: 'center',
              }}>{counts[s.id]}</span>
            </button>
          )
        })}
      </div>

      {/* ── SEÇİMLƏR bölməsi ── */}
      {section === 'selections' && (() => {
        const shown = sels.filter((s: any) => s.institution === instId)
        return (
          <>
            {shown.length === 0 ? (
              <EmptyState icon="🗳" text="Seçim arxivi boşdur" sub="Seçimlər bölməsindən seçimləri arxivlədikdə burada görünəcək." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {shown.map((sel: any, idx: number) => (
                  <ArchiveCard
                    key={sel.id} sel={sel} idx={idx} allUsers={allUsers}
                    expanded={expandedId === sel.id}
                    instFlt={instFlt[sel.id] || 'all'}
                    searchQ={search[sel.id] || ''}
                    onToggle={() => setExpandedId(expandedId === sel.id ? null : sel.id)}
                    onInstFlt={v => setInstFlt(p => ({ ...p, [sel.id]: v }))}
                    onSearch={v => setSearch(p => ({ ...p, [sel.id]: v }))}
                    onRestore={() => handleRestoreSel(sel.id)}
                    onDelete={() => handleDeleteSel(sel.id)}
                  />
                ))}
              </div>
            )}
          </>
        )
      })()}

      {/* ── TƏHSİL ALANLAR bölməsi ── */}
      {section === 'users' && (() => {
        const shown = uarcs.filter((a: any) => a.institution === instId)
        return (
          <>
            {shown.length === 0 ? (
              <EmptyState icon="👥" text="Təhsil alan arxivi boşdur" sub="Təhsil Alanlar bölməsindən 'Arxivlə' düyməsini istifadə etdikdə burada görünəcək." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {shown.map((arc: any, idx: number) => (
                  <UserArchiveCard
                    key={arc.id} arc={arc} idx={idx}
                    expanded={expandedId === arc.id}
                    searchQ={search[arc.id] || ''}
                    onToggle={() => setExpandedId(expandedId === arc.id ? null : arc.id)}
                    onSearch={v => setSearch(p => ({ ...p, [arc.id]: v }))}
                    onRestore={() => handleRestoreUserArc(arc)}
                    onDelete={() => handleDeleteUArc(arc.id)}
                  />
                ))}
              </div>
            )}
          </>
        )
      })()}

      {/* ── MÜƏSSİSƏ/İXTİSASLAR bölməsi ── */}
      {section === 'specialties' && (() => {
        const shown  = tarcs.filter((a: any) => !a.institution || a.institution === instId)
        const shownStrict = tarcs.filter((a: any) => a.institution === instId)
        const displayed = shownStrict.length > 0 ? shownStrict : shown
        return (
          <>
            {displayed.length === 0 ? (
              <EmptyState icon="🎓" text="İxtisas arxivi boşdur" sub="Müəssisə/İxtisaslar bölməsindən 'Arxivlə' düyməsini istifadə etdikdə burada görünəcək." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {displayed.map((arc: any, idx: number) => (
                  <TreeArchiveCard
                    key={arc.id} arc={arc} idx={idx}
                    expanded={expandedId === arc.id}
                    onToggle={() => setExpandedId(expandedId === arc.id ? null : arc.id)}
                    onRestore={() => handleRestoreTreeArc(arc)}
                    onDelete={() => handleDeleteTreeArc(arc.id)}
                  />
                ))}
              </div>
            )}
          </>
        )
      })()}

    </div>
  )
}

// ── Müəssisə Tab Sırası ───────────────────────────────────────────────────────
function InstTabs({ insts, active, counts, onSelect }: {
  insts:    any[]
  active:   string
  counts:   Record<string, number>
  onSelect: (id: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {insts.map((inst: any) => {
        const isActive = active === inst.id
        const cnt      = counts[inst.id] ?? 0
        return (
          <button
            key={inst.id}
            onClick={() => onSelect(inst.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 20px', borderRadius: 12, border: 'none',
              cursor: 'pointer', fontWeight: 700, fontSize: 13,
              transition: 'all .15s',
              background: isActive ? 'var(--blue)' : '#f0f2fa',
              color:      isActive ? '#fff'        : 'var(--muted)',
              boxShadow:  isActive ? '0 3px 10px #c9962a33' : 'none',
            }}
          >
            <InstIcon icon={inst.icon} size={16} style={{ marginRight: 2 }} />
            {inst.label}
            <span style={{
              fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 20,
              background: isActive ? 'rgba(255,255,255,0.25)' : '#f3e9cf',
              color:      isActive ? '#fff' : '#9a7b1e',
              minWidth: 20, textAlign: 'center',
            }}>{cnt}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Boş vəziyyət ──────────────────────────────────────────────────────────────
function EmptyState({ icon, text, sub }: { icon: string; text: string; sub: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 360, gap: 14,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 22,
        background: 'linear-gradient(135deg,#f0f2fa,#f3e9cf)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, boxShadow: '0 4px 20px #0001',
      }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>{text}</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>{sub}</div>
    </div>
  )
}

// ── Təhsil alan Arxiv Kartı ───────────────────────────────────────────────────────
function UserArchiveCard({ arc, idx, expanded, searchQ, onToggle, onSearch, onDelete, onRestore }: any) {
  const snapshot: any[] = arc.snapshot || []

  const instColor = arc.institution === 'kollec' ? '#c9962a' : '#b8860b'
  const instBg    = arc.institution === 'kollec' ? '#fbf1d6' : '#fbf1d6'
  const instLabel = arc.institution === 'kollec' ? '🎓 Hərbi Kollec' : '🏛️ AHM'

  const archivedDate = arc.archivedAt
    ? new Date(arc.archivedAt).toLocaleDateString('az-AZ', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—'

  const rows = useMemo(() => {
    const q = searchQ.toLowerCase()
    return snapshot
      .filter(u => !q || u.name.toLowerCase().includes(q) || (u.fin || '').toLowerCase().includes(q))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
  }, [snapshot.length, searchQ])

  const placed  = snapshot.filter(u => u.placedSpecialty).length
  const grpSet  = new Set(snapshot.map(u => u.group).filter(Boolean))
  const hasGroups = grpSet.size > 0

  function exportExcel() {
    const data = rows.map((u, i) => ({
      '#': i + 1, 'Ad Soyad': u.name, 'Ata adı': u.parentName || '—',
      'İş nömrəsi': u.workNumber || '—', 'FİN': u.fin || '—',
      'Qrup': u.group || '—', 'Bal': Number(u.score).toFixed(2),
      'Yerləşdiyi ixtisas': u.placedSpecialty || 'Yerləşdirilməyib',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 7 }, { wch: 8 }, { wch: 28 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Təhsil Alanlar')
    XLSX.writeFile(wb, `Arxiv_${arc.label.replace(/\s/g, '_')}_${archivedDate}.xlsx`)
    addLog('user', 'info', `Arxiv təhsil alan ixracı: "${arc.label}"`, `${arc.snapshot?.length ?? 0} təhsil alan`)
  }

  return (
    <div style={{
      background: '#fff', border: '1.5px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
      boxShadow: expanded ? '0 8px 32px #0002' : '0 2px 8px #0001',
      transition: 'box-shadow .2s',
    }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '16px 22px', cursor: 'pointer',
          background: expanded ? '#f8f9ff' : '#fff',
          borderBottom: expanded ? '1.5px solid var(--border)' : 'none',
          transition: 'background .15s', userSelect: 'none',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg,#9a7b1e22,#9aa0ac22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: '#9a7b1e',
        }}>{String(idx + 1).padStart(2, '0')}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{arc.label}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: instBg, color: instColor, border: `1px solid ${instColor}33`,
            }}>{instLabel}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: '#f5f5f5', color: '#888', border: '1px solid #e8e8e8',
            }}>🗄️ {archivedDate}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>👥 {snapshot.length} təhsil alan</span>
            <span>✅ {placed} yerləşdirildi</span>
            {hasGroups && <span>📋 {grpSet.size} qrup</span>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={onRestore}
            style={{
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid #52c41a66', background: '#f0fff4',
              color: '#237804', fontWeight: 700, fontSize: 12, transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#52c41a'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f0fff4'; (e.currentTarget as HTMLElement).style.color = '#237804' }}
          >↩ Bərpa et</button>
          <button
            onClick={onDelete}
            style={{
              width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid #ff4d4f44', background: '#fff0f0',
              color: '#ff4d4f', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ff4d4f'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff0f0'; (e.currentTarget as HTMLElement).style.color = '#ff4d4f' }}
          >🗑</button>
        </div>

        <div style={{
          width: 28, height: 28, borderRadius: 8, background: '#f0f2fa',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: 'var(--muted)', flexShrink: 0,
          transition: 'transform .2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</div>
      </div>

      {expanded && (
        <div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 12, padding: '14px 22px',
            background: 'linear-gradient(135deg,#f8f9ff,#f4f6fc)',
            borderBottom: '1px solid var(--border)',
          }}>
            {[
              { icon: '👥', label: 'Cəmi təhsil alan',    val: snapshot.length, color: instColor },
              { icon: '✅', label: 'Yerləşdirilib',    val: placed,          color: '#52c41a' },
              { icon: '⏳', label: 'Yerləşdirilməyib', val: snapshot.length - placed, color: '#f5a623' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#fff', borderRadius: 12, padding: '12px 16px',
                border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 1 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.val}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex', gap: 10, padding: '12px 22px',
            borderBottom: '1px solid var(--border)', background: '#fff',
            alignItems: 'center', flexWrap: 'wrap',
          }}>
            <input
              className="search-input"
              placeholder="🔍  Ad və ya FİN..."
              value={searchQ}
              onChange={e => onSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <button onClick={exportExcel} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: '#1d6f42', color: '#fff', fontWeight: 700,
              fontSize: 12, cursor: 'pointer', flexShrink: 0,
            }}>📥 Excel</button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: hasGroups ? 820 : 750 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>TƏHSİL ALAN</th>
                  <th>İŞ NÖMRƏSİ</th>
                  <th>FİN</th>
                  {hasGroups && <th style={{ width: 70, textAlign: 'center' }}>QRUP</th>}
                  <th style={{ width: 100, textAlign: 'center' }}>BAL</th>
                  <th>YERLƏŞDİYİ İXTİSAS</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={hasGroups ? 7 : 6} style={{ textAlign: 'center', padding: '36px', color: 'var(--muted)', fontSize: 13 }}>Nəticə tapılmadı</td></tr>
                )}
                {rows.map((u: any, i: number) => (
                  <tr key={u.id || i}>
                    <td style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</td>
                    <td>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.parentName || '—'}</div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{u.workNumber || '—'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 }}>{u.fin || '—'}</td>
                    {hasGroups && (
                      <td style={{ textAlign: 'center' }}>
                        {u.group
                          ? <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 20, background: instBg, color: instColor, fontWeight: 800, fontSize: 12 }}>{u.group}</span>
                          : <span style={{ color: '#ccc' }}>—</span>}
                      </td>
                    )}
                    <td style={{ textAlign: 'center' }}>
                      <span style={{ background: '#e8f4ff', color: 'var(--blue)', borderRadius: 20, padding: '3px 12px', fontWeight: 800, fontSize: 13 }}>
                        {Number(u.score).toFixed(2)}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: u.placedSpecialty ? 'var(--blue)' : '#ccc', fontWeight: u.placedSpecialty ? 700 : 400 }}>
                      {u.placedSpecialty || '— Yerləşdirilməyib'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: '10px 22px', borderTop: '1px solid var(--border)',
            background: '#fafbff', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', fontSize: 12, color: 'var(--muted)',
          }}>
            <span>{rows.length} nəticə</span>
            <span style={{ color: '#52c41a', fontWeight: 700 }}>
              ✅ {placed} yerləşdirildi · ⏳ {snapshot.length - placed} gözləyir
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Seçim Arxiv Kartı ─────────────────────────────────────────────────────────
function ArchiveCard({ sel, idx, allUsers, expanded, instFlt, searchQ,
  onToggle, onInstFlt, onSearch, onRestore, onDelete }: any) {

  const tree     = sel ? treeDb.get(sel.treeId) : null
  const subs     = sel ? (submissionDb.getBySelection(sel.id) as any[]) : []
  const nameMap  = tree ? buildNameMap(tree) : {}
  const leaves   = getLeavesWithPath(tree?.nodes || [])
  const totalQuota = leaves.reduce((s, { leaf }) => s + (leaf.quota || 0), 0)

  const instUsers = allUsers.filter((u: any) => u.institution === sel.institution)
  const submitted = instUsers.filter((u: any) => subs.find((s: any) => s.userId === u.id))
  const placed    = instUsers.filter((u: any) => u.placedSpecialty)

  const instColor = sel.institution === 'kollec' ? '#c9962a' : '#b8860b'
  const instBg    = sel.institution === 'kollec' ? '#fbf1d6' : '#fbf1d6'
  const instLabel = sel.institution === 'kollec' ? '🎓 Hərbi Kollec' : '🏛️ AHM'

  const rows = useMemo(() => {
    return submitted
      .filter((u: any) => {
        const q = searchQ.toLowerCase()
        if (q && !u.name.toLowerCase().includes(q) && !(u.fin || '').toLowerCase().includes(q)) return false
        if (instFlt !== 'all' && u.institution !== instFlt) return false
        return true
      })
      .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
  }, [submitted.length, searchQ, instFlt])

  function exportExcel() {
    const data = rows.map((u: any, i: number) => ({
      '#': i + 1, 'Təhsil alan': u.name, 'FİN': u.fin || '—',
      'İş nömrəsi': u.workNumber || '—',
      'Müəssisə': u.institution === 'kollec' ? 'Hərbi Kollec' : 'AHM',
      'Bal': Number(u.score).toFixed(2), 'Qrup': u.group || '—',
      'Yerləşdiyi ixtisas': u.placedSpecialty ? (nameMap[u.placedSpecialty] || u.placedSpecialty) : '—',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 6 }, { wch: 30 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Arxiv')
    XLSX.writeFile(wb, `Arxiv_${sel.name.replace(/\s/g, '_')}.xlsx`)
    addLog('selection', 'info', `Arxiv seçim nəticəsi ixrac edildi: "${sel.name}"`)
  }

  const archivedDate = sel.archivedAt
    ? new Date(sel.archivedAt).toLocaleDateString('az-AZ', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—'

  return (
    <div style={{
      background: '#fff', border: '1.5px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
      boxShadow: expanded ? '0 8px 32px #0002' : '0 2px 8px #0001',
      transition: 'box-shadow .2s',
    }}>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '18px 22px', cursor: 'pointer',
          background: expanded ? '#f8f9ff' : '#fff',
          borderBottom: expanded ? '1.5px solid var(--border)' : 'none',
          transition: 'background .15s', userSelect: 'none',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg,#9a7b1e22,#9aa0ac22)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: '#9a7b1e',
        }}>{String(idx + 1).padStart(2, '0')}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{sel.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: instBg, color: instColor, border: `1px solid ${instColor}33`,
            }}>{instLabel}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: '#f5f5f5', color: '#888', border: '1px solid #e8e8e8',
            }}>🗄️ Arxivləndi: {archivedDate}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>👥 {submitted.length} təhsil alan</span>
            <span>✅ {placed.length} yerləşdirildi</span>
            <span>🎓 {leaves.length} ixtisas · {totalQuota} kvota</span>
            {sel.deadline && <span>⏰ Son tarix: {new Date(sel.deadline).toLocaleDateString('az-AZ')}</span>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={onRestore}
            style={{
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid #52c41a66', background: '#f0fff4',
              color: '#237804', fontWeight: 700, fontSize: 12, transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#52c41a'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f0fff4'; (e.currentTarget as HTMLElement).style.color = '#237804' }}
          >↩ Bərpa et</button>
          <button
            onClick={onDelete}
            style={{
              width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid #ff4d4f44', background: '#fff0f0',
              color: '#ff4d4f', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ff4d4f'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff0f0'; (e.currentTarget as HTMLElement).style.color = '#ff4d4f' }}
          >🗑</button>
        </div>

        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: '#f0f2fa', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: 14, color: 'var(--muted)',
          flexShrink: 0, transition: 'transform .2s',
          transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>▾</div>
      </div>

      {expanded && (
        <div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4,1fr)',
            gap: 12, padding: '16px 22px',
            background: 'linear-gradient(135deg,#f8f9ff,#f4f6fc)',
            borderBottom: '1px solid var(--border)',
          }}>
            {[
              { icon: '👥', label: 'Seçim edib',       val: submitted.length,               color: '#c9962a' },
              { icon: '✅', label: 'Yerləşdirilib',     val: placed.length,                  color: '#52c41a' },
              { icon: '⏳', label: 'Yerləşdirilməyib',  val: submitted.length - placed.length, color: '#f5a623' },
              { icon: '🎓', label: 'Cəmi kvota',        val: totalQuota,                     color: '#b8860b' },
            ].map(s => (
              <div key={s.label} style={{
                background: '#fff', borderRadius: 12, padding: '12px 16px',
                border: '1.5px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <span style={{ fontSize: 18 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 1 }}>{s.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: s.color }}>{s.val}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{
            display: 'flex', gap: 10, padding: '12px 22px',
            borderBottom: '1px solid var(--border)', background: '#fff',
            alignItems: 'center', flexWrap: 'wrap',
          }}>
            <input
              className="search-input"
              placeholder="🔍  Ad və ya FİN..."
              value={searchQ}
              onChange={e => onSearch(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <select className="filter-select" value={instFlt} onChange={e => onInstFlt(e.target.value)}>
              <option value="all">Bütün müəssisələr</option>
              <option value="kollec">🎓 Hərbi Kollec</option>
              <option value="ahm">🏛️ AHM</option>
            </select>
            <button onClick={exportExcel} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: '#1d6f42', color: '#fff', fontWeight: 700,
              fontSize: 12, cursor: 'pointer', flexShrink: 0,
            }}>📥 Excel</button>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>TƏHSİL ALAN</th>
                  <th>FİN</th>
                  <th style={{ width: 90 }}>BAL</th>
                  <th>MÜƏSSİSƏ</th>
                  <th style={{ width: 60 }}>QRUP</th>
                  <th>YERLƏŞDİYİ İXTİSAS</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontSize: 13 }}>
                      Nəticə tapılmadı
                    </td>
                  </tr>
                )}
                {rows.map((u: any, i: number) => {
                  const instOpt = u.institution === 'kollec'
                    ? { label: '🎓 Hərbi Kollec', color: '#c9962a', bg: '#fbf1d6' }
                    : u.institution === 'ahm'
                    ? { label: '🏛️ AHM', color: '#b8860b', bg: '#fbf1d6' }
                    : null
                  return (
                    <tr key={u.id}>
                      <td style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</td>
                      <td>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.parentName || '—'} · {u.workNumber || '—'}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: 1 }}>{u.fin || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span style={{ background: '#e8f4ff', color: 'var(--blue)', borderRadius: 20, padding: '3px 12px', fontWeight: 800, fontSize: 13 }}>
                          {Number(u.score).toFixed(2)}
                        </span>
                      </td>
                      <td>
                        {instOpt
                          ? <span style={{ display: 'inline-block', padding: '4px 12px', borderRadius: 8, background: instOpt.bg, color: instOpt.color, fontWeight: 700, fontSize: 12 }}>{instOpt.label}</span>
                          : <span style={{ fontSize: 12, color: '#ccc' }}>—</span>}
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: 13 }}>{u.group || '—'}</td>
                      <td style={{ fontSize: 12, color: u.placedSpecialty ? 'var(--blue)' : '#ccc', fontWeight: u.placedSpecialty ? 700 : 400 }}>
                        {u.placedSpecialty ? (nameMap[u.placedSpecialty] || u.placedSpecialty) : '— Yerləşdirilməyib'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{
            padding: '10px 22px', borderTop: '1px solid var(--border)',
            background: '#fafbff', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', fontSize: 12, color: 'var(--muted)',
          }}>
            <span>{rows.length} nəticə göstərilir</span>
            <span style={{ color: '#52c41a', fontWeight: 700 }}>
              ✅ {placed.length} yerləşdirildi · ⏳ {submitted.length - placed.length} gözləyir
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Rəng sxemi (Specialties ilə eyni) ────────────────────────────────────────
const DEPTH_COLORS = ['#c9962a', '#b8860b', '#ff7c4f', '#237804', '#c41d7f', '#d48806']
function depthColor(d: number) { return DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)] }

function arcCountLeaves(nodes: any[]): number {
  return nodes.reduce((s: number, n: any) => s + (!n.children?.length ? 1 : arcCountLeaves(n.children)), 0)
}
function arcTotalQuota(nodes: any[]): number {
  return nodes.reduce((s: number, n: any) => s + (!n.children?.length ? (n.quota || 0) : arcTotalQuota(n.children)), 0)
}

// ── Yalnız-oxu node sətiri (Specialties NodeRow-un redaktəsiz versiyası) ──────
function ReadonlyNodeRow({ node, depth }: { node: any; depth: number }) {
  const [open, setOpen] = useState(false)
  const isLeaf    = !node.children?.length
  const color     = depthColor(depth)
  const bgDefault = depth === 0 ? '#f6f8ff' : depth === 1 ? '#fafbff' : '#fff'

  return (
    <>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: `8px 14px 8px ${14 + depth * 24}px`,
          borderBottom: '1px solid #f0f2fa',
          background: open ? '#f0f4ff' : bgDefault,
          transition: 'background .1s',
          cursor: isLeaf ? 'default' : 'pointer',
          userSelect: 'none',
        }}
        onClick={() => { if (!isLeaf) setOpen(o => !o) }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f0f4ff' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = open ? '#f0f4ff' : bgDefault }}
      >
        {/* Chevron */}
        <div style={{
          width: 18, height: 18, borderRadius: 4, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isLeaf ? 'transparent' : (open ? color : '#eef0fa'),
          color: isLeaf ? 'transparent' : (open ? '#fff' : 'var(--muted)'),
          fontSize: 9, transition: 'all .15s',
        }}>
          {!isLeaf && (open ? '▾' : '▸')}
        </div>

        {/* Dərinlik rəngi xətti */}
        <div style={{ width: 3, height: 22, borderRadius: 2, background: color, flexShrink: 0 }} />

        {/* Ad + kvota / alt-statistika */}
        <div style={{ flex: 1, fontSize: 13, fontWeight: depth === 0 ? 700 : depth === 1 ? 600 : 500, color: depth === 0 ? color : 'var(--text)', lineHeight: 1.3 }}>
          {node.name}
          {isLeaf && node.quota != null && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
              kvota: {node.quota}
            </span>
          )}
          {!isLeaf && (() => {
            const sub  = arcCountLeaves(node.children)
            const quot = arcTotalQuota(node.children)
            return (
              <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--muted)', fontWeight: 400, display: 'inline-flex', gap: 10 }}>
                <span style={{ color: '#237804' }}>kvota: <b>{quot}</b></span>
                <span>·</span>
                <span>{sub} ixtisas</span>
              </span>
            )
          })()}
        </div>

        {/* Tip etiketi */}
        <span style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600, whiteSpace: 'nowrap',
          background: depth === 0 ? '#fff4e6' : depth === 1 ? '#f0f4ff' : '#f0fff4',
          color:      depth === 0 ? '#d46b08' : depth === 1 ? color      : '#237804',
        }}>
          {depth === 0
            ? `⚔️ Qoşun növü · ${node.children?.length ?? 0}`
            : depth === 1
            ? (isLeaf ? '📚 Mülki ixtisas' : `📚 Mülki ixtisas · ${node.children?.length ?? 0}`)
            : '🎓 Hərbi uçot ixtisası'}
        </span>

        {/* Prioritet / qrup göstərici (yalnız oxu) */}
        {node.tiebreaker && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#fffbe6', color: '#d46b08', fontWeight: 700 }}>
            🏆 Prioritet
          </span>
        )}
        {!!node.groups?.length && (
          <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#f0fff4', color: '#237804', fontWeight: 700 }}>
            👥 Q:{node.groups.join(',')}
          </span>
        )}
      </div>

      {open && (node.children || []).map((child: any) => (
        <ReadonlyNodeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

// ── İxtisas Ağac Arxiv Kartı ──────────────────────────────────────────────────
function TreeArchiveCard({ arc, idx, expanded, onToggle, onDelete, onRestore }: any) {
  const nodes   = arc.nodes || []
  const leaves  = arcCountLeaves(nodes)
  const total   = arcTotalQuota(nodes)
  const isImage = arc.icon?.startsWith('data:')

  const archivedDate = arc.archivedAt
    ? new Date(arc.archivedAt).toLocaleDateString('az-AZ', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—'

  return (
    <div style={{
      background: '#fff', border: '1.5px solid var(--border)',
      borderRadius: 16, overflow: 'hidden',
      boxShadow: expanded ? '0 8px 32px #0002' : '0 2px 8px #0001',
      transition: 'box-shadow .2s',
    }}>

      {/* ── Başlıq (Specialties kartı ilə eyni) ── */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '15px 20px', cursor: 'pointer', userSelect: 'none',
          background: expanded ? '#f4f7ff' : '#fff',
          borderBottom: expanded ? '1.5px solid #f3e3b8' : 'none',
          transition: 'background .15s',
        }}
        onMouseEnter={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
        onMouseLeave={e => { if (!expanded) (e.currentTarget as HTMLElement).style.background = '#fff' }}
      >
        {/* Chevron */}
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: expanded ? 'var(--blue)' : '#eef0fa',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, color: expanded ? '#fff' : 'var(--muted)', transition: 'all .15s',
        }}>
          {expanded ? '▾' : '▸'}
        </div>

        {/* Logo */}
        <div style={{
          width: 42, height: 42, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
          background: '#fff', border: '1.5px solid #efe1bd',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 22, transition: 'all .15s',
        }}>
          {arc.icon
            ? (isImage ? <img src={arc.icon} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span>{arc.icon}</span>)
            : <span>🏛️</span>}
        </div>

        {/* Ad + il + arxiv tarixi */}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: expanded ? 'var(--blue)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {arc.name}
            {arc.year && (
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', background: '#eef0fa', borderRadius: 5, padding: '1px 7px' }}>
                {arc.year}
              </span>
            )}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: '#f5f5f5', color: '#888', border: '1px solid #e8e8e8',
            }}>🗄️ {archivedDate}</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            {nodes.length} qoşun növü · {leaves} hərbi uçot ixtisası · Ümumi kvota: {total}
          </div>
        </div>

        {/* Bərpa + Sil düymələri */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={onRestore}
            style={{
              padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid #52c41a66', background: '#f0fff4',
              color: '#237804', fontWeight: 700, fontSize: 12, transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#52c41a'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f0fff4'; (e.currentTarget as HTMLElement).style.color = '#237804' }}
          >↩ Bərpa et</button>
          <button
            onClick={onDelete}
            style={{
              width: 34, height: 34, borderRadius: 8, cursor: 'pointer',
              border: '1.5px solid #ff4d4f44', background: '#fff0f0',
              color: '#ff4d4f', fontWeight: 700, fontSize: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#ff4d4f'; (e.currentTarget as HTMLElement).style.color = '#fff' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff0f0'; (e.currentTarget as HTMLElement).style.color = '#ff4d4f' }}
          >🗑</button>
        </div>
      </div>

      {/* ── Açılan məzmun — eyni ağac strukturu ── */}
      {expanded && (
        <div>
          {/* Alt başlıq */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #f0f2fa' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
              İxtisas Ağacı
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {leaves} ixtisas · {total} kvota
            </span>
          </div>

          {nodes.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
              Bu arxivdə ixtisas yoxdur
            </div>
          ) : (
            nodes.map((node: any) => (
              <ReadonlyNodeRow key={node.id} node={node} depth={0} />
            ))
          )}
        </div>
      )}
    </div>
  )
}
