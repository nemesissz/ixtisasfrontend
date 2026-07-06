import { useState } from 'react'
import { treeDb, userDb, treeArchiveDb, institutionDb, useLocalState, addLog } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import InstIcon, { isImageIcon } from '../../components/InstIcon'
import InstTabs from '../../components/InstTabs'
import { can } from '../../permissions'

// ── Types ─────────────────────────────────────────────────────────────────────
type TNode = {
  id: string; name: string; quota?: number; children: TNode[];
  tiebreaker?: string[];
  groupTiebreakers?: { [group: string]: string[] }
  groups?: string[]
  quotaMode?: 'auto' | 'manual'
  mülkiQuota?: number
  liseyQuota?: number
  // Cinsə görə məhdudiyyət (yalnız leaf) — təyin olunmayıbsa məhdudiyyət yoxdur
  allowFemale?: boolean
  allowMale?: boolean
  maxFemale?: number | null
  maxMale?: number | null
}

const DEFAULT_SUBJECTS    = ['Riyaziyyat', 'Fizika', 'Dil']
function getStoredSubjects(): string[] {
  try { const s = localStorage.getItem('mmu_priority_subjects'); return s ? JSON.parse(s) : [] } catch { return [] }
}
const DEFAULT_LEVEL_NAMES = ['Qoşun növü', 'Mülki ixtisas', 'Hərbi uçot ixtisası']

// ── Prioritet modalı köməkçi: bir qrupun siyahısı ────────────────────────────
const UMUMI_KEY = 'Ümumi imtahan nəticəsi'

