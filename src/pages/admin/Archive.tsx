import { useState, useMemo, useEffect } from 'react'
import { useActiveInst } from '../../activeInst'
import * as XLSX from 'xlsx'
import { selectionDb, treeDb, userDb, submissionDb, userArchiveDb, institutionDb, useLocalState, buildNameMap, addLog, cohortDb, normFin } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import { useTopbar } from '../../contexts/TopbarContext'
import InstIcon from '../../components/InstIcon'
import { formatDate } from '../../utils-date'
import { P } from '../../palette'

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
  { id: 'users',       icon: '👥', label: 'Təhsilalanlar' },
  { id: 'specialties', icon: '🎓', label: 'Müəssisə/İxtisaslar' },
]

export default function Archive() {
  const [selList,   refreshSels]  = useLocalState(selectionDb.getArchived)
  const [userArcs,  refreshUArcs] = useLocalState(userArchiveDb.getAll)
  const [treeArcs,  refreshTArcs] = useLocalState(treeDb.getArchived)
  const [users]                   = useLocalState(userDb.getAll)

  const [section,    setSection]    = useState('selections')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [instFlt,    setInstFlt]    = useState<Record<string, string>>({})
  const [search,     setSearch]     = useState<Record<string, string>>({})
  const [instList]                  = useLocalState(institutionDb.getAll)
  const [activeInst, setActiveInst] = useActiveInst(instList as any[])
  const { dialog, showConfirm, showInfo, closeDialog } = useDialog()
  const { setSlot, clearSlot } = useTopbar()

  const allUsers = (users    ?? []) as any[]
  const sels     = (selList  ?? []) as any[]
  const uarcs    = (userArcs ?? []) as any[]
  const tarcs    = (treeArcs ?? []) as any[]
  const insts    = (instList ?? []) as any[]

  function handleRestoreSel(id: string) {
    showConfirm({
      icon: '↩', iconBg: '#f0fff4', iconColor: '#52c41a',
      title: 'Seçimi bərpa et',
      message: 'Bu seçimi arxivdən çıxarıb yenidən aktiv etmək istəyirsiniz?',
      confirmLabel: 'Bərpa et', confirmColor: '#52c41a',
      onConfirm: async () => { const s = sels.find((x: any) => x.id === id); await selectionDb.restore(id); addLog('selection', 'success', `Seçim arxivdən bərpa edildi: "${s?.name || id}"`); await refreshSels() },
    })
  }
  function handleDeleteSel(id: string) {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Seçimi sil',
      message: 'Bu seçim arxivdən tamamilə silinəcək. Əməliyyat geri alına bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: async () => { const s = sels.find((x: any) => x.id === id); await selectionDb.delete(id); addLog('selection', 'error', `Seçim arxivdən tamamilə silindi: "${s?.name || id}"`); await refreshSels() },
    })
  }
  function handleDeleteUArc(id: string) {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Təhsilalan arxivini sil',
      message: 'Bu təhsilalan arxivi tamamilə silinəcək. Əməliyyat geri qaytarıla bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: async () => { const a = uarcs.find((x: any) => x.id === id); await userArchiveDb.delete(id); addLog('user', 'error', `Təhsilalan arxivi silindi: "${a?.label || id}"`, `${a?.snapshot?.length ?? 0} təhsilalan qeydi`); await refreshUArcs() },
    })
  }
  // Bərpa pəncərəsi: hansı qrupa salınacağı seçilir (bax: RestoreUsersModal)
  const [restoreArc, setRestoreArc] = useState<any>(null)
  function handleRestoreUserArc(arc: any) { setRestoreArc(arc) }

  /**
   * target: 'keep' — arxivdəki qrup saxlanılır (silinibsə qrupsuz);
   *         'none' — qrupsuz; başqa dəyər — həmin qrupun ID-si.
   */
  async function doRestoreUserArc(arc: any, target: string) {
        const [existing, cohortList] = await Promise.all([userDb.getAll(), cohortDb.getAll()])
        // FİN yalnız qrup daxilində unikaldır: eyni FİN başqa qrupda/müəssisədə ola bilər.
        // Arxivdəki qrup sonradan silinibsə təhsilalan qrupsuz bərpa olunur.
        const liveCohorts = new Set(cohortList.map((c: any) => c.id))
        const cohortFor = (raw: any) =>
          target === 'keep' ? (raw.cohort && liveCohorts.has(raw.cohort) ? raw.cohort : null)
          : target === 'none' ? null
          : target
        const scopeKey  = (u: any) => `${u.cohort ? 'c:' + u.cohort : 'i:' + u.institution}|${normFin(u.fin)}`
        const existKeys = new Set(existing.filter((u: any) => normFin(u.fin)).map(scopeKey))
        const existIds  = new Set(existing.map((u: any) => u.id))
        const toAdd: any[] = []
        for (const raw of arc.snapshot || []) {
          const u = { ...raw, cohort: cohortFor(raw) }
          if (existIds.has(u.id)) continue
          if (normFin(u.fin) && existKeys.has(scopeKey(u))) continue
          if (normFin(u.fin)) existKeys.add(scopeKey(u))
          toAdd.push(u)
        }
        // ID SAXLANILIR: arxivdəki seçimlər (Submission.userId) məhz bu ID-lərə bağlıdır.
        // Əvvəl id atılırdı → yeni ID yaranırdı → seçimlər və nəticələr qopurdu.
        await userDb.bulkCreate(toAdd)
        // Göndərilmiş seçimləri də geri yaz (yalnız bərpa olunanlar üçün)
        const addedIds = new Set(toAdd.map((u: any) => u.id))
        const subs = (arc.submissions || []).filter((s: any) => addedIds.has(s.userId))
        let subOk = 0
        for (const s of subs) {
          try { await submissionDb.save({ userId: s.userId, userName: s.userName ?? null, selectionId: s.selectionId, ranking: s.ranking || [] }); subOk++ }
          catch { /* seçimi silinmiş/əlçatmaz olan sətir bərpanı dayandırmamalıdır */ }
        }
        const skipped = (arc.snapshot?.length ?? 0) - toAdd.length
        await userArchiveDb.delete(arc.id)
        const grpName = target === 'keep' ? 'arxivdəki qrup' : target === 'none' ? 'qrupsuz'
          : `qrup: ${cohortList.find((c: any) => c.id === target)?.label ?? target}`
        addLog('user', 'success', `Təhsilalanlar arxivdən bərpa edildi: "${arc.label}"`, `${toAdd.length} bərpa · ${grpName}${subOk ? ` · ${subOk} seçim` : ''}${skipped ? ` · ${skipped} mövcud idi` : ''}`)
        await refreshUArcs()
        showInfo({
          icon: '✅', iconBg: '#f0fff4', iconColor: '#52c41a',
          title: 'Bərpa tamamlandı',
          message: `${toAdd.length} təhsilalan bərpa edildi.${subOk ? ` ${subOk} göndərilmiş seçim və yerləşdirmə nəticələri ilə birlikdə.` : ''}${skipped ? ` ${skipped} təhsilalan artıq mövcud idi.` : ''} Arxivdən silindi.`,
          confirmLabel: 'Bağla',
        })
  }
  function handleRestoreTreeArc(arc: any) {
    showConfirm({
      icon: '🎓', iconBg: `${P.tint}`, iconColor: `${P.navy}`,
      title: 'Strukturu bərpa et',
      message: `"${arc.name}" ixtisas strukturu və onunla birlikdə arxivə düşmüş seçimlər geri qaytarılacaq. Eyni struktur bərpa olunur — nəticələr də yenidən işlək olur. (Əvvəllər əl ilə arxivlənmiş seçimlərə toxunulmur.)`,
      confirmLabel: 'Bərpa et', confirmColor: `${P.navy}`,
      onConfirm: async () => {
        // Nüsxə yaradılmır: eyni sətir yenidən aktiv edilir, ona görə
        // Selection.TreeId bağlantıları və nəticələr qırılmır.
        await treeDb.restore(arc.id)
        addLog('system', 'success', `İxtisas strukturu arxivdən bərpa edildi: "${arc.name}"`)
        await refreshTArcs()
        showInfo({
          icon: '✅', iconBg: '#f0fff4', iconColor: '#52c41a',
          title: 'Bərpa tamamlandı',
          message: 'Struktur Müəssisə/İxtisaslar bölməsinə, onunla birlikdə arxivlənmiş seçimlər isə Seçimlər bölməsinə qaytarıldı.',
          confirmLabel: 'Bağla',
        })
      },
    })
  }
  function handleDeleteTreeArc(id: string) {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'İxtisas arxivini sil',
      message: 'Bu ixtisas strukturu bazadan tamamilə silinəcək. Əməliyyat geri alına bilməz. Ona bağlı seçim varsa silinmə mümkün olmayacaq.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: async () => {
        const a = tarcs.find((x: any) => x.id === id)
        try {
          await treeDb.delete(id)
        } catch (e: any) {
          let msg = String(e?.message ?? e ?? '')
          try { const j = JSON.parse(msg); if (j?.message) msg = j.message } catch { /* JSON deyil */ }
          showInfo({
            icon: '⚠️', iconBg: '#fdecea', iconColor: '#c0392b',
            title: 'Struktur silinmədi', message: msg, confirmLabel: 'Bağla',
          })
          return
        }
        addLog('system', 'error', `İxtisas strukturu silindi: "${a?.name || id}"`)
        await refreshTArcs()
      },
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
                  boxShadow:  instId === inst.id ? `0 2px 8px ${P.navy}33` : 'none',
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
      {restoreArc && (
        <RestoreUsersModal
          arc={restoreArc}
          onClose={() => setRestoreArc(null)}
          onRestore={async target => { await doRestoreUserArc(restoreArc, target); setRestoreArc(null) }}
        />
      )}

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
                background: isActive ? `linear-gradient(135deg,${P.navy},${P.steel})` : '#f0f2fa',
                color:      isActive ? '#fff' : 'var(--muted)',
                boxShadow:  isActive ? `0 4px 14px ${P.navy}33` : 'none',
              }}
            >
              <span style={{ fontSize: 14 }}>{s.icon}</span>
              {s.label}
              <span style={{
                fontSize: 11, fontWeight: 800, padding: '1px 7px', borderRadius: 20,
                background: isActive ? 'rgba(255,255,255,0.25)' : `${P.tint}`,
                color: isActive ? '#fff' : `${P.ink}`, minWidth: 18, textAlign: 'center',
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
                    key={sel.id} sel={sel} idx={idx} allUsers={allUsers} insts={insts}
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

      {/* ── TƏHSİLALANLAR bölməsi ── */}
      {section === 'users' && (() => {
        const shown = uarcs.filter((a: any) => a.institution === instId)
        return (
          <>
            {shown.length === 0 ? (
              <EmptyState icon="👥" text="Təhsilalan arxivi boşdur" sub="Təhsilalanlar bölməsindən 'Arxivlə' düyməsini istifadə etdikdə burada görünəcək." />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {shown.map((arc: any, idx: number) => (
                  <UserArchiveCard
                    key={arc.id} arc={arc} idx={idx} insts={insts}
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
              boxShadow:  isActive ? `0 3px 10px ${P.navy}33` : 'none',
            }}
          >
            <InstIcon icon={inst.icon} size={16} style={{ marginRight: 2 }} />
            {inst.label}
            <span style={{
              fontSize: 11, fontWeight: 800, padding: '1px 8px', borderRadius: 20,
              background: isActive ? 'rgba(255,255,255,0.25)' : `${P.tint}`,
              color:      isActive ? '#fff' : `${P.ink}`,
              minWidth: 20, textAlign: 'center',
            }}>{cnt}</span>
          </button>
        )
      })}
    </div>
  )
}

// ── Boş vəziyyət ──────────────────────────────────────────────────────────────
// ── Təhsilalan arxivinin bərpası: hansı qrupa salınsın ─────────────────────
// Arxivdəki qrup saxlanıla, mövcud qrup seçilə, yerindəcə yeni qrup yaradıla
// və ya təhsilalanlar qrupsuz bərpa oluna bilər.
function RestoreUsersModal({ arc, onClose, onRestore }: {
  arc: any; onClose: () => void; onRestore: (target: string) => Promise<void>
}) {
  const [cohorts, setCohorts] = useState<any[] | null>(null)
  const [mode, setMode]       = useState<'keep' | 'existing' | 'new' | 'none'>('keep')
  const [pick, setPick]       = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy]       = useState(false)
  const [err, setErr]         = useState('')

  useEffect(() => {
    cohortDb.getAll(arc.institution).then(list => {
      const live = list.filter((c: any) => !c.isArchived)
      setCohorts(live)
      if (live.length) setPick(live[0].id)
    }).catch(() => setCohorts([]))
  }, [arc.institution])

  // Arxivdəki təhsilalanların əvvəlki qrupları (adı ilə)
  const origIds = Array.from(new Set((arc.snapshot || []).map((u: any) => u.cohort).filter(Boolean))) as string[]
  const origNames = origIds.map(id => cohorts?.find(c => c.id === id)?.label).filter(Boolean) as string[]
  const origMissing = origIds.length > origNames.length

  const subCount = arc.submissions?.length ?? 0
  const canSubmit = !busy && (mode !== 'existing' || !!pick) && (mode !== 'new' || !!newLabel.trim())

  async function submit() {
    setErr(''); setBusy(true)
    try {
      let target: string = mode === 'existing' ? pick : mode
      if (mode === 'new') {
        const label = newLabel.trim()
        const dup = cohorts?.find(c => c.label.trim().toLowerCase() === label.toLowerCase())
        if (dup) target = dup.id
        else {
          const c = await cohortDb.create({ institution: arc.institution, label })
          addLog('user', 'info', `Qrup yaradıldı: "${label}"`, `Arxivdən bərpa zamanı · "${arc.label}"`)
          target = c.id
        }
      }
      await onRestore(target)
    } catch (e: any) {
      setErr(e?.message || 'Bərpa alınmadı')
      setBusy(false)
    }
  }

  const opt = (key: typeof mode, title: string, sub?: React.ReactNode) => (
    <label key={key} style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
      border: `1.5px solid ${mode === key ? `${P.navy}` : '#e6e9f5'}`, background: mode === key ? `${P.tint2}` : '#fff',
    }}>
      <input type="radio" checked={mode === key} onChange={() => setMode(key)} style={{ marginTop: 3 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 13.5, color: 'var(--text)' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{sub}</span>}
      </span>
    </label>
  )

  return (
    <div className="modal-overlay open" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">↩ Təhsilalanları bərpa et</span>
          <button className="modal-close" onClick={onClose} disabled={busy}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
            «{arc.label}» arxivindəki <b style={{ color: 'var(--text)' }}>{arc.snapshot?.length ?? 0}</b> təhsilalan aktiv siyahıya əlavə ediləcək
            {subCount ? <>, {subCount} göndərilmiş seçim və yerləşdirmə nəticələri də geri qaytarılır</> : null}. Hansı qrupa salınsın?
          </div>

          {cohorts === null ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', padding: '8px 0' }}>Qruplar yüklənir...</div>
          ) : (
            <>
              {opt('keep', 'Arxivdəki qrupda saxla',
                origIds.length === 0 ? 'Arxivdə qrup qeyd olunmayıb — qrupsuz bərpa olunacaq'
                : <>{origNames.length ? origNames.join(', ') : ''}{origMissing ? `${origNames.length ? ' · ' : ''}silinmiş qrupa aid olanlar qrupsuz bərpa olunacaq` : ''}</>)}

              {opt('existing', 'Mövcud qrupa sal',
                cohorts.length === 0 ? 'Bu müəssisədə aktiv qrup yoxdur — yeni qrup yaradın' : undefined)}
              {mode === 'existing' && cohorts.length > 0 && (
                <select className="form-select" value={pick} onChange={e => setPick(e.target.value)} style={{ marginLeft: 30, width: 'calc(100% - 30px)' }}>
                  {cohorts.map(c => <option key={c.id} value={c.id}>{c.label}{c.year ? ` (${c.year})` : ''}</option>)}
                </select>
              )}

              {opt('new', 'Yeni qrup yarat və ora sal')}
              {mode === 'new' && (
                <input className="form-input" autoFocus placeholder="Qrupun adı (məs. 2026 buraxılışı)" value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && canSubmit) submit() }}
                  style={{ marginLeft: 30, width: 'calc(100% - 30px)' }} />
              )}

              {opt('none', 'Qrupsuz bərpa et')}
            </>
          )}

          {mode !== 'keep' && subCount > 0 && (
            <div style={{ fontSize: 12, color: `${P.ink}`, background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8, padding: '8px 10px' }}>
              Qeyd: seçimlər qrupa bağlı struktura aiddir. Təhsilalanları başqa qrupa salsanız, köhnə seçim nəticələri həmin qrupun strukturunda görünməyə bilər.
            </div>
          )}
          {err && <div style={{ fontSize: 12.5, color: '#cf1322' }}>{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="btn btn-outline" onClick={onClose} disabled={busy}>Ləğv et</button>
          <button className="btn btn-primary" onClick={submit} disabled={!canSubmit || cohorts === null}>
            {busy ? 'Bərpa edilir...' : '↩ Bərpa et'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ icon, text, sub }: { icon: string; text: string; sub: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: 360, gap: 14,
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 22,
        background: `linear-gradient(135deg,#f0f2fa,${P.tint})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 36, boxShadow: '0 4px 20px #0001',
      }}>{icon}</div>
      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text)' }}>{text}</div>
      <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>{sub}</div>
    </div>
  )
}

// ── Təhsilalan Arxiv Kartı ───────────────────────────────────────────────────────
function UserArchiveCard({ arc, idx, insts, expanded, searchQ, onToggle, onSearch, onDelete, onRestore }: any) {
  const snapshot: any[] = arc.snapshot || []

  // Müəssisə adı siyahıdan götürülür (köhnə 'kollec'/'ahm' sabitləri deyil)
  const inst      = (insts || []).find((i: any) => i.id === arc.institution)
  const instColor = `${P.navyDk}`
  const instBg    = `${P.tint}`
  const instIcon  = inst?.icon
  const instLabel = inst?.label || arc.institution || '—'

  const archivedDate = arc.archivedAt
    ? formatDate(arc.archivedAt)
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
      '№': i + 1, 'Ad Soyad': u.name, 'Ata adı': u.parentName || '—',
      'İş nömrəsi': u.workNumber || '—', 'FİN': u.fin || '—',
      'Qrup': u.group || '—', 'Bal': Number(u.score).toFixed(2),
      'Yerləşdiyi ixtisas': u.placedSpecialty || 'Yerləşdirilməyib',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 4 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 7 }, { wch: 8 }, { wch: 28 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Təhsilalanlar')
    XLSX.writeFile(wb, `Arxiv_${arc.label.replace(/\s/g, '_')}_${archivedDate}.xlsx`)
    addLog('user', 'info', `Arxiv təhsilalan ixracı: "${arc.label}"`, `${arc.snapshot?.length ?? 0} təhsilalan`)
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
          background: `linear-gradient(135deg,${P.ink}22,#9aa0ac22)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: `${P.ink}`,
        }}>{String(idx + 1).padStart(2, '0')}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{arc.label}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: instBg, color: instColor, border: `1px solid ${instColor}33`,
            }}><InstIcon icon={instIcon} size={11} />{instLabel}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: '#f5f5f5', color: '#888', border: '1px solid #e8e8e8',
            }}>🗄️ {archivedDate}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>👥 {snapshot.length} təhsilalan</span>
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
              { icon: '👥', label: 'Cəmi təhsilalan',    val: snapshot.length, color: instColor },
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
                  <th style={{ width: 40 }}>№</th>
                  <th>TƏHSİLALAN</th>
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
function ArchiveCard({ sel, idx, allUsers, insts, expanded, instFlt, searchQ,
  onToggle, onInstFlt, onSearch, onRestore, onDelete }: any) {

  const [tree,   setTree]   = useState<any>(null)
  const [subs,   setSubs]   = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    if (!sel) { setTree(null); setSubs([]); setLoaded(true); return }
    Promise.all([treeDb.get(sel.treeId), submissionDb.getBySelection(sel.id)]).then(([t, s]) => {
      if (!cancelled) { setTree(t); setSubs(s); setLoaded(true) }
    })
    return () => { cancelled = true }
  }, [sel?.id])

  const nameMap  = tree ? buildNameMap(tree) : {}
  const leaves   = getLeavesWithPath(tree?.nodes || [])
  const totalQuota = leaves.reduce((s, { leaf }) => s + (leaf.quota || 0), 0)

  // DİQQƏT: bütün hook-lar erkən `return`-dən ƏVVƏL çağırılmalıdır,
  // yoxsa React "Rendered more hooks than during the previous render" xətası verir.
  const instUsers = sel ? allUsers.filter((u: any) => u.institution === sel.institution) : []
  const submitted = instUsers.filter((u: any) => subs.find((s: any) => s.userId === u.id))
  const placed    = instUsers.filter((u: any) => u.placedSpecialty)

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

  if (!loaded) {
    return (
      <div style={{
        background: '#fff', border: '1.5px solid var(--border)',
        borderRadius: 16, padding: '18px 22px', color: 'var(--muted)', fontSize: 13,
      }}>Yüklənir...</div>
    )
  }

  // Müəssisə adı siyahıdan götürülür (köhnə 'kollec'/'ahm' sabitləri deyil)
  const inst      = (insts || []).find((i: any) => i.id === sel.institution)
  const instColor = `${P.navyDk}`
  const instBg    = `${P.tint}`
  const instIcon  = inst?.icon
  const instLabel = inst?.label || sel.institution || '—'

  function exportExcel() {
    const data = rows.map((u: any, i: number) => ({
      '№': i + 1, 'Təhsilalan': u.name, 'FİN': u.fin || '—',
      'İş nömrəsi': u.workNumber || '—',
      'Müəssisə': (insts || []).find((i: any) => i.id === u.institution)?.label || u.institution || '—',
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
    ? formatDate(sel.archivedAt)
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
          background: `linear-gradient(135deg,${P.ink}22,#9aa0ac22)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, color: `${P.ink}`,
        }}>{String(idx + 1).padStart(2, '0')}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)' }}>{sel.name}</span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: instBg, color: instColor, border: `1px solid ${instColor}33`,
            }}><InstIcon icon={instIcon} size={11} />{instLabel}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6,
              background: '#f5f5f5', color: '#888', border: '1px solid #e8e8e8',
            }}>🗄️ Arxivləndi: {archivedDate}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>👥 {submitted.length} təhsilalan</span>
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
              { icon: '👥', label: 'Seçim edib',       val: submitted.length,               color: `${P.navy}` },
              { icon: '✅', label: 'Yerləşdirilib',     val: placed.length,                  color: '#52c41a' },
              { icon: '⏳', label: 'Yerləşdirilməyib',  val: submitted.length - placed.length, color: '#f5a623' },
              { icon: '🎓', label: 'Cəmi kvota',        val: totalQuota,                     color: `${P.navyDk}` },
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
              {(insts || []).map((i: any) => <option key={i.id} value={i.id}>{i.label}</option>)}
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
                  <th style={{ width: 40 }}>№</th>
                  <th>TƏHSİLALAN</th>
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
                  const uInst = (insts || []).find((i: any) => i.id === u.institution)
                  const instOpt = uInst
                    ? { label: uInst.label, icon: uInst.icon, color: `${P.navyDk}`, bg: `${P.tint}` }
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
                          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 12px', borderRadius: 8, background: instOpt.bg, color: instOpt.color, fontWeight: 700, fontSize: 12 }}><InstIcon icon={instOpt.icon} size={13} />{instOpt.label}</span>
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
const DEPTH_COLORS = [`${P.navy}`, `${P.navyDk}`, '#ff7c4f', '#237804', '#c41d7f', '#d48806']
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
    ? formatDate(arc.archivedAt)
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
          borderBottom: expanded ? `1.5px solid ${P.line3}` : 'none',
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
          background: '#fff', border: `1.5px solid ${P.line2}`,
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