function SubjectList({ items, onChange, autoSubjects, autoScores }: {
  items: string[]
  onChange: (next: string[]) => void
  autoSubjects?: string[]
  autoScores?: { [subject: string]: number }
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  const RANK_COLORS = ['#c9962a', '#b8860b', '#52c41a', '#f5a623', '#ff4d4f', '#722ed1']

  function remove(i: number) { onChange(items.filter((_, idx) => idx !== i)) }
  function add(subj: string) { if (!items.includes(subj)) onChange([...items, subj]) }
  function onDragEnd() {
    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
      const a = [...items]; const [m] = a.splice(dragIdx, 1); a.splice(overIdx, 0, m)
      onChange(a)
    }
    setDragIdx(null); setOverIdx(null)
  }

  // Əlavə edilə bilən fənlər: Ümumi + autoSubjects, hələ siyahıda olmayanlar
  const available = [UMUMI_KEY, ...(autoSubjects ?? [])].filter((s, i, arr) => arr.indexOf(s) === i && !items.includes(s))

  return (
    <div>
      {/* Siyahı */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 40 }}>
        {items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '16px 0', color: '#bbb', fontSize: 12 }}>
            Hələ fən əlavə edilməyib
          </div>
        )}
        {items.map((subject, i) => {
          const isDragging = dragIdx === i
          const isOver     = overIdx === i && dragIdx !== i
          const isUmumi    = subject === UMUMI_KEY
          return (
            <div key={subject} draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnter={() => setOverIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDragEnd={onDragEnd}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 10,
                background: isDragging ? '#eef0fa' : isUmumi ? '#f0f7ff' : '#f8f9fd',
                border: isOver ? '2px dashed var(--blue)' : isUmumi ? '1.5px solid #bfdbfe' : '1.5px solid #efe1bd',
                opacity: isDragging ? 0.45 : 1, cursor: 'grab',
                transition: 'opacity .15s, border .1s', userSelect: 'none',
              }}>
              <span style={{ color: '#bbb', fontSize: 15, flexShrink: 0 }}>⠿</span>
              <span style={{
                width: 24, height: 24, borderRadius: 7, flexShrink: 0,
                background: RANK_COLORS[i] ?? '#aaa',
                color: '#fff', fontWeight: 800, fontSize: 12,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: isUmumi ? '#1d4ed8' : 'inherit' }}>
                {isUmumi ? '📊 ' : ''}{subject}
              </span>
              <button onClick={() => remove(i)} onMouseDown={e => e.stopPropagation()}
                style={{ padding: '3px 7px', borderRadius: 6, border: '1.5px solid #ffd0d0', background: '#fff5f5', color: '#ff4d4f', fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontSize: 12 }}
                title="Sil">✕</button>
            </div>
          )
        })}
      </div>

      {/* Əlavə et chipləri */}
      {available.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1.5px dashed #efe1bd' }}>
          <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Əlavə et</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {available.map(s => (
              <button key={s} onClick={() => add(s)}
                style={{
                  padding: '4px 12px', borderRadius: 20, border: s === UMUMI_KEY ? '1.5px solid #bfdbfe' : '1.5px solid #efe1bd',
                  background: s === UMUMI_KEY ? '#eff6ff' : '#f8f9fd',
                  color: s === UMUMI_KEY ? '#1d4ed8' : '#9a7b1e',
                  fontWeight: 600, fontSize: 12, cursor: 'pointer', transition: 'all .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = s === UMUMI_KEY ? '#dbeafe' : '#eef0ff' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = s === UMUMI_KEY ? '#eff6ff' : '#f8f9fd' }}
              >
                + {s === UMUMI_KEY ? '📊 ' : ''}{s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Prioritet modalı ──────────────────────────────────────────────────────────
function PriorityModal({ node, onSave, onClose, groupSubjectsMap, groupScoresMap, allSubjects }: {
  node: TNode
  onSave: (data: { tiebreaker?: string[]; groupTiebreakers?: { [g: string]: string[] } }) => void
  onClose: () => void
  groupSubjectsMap?: { [g: string]: string[] }
  groupScoresMap?: { [g: string]: { [subject: string]: number } }
  allSubjects?: string[]   // müəssisənin təhsilalanlarının faktiki fənləri (cədvəldən)
}) {
  const stored   = getStoredSubjects()
  const hasGroups = (node.groups?.length ?? 0) > 0
  const groups    = node.groups ?? []

  // Flat (qrupsuz) state — əvvəlcə saxlanmış, yoxsa CƏDVƏLDƏN avtomatik fənlər
  const [flatItems, setFlatItems] = useState<string[]>(
    node.tiebreaker?.length ? node.tiebreaker
    : (allSubjects && allSubjects.length) ? [...allSubjects]
    : stored.length ? [...stored]
    : [...DEFAULT_SUBJECTS]
  )

  // Qrupa görə state — əvvəlcə saxlanmış, yoxsa avtomatik aşkar edilmiş fənlər
  const UMUMI_OLD = 'Ümumi imtahan balı'
  const [grpItems, setGrpItems] = useState<{ [g: string]: string[] }>(() => {
    const base = node.groupTiebreakers ?? {}
    const result: { [g: string]: string[] } = {}
    groups.forEach(g => {
      let list: string[]
      if (base[g]?.length) {
        list = base[g].map(s => s === UMUMI_OLD ? UMUMI_KEY : s)
      } else if (groupSubjectsMap?.[g]?.length) {
        list = [...groupSubjectsMap[g]]
      } else {
        list = []
      }
      // "Ümumi imtahan nəticəsi" hər zaman siyahıda olsun (yoxdursa başa əlavə et)
      const hasUmumi = (groupSubjectsMap?.[g] ?? []).includes(UMUMI_KEY)
      if (hasUmumi && !list.includes(UMUMI_KEY)) {
        list = [UMUMI_KEY, ...list]
      }
      result[g] = list
    })
    return result
  })
  const [activeGrp, setActiveGrp] = useState<string>(groups[0] ?? '')

  function handleSave() {
    if (hasGroups) {
      onSave({ groupTiebreakers: grpItems })
    } else {
      onSave({ tiebreaker: flatItems })
    }
    onClose()
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">🏆 Bərabər Bal Prioriteti — {node.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Bərabər bal halında təhsilalanlar bu fənlər üzrə göstərilən sıraya görə seçiləcək.
            {hasGroups && <> Hər qrupun öz prioritet fənləri var.</>}
          </div>

          {hasGroups ? (
            <>
              {/* Qrup tabları */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
                {groups.map(g => (
                  <button key={g} onClick={() => setActiveGrp(g)}
                    style={{
                      padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      fontWeight: 700, fontSize: 13, transition: 'all .15s',
                      background: activeGrp === g ? '#c9962a' : '#f0f2fa',
                      color:      activeGrp === g ? '#fff'     : 'var(--muted)',
                      boxShadow:  activeGrp === g ? '0 2px 8px #c9962a44' : 'none',
                    }}>
                    Qrup {g}
                    {grpItems[g]?.length > 0 && (
                      <span style={{ marginLeft: 6, background: activeGrp === g ? '#ffffff33' : '#efe1bd', color: activeGrp === g ? '#fff' : '#c9962a', borderRadius: 20, padding: '1px 7px', fontSize: 11 }}>
                        {grpItems[g].length} fən
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Aktiv qrupun siyahısı */}
              {activeGrp && (
                <SubjectList
                  key={activeGrp}
                  items={grpItems[activeGrp] ?? []}
                  onChange={next => setGrpItems(prev => ({ ...prev, [activeGrp]: next }))}
                  autoSubjects={groupSubjectsMap?.[activeGrp] ?? []}
                  autoScores={groupScoresMap?.[activeGrp]}
                />
              )}
            </>
          ) : (
            <SubjectList
              items={flatItems}
              onChange={setFlatItems}
              autoSubjects={(() => {
                const subjSet = new Set<string>(allSubjects ?? [])
                Object.values(groupSubjectsMap ?? {}).forEach(arr => arr.forEach(s => subjSet.add(s)))
                return Array.from(subjSet)
              })()}
            />
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary" onClick={handleSave}>✓ Yadda Saxla</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Qrup təyinat modalı ───────────────────────────────────────────────────────
function GroupModal({ node, onSave, onClose }: {
  node: TNode
  onSave: (groups: string[]) => void
  onClose: () => void
}) {
  const allGroups = [...new Set(
    (userDb.getAll() as any[]).map((u: any) => u.group).filter(Boolean)
  )].sort() as string[]

  const [selected, setSelected] = useState<string[]>(node.groups || [])

  function toggle(g: string) {
    setSelected(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 380 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">👥 Qrup Təyinatı — {node.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Seçilmiş qruplardan olan təhsilalanlar bu ixtisası görəcək.
            Heç biri seçilməsə — bütün qruplar üçün görünür.
          </div>

          {allGroups.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--muted)', textAlign: 'center', padding: '20px 0' }}>
              Təhsilalan cədvəlində qrup məlumatı tapılmadı
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {allGroups.map(g => (
                <label key={g} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                  background: selected.includes(g) ? '#f0fff4' : '#f8f9fd',
                  border: `1.5px solid ${selected.includes(g) ? '#52c41a' : '#efe1bd'}`,
                  transition: 'all .15s',
                }}>
                  <input type="checkbox" checked={selected.includes(g)} onChange={() => toggle(g)}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#52c41a' }} />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>Qrup {g}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
                    {(userDb.getAll() as any[]).filter((u: any) => u.group === g).length} təhsilalan
                  </span>
                </label>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary" onClick={() => { onSave(selected); onClose() }}>
              ✓ Yadda Saxla
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function uid(p = 'n') { return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 5)}` }

// ── Ağac əməliyyatları (rekursiv) ─────────────────────────────────────────────
function addChild(nodes: TNode[], parentId: string, child: TNode): TNode[] {
  return nodes.map(n => n.id === parentId
    ? { ...n, children: [...(n.children || []), child] }
    : { ...n, children: addChild(n.children || [], parentId, child) }
  )
}
function updateNode(nodes: TNode[], id: string, up: Partial<TNode>): TNode[] {
  return nodes.map(n => n.id === id
    ? { ...n, ...up }
    : { ...n, children: updateNode(n.children || [], id, up) }
  )
}
function deleteNode(nodes: TNode[], id: string): TNode[] {
  return nodes.filter(n => n.id !== id).map(n => ({ ...n, children: deleteNode(n.children || [], id) }))
}
function countLeaves(nodes: TNode[]): number {
  return nodes.reduce((s, n) => s + (!n.children?.length ? 1 : countLeaves(n.children)), 0)
}
function totalQuota(nodes: TNode[]): number {
  return nodes.reduce((s, n) => s + (!n.children?.length ? (n.quota || 0) : totalQuota(n.children)), 0)
}
// Ağacın faktiki dərinliyi (səviyyə sayı)
function treeDepth(nodes: TNode[], d = 1): number {
  let max = 0
  for (const n of nodes || []) {
    max = Math.max(max, (n.children?.length ? treeDepth(n.children, d + 1) : d))
  }
  return max
}


// ── Icon picker (şəkil yükləmə) ───────────────────────────────────────────────
function IconPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isImage = value?.startsWith('data:')
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => { if (ev.target?.result) onChange(ev.target.result as string) }
    reader.readAsDataURL(file)
  }
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Logo</div>
      <label style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, padding: '20px 16px', borderRadius: 12, cursor: 'pointer',
        border: '2px dashed #c5d0ff', background: '#f4f7ff', transition: 'border-color .15s',
      }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--blue)')}
        onMouseLeave={e => (e.currentTarget.style.borderColor = '#c5d0ff')}
      >
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        <div style={{ fontSize: 28 }}>🖼️</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--blue)' }}>Şəkil seçin</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>PNG, JPG, SVG — istənilən format</div>
      </label>
      {value && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, padding: '10px 14px', background: '#f8f9fd', borderRadius: 10, border: '1.5px solid #efe1bd' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', flexShrink: 0, background: '#fff', border: '1.5px solid #efe1bd', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isImage
              ? <img src={value} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              : <span style={{ fontSize: 26 }}>{value}</span>
            }
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>Seçilmiş logo</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{isImage ? 'Yüklənmiş şəkil' : 'İkon'}</div>
          </div>
          <button type="button" onClick={() => onChange('')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#ccc', padding: 4 }}>✕</button>
        </div>
      )}
    </div>
  )
}

// ── Form modalı ───────────────────────────────────────────────────────────────
function InlineModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  )
}

// ── Təsdiq modalı ─────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="modal-overlay open" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <span style={{ fontSize: 20 }}>🗑️</span>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body" style={{ paddingTop: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', marginBottom: 8 }}>
            Silmək istəyirsiniz?
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 24, lineHeight: 1.5 }}>
            {message}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={onCancel}>Ləğv et</button>
            <button
              className="btn btn-danger"
              style={{ padding: '8px 22px' }}
              onClick={onConfirm}
            >
              Sil
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Rəng sxemi (dərinliyə görə) ───────────────────────────────────────────────
const DEPTH_COLORS = ['#c9962a', '#b8860b', '#ff7c4f', '#237804', '#c41d7f', '#d48806']
function depthColor(d: number) { return DEPTH_COLORS[Math.min(d, DEPTH_COLORS.length - 1)] }

// ── Kvota bölgüsü modalı ─────────────────────────────────────────────────────
function QuotaModeModal({ node, instUsers, onSave, onClose }: {
  node: TNode
  instUsers: any[]
  onSave: (mode: 'auto' | 'manual', mülkiQ?: number, liseyQ?: number) => void
  onClose: () => void
}) {
  const quota      = node.quota || 0
  const total      = instUsers.length || 1
  const mülkiTotal = instUsers.filter(u => u.source === 'mülki').length
  const liseyTotal = instUsers.filter(u => u.source === 'lisey').length
  const hasSrc     = mülkiTotal + liseyTotal > 0

  const autoMülki = hasSrc ? Math.round(quota * mülkiTotal / total) : Math.round(quota / 2)
  const autoLisey = quota - autoMülki

  const [mode,      setMode]      = useState<'auto' | 'manual'>(node.quotaMode || 'auto')
  const [mülkiVal,  setMülkiVal]  = useState(node.quotaMode === 'manual' && node.mülkiQuota != null ? node.mülkiQuota : autoMülki)
  const [liseyVal,  setLiseyVal]  = useState(node.quotaMode === 'manual' && node.liseyQuota != null ? node.liseyQuota : autoLisey)

  const total2  = mülkiVal + liseyVal
  const overSum = total2 > quota

  function handleMülki(v: number) {
    const n = Math.max(0, Math.min(v, quota))
    setMülkiVal(n)
    setLiseyVal(quota - n)
  }
  function handleLisey(v: number) {
    const n = Math.max(0, Math.min(v, quota))
    setLiseyVal(n)
    setMülkiVal(quota - n)
  }

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">⚖️ Kvota bölgüsü — {node.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          {/* Ümumi kvota */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: '#f4f7ff', borderRadius: 10, border: '1.5px solid #f3e3b8' }}>
            <span style={{ fontSize: 20 }}>🎯</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Ümumi kvota: <span style={{ color: 'var(--blue)' }}>{quota}</span></div>
              {hasSrc && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  Müəssisə nisbəti —{' '}
                  <span style={{ color: '#1677ff', fontWeight: 700 }}>Mülki: {mülkiTotal} ({Math.round(mülkiTotal/total*100)}%)</span>
                  {' · '}
                  <span style={{ color: '#531dab', fontWeight: 700 }}>Lisey: {liseyTotal} ({Math.round(liseyTotal/total*100)}%)</span>
                </div>
              )}
            </div>
          </div>

          {/* Rejim seçimi */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            {(['auto', 'manual'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                flex: 1, padding: '10px 0', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer',
                border: `2px solid ${mode === m ? (m === 'auto' ? '#c9962a' : '#c41d7f') : '#efe1bd'}`,
                background: mode === m ? (m === 'auto' ? '#eef1ff' : '#fff0f6') : '#fff',
                color: mode === m ? (m === 'auto' ? '#c9962a' : '#c41d7f') : '#8890b0',
                transition: 'all .15s',
              }}>
                {m === 'auto' ? '⚖️ Avtomatik (faiz nisbəti)' : '✏️ Manual (özüm təyin edim)'}
              </button>
            ))}
          </div>

          {/* Auto rejimi — göstər */}
          {mode === 'auto' && (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: '#f0f7ff', border: '1.5px solid #bfd0ff', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#3a4560', marginBottom: 10 }}>Avtomatik hesablanacaq dəyərlər:</div>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#e8f0ff', border: '1px solid #bfd0ff', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#1677ff', fontWeight: 600, marginBottom: 4 }}>Mülki</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#1677ff' }}>{autoMülki}</div>
                  <div style={{ fontSize: 10, color: '#1677ff', opacity: 0.7 }}>{quota > 0 ? Math.round(autoMülki/quota*100) : 0}%</div>
                </div>
                <div style={{ flex: 1, padding: '10px 14px', borderRadius: 8, background: '#fbf1d6', border: '1px solid #d3adf7', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#531dab', fontWeight: 600, marginBottom: 4 }}>Lisey</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: '#531dab' }}>{autoLisey}</div>
                  <div style={{ fontSize: 10, color: '#531dab', opacity: 0.7 }}>{quota > 0 ? Math.round(autoLisey/quota*100) : 0}%</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: hasSrc ? 'var(--muted)' : '#c47f0a', marginTop: 10, lineHeight: 1.5 }}>
                {hasSrc
                  ? <>Müəssisə nisbətinə görə (Mülki {Math.round(mülkiTotal/total*100)}% · Lisey {Math.round(liseyTotal/total*100)}%) hər yerləşdirmədə yenidən hesablanır.</>
                  : <>⚠️ Müəssisədə hələ mənbəli təhsilalan yoxdur — yuxarıdakı dəyərlər müvəqqəti 50/50 bölgüdür. Təhsilalanlar import ediləndən sonra real nisbətə görə hesablanacaq.</>}
              </div>
            </div>
          )}

          {/* Manual rejimi — input */}
          {mode === 'manual' && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                {/* Mülki */}
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#1677ff', display: 'block', marginBottom: 6 }}>
                    🔵 Mülki kvota
                  </label>
                  <input
                    type="number" min={0} max={quota} value={mülkiVal}
                    onChange={e => handleMülki(parseInt(e.target.value) || 0)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 15, fontWeight: 700,
                      border: '2px solid #1677ff', background: '#e8f0ff', color: '#1677ff',
                      textAlign: 'center', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#1677ff', textAlign: 'center', marginTop: 4 }}>
                    {quota > 0 ? Math.round(mülkiVal/quota*100) : 0}%
                  </div>
                </div>
                {/* Ayırıcı */}
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 20, color: 'var(--muted)', paddingTop: 20 }}>+</div>
                {/* Lisey */}
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: '#531dab', display: 'block', marginBottom: 6 }}>
                    🟣 Lisey kvota
                  </label>
                  <input
                    type="number" min={0} max={quota} value={liseyVal}
                    onChange={e => handleLisey(parseInt(e.target.value) || 0)}
                    style={{
                      width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 15, fontWeight: 700,
                      border: '2px solid #531dab', background: '#fbf1d6', color: '#531dab',
                      textAlign: 'center', boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ fontSize: 10, color: '#531dab', textAlign: 'center', marginTop: 4 }}>
                    {quota > 0 ? Math.round(liseyVal/quota*100) : 0}%
                  </div>
                </div>
                {/* Cəm */}
                <div style={{ display: 'flex', alignItems: 'center', fontSize: 20, color: 'var(--muted)', paddingTop: 20 }}>=</div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: overSum ? '#cf1322' : '#237804', display: 'block', marginBottom: 6 }}>
                    Cəm
                  </label>
                  <div style={{
                    padding: '10px 12px', borderRadius: 8, fontSize: 15, fontWeight: 800,
                    border: `2px solid ${overSum ? '#ff4d4f' : '#52c41a'}`,
                    background: overSum ? '#fff1f0' : '#f0fff4',
                    color: overSum ? '#cf1322' : '#237804',
                    textAlign: 'center',
                  }}>
                    {total2}
                  </div>
                  <div style={{ fontSize: 10, color: overSum ? '#cf1322' : '#237804', textAlign: 'center', marginTop: 4 }}>
                    {overSum ? `⚠ max ${quota}` : `/ ${quota}`}
                  </div>
                </div>
              </div>

              {/* Vizual bar */}
              <div style={{ height: 10, borderRadius: 5, background: '#f0f0f0', overflow: 'hidden', display: 'flex' }}>
                <div style={{ width: `${quota > 0 ? mülkiVal/quota*100 : 0}%`, background: 'linear-gradient(90deg,#c9962a,#69a0ff)', transition: 'width .2s' }} />
                <div style={{ width: `${quota > 0 ? liseyVal/quota*100 : 0}%`, background: 'linear-gradient(90deg,#9b59d4,#c07ef8)', transition: 'width .2s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                <span style={{ color: '#c9962a' }}>Mülki {quota > 0 ? Math.round(mülkiVal/quota*100) : 0}%</span>
                <span style={{ color: '#531dab' }}>Lisey {quota > 0 ? Math.round(liseyVal/quota*100) : 0}%</span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary"
              disabled={mode === 'manual' && overSum}
              style={{ opacity: mode === 'manual' && overSum ? 0.5 : 1 }}
              onClick={() => {
                onSave(mode, mode === 'manual' ? mülkiVal : undefined, mode === 'manual' ? liseyVal : undefined)
                onClose()
              }}>
              ✓ Yadda saxla
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Cinsə görə məhdudiyyət modalı (yalnız leaf) ──────────────────────────────
function GenderModal({ node, instUsers, onSave, onClose }: {
  node: TNode; instUsers: any[]
  onSave: (cfg: { allowFemale: boolean; allowMale: boolean; maxFemale: number | null; maxMale: number | null } | null) => void
  onClose: () => void
}) {
  const [allowF, setAllowF] = useState(node.allowFemale !== false)
  const [allowM, setAllowM] = useState(node.allowMale !== false)
  const [maxF, setMaxF] = useState<string>(node.maxFemale != null ? String(node.maxFemale) : '')
  const [maxM, setMaxM] = useState<string>(node.maxMale != null ? String(node.maxMale) : '')

  const femCount = instUsers.filter(u => u.gender === 'qadın').length
  const malCount = instUsers.filter(u => u.gender === 'kişi').length
  const quota = node.quota || 0
  const valid = allowF || allowM

  function save() {
    if (!valid) return
    onSave({
      allowFemale: allowF,
      allowMale: allowM,
      maxFemale: allowF && maxF.trim() !== '' ? Math.max(0, parseInt(maxF, 10) || 0) : null,
      maxMale:   allowM && maxM.trim() !== '' ? Math.max(0, parseInt(maxM, 10) || 0) : null,
    })
  }

  const row = (label: string, count: number, color: string, allow: boolean, setAllow: (b: boolean) => void, maxV: string, setMaxV: (s: string) => void) => (
    <div style={{ border: `1.5px solid ${allow ? color + '55' : '#eee'}`, borderRadius: 10, padding: '12px 14px', marginBottom: 12, background: allow ? color + '0d' : '#fafafa' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
        <input type="checkbox" checked={allow} onChange={e => setAllow(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer', accentColor: color }} />
        <span style={{ color: allow ? color : '#aaa' }}>{label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>müəssisədə {count} nəfər</span>
      </label>
      {allow && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 28 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Maksimum say:</span>
          <input type="number" min={0} value={maxV} placeholder="limitsiz"
            onChange={e => setMaxV(e.target.value)}
            style={{ width: 110, padding: '5px 9px', border: '1.5px solid #dde', borderRadius: 7, fontSize: 13 }} />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>boş = limit yoxdur</span>
        </div>
      )}
    </div>
  )

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">⚥ Cinsə görə məhdudiyyət — {node.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: '10px 14px', background: '#f4f7ff', borderRadius: 10, border: '1.5px solid #f3e3b8' }}>
            <span style={{ fontSize: 20 }}>🎯</span>
            <div style={{ fontWeight: 700, fontSize: 13 }}>Ümumi kvota: <span style={{ color: 'var(--blue)' }}>{quota}</span></div>
          </div>

          {row('Qadın daxil ola bilər', femCount, '#c41d7f', allowF, setAllowF, maxF, setMaxF)}
          {row('Kişi daxil ola bilər',  malCount, '#0958d9', allowM, setAllowM, maxM, setMaxM)}

          {!valid && (
            <div style={{ fontSize: 12, color: '#cf1322', fontWeight: 600, marginBottom: 8 }}>
              ⚠ Ən azı bir cins seçilməlidir.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={save} disabled={!valid}
              style={{ flex: 1, padding: '10px', borderRadius: 9, border: 'none', background: valid ? 'linear-gradient(135deg,#c9962a,#b8860b)' : '#ccc', color: '#fff', fontWeight: 700, fontSize: 13, cursor: valid ? 'pointer' : 'not-allowed' }}>
              Yadda saxla
            </button>
            <button onClick={() => onSave(null)}
              title="Məhdudiyyəti sil (hər ikisi sərbəst)"
              style={{ padding: '10px 14px', borderRadius: 9, border: '1.5px solid #ffccc7', background: '#fff1f0', color: '#cf1322', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Sıfırla
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tək node sətiri (rekursiv render, açıb-bağlanan) ─────────────────────────
function NodeRow({ node, depth, onAdd, onEdit, onDelete, onPriority, onDeactivatePriority, onGroup, onDeactivateGroup, sourceProportional, instUsers, onQuotaMode, levelNames, hasGender, onGenderConfig }: {
  node: TNode; depth: number
  onAdd: (parentId: string, childDepth: number) => void
  levelNames: string[]
  onEdit: (node: TNode) => void
  onDelete: (id: string) => void
  onPriority: (node: TNode) => void
  onDeactivatePriority: (nodeId: string) => void
  onGroup: (node: TNode) => void
  onDeactivateGroup: (nodeId: string) => void
  sourceProportional?: boolean
  instUsers?: any[]
  onQuotaMode?: (nodeId: string, mode: 'auto' | 'manual', mülkiQ?: number, liseyQ?: number) => void
  hasGender?: boolean
  onGenderConfig?: (nodeId: string, cfg: { allowFemale: boolean; allowMale: boolean; maxFemale: number | null; maxMale: number | null } | null) => void
}) {
  const [open,        setOpen]        = useState(false)
  const [quotaModal,  setQuotaModal]  = useState(false)
  const [genderModal, setGenderModal] = useState(false)
  const isLeaf    = !node.children?.length
  const color     = depthColor(depth)
  const bgDefault = depth === 0 ? '#f6f8ff' : depth === 1 ? '#fafbff' : '#fff'

  return (
    <>
      <div className="spec-node-row" style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: `8px 14px 8px ${14 + depth * 26}px`,
        borderLeft: depth > 0 ? `2px solid ${color}33` : 'none',
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
        {/* Chevron (qruplar üçün) */}
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

        {/* Ad */}
        <div style={{ flex: 1, fontSize: 13, fontWeight: depth === 0 ? 700 : depth === 1 ? 600 : 500, color: depth === 0 ? color : 'var(--text)', lineHeight: 1.3 }}>
          {node.name}
          {isLeaf && node.quota != null && (
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>
              kvota: {node.quota}
            </span>
          )}
          {/* ── Proporsional kvota badge (yalnız leaf + sourceProportional aktiv) ── */}
          {isLeaf && sourceProportional && (
            <button
              onClick={e => { e.stopPropagation(); setQuotaModal(true) }}
              style={{
                marginLeft: 8,
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700,
                cursor: 'pointer', border: 'none',
                background: node.quotaMode === 'manual'
                  ? 'linear-gradient(135deg,#fff0f6,#fce8ff)'
                  : 'linear-gradient(135deg,#eef1ff,#e8f0ff)',
                color: node.quotaMode === 'manual' ? '#c41d7f' : '#c9962a',
                boxShadow: '0 1px 4px #0001',
              }}
              title="Kvota bölgüsünü düzəlt"
            >
              {node.quotaMode === 'manual'
                ? <>✏️ M:{node.mülkiQuota ?? '?'} · L:{node.liseyQuota ?? '?'}</>
                : <>⚖️ Avtomatik</>
              }
            </button>
          )}
          {!isLeaf && (() => {
            const subLeaves = countLeaves(node.children)
            const subQuota  = totalQuota(node.children)
            return (
              <span style={{ marginLeft: 10, fontSize: 11, color: 'var(--muted)', fontWeight: 400, display: 'inline-flex', gap: 10 }}>
                <span style={{ color: '#237804' }}>kvota: <b>{subQuota}</b></span>
                <span>·</span>
                <span>{subLeaves} ixtisas</span>
              </span>
            )
          })()}
        </div>

        {/* Tip etiketi */}
        <span className="spec-type-badge" style={{
          fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600, whiteSpace: 'nowrap',
          background: depth === 0 ? '#fff4e6' : depth === 1 ? '#f0f4ff' : '#f0fff4',
          color:      depth === 0 ? '#d46b08' : depth === 1 ? color       : '#237804',
        }}>
          {depth === 0
            ? `⚔️ ${levelNames[0]} · ${node.children.length}`
            : depth === 1
            ? (isLeaf ? `📚 ${levelNames[1]}` : `📚 ${levelNames[1]} · ${node.children.length}`)
            : `🎓 ${levelNames[2] ?? DEFAULT_LEVEL_NAMES[2]}`}
        </span>

        {/* Əməliyyatlar — yalnız tree.edit icazəsi ilə */}
        {can('tree.edit') && (
        <div className="spec-node-actions" style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => onPriority(node)}
              style={{
                fontSize: 11, padding: '2px 10px',
                borderRadius: (node.tiebreaker || node.groupTiebreakers) ? '6px 0 0 6px' : '6px',
                border: `1.5px solid ${(node.tiebreaker || node.groupTiebreakers) ? '#f5a623' : '#dde'}`,
                background: (node.tiebreaker || node.groupTiebreakers) ? '#fffbe6' : '#f8f9fd',
                color: (node.tiebreaker || node.groupTiebreakers) ? '#d46b08' : '#bbb',
                fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
              }}
              title={(node.tiebreaker || node.groupTiebreakers) ? 'Prioriteti düzəlt' : 'Prioritet təyin et'}>
              🏆 <span className="spec-btn-label">
                {node.groupTiebreakers
                  ? `Prioritet (${Object.keys(node.groupTiebreakers).length} qrup) ✓`
                  : node.tiebreaker ? 'Prioritet ✓' : 'Prioritet'}
              </span>
            </button>
            {(node.tiebreaker || node.groupTiebreakers) && (
              <button
                onClick={() => onDeactivatePriority(node.id)}
                style={{
                  fontSize: 11, padding: '2px 7px', borderRadius: '0 6px 6px 0',
                  border: '1.5px solid #f5a623', borderLeft: 'none',
                  background: '#fff1e6', color: '#d46b08',
                  fontWeight: 700, cursor: 'pointer',
                }}
                title="Prioriteti deaktiv et">
                ✕
              </button>
            )}
          </div>
          {/* Qrup düyməsi */}
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => onGroup(node)}
              style={{
                fontSize: 11, padding: '2px 10px',
                borderRadius: node.groups?.length ? '6px 0 0 6px' : '6px',
                border: `1.5px solid ${node.groups?.length ? '#52c41a' : '#dde'}`,
                background: node.groups?.length ? '#f0fff4' : '#f8f9fd',
                color: node.groups?.length ? '#237804' : '#bbb',
                fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
              }}
              title={node.groups?.length ? 'Qrupları düzəlt' : 'Qrup təyin et'}>
              👥 <span className="spec-btn-label">{node.groups?.length ? `Q:${node.groups.join(',')} ✓` : 'Qrup'}</span>
            </button>
            {!!node.groups?.length && (
              <button
                onClick={() => onDeactivateGroup(node.id)}
                style={{
                  fontSize: 11, padding: '2px 7px', borderRadius: '0 6px 6px 0',
                  border: '1.5px solid #52c41a', borderLeft: 'none',
                  background: '#f0fff4', color: '#237804',
                  fontWeight: 700, cursor: 'pointer',
                }}
                title="Qrup təyinatını sil">✕</button>
            )}
          </div>

          {/* Cins məhdudiyyəti düyməsi — yalnız leaf + datada cins varsa */}
          {hasGender && isLeaf && (() => {
            const restricted = node.allowFemale === false || node.allowMale === false || node.maxFemale != null || node.maxMale != null
            return (
              <button
                onClick={() => setGenderModal(true)}
                style={{
                  fontSize: 11, padding: '2px 10px', borderRadius: 6,
                  border: `1.5px solid ${restricted ? '#c41d7f' : '#dde'}`,
                  background: restricted ? '#fff0f6' : '#f8f9fd',
                  color: restricted ? '#c41d7f' : '#bbb',
                  fontWeight: 700, cursor: 'pointer', transition: 'all .15s', whiteSpace: 'nowrap',
                }}
                title="Cinsə görə məhdudiyyət">
                ⚥ <span className="spec-btn-label">{restricted
                  ? `${node.allowFemale === false ? 'K' : node.allowMale === false ? 'Q' : 'Q+K'}${(node.maxFemale != null || node.maxMale != null) ? ` (${node.maxFemale != null ? 'Q≤'+node.maxFemale : ''}${node.maxFemale != null && node.maxMale != null ? ',' : ''}${node.maxMale != null ? 'K≤'+node.maxMale : ''})` : ''} ✓`
                  : 'Cins'}</span>
              </button>
            )
          })()}

          <button className="icon-btn ib-add" style={{ fontSize: 11, padding: '2px 9px' }}
            onClick={() => onAdd(node.id, depth + 1)}
            title="Alt element əlavə et">
            + <span className="spec-btn-label">{levelNames[depth + 1] ?? 'Alt'}</span>
          </button>
          <button className="icon-btn ib-edit" onClick={() => onEdit(node)}>✏️</button>
          <button className="icon-btn ib-del"  onClick={() => onDelete(node.id)}>🗑</button>
        </div>
        )}
      </div>

      {/* ── Kvota bölgüsü modalı ── */}
      {quotaModal && isLeaf && (
        <QuotaModeModal
          node={node}
          instUsers={instUsers || []}
          onClose={() => setQuotaModal(false)}
          onSave={(mode, mülkiQ, liseyQ) => onQuotaMode?.(node.id, mode, mülkiQ, liseyQ)}
        />
      )}

      {/* ── Cinsə görə məhdudiyyət modalı ── */}
      {genderModal && isLeaf && (
        <GenderModal
          node={node}
          instUsers={instUsers || []}
          onClose={() => setGenderModal(false)}
          onSave={cfg => { onGenderConfig?.(node.id, cfg); setGenderModal(false) }}
        />
      )}

      {/* Uşaqlar — yalnız açıq olduqda */}
      {open && (node.children || []).map(child => (
        <NodeRow key={child.id} node={child} depth={depth + 1}
          onAdd={onAdd} onEdit={onEdit} onDelete={onDelete}
          onPriority={onPriority} onDeactivatePriority={onDeactivatePriority}
          onGroup={onGroup} onDeactivateGroup={onDeactivateGroup}
          sourceProportional={sourceProportional}
          instUsers={instUsers}
          onQuotaMode={onQuotaMode}
          levelNames={levelNames}
          hasGender={hasGender}
          onGenderConfig={onGenderConfig}
        />
      ))}
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════════
export default function Specialties() {
  const [trees, refreshTrees]   = useLocalState(treeDb.getAll)
  const [insts]                 = useLocalState(institutionDb.getAll)
  const [tab, setTab]           = useState<string>('')

  // Tədris ili seçimləri — cari ildən başlayaraq 5 il
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 6 }, (_, i) => {
    const y = currentYear - 1 + i
    return `${y}–${y + 1}`
  })
  const [openTreeId, setOpenTreeId] = useState<string | null>(null)
  const [modal, setModal] = useState<any>(null)
  const { dialog: appDialog, showConfirm: showAppConfirm, closeDialog } = useDialog()
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [priorityNode, setPriorityNode] = useState<{ treeId: string; node: TNode } | null>(null)
  const [groupNode,    setGroupNode]    = useState<{ treeId: string; node: TNode } | null>(null)

  function askConfirm(message: string, onConfirm: () => void) {
    setConfirm({ message, onConfirm })
  }

  function getTree(id: string) { return (trees as any[]).find((t: any) => t.id === id) }
  function toggle(id: string)  { setOpenTreeId(prev => prev === id ? null : id) }

  function handleSavePriority(data: { tiebreaker?: string[]; groupTiebreakers?: { [g: string]: string[] } }) {
    if (!priorityNode) return
    const { treeId, node } = priorityNode
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], node.id, {
      tiebreaker: data.tiebreaker,
      groupTiebreakers: data.groupTiebreakers,
    }))
    addLog('admin', 'info', `Prioritet (tiebreaker) təyin edildi: "${node.name}"`,
      data.groupTiebreakers ? `${Object.keys(data.groupTiebreakers).length} qrup üzrə` : (data.tiebreaker?.join(', ') || '—'))
    setPriorityNode(null)
  }

  function handleDeactivatePriority(treeId: string, nodeId: string) {
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], nodeId, { tiebreaker: undefined, groupTiebreakers: undefined }))
    addLog('admin', 'info', `Prioritet deaktiv edildi`, `Struktur: ${t?.name} · nodeId: ${nodeId}`)
  }

  function handleSaveGroups(groups: string[]) {
    if (!groupNode) return
    const { treeId, node } = groupNode
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], node.id, { groups: groups.length ? groups : undefined }))
    addLog('admin', 'info', `Qrup təyinatı yeniləndi: "${node.name}"`, groups.length ? `Qruplar: ${groups.join(', ')}` : 'Qrup silindi')
    setGroupNode(null)
  }

  function handleDeactivateGroup(treeId: string, nodeId: string) {
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], nodeId, { groups: undefined }))
    addLog('admin', 'info', `Qrup təyinatı silindi`, `Struktur: ${t?.name} · nodeId: ${nodeId}`)
  }

  function handleQuotaMode(treeId: string, nodeId: string, mode: 'auto' | 'manual', mülkiQ?: number, liseyQ?: number) {
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], nodeId, {
      quotaMode: mode,
      mülkiQuota: mode === 'manual' ? mülkiQ : undefined,
      liseyQuota: mode === 'manual' ? liseyQ : undefined,
    }))
    addLog('admin', 'info',
      `İxtisas kvota rejimi: ${mode === 'manual' ? 'Manual' : 'Avtomatik'} — ${nodeId}`,
      mode === 'manual' ? `Mülki: ${mülkiQ} · Lisey: ${liseyQ}` : 'Faiz nisbətinə görə')
  }

  function handleGenderConfig(treeId: string, nodeId: string, cfg: { allowFemale: boolean; allowMale: boolean; maxFemale: number | null; maxMale: number | null } | null) {
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], nodeId, cfg
      ? { allowFemale: cfg.allowFemale, allowMale: cfg.allowMale, maxFemale: cfg.maxFemale, maxMale: cfg.maxMale }
      : { allowFemale: undefined, allowMale: undefined, maxFemale: undefined, maxMale: undefined }))
    addLog('admin', 'info', `İxtisas cins məhdudiyyəti — ${nodeId}`,
      cfg ? `Qadın: ${cfg.allowFemale ? 'bəli' : 'xeyr'}${cfg.maxFemale != null ? ' (max '+cfg.maxFemale+')' : ''} · Kişi: ${cfg.allowMale ? 'bəli' : 'xeyr'}${cfg.maxMale != null ? ' (max '+cfg.maxMale+')' : ''}` : 'Məhdudiyyət silindi')
  }

  // ── Müəssisənin təhsilalanlarından ən çox rast gəlinən tədris ilini tap ──────
  function getInstYear(instId: string): string {
    const us = (userDb.getAll() as any[]).filter((u: any) => u.institution === instId && u.year)
    if (us.length) {
      const counts: Record<string, number> = {}
      for (const u of us) counts[u.year] = (counts[u.year] || 0) + 1
      return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
    }
    // Təhsilalan yoxdursa, müəssisənin öz tədris ilini götür
    const inst = (insts as any[]).find((i: any) => i.id === instId)
    return inst?.year || ''
  }

  // ── Struktur CRUD ─────────────────────────────────────────────────────────
  function createTree() {
    const instId = modal.instId || (tab || (insts as any[])[0]?.id || '')
    const inst   = (insts as any[]).find((i: any) => i.id === instId)
    const label  = modal.instLabel || inst?.label || ''
    const extra  = (modal.name || '').trim()
    const name   = [label, extra].filter(Boolean).join(' - ').trim()
    if (!instId || !name) return
    const created = treeDb.create({ name, year: modal.year?.trim() || '', icon: modal.icon || inst?.icon || '', institution: instId, levelNames: [...DEFAULT_LEVEL_NAMES] })
    addLog('admin', 'success', `Yeni ixtisas strukturu yaradıldı: "${name}"`, `İl: ${modal.year?.trim() || '—'} · Müəssisə: ${inst?.label || '—'}`)
    refreshTrees(); setOpenTreeId(created.id); setModal(null)
  }

  function renameTree(treeId: string) {
    const t = getTree(treeId)
    const instId = modal.instId || t?.institution || ''
    const inst   = (insts as any[]).find((i: any) => i.id === instId)
    const name   = (modal.name || modal.instLabel || inst?.label || t?.name || '').trim()
    if (!name) return
    const cleanedLevels = Array.isArray(modal.levelNames) && modal.levelNames.length
      ? modal.levelNames.map((v: string, i: number) => (v || '').trim() || DEFAULT_LEVEL_NAMES[i] || `Səviyyə ${i + 1}`)
      : (t?.levelNames || [...DEFAULT_LEVEL_NAMES])
    treeDb.update(treeId, { ...t, name, year: modal.year?.trim() || '', icon: modal.icon ?? t.icon ?? '', institution: instId || t.institution || '', levelNames: cleanedLevels })
    addLog('admin', 'info', `İxtisas strukturu yeniləndi: "${name}"`, `Səviyyələr: ${cleanedLevels.join(' › ')}`)
    refreshTrees(); setModal(null)
  }

  function deleteTree(id: string) {
    const t = getTree(id)
    askConfirm('Bu struktur və içindəki bütün ixtisaslar silinəcək. Bu əməliyyat geri alına bilməz.', () => {
      const updated = (trees as any[]).filter((t: any) => t.id !== id)
      localStorage.setItem('mmu_specialty_trees', JSON.stringify(updated))
      if (openTreeId === id) setOpenTreeId(null)
      addLog('admin', 'warning', `İxtisas strukturu silindi: "${t?.name || id}"`, 'Bütün ixtisaslar da silindi')
      refreshTrees()
      setConfirm(null)
    })
  }

  // ── Node CRUD (rekursiv) ──────────────────────────────────────────────────
  function saveNodes(treeId: string, nodes: TNode[]) {
    const t = getTree(treeId)
    treeDb.update(treeId, { ...t, nodes })
    refreshTrees()
  }

  function handleAddChild(treeId: string, parentId: string | null) {
    const name = modal.name?.trim(); if (!name) return
    const quota = modal.quota !== '' && modal.quota != null ? Number(modal.quota) : undefined
    const child: TNode = { id: uid('n'), name, quota, children: [] }
    const t = getTree(treeId)
    const newNodes = parentId === null
      ? [...(t.nodes || []), child]
      : addChild(t.nodes || [], parentId, child)
    // Əgər bu depth üçün ilk dəfə level adı təyin edilirdisə — yadda saxla
    const depth = modal.depth ?? 0
    const levelName = modal.levelName?.trim()
    if (levelName) {
      const existing: string[] = t.levelNames ? [...t.levelNames] : []
      existing[depth] = levelName
      treeDb.update(treeId, { ...t, nodes: newNodes, levelNames: existing })
      refreshTrees()
    } else {
      saveNodes(treeId, newNodes)
    }
    addLog('admin', 'success', `Yeni node əlavə edildi: "${name}"`, `Struktur: ${t?.name}${quota !== undefined ? ` · Kvota: ${quota}` : ''}`)
    setModal(null)
  }

  function handleEditNode(treeId: string, nodeId: string) {
    const name = modal.name?.trim(); if (!name) return
    const quota = modal.quota !== '' && modal.quota != null ? Number(modal.quota) : undefined
    const t = getTree(treeId)
    saveNodes(treeId, updateNode(t.nodes || [], nodeId, { name, quota }))
    addLog('admin', 'info', `Node yeniləndi: "${name}"`, `Struktur: ${t?.name}${quota !== undefined ? ` · Kvota: ${quota}` : ''}`)
    setModal(null)
  }

  function handleDeleteNode(treeId: string, nodeId: string) {
    const t = getTree(treeId)
    askConfirm('Bu element və bütün alt elementləri silinəcək. Bu əməliyyat geri alına bilməz.', () => {
      saveNodes(treeId, deleteNode(t.nodes || [], nodeId))
      addLog('admin', 'warning', `Node silindi`, `Struktur: ${t?.name} · nodeId: ${nodeId}`)
      setConfirm(null)
    })
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function handleModalSubmit() {
    const { type, treeId, parentId, nodeId } = modal || {}
    if (type === 'createTree')  createTree()
    if (type === 'renameTree')  renameTree(treeId)
    if (type === 'addNode')     handleAddChild(treeId, parentId ?? null)
    if (type === 'editNode')    handleEditNode(treeId, nodeId)
  }

  const MODAL_TITLES: Record<string, string> = {
    createTree: 'Yeni İxtisas Strukturu Yarat', renameTree: 'İxtisas Strukturunu Düzəlt',
    addNode: (() => {
      const tree = (trees as any[]).find((t: any) => t.id === modal?.treeId)
      const lv = tree?.levelNames ?? DEFAULT_LEVEL_NAMES
      const d = modal?.depth ?? 0
      return `${lv[d] ?? 'Element'} əlavə et`
    })(),
    editNode: 'Elementi Düzəlt',
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Prioritet modalı ── */}
      {appDialog && <AppDialog cfg={appDialog} onClose={closeDialog} />}

      {priorityNode && (() => {
        const tree = getTree(priorityNode.treeId)
        const instId = tree?.institution || ''
        const allUsers = (userDb.getAll() as any[]).filter((u: any) => u.institution === instId)
        // Müəssisənin BÜTÜN təhsilalanlarının faktiki fənləri (cədvəldən avtomatik)
        const instSubjSet = new Set<string>()
        allUsers.forEach((u: any) => {
          if (u.subjects) Object.entries(u.subjects).forEach(([k, v]) => { if (v != null) instSubjSet.add(k) })
        })
        const instSubjects = Array.from(instSubjSet)
        const gsMap: { [g: string]: string[] } = {}
        const gsScores: { [g: string]: { [subject: string]: number } } = {}
        for (const g of (priorityNode.node.groups ?? [])) {
          const gUsers = allUsers.filter((u: any) => String(u.group) === String(g))
          const subjSet = new Set<string>()
          const subjSums: { [s: string]: number } = {}
          const subjCounts: { [s: string]: number } = {}
          gUsers.forEach((u: any) => {
            if (u.subjects) Object.entries(u.subjects).forEach(([k, v]) => {
              if (v != null) {
                subjSet.add(k)
                subjSums[k] = (subjSums[k] ?? 0) + Number(v)
                subjCounts[k] = (subjCounts[k] ?? 0) + 1
              }
            })
            // Ümumi imtahan nəticəsi
            if (u.score != null && !isNaN(Number(u.score))) {
              const KEY = 'Ümumi imtahan nəticəsi'
              subjSums[KEY] = (subjSums[KEY] ?? 0) + Number(u.score)
              subjCounts[KEY] = (subjCounts[KEY] ?? 0) + 1
            }
          })
          // Ümumi imtahan nəticəsinı siyahının başına əlavə et
          const KEY = 'Ümumi imtahan nəticəsi'
          if (subjCounts[KEY]) subjSet.add(KEY)
          gsMap[g] = [KEY, ...Array.from(subjSet).filter(k => k !== KEY)]
          gsScores[g] = {}
          Array.from(subjSet).forEach(k => { gsScores[g][k] = subjSums[k] / subjCounts[k] })
        }
        return (
          <PriorityModal
            node={priorityNode.node}
            onSave={handleSavePriority}
            onClose={() => setPriorityNode(null)}
            groupSubjectsMap={gsMap}
            groupScoresMap={gsScores}
            allSubjects={instSubjects}
          />
        )
      })()}

      {/* ── Qrup modalı ── */}
      {groupNode && (
        <GroupModal
          node={groupNode.node}
          onSave={handleSaveGroups}
          onClose={() => setGroupNode(null)}
        />
      )}

      {/* ── Təsdiq modalı ── */}
      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* ── Form modalı ── */}
      {modal && (
        <InlineModal title={MODAL_TITLES[modal.type]} onClose={() => setModal(null)}>

          {/* Node modalı: bu depth-də heç element yoxdursa səviyyə adı soruşulur (yuxarıda) */}
          {modal.type === 'addNode' && (() => {
            const depth = modal.depth ?? 0
            const tree = (trees as any[]).find((t: any) => t.id === modal.treeId)
            const countAtDepth = (nodes: any[], d: number): number => {
              if (!nodes?.length) return 0
              if (d === 0) return nodes.length
              return nodes.reduce((s: number, n: any) => s + countAtDepth(n.children || [], d - 1), 0)
            }
            const hasNodesAtDepth = countAtDepth(tree?.nodes || [], depth) > 0
            const existingName = tree?.levelNames?.[depth]
            if (existingName && hasNodesAtDepth) return null
            return (
              <div className="form-group" style={{ background: '#f4f7ff', borderRadius: 8, padding: '10px 12px', border: '1.5px solid #d0d8ff' }}>
                <label className="form-label" style={{ color: 'var(--blue)', marginBottom: 4 }}>
                  Bu səviyyənin adı <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(digər elementlərə də tətbiq olunacaq)</span>
                </label>
                <input
                  className="form-input"
                  placeholder={existingName || DEFAULT_LEVEL_NAMES[depth] || 'Səviyyə adı'}
                  value={modal.levelName || ''}
                  onChange={e => setModal((m: any) => ({ ...m, levelName: e.target.value }))}
                />
              </div>
            )
          })()}

          {/* Struktur modalı: müəssisə (sabit — aktiv tabdan) */}
          {(modal.type === 'createTree' || modal.type === 'renameTree') ? (
            <div className="form-group">
              <label className="form-label">Müəssisə</label>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '11px 14px', borderRadius: 10,
                background: '#fbf1d6', border: '1.5px solid #c5d0ff',
                fontWeight: 700, fontSize: 14, color: '#c9962a',
              }}>
                {(() => {
                  const inst = (insts as any[]).find((i: any) => i.id === modal.instId)
                  return <><InstIcon icon={inst?.icon} size={18} /> {modal.instLabel || inst?.label || '—'}</>
                })()}
              </div>
              {/* Əlavə ad — müəssisə adından sonra əlavə olunur */}
              <label className="form-label" style={{ marginTop: 12 }}>Ad (müəssisə adından sonra əlavə olunur)</label>
              <input className="form-input" autoFocus placeholder="Məs: 2031 Buraxılış"
                value={modal.name || ''}
                onChange={e => setModal((m: any) => ({ ...m, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()} />
              {(() => {
                const final = [modal.instLabel || '', (modal.name || '').trim()].filter(Boolean).join(' - ')
                return <div style={{ fontSize: 11, marginTop: 6, color: 'var(--blue)' }}>Tam ad: <b>{final || '—'}</b></div>
              })()}
            </div>
          ) : (
            <div className="form-group">
              <label className="form-label">Ad *</label>
              <input className="form-input" autoFocus placeholder="Ad daxil edin"
                value={modal.name || ''}
                onChange={e => setModal((m: any) => ({ ...m, name: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleModalSubmit()} />
            </div>
          )}

          {/* Struktur modalı: il + logo */}
          {(modal.type === 'createTree' || modal.type === 'renameTree') && (
            <>
              <div className="form-group">
                <label className="form-label">Tədris İli</label>
                {modal.year ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '11px 14px', borderRadius: 10,
                    background: '#f0fff4', border: '1.5px solid #b7eb8f',
                    fontWeight: 700, fontSize: 14, color: '#237804',
                  }}>
                    📅 {modal.year}
                  </div>
                ) : (
                  <div style={{
                    padding: '11px 14px', borderRadius: 10,
                    background: '#fff8e6', border: '1.5px solid #ffd591',
                    fontSize: 13, color: '#d46b08',
                  }}>
                    ⚠️ Bu müəssisədə tədris ili olan təhsilalan tapılmadı
                  </div>
                )}
              </div>
            </>
          )}

          {/* Struktur modalı: səviyyə adları (yalnız redaktədə) */}
          {modal.type === 'renameTree' && Array.isArray(modal.levelNames) && (
            <div className="form-group">
              <label className="form-label">🏷️ Səviyyə adları</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {modal.levelNames.map((v: string, i: number) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#8890b0', width: 66, flexShrink: 0 }}>Səviyyə {i + 1}</span>
                    <input className="form-input" style={{ flex: 1 }}
                      value={v}
                      placeholder={DEFAULT_LEVEL_NAMES[i] || `Səviyyə ${i + 1}`}
                      onChange={e => setModal((m: any) => ({ ...m, levelNames: m.levelNames.map((x: string, j: number) => j === i ? e.target.value : x) }))} />
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, marginTop: 6, color: 'var(--muted)' }}>
                Bu adlar cədvəl başlıqlarında, çap vərəqlərində və statistikalarda istifadə olunur.
              </div>
            </div>
          )}

          {/* Node modalı: kvota (ixtisas üçün) */}
          {(modal.type === 'addNode' || modal.type === 'editNode') && (
            <div className="form-group">
              <label className="form-label">Kvota <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(hərbi uçot ixtisası üçün, digərləri üçün boş buraxın)</span></label>
              <input className="form-input" type="number" min="0" placeholder="—"
                value={modal.quota ?? ''}
                onChange={e => setModal((m: any) => ({ ...m, quota: e.target.value }))} />
            </div>
          )}

          <div className="modal-foot" style={{ padding: 0, marginTop: 8, borderTop: 'none' }}>
            <button className="btn btn-outline" onClick={() => setModal(null)}>Ləğv et</button>
            <button className="btn btn-primary" onClick={handleModalSubmit}>Yadda Saxla</button>
          </div>
        </InlineModal>
      )}

      {/* ── Müəssisə tabları + Yeni struktur düyməsi ── */}
      <InstTabs
        insts={insts as any[]}
        activeId={tab || (insts as any[])[0]?.id || ''}
        onSelect={(id) => setTab(id)}
        trailing={can('tree.edit') ? (
          <button
            onClick={() => {
              const activeId = tab || (insts as any[])[0]?.id || ''
              const activeInst = (insts as any[]).find((i: any) => i.id === activeId)
              setModal({ type: 'createTree', name: '', instId: activeInst?.id || '', instLabel: activeInst?.label || '', year: getInstYear(activeId), icon: '' })
            }}
            style={{
              padding: '10px 18px', borderRadius: 10, border: '1.5px dashed #c5d0ff', height: 42,
              background: '#f8f9ff', color: 'var(--blue)', fontWeight: 700, fontSize: 13,
              cursor: 'pointer', transition: 'all .15s',
            }}
            onMouseEnter={e => { (e.currentTarget.style.background = '#eef1ff'); (e.currentTarget.style.borderColor = 'var(--blue)') }}
            onMouseLeave={e => { (e.currentTarget.style.background = '#f8f9ff'); (e.currentTarget.style.borderColor = '#c5d0ff') }}
          >
            + Yeni İxtisas Strukturu
          </button>
        ) : undefined}
      />

      {/* ── Kart siyahısı ── */}
      {(() => {
        const activeTab = tab || (insts as any[])[0]?.id || ''
        const firstInstId = (insts as any[])[0]?.id || ''
        const visibleTrees = (trees as any[]).filter((t: any) => {
          if (t.institution) return t.institution === activeTab
          // Köhnə strukturlar (institution sahəsi olmayan) birinci tabda göstərilir
          return activeTab === firstInstId
        })

        return visibleTrees.length === 0 ? (
        <div className="card">
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏛️</div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Hələ struktur yoxdur</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Yeni struktur yaradın və ixtisasları əlavə edin</div>
            {can('tree.edit') && (
            <button className="btn btn-primary" onClick={() => {
              const activeId = tab || (insts as any[])[0]?.id || ''
              const ai = (insts as any[]).find((i: any) => i.id === activeId)
              setModal({ type: 'createTree', name: '', instId: ai?.id || '', instLabel: ai?.label || '', year: getInstYear(activeId), icon: '' })
            }}>
              + İlk Strukturu Yarat
            </button>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibleTrees.map((t: any) => {
            const isOpen    = openTreeId === t.id
            const leaves    = countLeaves(t.nodes || [])
            const quota     = totalQuota(t.nodes || [])
            const rootCount = (t.nodes || []).length
            // Orta səviyyə (mülki ixtisas) sayı — root-ların birbaşa övladları
            const midCount  = (t.nodes || []).reduce((s: number, n: any) => s + (n.children?.length || 0), 0)
            const lvN       = t.levelNames?.length ? t.levelNames : DEFAULT_LEVEL_NAMES
            const isImage   = t.icon?.startsWith('data:')

            return (
              <div key={t.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>

                {/* ── Başlıq sətiri ── */}
                <div
                  className="spec-tree-head"
                  onClick={() => toggle(t.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 14,
                    padding: '15px 20px', cursor: 'pointer', userSelect: 'none',
                    background: isOpen ? '#f4f7ff' : '#fff',
                    borderBottom: isOpen ? '1.5px solid #f3e3b8' : 'none',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fff' }}
                >
                  {/* Chevron */}
                  <div style={{
                    width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                    background: isOpen ? 'var(--blue)' : '#eef0fa',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, color: isOpen ? '#fff' : 'var(--muted)', transition: 'all .15s',
                  }}>
                    {isOpen ? '▾' : '▸'}
                  </div>

                  {/* Logo */}
                  <div style={{
                    width: 42, height: 42, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
                    background: '#fff', border: '1.5px solid #efe1bd',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, transition: 'all .15s',
                  }}>
                    {t.icon
                      ? (isImage ? <img src={t.icon} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span>{t.icon}</span>)
                      : <span>🏛️</span>
                    }
                  </div>

                  {/* Ad + il */}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: isOpen ? 'var(--blue)' : 'var(--text)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {t.name}
                      {t.year && (
                        <span style={{
                          fontSize: 11, fontWeight: 800,
                          color: isOpen ? '#c9962a' : '#9a7b1e',
                          background: isOpen
                            ? 'linear-gradient(145deg,#e8eeff,#d4dcff)'
                            : 'linear-gradient(145deg,#f0f3ff,#e4eaff)',
                          borderRadius: 8,
                          padding: '3px 10px',
                          boxShadow: '3px 3px 6px #c0cae8, -2px -2px 5px #ffffff, inset 0 1px 0 #fff',
                          border: '1px solid #d0d8f8',
                          letterSpacing: 0.3,
                        }}>
                          📅 {t.year}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {rootCount} {lvN[0] || 'qoşun növü'}
                      {midCount > 0 && ` · ${midCount} ${lvN[1] || 'mülki ixtisas'}`}
                      {` · ${leaves} ${lvN[2] || 'hərbi uçot ixtisası'} · Ümumi kvota: ${quota}`}
                    </div>
                  </div>

                  {/* Düymələr */}
                  <div className="spec-tree-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

                    {/* ── Proporsional bölgü toggle ── */}
                    <div
                      onClick={() => {
                        const next = !t.sourceProportional
                        treeDb.update(t.id, { sourceProportional: next })
                        refreshTrees()
                        addLog('admin', next ? 'success' : 'info',
                          `Proporsional bölgü ${next ? 'aktivləşdirildi' : 'deaktivləşdirildi'}: "${t.name}"`)
                      }}
                      title={t.sourceProportional ? 'Proporsional bölgü aktiv' : 'Proporsional bölgü deaktiv'}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                        border: `1.5px solid ${t.sourceProportional ? '#7b5ea7' : '#c5d0ff'}`,
                        background: t.sourceProportional ? 'linear-gradient(135deg,#f0e8ff,#e6d8ff)' : '#f4f7ff',
                        transition: 'all .15s',
                        userSelect: 'none',
                      }}
                    >
                      {/* Sliding toggle */}
                      <div style={{
                        width: 32, height: 18, borderRadius: 9, position: 'relative',
                        background: t.sourceProportional ? 'linear-gradient(135deg,#7b5ea7,#c9962a)' : '#d0d5e8',
                        transition: 'background .2s', flexShrink: 0,
                        boxShadow: t.sourceProportional ? '0 0 6px #7b5ea755' : 'none',
                      }}>
                        <div style={{
                          position: 'absolute', top: 2, width: 14, height: 14, borderRadius: '50%', background: '#fff',
                          left: t.sourceProportional ? 16 : 2,
                          transition: 'left .2s',
                          boxShadow: '0 1px 3px rgba(0,0,0,.25)',
                        }} />
                      </div>
                      <span className="spec-prop-label" style={{
                        fontSize: 11, fontWeight: 700,
                        color: t.sourceProportional ? '#5a3ea0' : '#8890b0',
                        whiteSpace: 'nowrap',
                      }}>
                        ⚖️ <span className="spec-btn-label">Proporsional</span>
                      </span>
                    </div>

                    {can('tree.delete') && (
                    <button
                      className="btn btn-sm"
                      style={{ background: '#f0f2fa', color: '#9a7b1e', border: '1.5px solid #d0d4f0' }}
                      onClick={() => showAppConfirm({
                        icon: '🗄️', iconBg: '#f0f2fa', iconColor: '#9a7b1e',
                        title: 'Strukturu arxivlə',
                        message: `"${t.name}" ixtisas strukturunun snapshotunu arxivə göndərmək istəyirsiniz?`,
                        confirmLabel: 'Arxivlə', confirmColor: '#9a7b1e',
                        onConfirm: () => {
                          treeArchiveDb.save({ name: t.name, year: t.year || '', icon: t.icon || '', institution: t.institution || '', nodes: t.nodes || [] })
                          treeDb.delete(t.id)
                          addLog('admin', 'info', `İxtisas strukturu arxivləndi: "${t.name}"`, `İl: ${t.year || '—'}`)
                          refreshTrees()
                        },
                      })}
                    >🗄️ Arxivlə</button>
                    )}
                    {can('tree.edit') && (
                    <button className="btn btn-outline btn-sm"
                      onClick={() => {
                        const inst = (insts as any[]).find((i: any) => i.id === t.institution)
                        const depth = Math.max(treeDepth(t.nodes || []), (t.levelNames?.length || 0), DEFAULT_LEVEL_NAMES.length)
                        const levelNames = Array.from({ length: depth }, (_, i) => t.levelNames?.[i] ?? DEFAULT_LEVEL_NAMES[i] ?? `Səviyyə ${i + 1}`)
                        // Tədris ili: ağacda yoxdursa təhsilalanların/müəssisənin ilinə görə dinamik götür
                        const syncedYear = t.year || getInstYear(t.institution || '')
                        setModal({ type: 'renameTree', treeId: t.id, name: t.name, instId: t.institution || '', instLabel: inst?.label || t.name, year: syncedYear, icon: t.icon || '', levelNames })
                      }}>
                      ✏️ Düzəlt
                    </button>
                    )}
                    {can('tree.delete') && (
                    <button className="btn btn-danger btn-sm" style={{ padding: '4px 10px' }}
                      onClick={() => deleteTree(t.id)}>🗑</button>
                    )}
                  </div>
                </div>

                {/* ── Açıq olduqda: node ağacı ── */}
                {isOpen && (() => {
                  const tree = getTree(t.id)
                  if (!tree) return null
                  const nodes: TNode[] = tree.nodes || []

                  return (
                    <div>
                      {/* Alt başlıq + kök element əlavə et */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #f0f2fa' }}>
                        <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
                          İxtisas Ağacı
                        </span>
                        <button className="btn btn-primary btn-sm"
                          onClick={() => setModal({ type: 'addNode', treeId: t.id, parentId: null, name: '', quota: '', depth: 0, levelName: '' })}>
                          + {(t.levelNames?.[0]) || DEFAULT_LEVEL_NAMES[0]}
                        </button>
                      </div>

                      {/* Boş ağac */}
                      {nodes.length === 0 && (
                        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--muted)', fontSize: 12 }}>
                          Hələ {(t.levelNames?.[0]) || DEFAULT_LEVEL_NAMES[0]} yoxdur —{' '}
                          <b style={{ color: 'var(--blue)', cursor: 'pointer' }}
                            onClick={() => setModal({ type: 'addNode', treeId: t.id, parentId: null, name: '', quota: '', depth: 0, levelName: '' })}>
                            + {(t.levelNames?.[0]) || DEFAULT_LEVEL_NAMES[0]} əlavə edin
                          </b>
                        </div>
                      )}

                      {/* Rekursiv node siyahısı */}
                      {(() => {
                        const tInstId   = t.institution || ''
                        const allUsers  = userDb.getAll() as any[]
                        const instUsers = tInstId ? allUsers.filter((u: any) => u.institution === tInstId) : []
                        const hasGender = instUsers.some((u: any) => u.gender)
                        return nodes.map((node: TNode) => (
                          <NodeRow
                            key={node.id}
                            node={node}
                            depth={0}
                            onAdd={(parentId, childDepth) => setModal({ type: 'addNode', treeId: t.id, parentId, name: '', quota: '', depth: childDepth, levelName: '' })}
                            onEdit={n => setModal({ type: 'editNode', treeId: t.id, nodeId: n.id, name: n.name, quota: n.quota ?? '' })}
                            onDelete={nodeId => handleDeleteNode(t.id, nodeId)}
                            onPriority={n => setPriorityNode({ treeId: t.id, node: n })}
                            onDeactivatePriority={nodeId => handleDeactivatePriority(t.id, nodeId)}
                            onGroup={n => setGroupNode({ treeId: t.id, node: n })}
                            onDeactivateGroup={nodeId => handleDeactivateGroup(t.id, nodeId)}
                            sourceProportional={!!t.sourceProportional}
                            instUsers={instUsers}
                            onQuotaMode={(nodeId, mode, mülkiQ, liseyQ) => handleQuotaMode(t.id, nodeId, mode, mülkiQ, liseyQ)}
                            levelNames={t.levelNames?.length ? t.levelNames : DEFAULT_LEVEL_NAMES}
                            hasGender={hasGender}
                            onGenderConfig={(nodeId, cfg) => handleGenderConfig(t.id, nodeId, cfg)}
                          />
                        ))
                      })()}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </div>
      )
      })()}
    </>
  )
}
