import { useState, useEffect, useMemo } from 'react'
import { useActiveInst } from '../../activeInst'
import { treeDb, userDb, institutionDb, cohortDb, systemSettingsDb, useLocalState, addLog } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import InstIcon, { isImageIcon } from '../../components/InstIcon'
import InstTabs from '../../components/InstTabs'
import { can } from '../../permissions'
import { useBalanceSim } from '../../quota-sim'
import { poolCounts, checkManual, leavesWithPath, balanceForLeaf, genderPool, balanceReport, feasibility, globalSourceSplitCached, autoSplit, BALANCE_TOLERANCE, sourceBalance, fragileRisks, groupBlocks } from '../../quota-pool'
import type { SourceSlotCheck } from '../../quota-pool'
import { UMUMI_KEY, SUM_SEP, isSumCrit, critParts } from '../../tiebreak'

// ── Types ─────────────────────────────────────────────────────────────────────
type TNode = {
  id: string; name: string; quota?: number; children: TNode[];
  tiebreaker?: string[];
  groupTiebreakers?: { [group: string]: string[] }
  groups?: string[]
  /**
   * Qrupdan ƏLAVƏ məhdudiyyətlər: kanonik sütun açarı -> icazə verilən dəyərlər.
   * Açarlar: group | source | gender | year | lv0, lv1, ... (bax: quota-pool.ts).
   * Məsələn { lv0: ['QQ'] } — yalnız qoşun növü QQ olanlar bu node-u görür.
   */
  filters?: { [col: string]: string[] }
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
const DEFAULT_LEVEL_NAMES = ['Qoşun növü', 'Mülki ixtisas', 'Hərbi uçot ixtisası']

// ── Prioritet modalı köməkçi: bir qrupun siyahısı ────────────────────────────

function SubjectList({ items, onChange, autoSubjects, autoScores }: {
  items: string[]
  onChange: (next: string[]) => void
  autoSubjects?: string[]
  autoScores?: { [subject: string]: number }
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  // Cəm (toplama) qurucusunun vəziyyəti
  const [sumOpen, setSumOpen]     = useState(false)
  const [sumPicked, setSumPicked] = useState<string[]>([])
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

  // Bütün mövcud sütunlar (cəm qurucusu üçün — artıq siyahıda olanlar da toplana bilər)
  const allCols = [UMUMI_KEY, ...(autoSubjects ?? [])].filter((s, i, arr) => arr.indexOf(s) === i)
  // Əlavə edilə bilən fənlər: hələ siyahıda olmayanlar
  const available = allCols.filter(s => !items.includes(s))

  function addSum() {
    // Cəm meyarı tək sətir kimi saxlanılır: "A + B" — baza sxemi dəyişmir
    const crit = sumPicked.join(SUM_SEP)
    if (crit && !items.includes(crit)) onChange([...items, crit])
    setSumOpen(false); setSumPicked([])
  }

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
          const isSum      = isSumCrit(subject)
          return (
            <div key={subject} draggable
              onDragStart={() => setDragIdx(i)}
              onDragEnter={() => setOverIdx(i)}
              onDragOver={e => e.preventDefault()}
              onDragEnd={onDragEnd}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 10,
                background: isDragging ? '#eef0fa' : isSum ? '#f6fff2' : isUmumi ? '#f0f7ff' : '#f8f9fd',
                border: isOver ? '2px dashed var(--blue)' : isSum ? '1.5px solid #b7e3a0' : isUmumi ? '1.5px solid #bfdbfe' : '1.5px solid #efe1bd',
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
              <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, color: isSum ? '#3f7a24' : isUmumi ? '#1d4ed8' : 'inherit' }}>
                {isSum ? (
                  <>
                    <span style={{ fontWeight: 800 }}>Σ Cəm</span>
                    <div style={{ fontSize: 11.5, fontWeight: 600, color: '#5f8c46', marginTop: 2, lineHeight: 1.4 }}>
                      {critParts(subject).join(' + ')}
                    </div>
                  </>
                ) : (<>{isUmumi ? '📊 ' : ''}{subject}</>)}
              </span>
              <button onClick={() => remove(i)} onMouseDown={e => e.stopPropagation()}
                style={{ padding: '3px 7px', borderRadius: 6, border: '1.5px solid #ffd0d0', background: '#fff5f5', color: '#ff4d4f', fontWeight: 700, cursor: 'pointer', flexShrink: 0, fontSize: 12 }}
                title="Sil">✕</button>
            </div>
          )
        })}
      </div>

      {/* Cəm (toplama) qurucusu — bir neçə sütunu tək meyar kimi toplamaq üçün */}
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1.5px dashed #efe1bd' }}>
        {!sumOpen ? (
          <button onClick={() => { setSumOpen(true); setSumPicked([]) }}
            style={{
              padding: '5px 14px', borderRadius: 20, border: '1.5px solid #b7e3a0',
              background: '#f6fff2', color: '#3f7a24', fontWeight: 700, fontSize: 12, cursor: 'pointer',
            }}>
            Σ Cəm meyarı əlavə et
          </button>
        ) : (
          <div style={{ border: '1.5px solid #b7e3a0', background: '#f9fff6', borderRadius: 10, padding: 12 }}>
            <div style={{ fontSize: 11.5, color: '#5f8c46', fontWeight: 700, marginBottom: 8 }}>
              Toplanacaq sütunları seçin — onların cəmi tək prioritet meyarı kimi işlədiləcək
              (məs. ümumi imtahan nəticəsi + semestr balı).
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allCols.map(c => {
                const on = sumPicked.includes(c)
                return (
                  <button key={c} onClick={() => setSumPicked(prev => on ? prev.filter(x => x !== c) : [...prev, c])}
                    style={{
                      padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      border: '1.5px solid ' + (on ? '#3f7a24' : '#d8e8cf'),
                      background: on ? '#3f7a24' : '#fff', color: on ? '#fff' : '#5f8c46',
                    }}>
                    {on ? '✓ ' : '+ '}{c === UMUMI_KEY ? '📊 ' : ''}{c}
                  </button>
                )
              })}
            </div>
            {sumPicked.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#3f7a24', fontWeight: 700 }}>
                Nəticə: Σ {sumPicked.join(' + ')}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
              <button onClick={() => setSumOpen(false)}
                style={{ padding: '5px 14px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#fff', color: 'var(--muted)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                Ləğv
              </button>
              <button disabled={sumPicked.length < 2} onClick={addSum}
                style={{
                  padding: '5px 14px', borderRadius: 8, border: 'none', fontWeight: 800, fontSize: 12,
                  cursor: sumPicked.length < 2 ? 'not-allowed' : 'pointer',
                  background: sumPicked.length < 2 ? '#dfe3dd' : '#3f7a24',
                  color: sumPicked.length < 2 ? '#98a292' : '#fff',
                }}>
                Siyahıya əlavə et
              </button>
            </div>
            {sumPicked.length === 1 && (
              <div style={{ fontSize: 11, color: '#9a7b1e', marginTop: 6 }}>Ən azı iki sütun seçin.</div>
            )}
          </div>
        )}
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
  const hasGroups = (node.groups?.length ?? 0) > 0
  const groups    = node.groups ?? []

  // Flat (qrupsuz) state — əvvəlcə saxlanmış, yoxsa CƏDVƏLDƏN avtomatik fənlər
  const [flatItems, setFlatItems] = useState<string[]>(
    node.tiebreaker?.length ? node.tiebreaker
    : (allSubjects && allSubjects.length) ? [...allSubjects]
    : [...DEFAULT_SUBJECTS]
  )

  // Nə tiebreaker, nə də avtomatik fənlər varsa — əvvəlcə saxlanmış prioritetləri backend-dən yüklə
  useEffect(() => {
    if (!node.tiebreaker?.length && !(allSubjects && allSubjects.length)) {
      systemSettingsDb.getPrioritySubjects().then(stored => {
        if (stored.length) setFlatItems(stored)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

// ── Node filtrində istifadə oluna bilən sütunlar ─────────────────────────────
// Kanonik açar (bazada saxlanılan) + insana görünən ad. Səviyyə sütunlarının adı
// strukturun levelNames sahəsindən gəlir, ona görə siyahı ağaca görə qurulur.
// "Qrup" burada YOXDUR — onun öz bölməsi var.
// Strukturun səviyyə adları — boş qalan səviyyələr üçün default adlar işlənir.
// Ağacın FAKTİKİ dərinliyi levelNames-dən uzun ola bilər, ona görə hər ikisinə baxılır.
function levelNamesOf(tree: any): string[] {
  const depth = (function d(nodes: any[]): number {
    let max = 0
    for (const n of nodes || []) max = Math.max(max, 1 + d(n.children || []))
    return max
  })(tree?.nodes || [])
  const count = Math.max(depth, tree?.levelNames?.length || 0)
  return Array.from({ length: count }, (_, i) =>
    tree?.levelNames?.[i] || DEFAULT_LEVEL_NAMES[i] || `Səviyyə ${i + 1}`)
}

function filterableCols(levelNames: string[], extraKeys: string[] = []): { key: string; label: string }[] {
  return [
    ...levelNames.map((ln, i) => ({ key: 'lv' + i, label: ln })),
    { key: 'source', label: 'Mənbə' },
    { key: 'gender', label: 'Cins' },
    { key: 'year',   label: 'Tədris ili' },
    // Excel-dən gələn sərbəst mətn sütunları (məs. "dil") — ExtraFields
    ...extraKeys.map(k => ({ key: 'ex:' + k, label: k.charAt(0).toUpperCase() + k.slice(1) })),
  ]
}

// Təhsilalanın kanonik açar üzrə dəyəri — quota-pool.ts/studentColValue ilə eyni
// məntiq (burada UI üçün, orada hesablama üçün istifadə olunur).
function colValueOf(u: any, key: string): string {
  const mx = /^ex:(.+)$/i.exec(String(key ?? '').trim())
  if (mx) {
    const want = mx[1].trim().toLowerCase()
    const ef = u?.extraFields || {}
    for (const k of Object.keys(ef)) if (k.trim().toLowerCase() === want) return String(ef[k] ?? '').trim()
    return ''
  }
  if (key === 'group')  return String(u?.group  ?? '').trim()
  if (key === 'source') return String(u?.source ?? '').trim()
  if (key === 'gender') return String(u?.gender ?? '').trim()
  if (key === 'year')   return String(u?.year   ?? '').trim()
  const m = /^lv(\d+)$/.exec(key)
  if (m) return String(u?.branchByLevel?.[Number(m[1])] ?? '').trim()
  return ''
}

// ── Qrup təyinat modalı ───────────────────────────────────────────────────────
function GroupModal({ node, users, levelNames, onSave, onClose }: {
  node: TNode
  /** Bu strukturun təhsilalanları — dəyər siyahıları buradan yığılır */
  users: any[]
  /** Strukturun səviyyə adları — "Qoşun növü" kimi sütunların görünən adı */
  levelNames: string[]
  onSave: (groups: string[], filters: { [col: string]: string[] } | undefined) => void
  onClose: () => void
}) {
  const allGroups = [...new Set(
    users.map((u: any) => u.group).filter(Boolean)
  )].sort() as string[]

  const [selected, setSelected] = useState<string[]>(node.groups || [])

  function toggle(g: string) {
    setSelected(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  // ── Əlavə sütun filtrləri ──────────────────────────────────────────────────
  // Yalnız bu strukturun təhsilalanlarında FAKTİKİ dəyəri olan sütunlar təklif
  // olunur: qoşun növü sütunu, məsələn, hər təhsilalan qrupunda olmur.
  const [filters, setFilters] = useState<{ [col: string]: string[] }>(node.filters || {})
  // Bu strukturun təhsilalanlarında faktiki olan sərbəst mətn sütunları
  const extraKeys = [...new Set(
    users.flatMap((u: any) => Object.keys(u?.extraFields || {}).filter(k => String(u.extraFields[k] ?? '').trim()))
  )].sort() as string[]
  const availCols = filterableCols(levelNames, extraKeys)
    .map(c => ({ ...c, values: [...new Set(users.map(u => colValueOf(u, c.key)).filter(Boolean))].sort() }))
    .filter(c => c.values.length > 0)
  const activeCols = availCols.filter(c => c.key in filters)
  const freeCols   = availCols.filter(c => !(c.key in filters))

  const addCol    = (key: string) => setFilters(prev => ({ ...prev, [key]: [] }))
  const dropCol   = (key: string) => setFilters(prev => { const n = { ...prev }; delete n[key]; return n })
  const toggleVal = (key: string, v: string) => setFilters(prev => {
    const cur = prev[key] || []
    return { ...prev, [key]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] }
  })

  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">👥 Görünmə Məhdudiyyəti — {node.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
            Seçilmiş qruplardan olan təhsilalanlar bu ixtisası görəcək.
            Heç biri seçilməsə — bütün qruplar üçün görünür.
          </div>
          <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>QRUP</div>

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
                    {users.filter((u: any) => u.group === g).length} təhsilalan
                  </span>
                </label>
              ))}
            </div>
          )}

          {/* ── Əlavə sütun üzrə məhdudiyyət ──────────────────────────────────
              Qrupdan başqa istənilən mövcud sütun (məs. Qoşun növü) üzrə də
              məhdudiyyət qoyula bilər. Seçilmiş dəyəri olmayan təhsilalana
              məhdudiyyət tətbiq edilmir. */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1.5px solid var(--border)' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: 'var(--muted)', marginBottom: 8 }}>ƏLAVƏ SÜTUN</div>

            {activeCols.length === 0 && freeCols.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Bu strukturun təhsilalanlarında məhdudiyyət qoyula biləcək başqa sütun yoxdur.
              </div>
            )}

            {activeCols.map(c => (
              <div key={c.key} style={{
                marginBottom: 10, padding: '10px 12px', borderRadius: 10,
                background: '#f8f9fd', border: '1.5px solid #efe1bd',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 800 }}>{c.label}</span>
                  <button onClick={() => dropCol(c.key)} title="Bu sütun üzrə məhdudiyyəti sil"
                    style={{
                      marginLeft: 'auto', border: 'none', background: 'transparent',
                      color: '#cf1322', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                    }}>✕ sil</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {c.values.map(v => {
                    const on = (filters[c.key] || []).includes(v)
                    return (
                      <button key={v} onClick={() => toggleVal(c.key, v)}
                        title={users.filter(u => colValueOf(u, c.key) === v).length + ' təhsilalan'}
                        style={{
                          padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                          fontSize: 12, fontWeight: 700,
                          border: '1.5px solid ' + (on ? '#52c41a' : '#dde'),
                          background: on ? '#f0fff4' : '#fff',
                          color: on ? '#237804' : 'var(--muted)',
                        }}>
                        {on ? '✓ ' : ''}{v}
                        <span style={{ marginLeft: 6, opacity: .65, fontWeight: 600 }}>
                          {users.filter(u => colValueOf(u, c.key) === v).length}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {(filters[c.key] || []).length === 0 && (
                  <div style={{ fontSize: 11, color: '#d46b08', marginTop: 8 }}>
                    Heç bir dəyər seçilməyib — bu sütun üzrə məhdudiyyət tətbiq olunmayacaq.
                  </div>
                )}
              </div>
            ))}

            {freeCols.length > 0 && (
              <select value="" onChange={e => { if (e.target.value) addCol(e.target.value) }}
                style={{
                  fontSize: 12, fontWeight: 700, padding: '7px 10px', borderRadius: 8,
                  border: '1.5px solid #dde', background: '#fff', cursor: 'pointer', width: '100%',
                }}>
                <option value="">+ Sütun əlavə et…</option>
                {freeCols.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            )}
          </div>

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-outline" onClick={onClose}>Ləğv et</button>
            <button className="btn btn-primary" onClick={() => {
              // Dəyəri seçilməmiş sütun saxlanılmır — yoxsa "boş filtr" kimi qalar.
              const clean: { [col: string]: string[] } = {}
              for (const k of Object.keys(filters)) if (filters[k]?.length) clean[k] = filters[k]
              onSave(selected, Object.keys(clean).length ? clean : undefined)
              onClose()
            }}>
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
function QuotaModeModal({ node, path, treeNodes, instUsers, onSave, onClose }: {
  node: TNode
  /** kökdən bu yarpağa qədər node-lar — hovuzu süzmək üçün */
  path: TNode[]
  /** strukturun kök node-ları — eyni hovuzlu ixtisasları tapmaq üçün */
  treeNodes: TNode[]
  instUsers: any[]
  onSave: (mode: 'auto' | 'manual', mülkiQ?: number, liseyQ?: number) => void
  onClose: () => void
}) {
  const quota = node.quota || 0

  // Hovuz: bu ixtisası SEÇƏ BİLƏN təhsilalanlar (bütün səviyyələrin məhdudiyyətləri ilə)
  const pool       = poolCounts(instUsers, path)
  const mülkiTotal = pool.mülki
  const liseyTotal = pool.lisey
  const hasSrc     = mülkiTotal + liseyTotal > 0

  // Avtomatik bölgü qlobal cədvəldən gəlir — bax: quota-pool.ts/globalSourceSplit
  const gTable    = globalSourceSplitCached(instUsers, treeNodes || [])
  const auto      = autoSplit(node, pool, gTable)
  const autoMülki = hasSrc ? auto.mülki : Math.round(quota / 2)
  const autoLisey = hasSrc ? auto.lisey : quota - Math.round(quota / 2)

  const [mode,      setMode]      = useState<'auto' | 'manual'>(node.quotaMode || 'auto')
  const [mülkiVal,  setMülkiVal]  = useState(node.quotaMode === 'manual' && node.mülkiQuota != null ? node.mülkiQuota : autoMülki)
  const [liseyVal,  setLiseyVal]  = useState(node.quotaMode === 'manual' && node.liseyQuota != null ? node.liseyQuota : autoLisey)

  const total2  = mülkiVal + liseyVal
  const overSum = total2 > quota

  // Eyni namizəd hovuzuna malik ixtisaslar üzrə ümumi mülki/lisey balansı.
  // Cari modaldakı dəyişiklik `override` kimi verilir ki, nəticə dərhal görünsün.
  const allLeaves = leavesWithPath(treeNodes || [])
  const bal = balanceForLeaf(instUsers, allLeaves, path, {
    leafId: node.id, mode, mülki: mülkiVal, lisey: liseyVal,
  }, undefined, gTable)

  // Faktiki bölgü nisbəti xam hovuzdan yox, qlobal modeldən gəlir: eyni hovuzu
  // paylaşan ixtisasların kvotası məhduddur, ona görə 22/367 deyil, 22/48 kimi
  // real yer bölgüsü göstərilir.
  const peerQuota = bal.peers.reduce((a, p) => a + p.quota, 0)
  const shareM    = bal.autoMülki
  const shareL    = bal.autoLisey
  const shareTot  = shareM + shareL || 1
  const pctM      = Math.round(shareM / shareTot * 100)
  const pctL      = 100 - pctM

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
                  Bu ixtisası <b>{pool.total}</b> nəfər seçə bilər (Mülki {mülkiTotal} · Lisey {liseyTotal})
                  {instUsers.length !== pool.total && (
                    <>, <span style={{ color: '#c47f0a' }}>{instUsers.length - pool.total} nəfər məhdudiyyətlərə görə kənardadır</span></>
                  )}
                  <div style={{ marginTop: 3 }}>
                    Eyni hovuzu paylaşan ixtisasların ümumi kvotası <b>{peerQuota}</b> — yerlərin bölgüsü:{' '}
                    <span style={{ color: '#1677ff', fontWeight: 700 }}>Mülki: {shareM} ({pctM}%)</span>
                    {' · '}
                    <span style={{ color: '#531dab', fontWeight: 700 }}>Lisey: {shareL} ({pctL}%)</span>
                  </div>
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
                  ? <>Eyni hovuzu paylaşan ixtisaslar üzrə real yer bölgüsünə görə (Mülki {pctM}% · Lisey {pctL}%) hər yerləşdirmədə yenidən hesablanır. Yuxarıdakı səviyyələrin qrup, cins və budaq məhdudiyyətləri, həmçinin kvota tutumu nəzərə alınır.</>
                  : <>⚠️ Bu ixtisası seçə bilən mənbəli təhsilalan yoxdur — yuxarıdakı dəyərlər müvəqqəti 50/50 bölgüdür.</>}
              </div>
              {/* Xəbərdarlıq yalnız NAMİZƏD ÇATIŞMAZLIĞINDA verilir. Əvvəl şərt
                  `auto.unfilled > 0` idi və qlobal modelin qalığını da namizəd
                  çatışmazlığı kimi göstərirdi: 151 namizəd və 10 kvota olduğu halda
                  "kvota namizəd sayından böyükdür" yazılırdı. */}
              {pool.total < quota && (
                <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 8, background: '#fff2f0', border: '1px solid #ffccc7', fontSize: 11.5, color: '#cf1322', lineHeight: 1.5 }}>
                  ⚠️ Kvota namizəd sayından böyükdür — <b>{quota - pool.total} yer</b> heç kimlə dolmayacaq.
                  Bu ixtisası cəmi {pool.total} nəfər seçə bilir.
                </div>
              )}
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

              {/* Manual bölgünün nəticəsi — boş qalan yer + eyni hovuz üzrə balans */}
              {hasSrc && (() => {
                const chk = checkManual(mülkiVal, liseyVal, pool)
                const empty = chk.emptyMülki + chk.emptyLisey
                // Yerləşdirmə mənbə slotlarını qarışdırmadığı üçün ölçü modelə
                // yaxınlıq deyil, REAL icra olunabilirlikdir: bir mənbədə artıq
                // slot yaranırsa, o yer boş qalacaq və digər mənbədən namizəd
                // yerləşməmiş qalacaq. Tolerans yoxdur — 1 yer də real itkidir.
                const sb = sourceBalance(instUsers, treeNodes, undefined,
                  { leafId: node.id, mode, mülki: mülkiVal, lisey: liseyVal })
                const balanced = sb.ok
                // mənfi = əskik slot (namizəd yersiz), müsbət = artıq slot (yer boş)
                const dM = sb.mülki.unfillable - sb.mülki.deficit
                const dL = sb.lisey.unfillable - sb.lisey.deficit
                return (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Namizəd çatmır → yer boş qalacaq */}
                    {empty > 0 && (
                      <div style={{ padding: '9px 12px', borderRadius: 8, background: '#fff2f0', border: '1px solid #ffccc7', fontSize: 11.5, color: '#cf1322', lineHeight: 1.6 }}>
                        ⚠️ <b>{empty} yer boş qalacaq</b> — namizəd çatmır:
                        {chk.emptyMülki > 0 && <> mülki üçün <b>{mülkiVal}</b> yer var, seçə bilən cəmi <b>{pool.mülki}</b> nəfər.</>}
                        {chk.emptyLisey > 0 && <> lisey üçün <b>{liseyVal}</b> yer var, seçə bilən cəmi <b>{pool.lisey}</b> nəfər.</>}
                      </div>
                    )}

                    {/* Eyni namizəd hovuzu üzrə ümumi balans */}
                    <div style={{
                      padding: '10px 12px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.6,
                      background: balanced ? '#f0fff4' : '#fffbe6',
                      border: `1px solid ${balanced ? '#b7eb8f' : '#ffe58f'}`,
                      color: balanced ? '#237804' : '#874d00',
                    }}>
                      {balanced ? (
                        <>✅ <b>Balans yerindədir.</b> Eyni namizəd qrupundakı {bal.peers.length} ixtisas üzrə
                        cəmi mülki <b>{bal.effMülki}</b> · lisey <b>{bal.effLisey}</b> — avtomatik bölgü ilə uyğundur.</>
                      ) : (
                        <>
                          ⚠️ <b>Balans pozulur.</b>{' '}
                          {dM > 0 && <><b>{dM} mülki yer</b> boş qalacaq. </>}
                          {dL > 0 && <><b>{dL} lisey yer</b> boş qalacaq. </>}
                          {dM < 0 && <><b>{-dM} mülki namizəd</b> yersiz qalacaq. </>}
                          {dL < 0 && <><b>{-dL} lisey namizəd</b> yersiz qalacaq. </>}

                          {/* Cins üzrə ayrıntı — kimin kənarda qaldığı dəqiq deyilir */}
                          {(() => {
                            const rows: string[] = []
                            const add = (lbl: string, c: SourceSlotCheck) => {
                              // Cins yalnız MƏCBURİ olduqda adlandırılır
                              if (c.femaleForced > 0) rows.push(`${c.femaleForced} qadın (${lbl})`)
                              if (c.maleForced   > 0) rows.push(`${c.maleForced} kişi (${lbl})`)
                              if (c.unattributedOut > 0)
                                rows.push(`${c.unattributedOut} namizəd (${lbl} — qadın da, kişi də ola bilər; bal sıralaması həll edir)`)
                            }
                            add('mülki', sb.mülki); add('lisey', sb.lisey)
                            return rows.length
                              ? <>Kənarda qalanlar: <b>{rows.join(' · ')}</b>. </>
                              : null
                          })()}

                          {/* Səbəb cins limitidirsə — birbaşa göstər */}
                          {sb.capIssues.length > 0 && (
                            <>Cins limiti kvotadan azdır:{' '}
                              {sb.capIssues.slice(0, 3).map(c =>
                                `${c.name} (qadın ${c.maxFemale ?? '—'} + kişi ${c.maxMale ?? '—'} = ${c.capacity} < kvota ${c.quota}, ${c.shortfall} yer heç vaxt dolmayacaq)`
                              ).join(' · ')}
                              {sb.capIssues.length > 3 ? ` və daha ${sb.capIssues.length - 3}` : ''}. </>
                          )}
                          {sb.capIssues.length === 0 && sb.genderTight.length > 0 && (
                            <>Cins limiti darboğazdır:{' '}
                              {sb.genderTight.slice(0, 3).map(g =>
                                `${g.name} — ${g.gender} limiti ${g.cap} (kvota ${g.quota}) tam dolub`
                              ).join(' · ')}
                              {sb.genderTight.length > 3 ? ` və daha ${sb.genderTight.length - 3}` : ''}. </>
                          )}

                          {sb.capIssues.length > 0
                            ? ' Həmin ixtisasda qadın/kişi limitini artırın və ya kvotanı azaldın.'
                            : sb.genderTight.length > 0
                              ? ' Darboğaz olan cins limitini artırın və ya kvotanı digər ixtisasa keçirin.'
                              : ` Aşağıdakı ixtisaslardan birində${dM > 0 ? ' mülki kvotanı azaltmaqla' : dL > 0 ? ' lisey kvotanı azaltmaqla' : ' düzəlişlə'} kompensasiya edin.`}
                        </>
                      )}
                    </div>

                    {/* Eyni hovuzlu ixtisaslar — kompensasiya haradan mümkündür */}
                    {bal.peers.length > 1 && (
                      <div style={{ border: '1px solid #e8eaf5', borderRadius: 8, overflow: 'hidden' }}>
                        <div style={{ padding: '7px 10px', background: '#f8f9fd', fontSize: 10.5, fontWeight: 800, color: '#5a6070', letterSpacing: .3 }}>
                          EYNİ NAMİZƏD QRUPU ({bal.pool.total} nəfər) — {bal.peers.length} İXTİSAS
                        </div>
                        <div style={{ maxHeight: 168, overflowY: 'auto' }}>
                          {bal.peers.map(pr => {
                            const chg = pr.effMülki !== pr.autoMülki
                            return (
                              <div key={pr.id} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                                borderTop: '1px solid #f2f4fa', fontSize: 11,
                                background: pr.isTarget ? '#fffbe6' : '#fff',
                              }}>
                                <span style={{ flex: 1, minWidth: 0, fontWeight: pr.isTarget ? 800 : 600, color: '#3a4560', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  title={pr.pathLabel ? `${pr.pathLabel} → ${pr.name}` : pr.name}>
                                  {pr.isTarget ? '▸ ' : ''}{pr.name}
                                  {pr.isManual && <span style={{ color: '#c41d7f', fontWeight: 700 }}> ✏️</span>}
                                </span>
                                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>kvota {pr.quota}</span>
                                <span style={{ flexShrink: 0, fontWeight: 700 }}>
                                  <span style={{ color: '#1677ff' }}>M {pr.effMülki}</span>
                                  {' · '}
                                  <span style={{ color: '#531dab' }}>L {pr.effLisey}</span>
                                </span>
                                <span style={{ flexShrink: 0, width: 62, textAlign: 'right', color: chg ? '#d46b08' : '#bbb' }}>
                                  {chg ? `avto ${pr.autoMülki}/${pr.autoLisey}` : 'avto'}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })()}
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

// ── Struktur üzrə balans təfsilatı ───────────────────────────────────────────
function BalanceModal({ tree, instUsers, onClose, onQuotaMode, onGenderConfig }: {
  tree: any; instUsers: any[]; onClose: () => void
  /** Balansı elə bu pəncərədən düzəltmək üçün — mülki/lisey bölgüsü */
  onQuotaMode?: (nodeId: string, mode: 'auto' | 'manual', mülkiQ?: number, liseyQ?: number) => void
  /** Balansı elə bu pəncərədən düzəltmək üçün — qadın/kişi məhdudiyyəti */
  onGenderConfig?: (nodeId: string, cfg: { allowFemale: boolean; allowMale: boolean; maxFemale: number | null; maxMale: number | null } | null) => void
}) {
  // Düzəliş üçün açılan alt-pəncərə: hansı ixtisas və hansı növ
  const [fix, setFix] = useState<{ nodeId: string; kind: 'source' | 'gender' } | null>(null)
  const leafRefs  = useMemo(() => leavesWithPath(tree.nodes || []), [tree])
  const fixTarget = fix ? leafRefs.find((x: any) => x.leaf.id === fix.nodeId) : null

  /** Sətirdəki kiçik düzəliş düymələri — yalnız handler verilibsə görünür */
  const FixBtns = ({ id, gender = true }: { id: string; gender?: boolean }) => (
    <span style={{ display: 'inline-flex', gap: 4, flexShrink: 0 }}>
      {onQuotaMode && (
        <button onClick={e => { e.stopPropagation(); setFix({ nodeId: id, kind: 'source' }) }}
          title="Mülki / lisey bölgüsünü düzəlt"
          style={{ border: '1px solid #d6e4ff', background: '#f0f5ff', color: '#1677ff', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 800, padding: '1px 6px', lineHeight: 1.5 }}>
          ⚖️ M/L
        </button>
      )}
      {gender && onGenderConfig && (
        <button onClick={e => { e.stopPropagation(); setFix({ nodeId: id, kind: 'gender' }) }}
          title="Qadın / kişi məhdudiyyətini düzəlt"
          style={{ border: '1px solid #ffd6e7', background: '#fff0f6', color: '#c41d7f', borderRadius: 6, cursor: 'pointer', fontSize: 10.5, fontWeight: 800, padding: '1px 6px', lineHeight: 1.5 }}>
          ⚥ Cins
        </button>
      )}
    </span>
  )

  const rep = balanceReport(instUsers, tree.nodes || [])
  // Yekun hökm: model müqayisəsi deyil, real icra olunabilirlik (bax: sourceBalance)
  const sb = sourceBalance(instUsers, tree.nodes || [])
  const fea = feasibility(instUsers, tree.nodes || [])
  // Kövrək bölgü: model "olur" desə də, yalnız MƏCBURİ paylanmada oturur
  const fr = fragileRisks(instUsers, tree.nodes || [])
  const frSeats = fr.reduce((a, x) => a + x.riskSeats, 0)
  const gbk = groupBlocks(instUsers, tree.nodes || [])
  // Real seçimlərlə neçə nəfər kənarda qala bilər — sadə üsulun simulyasiyası
  const sim = useBalanceSim(gbk.conflicts.length ? instUsers : [], tree)
  const segLabel = (x: { group: string; gender: string; source: string; branch: string }) =>
    [x.group || null, x.gender || null, x.source && x.source !== x.group ? x.source : null, x.branch || null]
      .filter(Boolean).join(' · ') || 'qrupsuz'
  return (
    <div className="modal-overlay open" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">📐 Kvota yoxlaması — {tree.name}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ maxHeight: '74vh', overflowY: 'auto' }}>

          {/* ── 0. Kövrək bölgü xəbərdarlığı ─────────────────────────────────
              Ən yuxarıda göstərilir: kvota rəqəmləri düz olsa belə, bölgü
              məcburi olduqda nəticə pozula bilər və bu, digər yoxlamalarda
              görünmür. */}
          {frSeats > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#5a6070', letterSpacing: .3, marginBottom: 8 }}>
                0. KÖVRƏK BÖLGÜ
              </div>
              <div style={{
                padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 12, lineHeight: 1.6,
                background: '#fff7e6', border: '1.5px solid #ffd591', color: '#874d00',
              }}>
                ⚠️ <b>{frSeats} yer risk altındadır.</b> Kvota rəqəmləri uyğun olsa da, bölgü yalnız
                <b> məcburi</b> halda oturur: aşağıdakı budaqlarda ehtiyat namizəd yoxdur, üstəlik
                namizədlər budaqdan kənar ixtisasları da seçə bilir. Kənara gedən hər namizəd
                <b> bir boş yer</b> və <b>bir yerləşməyən namizəd</b> deməkdir.
                <div style={{ marginTop: 6, fontSize: 11.5 }}>
                  Həlli: həmin budağın namizədlərinin kənara çıxmasını bağlayın — qonşu budaqlara da
                  görünmə məhdudiyyəti (👥 düyməsi) qoyun.
                </div>
              </div>
              <div style={{ border: '1px solid #ffd591', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
                {fr.map((x, i) => (
                  <div key={i} style={{
                    padding: '8px 12px', fontSize: 11.5, color: '#3a4560', lineHeight: 1.6,
                    borderTop: i ? '1px solid #ffe7ba' : 'none',
                  }}>
                    <b>{x.pathLabel ? x.pathLabel + ' → ' : ''}{x.nodeName}</b>
                    {' — '}{x.capacity} yer · {x.candidates} namizəd · bunlardan <b>{x.leakers}</b> nəfər
                    kənar ixtisasa da gedə bilir → <b style={{ color: '#d46b08' }}>{x.riskSeats} yer risk altında</b>
                    {/* Sızmanın dəqiq ünvanı — məhdudiyyət qoyulmalı olan yer budur */}
                    <div style={{ marginTop: 5, paddingLeft: 10, borderLeft: '2px solid #ffd591' }}>
                      <div style={{ fontSize: 10.5, fontWeight: 800, color: '#874d00', marginBottom: 2 }}>
                        AÇIQ QALAN İXTİSASLAR — cəmi {x.leakCapacity} yer
                      </div>
                      {x.leakTargets.slice(0, 6).map((t, k) => (
                        <div key={k} style={{ fontSize: 11 }}>{t.label} <b>({t.quota} yer)</b></div>
                      ))}
                      {x.leakTargets.length > 6 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          və daha {x.leakTargets.length - 6} ixtisas…
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ── 1. Kvota rəqəmləri strukturla uyğundurmu ── */}
          <div style={{ fontSize: 11, fontWeight: 800, color: '#5a6070', letterSpacing: .3, marginBottom: 8 }}>
            1. KVOTA RƏQƏMLƏRİ
          </div>
          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 12, lineHeight: 1.6,
            background: fea.ok ? '#f0fff4' : '#fffbe6',
            border: `1.5px solid ${fea.ok ? '#b7eb8f' : '#ffe58f'}`,
            color: fea.ok ? '#237804' : '#874d00',
          }}>
            {fea.ok
              ? <>✅ <b>Kvotalar uyğundur.</b> {fea.students} təhsilalanın hamısı üçün seçə bildiyi ixtisaslarda yer var.
                  {(() => {
                    const q = totalQuota(tree.nodes || [])
                    const extra = q - instUsers.length
                    return extra > 0
                      ? <div style={{ marginTop: 6, color: '#cf1322' }}>⚠️ Amma ümumi kvota ({q}) təhsilalan sayından ({instUsers.length}) <b>{extra} çoxdur</b> — {extra} yer boş qalacaq.</div>
                      : null
                  })()}</>
              : <>⚠️ <b>{fea.deficit} təhsilalan heç bir halda yerləşə bilməyəcək</b> və <b>{fea.unfillable} yer</b> boş qalacaq —
                  bu, alqoritmin yox, kvota rəqəmlərinin nəticəsidir: bir qrup namizədə yer çatmır,
                  artıq qalan yerlər isə onların girə bilmədiyi ixtisaslardadır.</>}
          </div>

          {!fea.ok && (
            <div style={{ border: '1px solid #ffe58f', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '7px 12px', background: '#fffbe6', fontSize: 10.5, fontWeight: 800, color: '#874d00' }}>
                YER ÇATMAYAN NAMİZƏDLƏR — {fea.tightCandidates} nəfər, cəmi {fea.tightCapacity} yer
                {' '}(çatışmır: {fea.tightCandidates - fea.tightCapacity})
              </div>
              <div style={{ padding: '8px 12px', fontSize: 11, color: '#3a4560', lineHeight: 1.7, borderTop: '1px solid #fff1b8' }}>
                Bu namizədlər <b>yalnız {fea.tightLeaves.length} ixtisasa girə bilir</b> və orada cəmi {fea.tightCapacity} yer var.
                Ya həmin ixtisaslarda kvotanı artırın, ya da aşağıdakı artıq yerlərin kvotasını azaldın.
              </div>

              {/* Qrup üzrə kimin neçə nəfəri kənarda qala bilər */}
              <div style={{ borderTop: '1px solid #fff1b8' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', background: '#fffdf5', fontSize: 10, fontWeight: 800, color: '#8a8ab0', letterSpacing: .2 }}>
                  <span style={{ flex: 1 }}>QRUP</span>
                  <span style={{ width: 62, textAlign: 'right' }}>NAMİZƏD</span>
                  <span style={{ width: 96, textAlign: 'right' }}>KƏNARDA QALIR</span>
                </div>
                {fea.segments.filter(x => x.maxUnplaced > 0 || x.count > 0).map((x, i) => {
                  const risk = x.maxUnplaced > 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderTop: '1px solid #fff7e6', fontSize: 11 }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: risk ? 700 : 500, color: risk ? '#874d00' : '#8a8ab0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {segLabel(x)}
                      </span>
                      <span style={{ width: 62, textAlign: 'right', color: 'var(--muted)' }}>{x.count}</span>
                      <span style={{ width: 96, textAlign: 'right', fontWeight: 800, color: risk ? '#cf1322' : '#52c41a' }}>
                        {!risk
                          ? '—'
                          : x.minUnplaced === x.maxUnplaced
                            ? `${x.maxUnplaced} nəfər`
                            : `${x.minUnplaced}–${x.maxUnplaced} nəfər`}
                      </span>
                    </div>
                  )
                })}
                <div style={{ padding: '6px 12px', borderTop: '1px solid #fff7e6', fontSize: 10.5, color: 'var(--muted)', lineHeight: 1.6 }}>
                  Aralıq göstərilirsə, çatışmazlığın kimin üzərinə düşəcəyi qabaqcadan bilinmir —
                  bu qruplar eyni yerlər uğrunda yarışır və nəticə balların sıralamasından asılıdır.
                  Cəmi kənarda qalan: <b>{fea.deficit} nəfər</b>.
                </div>
              </div>
              {fea.surplusLeaves.length > 0 && (
                <div style={{ borderTop: '1px solid #fff1b8' }}>
                  <div style={{ padding: '6px 12px', background: '#fff7e6', fontSize: 10.5, fontWeight: 800, color: '#874d00' }}>
                    ARTIQ YERLƏR — {fea.surplusCandidates} namizəd üçün {fea.surplusCapacity} yer
                    {' '}(artıq: {fea.surplusCapacity - fea.surplusCandidates})
                  </div>
                  <div style={{ padding: '7px 12px', fontSize: 11, color: '#3a4560', lineHeight: 1.6, borderTop: '1px solid #fff7e6' }}>
                    Boş qalacaq yer bu ixtisaslardan birində olacaq. <b>Hansında olacağı əvvəlcədən müəyyən deyil</b> —
                    təhsilalanların sıralamasından asılıdır, çünki bu ixtisaslar eyni namizədlərə açıqdır və bir-birini əvəz edir.
                  </div>
                  {fea.surplusLeaves.map(l => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderTop: '1px solid #fff7e6', fontSize: 11 }}>
                      <span style={{ flex: 1, minWidth: 0, color: '#3a4560', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={l.pathLabel ? `${l.pathLabel} → ${l.name}` : l.name}>
                        {l.pathLabel ? `${l.pathLabel} → ` : ''}<b>{l.name}</b>
                      </span>
                      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>kvota {l.quota}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 800, color: '#5a6070', letterSpacing: .3, marginBottom: 8 }}>
            2. MƏNBƏ BALANSI (MÜLKİ / LİSEY)
          </div>

          <div style={{
            padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 12, lineHeight: 1.6,
            background: sb.ok ? '#f0fff4' : '#fff2f0',
            border: `1.5px solid ${sb.ok ? '#b7eb8f' : '#ffccc7'}`,
            color: sb.ok ? '#237804' : '#cf1322',
          }}>
            {sb.ok
              ? <>✅ <b>Balans yerindədir.</b> Mülki <b>{sb.mülki.seats}</b> yer / <b>{sb.mülki.candidates}</b> namizəd ·
                  lisey <b>{sb.lisey.seats}</b> yer / <b>{sb.lisey.candidates}</b> namizəd — hər ikisi tam oturur.</>
              : <>⚠️ <b>Mənbə slotları uyğun gəlmir.</b>{' '}
                  {sb.mülki.unfillable > 0 && <><b>{sb.mülki.unfillable} mülki yer</b> boş qalacaq. </>}
                  {sb.lisey.unfillable > 0 && <><b>{sb.lisey.unfillable} lisey yer</b> boş qalacaq. </>}
                  {sb.mülki.deficit > 0 && <><b>{sb.mülki.deficit} mülki namizəd</b> yersiz qalacaq. </>}
                  {sb.lisey.deficit > 0 && <><b>{sb.lisey.deficit} lisey namizəd</b> yersiz qalacaq. </>}
                  (mülki {sb.mülki.seats} yer / {sb.mülki.candidates} namizəd · lisey {sb.lisey.seats} yer / {sb.lisey.candidates} namizəd).
                  Manual kvotaları düzəldin; balans bərpa olunmayana qədər seçimi yayımlamaq mümkün deyil.</>}
          </div>

          {/* ── Qrup blokları: dəstələr ya tam eyni, ya tam ayrı olmalıdır ── */}
          {(() => {
            const hasConf = gbk.conflicts.length > 0
            const tone = hasConf ? { bg: '#fff7e6', bd: '#ffd591', fg: '#874d00' }
              : !gbk.ok ? { bg: '#fff2f0', bd: '#ffccc7', fg: '#cf1322' } : { bg: '#f0fff4', bd: '#b7eb8f', fg: '#237804' }
            const lvTxt = (l: { name: string; seats: number }[]) => l.map(x => `${x.name} (${x.seats})`).join(', ')
            const srcTxt = (s: string) => s === 'mülki' ? 'Mülki' : 'Lisey'
            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#5a6070', letterSpacing: .3, marginBottom: 8 }}>
                  QRUP BLOKLARI (QRUP × CİNS × MƏNBƏ)
                </div>
                <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 8, fontSize: 12, lineHeight: 1.6, background: tone.bg, border: `1.5px solid ${tone.bd}`, color: tone.fg }}>
                  {hasConf
                    ? <>⚠️ <b>Qrup məhdudiyyətləri kəsişir ({gbk.conflicts.length})</b> — eyni adamlar həm geniş, həm dar dəstəyə açıq ixtisaslara gedə bilir,
                        dar ixtisaslar boş qala bilər. Dəqiq hesablamaq mümkün deyil, aşağıda simulyasiya ilə təxmin verilir.
                        Düzəltmək üçün hər qrupu yalnız bir bloka salın (məs. «1, 2, lisey» / «3» / «4, lisey»).</>
                    : gbk.ok
                      ? <>✅ <b>Bloklar tam oturur.</b> Qrup dəstələri kəsişmir, hər blokda nəfər = yer — hamı yerləşir.</>
                      : <>⚠️ <b>Dəqiq nəticə: {gbk.exactOut} nəfər kənarda qalacaq</b>
                          {gbk.blocks.some(x => x.over > 0) && <>, {gbk.blocks.reduce((a, x) => a + x.over, 0)} yer boş qalacaq</>}. Aşağıdakı bloklara baxın.</>}
                </div>
                {hasConf && (
                  <div style={{ border: '1px solid #ffe7ba', borderRadius: 10, marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{ padding: '6px 12px', background: '#fffbf0', fontSize: 10, fontWeight: 800, color: '#ad6800' }}>KƏSİŞMƏLƏR</div>
                    {gbk.conflicts.map((c, i) => (
                      <div key={i} style={{ borderTop: '1px solid #fff1d6', padding: '6px 12px', fontSize: 11.5, color: '#3a4560' }}>
                        <b>{srcTxt(c.source)}</b> <span style={{ fontSize: 10, fontWeight: 800, color: '#d46b08' }}>[QRUP]</span>: «{c.a.label}» ↔ «{c.b.label}» — <b>{c.shared}</b> nəfər hər ikisinə gedə bilir
                        <div style={{ fontSize: 10.5, color: '#874d00', marginTop: 2 }}>
                          {lvTxt(c.a.leaves)} <span style={{ color: '#aaa' }}>↔</span> {lvTxt(c.b.leaves)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {gbk.liseyNoCand.length > 0 && (
                  <div style={{ padding: '8px 14px', borderRadius: 10, marginBottom: 8, fontSize: 11.5, background: '#fff2f0', border: '1.5px solid #ffccc7', color: '#cf1322' }}>
                    ⚠️ Lisey qrupu olmayan ixtisaslarda lisey yeri var — lisey kvotasını 0 edin: {lvTxt(gbk.liseyNoCand)}
                  </div>
                )}
                {hasConf && (
                  <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 8, fontSize: 12, lineHeight: 1.6,
                    background: sim === undefined ? '#f6f7fb' : sim && sim.max > 0 ? '#fff7e6' : '#f0fff4',
                    border: `1.5px solid ${sim === undefined ? '#e6e8f0' : sim && sim.max > 0 ? '#ffd591' : '#b7eb8f'}`,
                    color: sim === undefined ? '#8a909c' : sim && sim.max > 0 ? '#874d00' : '#237804' }}>
                    {sim === undefined ? <>⏳ Simulyasiya hesablanır…</>
                      : !sim ? <>—</>
                      : sim.max === 0 ? <>✅ Simulyasiya: {sim.runs} sınaqda heç kim kənarda qalmadı.</>
                      : <>Simulyasiya ({sim.runs} sınaq, hər kəs ona açıq ixtisasları təsadüfi sırada seçir): <b>kənarda qala bilər {sim.min === sim.max ? sim.max : `${sim.min}–${sim.max}`}</b>
                          {sim.min !== sim.max && <> (adətən <b>{sim.median}</b>)</>}
                          {sim.emptyLeaves.length > 0 && <div style={{ fontSize: 11, marginTop: 4 }}><b>Ən çox boş qalan:</b> {sim.emptyLeaves.slice(0, 6).map(l => `${l.name} (~${l.avgEmpty.toFixed(1)})`).join(', ')}</div>}
                        </>}
                  </div>
                )}
                <div style={{ border: '1px solid #eef0f5', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', gap: 8, padding: '6px 12px', background: '#fafbfd', fontSize: 10, fontWeight: 800, color: '#8a8ab0', letterSpacing: .2 }}>
                    <span style={{ flex: 1 }}>BLOK (KİMƏ AÇIQDIR)</span>
                    <span style={{ width: 52, textAlign: 'right' }}>NƏFƏR</span>
                    <span style={{ width: 52, textAlign: 'right' }}>YER</span>
                    <span style={{ width: 130, textAlign: 'right' }}>NƏTİCƏ</span>
                  </div>
                  {gbk.blocks.map((x, i) => {
                    const v = gbk.conflicts.some(c => c.source === x.source && (c.a.label === x.label || c.b.label === x.label))
                      ? { t: 'kəsişir', c: '#d46b08' }
                      : x.short > 0 ? { t: `${x.short} nəfər kənarda`, c: '#cf1322' }
                      : x.over > 0 ? { t: `${x.over} yer boş`, c: '#cf1322' }
                      : { t: '✓ oturur', c: '#237804' }
                    return (
                      <div key={i} style={{ borderTop: '1px solid #f3f4f8', padding: '6px 12px', fontSize: 11.5 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ flex: 1, fontWeight: 700, color: '#3a4560' }}>{srcTxt(x.source)} · {x.label}</span>
                          <span style={{ width: 52, textAlign: 'right' }}>{x.count}</span>
                          <span style={{ width: 52, textAlign: 'right', fontWeight: 800, color: '#874d00' }}>{x.seats}</span>
                          <span style={{ width: 130, textAlign: 'right', fontWeight: 800, color: v.c }}>{v.t}</span>
                        </div>
                        <div style={{ fontSize: 10.5, color: '#874d00', marginTop: 2 }}>{lvTxt(x.leaves)}</div>
                      </div>
                    )
                  })}
                  {(gbk.noPlace.mülki + gbk.noPlace.lisey) > 0 && (
                    <div style={{ borderTop: '1px solid #f3f4f8', padding: '6px 12px', fontSize: 11.5, color: '#cf1322', fontWeight: 700 }}>
                      Heç bir ixtisasa açıq deyil: mülki {gbk.noPlace.mülki}, lisey {gbk.noPlace.lisey}
                    </div>
                  )}
                </div>
              </>
            )
          })()}

          {/* ── Cins limitləri — ayrıca və konkret ── */}
          {(() => {
            // Yalnız məcburi itkilər cinsə bağlanır (bax: quota-pool → femaleForced)
            const femOut = sb.mülki.femaleForced + sb.lisey.femaleForced
            const malOut = sb.mülki.maleForced   + sb.lisey.maleForced
            const anyOut = sb.mülki.unattributedOut + sb.lisey.unattributedOut
            const hasIssue = sb.capIssues.length > 0 || sb.genderTight.length > 0 || femOut > 0 || malOut > 0
            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#5a6070', letterSpacing: .3, margin: '4px 0 8px' }}>
                  3. CİNS MƏHDUDİYYƏTLƏRİ (QADIN / KİŞİ)
                </div>
                <div style={{
                  padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 12, lineHeight: 1.6,
                  background: hasIssue ? '#fff2f0' : '#f0fff4',
                  border: `1.5px solid ${hasIssue ? '#ffccc7' : '#b7eb8f'}`,
                  color: hasIssue ? '#cf1322' : '#237804',
                }}>
                  {!hasIssue && <>✅ <b>Cins limitləri qaydasındadır.</b> Hər limit üçün yetərli namizəd var,
                    limitlər heç bir yeri bağlamır.
                    {anyOut > 0 && <> Yer sayı {anyOut} nəfər azdır, amma bu, cins limitindən deyil —
                      kimin kənarda qalacağını bal sıralaması müəyyən edir.</>}</>}

                  {hasIssue && <>
                    {(femOut > 0 || malOut > 0) && <>⚠️ <b>Cins limitinə görə kənarda qalanlar:</b>{' '}
                      {femOut > 0 && <><b>{femOut} qadın</b> </>}
                      {femOut > 0 && malOut > 0 && '· '}
                      {malOut > 0 && <><b>{malOut} kişi</b> </>}
                      namizəd. </>}
                    {anyOut > 0 && <>Bundan başqa <b>{anyOut} nəfər</b> sadəcə yer çatmadığına görə kənarda
                      qalacaq — cinsi qabaqcadan demək olmaz, bal sıralaması həll edir. </>}

                    {sb.capIssues.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <b>Limit cəmi kvotadan azdır</b> — bu yerlər heç bir halda dolmayacaq:
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 6 }}>
                          <thead>
                            <tr style={{ background: '#fff', color: '#5a6070', textAlign: 'left' }}>
                              <th style={{ padding: '5px 8px', fontWeight: 700 }}>İxtisas</th>
                              <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'center' }}>Kvota</th>
                              <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'center' }}>Qadın limiti</th>
                              <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'center' }}>Kişi limiti</th>
                              <th style={{ padding: '5px 8px', fontWeight: 700, textAlign: 'center' }}>Boş qalacaq</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sb.capIssues.map(c => (
                              <tr key={c.id} style={{ borderTop: '1px solid #ffccc7' }}>
                                <td style={{ padding: '5px 8px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    <span>{c.name}</span>
                                    <FixBtns id={c.id} />
                                  </div>
                                  {c.pathLabel && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{c.pathLabel}</div>}
                                </td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{c.quota}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{c.maxFemale ?? '—'}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center' }}>{c.maxMale ?? '—'}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 800 }}>{c.shortfall}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {sb.genderTight.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <b>Limiti tam dolmuş ixtisaslar</b> — daha çox namizəd var, limit buraxmır:
                        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                          {sb.genderTight.map(g => (
                            <li key={`${g.id}-${g.gender}`}>
                              {g.name}{g.pathLabel ? ` (${g.pathLabel})` : ''} — <b>{g.gender}</b> limiti{' '}
                              <b>{g.cap}</b>, ixtisasın kvotası {g.quota} <FixBtns id={g.id} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>}
                </div>
              </>
            )
          })()}

          {rep.groups.map((g, gi) => {
            // Eyni qayda: qərar yuvarlaqlaşdırılmamış sapma + tolerans ilə verilir
            const overG = (v: number) => Math.abs(v) > BALANCE_TOLERANCE + 1e-9
            const bad = overG(g.driftMülki) || overG(g.driftLisey)
            return (
              <div key={g.key || gi} style={{ border: `1.5px solid ${bad ? '#ffccc7' : '#e8eaf5'}`, borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
                <div style={{ padding: '8px 12px', background: bad ? '#fff2f0' : '#f8f9fd', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: bad ? '#cf1322' : '#5a6070' }}>
                    {bad ? '⚠️' : '✅'} Namizəd qrupu: {g.pool.total} nəfər
                    <span style={{ fontWeight: 600, color: 'var(--muted)' }}> (mülki {g.pool.mülki} · lisey {g.pool.lisey})</span>
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700 }}>
                    <span style={{ color: '#1677ff' }}>M {g.effMülki}</span>
                    <span style={{ color: 'var(--muted)', fontWeight: 500 }}> / avto {g.autoMülki}</span>
                    {' · '}
                    <span style={{ color: '#531dab' }}>L {g.effLisey}</span>
                    <span style={{ color: 'var(--muted)', fontWeight: 500 }}> / avto {g.autoLisey}</span>
                    {bad && (
                      <span style={{ color: '#cf1322' }}>
                        {' '}({g.driftMülki > 0 ? '+' : ''}{Math.round(g.driftMülki)} M · {g.driftLisey > 0 ? '+' : ''}{Math.round(g.driftLisey)} L)
                      </span>
                    )}
                  </span>
                </div>
                {g.leaves.map(l => {
                  const chg = l.effMülki !== l.autoMülki || l.effLisey !== l.autoLisey
                  return (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderTop: '1px solid #f2f4fa', fontSize: 11 }}>
                      <span style={{ flex: 1, minWidth: 0, color: '#3a4560', fontWeight: chg ? 800 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={l.pathLabel ? `${l.pathLabel} → ${l.name}` : l.name}>
                        {l.name}{l.isManual && <span style={{ color: '#c41d7f' }}> ✏️</span>}
                      </span>
                      <FixBtns id={l.id} />
                      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>kvota {l.quota}</span>
                      <span style={{ flexShrink: 0, fontWeight: 700, width: 92, textAlign: 'right' }}>
                        <span style={{ color: '#1677ff' }}>M {l.effMülki}</span>
                        {' · '}
                        <span style={{ color: '#531dab' }}>L {l.effLisey}</span>
                      </span>
                      <span style={{ flexShrink: 0, width: 74, textAlign: 'right', color: chg ? '#d46b08' : '#ccc' }}>
                        {chg ? `avto ${l.autoMülki}/${l.autoLisey}` : 'avto'}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
        <div className="modal-foot" style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 18px' }}>
          <button className="btn btn-outline" onClick={onClose}>Bağla</button>
        </div>
      </div>

      {/* ── Düzəliş alt-pəncərələri: yoxlama pəncərəsini bağlamadan balansı bərpa etmək üçün.
          Kliklər saxlanılır ki, alt-pəncərə ilə iş yoxlama pəncərəsini bağlamasın. */}
      <div onClick={e => e.stopPropagation()}>
      {fix && fixTarget && fix.kind === 'source' && (
        <QuotaModeModal
          node={fixTarget.leaf as any}
          path={fixTarget.path as any}
          treeNodes={(tree.nodes || []) as any}
          instUsers={instUsers}
          onClose={() => setFix(null)}
          onSave={(mode, mülkiQ, liseyQ) => { onQuotaMode?.(fix.nodeId, mode, mülkiQ, liseyQ); setFix(null) }}
        />
      )}
      {fix && fixTarget && fix.kind === 'gender' && (
        <GenderModal
          node={fixTarget.leaf as any}
          path={fixTarget.path as any}
          instUsers={instUsers}
          treeNodes={(tree.nodes || []) as any}
          onClose={() => setFix(null)}
          onSave={cfg => { onGenderConfig?.(fix.nodeId, cfg); setFix(null) }}
        />
      )}
      </div>
    </div>
  )
}

// ── Cinsə görə məhdudiyyət modalı (yalnız leaf) ──────────────────────────────
function GenderModal({ node, path, instUsers, treeNodes, onSave, onClose }: {
  node: TNode
  /** kökdən bu yarpağa qədər node-lar — namizəd hovuzunu süzmək üçün */
  path: TNode[]
  instUsers: any[]
  /** strukturun kök node-ları — struktur üzrə təsiri qabaqcadan hesablamaq üçün */
  treeNodes?: TNode[]
  onSave: (cfg: { allowFemale: boolean; allowMale: boolean; maxFemale: number | null; maxMale: number | null } | null) => void
  onClose: () => void
}) {
  const [allowF, setAllowF] = useState(node.allowFemale !== false)
  const [allowM, setAllowM] = useState(node.allowMale !== false)
  const [maxF, setMaxF] = useState<string>(node.maxFemale != null ? String(node.maxFemale) : '')
  const [maxM, setMaxM] = useState<string>(node.maxMale != null ? String(node.maxMale) : '')

  // Müəssisənin ümumi sayı deyil — bu ixtisasa namizəd ola bilənlər.
  // Yarpağın öz cins bayraqları sayılmır (elə burada təyin olunur), qrup və
  // budaq məhdudiyyətləri isə tətbiq edilir.
  const gp       = genderPool(instUsers, path)
  const femCount = gp.qadın
  const malCount = gp.kişi
  const outCount = instUsers.length - gp.total
  const quota = node.quota || 0
  const valid = allowF || allowM

  // ── Seçim yadda saxlanmadan ƏVVƏL təsiri göstər ───────────────────────────
  // Bu ixtisasa qalan namizəd: söndürülmüş cins çıxılır, cinsi yazılmayanlar qalır
  const genderless = Math.max(0, gp.total - femCount - malCount)
  const capF       = allowF && maxF.trim() !== '' ? Math.max(0, parseInt(maxF, 10) || 0) : null
  const capM       = allowM && maxM.trim() !== '' ? Math.max(0, parseInt(maxM, 10) || 0) : null
  const reachCap   = (allowF ? Math.min(femCount, capF ?? femCount) : 0)
                   + (allowM ? Math.min(malCount, capM ?? malCount) : 0) + genderless
  const unfilled   = Math.max(0, quota - reachCap)

  // Struktur üzrə təsir: cari vəziyyət ilə bu konfiqurasiya arasındakı fərq.
  // Qeyd: feasibility() maxFemale/maxMale limitlərini nəzərə almır — bu hesab
  // yalnız cins bayraqlarının (allowFemale/allowMale) təsirini göstərir.
  const fea = useMemo(() => {
    if (!treeNodes?.length || !instUsers.length || !valid) return null
    const patch = (ns: TNode[]): TNode[] => ns.map(n => n.id === node.id
      ? { ...n, allowFemale: allowF, allowMale: allowM, maxFemale: capF, maxMale: capM }
      : { ...n, children: n.children ? patch(n.children) : n.children })
    const before = feasibility(instUsers, treeNodes as any[])
    const after  = feasibility(instUsers, patch(treeNodes) as any[])
    return { before: before.deficit, after: after.deficit, diff: after.deficit - before.deficit }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeNodes, instUsers, node.id, allowF, allowM, capF, capM, valid])

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
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}>namizəd: {count} nəfər</span>
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
            <div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>Ümumi kvota: <span style={{ color: 'var(--blue)' }}>{quota}</span></div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Bu ixtisasa namizəd ola bilən <b>{gp.total}</b> nəfər
                {outCount > 0 && <> · <span style={{ color: '#c47f0a' }}>{outCount} nəfər qrup/budaq məhdudiyyətinə görə kənardadır</span></>}
              </div>
            </div>
          </div>

          {row('Qadın daxil ola bilər', femCount, '#c41d7f', allowF, setAllowF, maxF, setMaxF)}
          {row('Kişi daxil ola bilər',  malCount, '#0958d9', allowM, setAllowM, maxM, setMaxM)}

          {!valid && (
            <div style={{ fontSize: 12, color: '#cf1322', fontWeight: 600, marginBottom: 8 }}>
              ⚠ Ən azı bir cins seçilməlidir.
            </div>
          )}

          {/* Bu ixtisasda boş qalacaq yerlər */}
          {valid && unfilled > 0 && (
            <div style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 8, background: '#fff2f0', border: '1px solid #ffccc7', fontSize: 11.5, color: '#cf1322', lineHeight: 1.5 }}>
              ⚠️ Bu ixtisasa cəmi <b>{reachCap} nəfər</b> düşə bilər, kvota isə <b>{quota}</b> —{' '}
              <b>{unfilled} yer</b> boş qalacaq.
            </div>
          )}

          {/* Struktur üzrə təsir */}
          {fea && fea.diff > 0 && (
            <div style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 8, background: '#fffbe6', border: '1px solid #ffe58f', fontSize: 11.5, color: '#874d00', lineHeight: 1.5 }}>
              ⚠️ Yadda saxlasan struktur üzrə kənarda qalanlar <b>{fea.before} → {fea.after}</b> olacaq
              (<b>+{fea.diff} nəfər</b> heç bir ixtisasa yerləşə bilməyəcək).
            </div>
          )}
          {fea && fea.diff < 0 && (
            <div style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 8, background: '#f0fff4', border: '1px solid #b7eb8f', fontSize: 11.5, color: '#237804', lineHeight: 1.5 }}>
              ✅ Yadda saxlasan struktur üzrə kənarda qalanlar <b>{fea.before} → {fea.after}</b> olacaq
              ({-fea.diff} nəfər az).
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
function NodeRow({ node, depth, ancestors, treeNodes, onAdd, onEdit, onDelete, onPriority, onDeactivatePriority, onGroup, onDeactivateGroup, sourceProportional, instUsers, onQuotaMode, levelNames, hasGender, onGenderConfig }: {
  node: TNode; depth: number
  /** kökdən bu node-a qədərki əcdadlar (bu node daxil deyil) */
  ancestors?: TNode[]
  /** strukturun kök node-ları */
  treeNodes?: TNode[]
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
        <div className="spec-node-actions" style={{ display: 'flex', gap: 6, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', gap: 2 }}>
            <button
              onClick={() => onPriority(node)}
              style={{
                fontSize: 11, padding: '5px 11px',
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
                  fontSize: 11, padding: '5px 8px', borderRadius: '0 6px 6px 0',
                  border: '1.5px solid #f5a623', borderLeft: 'none',
                  background: '#fff1e6', color: '#d46b08',
                  fontWeight: 700, cursor: 'pointer',
                }}
                title="Prioriteti deaktiv et">
                ✕
              </button>
            )}
          </div>
          {/* Görünmə məhdudiyyəti düyməsi — qrup və/və ya əlavə sütun filtrləri */}
          {(() => {
            const grp     = node.groups ?? []
            const flt     = node.filters ?? {}
            const fltKeys = Object.keys(flt).filter(k => flt[k]?.length)
            const on      = grp.length > 0 || fltKeys.length > 0
            // Düymənin etiketi: qrup varsa "Q:…", əlavə sütun varsa onun dəyərləri.
            // Sütunun görünən adı NodeRow-a ötürülən levelNames-dən gəlir.
            const colLabel = (k: string) => {
              const m = /^lv(\d+)$/.exec(k)
              if (m) return levelNames[Number(m[1])] || k
              const mx = /^ex:(.+)$/i.exec(k)   // sərbəst mətn sütunu — adın özü
              if (mx) return mx[1].charAt(0).toUpperCase() + mx[1].slice(1)
              return ({ source: 'Mənbə', gender: 'Cins', year: 'Tədris ili' } as any)[k] || k
            }
            const parts = [
              ...(grp.length ? [`Q:${grp.join(',')}`] : []),
              ...fltKeys.map(k => flt[k].join(',')),
            ]
            const tip = on
              ? 'Görünmə məhdudiyyəti: ' + [
                  grp.length ? `Qrup — ${grp.join(', ')}` : null,
                  ...fltKeys.map(k => `${colLabel(k)} — ${flt[k].join(', ')}`),
                ].filter(Boolean).join(' · ')
              : 'Qrup və ya əlavə sütun üzrə məhdudiyyət təyin et'
            return (
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  onClick={() => onGroup(node)}
                  style={{
                    fontSize: 11, padding: '5px 11px',
                    borderRadius: on ? '6px 0 0 6px' : '6px',
                    border: `1.5px solid ${on ? '#52c41a' : '#dde'}`,
                    background: on ? '#f0fff4' : '#f8f9fd',
                    color: on ? '#237804' : '#bbb',
                    fontWeight: 700, cursor: 'pointer', transition: 'all .15s',
                    maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}
                  title={tip}>
                  👥 <span className="spec-btn-label">{on ? `${parts.join(' · ')} ✓` : 'Qrup'}</span>
                </button>
                {on && (
                  <button
                    onClick={() => onDeactivateGroup(node.id)}
                    style={{
                      fontSize: 11, padding: '5px 8px', borderRadius: '0 6px 6px 0',
                      border: '1.5px solid #52c41a', borderLeft: 'none',
                      background: '#f0fff4', color: '#237804',
                      fontWeight: 700, cursor: 'pointer',
                    }}
                    title="Bütün görünmə məhdudiyyətlərini sil">✕</button>
                )}
              </div>
            )
          })()}

          {/* Cins məhdudiyyəti düyməsi — yalnız leaf + datada cins varsa */}
          {hasGender && isLeaf && (() => {
            const restricted = node.allowFemale === false || node.allowMale === false || node.maxFemale != null || node.maxMale != null
            return (
              <button
                onClick={() => setGenderModal(true)}
                style={{
                  fontSize: 11, padding: '5px 11px', borderRadius: 6,
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
          path={[...(ancestors || []), node]}
          treeNodes={treeNodes || []}
          instUsers={instUsers || []}
          onClose={() => setQuotaModal(false)}
          onSave={(mode, mülkiQ, liseyQ) => onQuotaMode?.(node.id, mode, mülkiQ, liseyQ)}
        />
      )}

      {/* ── Cinsə görə məhdudiyyət modalı ── */}
      {genderModal && isLeaf && (
        <GenderModal
          node={node}
          path={[...(ancestors || []), node]}
          instUsers={instUsers || []}
          treeNodes={treeNodes}
          onClose={() => setGenderModal(false)}
          onSave={cfg => { onGenderConfig?.(node.id, cfg); setGenderModal(false) }}
        />
      )}

      {/* Uşaqlar — yalnız açıq olduqda */}
      {open && (node.children || []).map(child => (
        <NodeRow key={child.id} node={child} depth={depth + 1}
          ancestors={[...(ancestors || []), node]}
          treeNodes={treeNodes}
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
  const [students]              = useLocalState(userDb.getAll)
  const [tab, setTab]           = useActiveInst(insts as any[])

  // Tədris ili seçimləri — cari ildən başlayaraq 5 il
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 6 }, (_, i) => {
    const y = currentYear - 1 + i
    return `${y}–${y + 1}`
  })
  const [openTreeId, setOpenTreeId] = useState<string | null>(null)
  const [modal, setModal] = useState<any>(null)
  const { dialog: appDialog, showConfirm: showAppConfirm, showInfo: showAppInfo, closeDialog } = useDialog()
  const [confirm, setConfirm] = useState<{ message: string; onConfirm: () => void } | null>(null)
  const [priorityNode, setPriorityNode] = useState<{ treeId: string; node: TNode } | null>(null)
  const [groupNode,    setGroupNode]    = useState<{ treeId: string; node: TNode } | null>(null)
  const [balanceTree, setBalanceTree] = useState<any>(null)

  // ── Strukturun təhsilalan qrupu ─────────────────────────────────────────────
  // Qrup STRUKTURDA təyin olunur və bazada saxlanılır: struktur kimin üçün
  // qurulubsa, ona bağlı seçim də həmin təhsilalanları əhatə edir. Seçim
  // ekranında ayrıca qrup seçimi yoxdur — struktur seçilməklə qrup da gəlir.
  const [cohorts, setCohorts] = useState<any[]>([])
  useEffect(() => { cohortDb.getAll().then(setCohorts) }, [])
  const pickCohort = async (treeId: string, cohortId: string) => {
    await treeDb.update(treeId, { cohort: cohortId || null })
    const t = getTree(treeId)
    const c = cohorts.find((x: any) => x.id === cohortId)
    await addLog('admin', 'info', `Strukturun təhsilalan qrupu dəyişdi: "${t?.name || treeId}"`,
      c ? `Yeni qrup: ${c.label}` : 'Qrup silindi — bütün müəssisə')
    await refreshTrees()
  }
  // Müəssisənin aktiv qrupları
  const cohortsOf = (instId: string) =>
    cohorts.filter((c: any) => c.institution === instId && !c.isArchived)
  // Strukturun hesablamalarında istifadə olunan təhsilalanlar
  const usersForTree = (t: any): any[] => {
    const instId = t?.institution || ''
    if (!instId) return []
    const inInst = (students as any[]).filter((u: any) => u.institution === instId)
    const cid = t?.cohort || ''
    return cid ? inInst.filter((u: any) => u.cohort === cid) : inInst
  }

  if (!trees || !insts || !students) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Yüklənir...</div>
  }

  function askConfirm(message: string, onConfirm: () => void) {
    setConfirm({ message, onConfirm })
  }

  function getTree(id: string) { return (trees as any[]).find((t: any) => t.id === id) }
  function toggle(id: string)  { setOpenTreeId(prev => prev === id ? null : id) }

  async function handleSavePriority(data: { tiebreaker?: string[]; groupTiebreakers?: { [g: string]: string[] } }) {
    if (!priorityNode) return
    const { treeId, node } = priorityNode
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], node.id, {
      tiebreaker: data.tiebreaker,
      groupTiebreakers: data.groupTiebreakers,
    }))
    await addLog('admin', 'info', `Prioritet (tiebreaker) təyin edildi: "${node.name}"`,
      data.groupTiebreakers ? `${Object.keys(data.groupTiebreakers).length} qrup üzrə` : (data.tiebreaker?.join(', ') || '—'))
    setPriorityNode(null)
  }

  async function handleDeactivatePriority(treeId: string, nodeId: string) {
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], nodeId, { tiebreaker: undefined, groupTiebreakers: undefined }))
    await addLog('admin', 'info', `Prioritet deaktiv edildi`, `Struktur: ${t?.name} · nodeId: ${nodeId}`)
  }

  async function handleSaveGroups(groups: string[], filters?: { [col: string]: string[] }) {
    if (!groupNode) return
    const { treeId, node } = groupNode
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], node.id, {
      groups: groups.length ? groups : undefined,
      filters,
    }))
    // Jurnal üçün sütunun görünən adı: lvN -> strukturun səviyyə adı
    const lvl = levelNamesOf(t)
    const filterText = filters
      ? Object.keys(filters).map(k => {
          const m = /^lv(\d+)$/.exec(k)
          const label = m ? (lvl[Number(m[1])] || k) : ({ source: 'Mənbə', gender: 'Cins', year: 'Tədris ili' } as any)[k] || k
          return `${label}: ${filters[k].join(', ')}`
        }).join(' · ')
      : ''
    await addLog('admin', 'info', `Görünmə məhdudiyyəti yeniləndi: "${node.name}"`,
      [groups.length ? `Qruplar: ${groups.join(', ')}` : 'Qrup məhdudiyyəti yoxdur',
       filterText || 'Əlavə sütun məhdudiyyəti yoxdur'].join(' · '))
    setGroupNode(null)
  }

  async function handleDeactivateGroup(treeId: string, nodeId: string) {
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], nodeId, { groups: undefined, filters: undefined }))
    await addLog('admin', 'info', `Görünmə məhdudiyyəti silindi`, `Struktur: ${t?.name} · nodeId: ${nodeId}`)
  }

  async function handleQuotaMode(treeId: string, nodeId: string, mode: 'auto' | 'manual', mülkiQ?: number, liseyQ?: number) {
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], nodeId, {
      quotaMode: mode,
      mülkiQuota: mode === 'manual' ? mülkiQ : undefined,
      liseyQuota: mode === 'manual' ? liseyQ : undefined,
    }))
    await addLog('admin', 'info',
      `İxtisas kvota rejimi: ${mode === 'manual' ? 'Manual' : 'Avtomatik'} — ${nodeId}`,
      mode === 'manual' ? `Mülki: ${mülkiQ} · Lisey: ${liseyQ}` : 'Faiz nisbətinə görə')
  }

  async function handleGenderConfig(treeId: string, nodeId: string, cfg: { allowFemale: boolean; allowMale: boolean; maxFemale: number | null; maxMale: number | null } | null) {
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], nodeId, cfg
      ? { allowFemale: cfg.allowFemale, allowMale: cfg.allowMale, maxFemale: cfg.maxFemale, maxMale: cfg.maxMale }
      : { allowFemale: undefined, allowMale: undefined, maxFemale: undefined, maxMale: undefined }))
    await addLog('admin', 'info', `İxtisas cins məhdudiyyəti — ${nodeId}`,
      cfg ? `Qadın: ${cfg.allowFemale ? 'bəli' : 'xeyr'}${cfg.maxFemale != null ? ' (max '+cfg.maxFemale+')' : ''} · Kişi: ${cfg.allowMale ? 'bəli' : 'xeyr'}${cfg.maxMale != null ? ' (max '+cfg.maxMale+')' : ''}` : 'Məhdudiyyət silindi')
  }

  // ── Müəssisənin təhsilalanlarından ən çox rast gəlinən tədris ilini tap ──────
  function getInstYear(instId: string): string {
    const us = (students as any[]).filter((u: any) => u.institution === instId && u.year)
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
  async function createTree() {
    const instId = modal.instId || (tab || (insts as any[])[0]?.id || '')
    const inst   = (insts as any[]).find((i: any) => i.id === instId)
    const label  = modal.instLabel || inst?.label || ''
    const extra  = (modal.name || '').trim()
    const name   = [label, extra].filter(Boolean).join(' - ').trim()
    if (!instId || !name) return
    const created = await treeDb.create({ name, year: modal.year?.trim() || '', icon: modal.icon || inst?.icon || '', institution: instId, levelNames: [...DEFAULT_LEVEL_NAMES] })
    await addLog('admin', 'success', `Yeni ixtisas strukturu yaradıldı: "${name}"`, `İl: ${modal.year?.trim() || '—'} · Müəssisə: ${inst?.label || '—'}`)
    await refreshTrees(); setOpenTreeId(created.id); setModal(null)
  }

  async function renameTree(treeId: string) {
    const t = getTree(treeId)
    const instId = modal.instId || t?.institution || ''
    const inst   = (insts as any[]).find((i: any) => i.id === instId)
    const name   = (modal.name || modal.instLabel || inst?.label || t?.name || '').trim()
    if (!name) return
    const cleanedLevels = Array.isArray(modal.levelNames) && modal.levelNames.length
      ? modal.levelNames.map((v: string, i: number) => (v || '').trim() || DEFAULT_LEVEL_NAMES[i] || `Səviyyə ${i + 1}`)
      : (t?.levelNames || [...DEFAULT_LEVEL_NAMES])
    await treeDb.update(treeId, { ...t, name, year: modal.year?.trim() || '', icon: modal.icon ?? t.icon ?? '', institution: instId || t.institution || '', levelNames: cleanedLevels })
    await addLog('admin', 'info', `İxtisas strukturu yeniləndi: "${name}"`, `Səviyyələr: ${cleanedLevels.join(' › ')}`)
    await refreshTrees(); setModal(null)
  }

  // Backend 409/500 qaytaranda istifadeciye aydin mesaj gosterilsin
  function apiErrorText(e: any): string {
    const raw = String(e?.message ?? e ?? '')
    try { const j = JSON.parse(raw); if (j?.message) return j.message } catch { /* JSON deyil */ }
    if (/DbUpdateException|foreign key|constraint/i.test(raw))
      return 'Bu struktur başqa qeydlərdə (seçimlərdə) istifadə olunur, ona görə silinə bilmir.'
    return raw || 'Naməlum xəta baş verdi.'
  }

  function showApiError(title: string, e: any) {
    showAppInfo({ icon: '⚠️', iconBg: '#fdecea', iconColor: '#c0392b', title, message: apiErrorText(e) })
  }

  function deleteTree(id: string) {
    const t = getTree(id)
    askConfirm('Bu struktur və içindəki bütün ixtisaslar silinəcək. Bu əməliyyat geri alına bilməz.', async () => {
      try {
        await treeDb.delete(id)
      } catch (e) {
        setConfirm(null)
        showApiError('Struktur silinmədi', e)
        return
      }
      if (openTreeId === id) setOpenTreeId(null)
      await addLog('admin', 'warning', `İxtisas strukturu silindi: "${t?.name || id}"`, 'Bütün ixtisaslar da silindi')
      await refreshTrees()
      setConfirm(null)
    })
  }

  // ── Node CRUD (rekursiv) ──────────────────────────────────────────────────
  async function saveNodes(treeId: string, nodes: TNode[]) {
    const t = getTree(treeId)
    await treeDb.update(treeId, { ...t, nodes })
    await refreshTrees()
  }

  async function handleAddChild(treeId: string, parentId: string | null) {
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
      await treeDb.update(treeId, { ...t, nodes: newNodes, levelNames: existing })
      await refreshTrees()
    } else {
      await saveNodes(treeId, newNodes)
    }
    await addLog('admin', 'success', `Yeni node əlavə edildi: "${name}"`, `Struktur: ${t?.name}${quota !== undefined ? ` · Kvota: ${quota}` : ''}`)
    setModal(null)
  }

  async function handleEditNode(treeId: string, nodeId: string) {
    const name = modal.name?.trim(); if (!name) return
    const quota = modal.quota !== '' && modal.quota != null ? Number(modal.quota) : undefined
    const t = getTree(treeId)
    await saveNodes(treeId, updateNode(t.nodes || [], nodeId, { name, quota }))
    await addLog('admin', 'info', `Node yeniləndi: "${name}"`, `Struktur: ${t?.name}${quota !== undefined ? ` · Kvota: ${quota}` : ''}`)
    setModal(null)
  }

  function handleDeleteNode(treeId: string, nodeId: string) {
    const t = getTree(treeId)
    askConfirm('Bu element və bütün alt elementləri silinəcək. Bu əməliyyat geri alına bilməz.', async () => {
      await saveNodes(treeId, deleteNode(t.nodes || [], nodeId))
      await addLog('admin', 'warning', `Node silindi`, `Struktur: ${t?.name} · nodeId: ${nodeId}`)
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
        const allUsers = (students as any[]).filter((u: any) => u.institution === instId)
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
          users={usersForTree(getTree(groupNode.treeId))}
          levelNames={levelNamesOf(getTree(groupNode.treeId))}
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
                <label className="form-label">📅 Tədris İli</label>
                {(() => {
                  // Siyahı: standart illər + strukturun mövcud ili (siyahıdan kənar ola bilər)
                  const opts = [...yearOptions]
                  if (modal.year && !opts.includes(modal.year)) opts.unshift(modal.year)
                  const custom = !!modal.yearCustom
                  return (<>
                    <select className="form-input" style={{ cursor: 'pointer' }}
                      value={custom ? '__custom__' : (modal.year || '')}
                      onChange={e => {
                        const v = e.target.value
                        if (v === '__custom__') setModal((m: any) => ({ ...m, yearCustom: true, year: '' }))
                        else setModal((m: any) => ({ ...m, yearCustom: false, year: v }))
                      }}>
                      <option value="">— seçilməyib —</option>
                      {opts.map(y => <option key={y} value={y}>{y}</option>)}
                      <option value="__custom__">✏️ Özüm yazım...</option>
                    </select>
                    {custom && (
                      <input className="form-input" style={{ marginTop: 8 }} autoFocus
                        placeholder="2031–2032" maxLength={9}
                        value={modal.year || ''}
                        onChange={e => {
                          let v = e.target.value.replace(/[^\d\-–]/g, '')
                          if (/^\d{5,}$/.test(v)) v = v.slice(0, 4) + '–' + v.slice(4, 8)
                          setModal((m: any) => ({ ...m, year: v }))
                        }} />
                    )}
                    {(() => {
                      // Təhsilalanlara görə təklif — fərqlidirsə bir kliklə tətbiq et
                      const sug = getInstYear(modal.instId || '')
                      if (!sug || sug === modal.year) return null
                      return (
                        <div style={{ fontSize: 11, marginTop: 6, color: 'var(--muted)' }}>
                          Təhsilalanlara görə: <b>{sug}</b>{' '}
                          <button type="button"
                            onClick={() => setModal((m: any) => ({ ...m, year: sug, yearCustom: false }))}
                            style={{ border: 'none', background: 'none', padding: 0, color: 'var(--blue)', fontWeight: 700, fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}>
                            tətbiq et
                          </button>
                        </div>
                      )
                    })()}
                    {!modal.year && !custom && (
                      <div style={{
                        marginTop: 8, padding: '9px 12px', borderRadius: 10,
                        background: '#fff8e6', border: '1.5px solid #ffd591',
                        fontSize: 12, color: '#d46b08',
                      }}>
                        ⚠️ Tədris ili seçilməyib
                      </div>
                    )}
                  </>)
                })()}
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

      {balanceTree && (() => {
        // Düzəlişdən sonra rəqəmlər dərhal yenilənsin deyə ağac hər dəfə
        // siyahıdan təzə götürülür (balanceTree yalnız id daşıyıcısıdır).
        const bt = (trees as any[]).find((t: any) => t.id === balanceTree.id) || balanceTree
        return (
          <BalanceModal
            tree={bt}
            instUsers={usersForTree(bt)}
            onClose={() => setBalanceTree(null)}
            onQuotaMode={(nodeId, mode, mülkiQ, liseyQ) => handleQuotaMode(bt.id, nodeId, mode, mülkiQ, liseyQ)}
            onGenderConfig={(nodeId, cfg) => handleGenderConfig(bt.id, nodeId, cfg)}
          />
        )
      })()}

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
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>
                        {rootCount} {lvN[0] || 'qoşun növü'}
                        {midCount > 0 && ` · ${midCount} ${lvN[1] || 'mülki ixtisas'}`}
                        {` · ${leaves} ${lvN[2] || 'hərbi uçot ixtisası'} · Ümumi kvota: ${quota}`}
                      </span>

                      {/* ── Mənbə balansı — kompakt nişan, təfsilat klikləyəndə açılır ── */}
                      {t.sourceProportional && (() => {
                        const tUsers = t.institution
                          ? usersForTree(t)
                          : []
                        if (!(t.nodes || []).length) return null
                        // Yerləşdirmə mənbə slotlarını qarışdırmır → ölçü real
                        // icra olunabilirlikdir: boş qalacaq yer / yersiz qalacaq namizəd
                        const sb = sourceBalance(tUsers, t.nodes || [])
                        // Max-flow "qaydasındadır" desə də, bölgü MƏCBURİ ola bilər:
                        // ehtiyat namizədi olmayan budağın namizədləri kənara da
                        // gedə bilirsə, hər gedən bir boş yer + bir kənarda qalan
                        // namizəd deməkdir. Bunu ayrıca xəbərdarlıq kimi göstəririk.
                        const fr = fragileRisks(tUsers, t.nodes || [])
                        const frSeats = fr.reduce((a, x) => a + x.riskSeats, 0)
                        const gbk = groupBlocks(tUsers, t.nodes || [])
                        const chip = {
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          fontSize: 10, fontWeight: 700, borderRadius: 6,
                          padding: '1px 7px', whiteSpace: 'nowrap' as const,
                        }
                        if (sb.ok && !gbk.ok) {
                          const conf = gbk.conflicts.length
                          return (
                            <span onClick={e => { e.stopPropagation(); setBalanceTree(t) }}
                              title={conf ? 'Qrup məhdudiyyətləri kəsişir: ' + gbk.conflicts.slice(0, 3).map(c => `«${c.a.label}» ↔ «${c.b.label}»`).join(', ') + ' — təfsilat üçün klikləyin'
                                : 'Bloklarda nəfər və yer uyğun deyil — təfsilat üçün klikləyin'}
                              style={{ ...chip, color: conf ? '#d46b08' : '#cf1322', background: conf ? '#fff7e6' : '#fff2f0', border: `1px solid ${conf ? '#ffd591' : '#ffccc7'}`, cursor: 'pointer' }}>
                              {conf ? `⚠️ Qrup kəsişməsi: ${conf}` : `⚠️ Blok: ${gbk.exactOut} nəfər kənarda`}
                            </span>
                          )
                        }
                        if (sb.ok && frSeats === 0) {
                          return (
                            <span title="Hər mənbənin yer sayı namizəd sayı ilə tam oturur"
                              style={{ ...chip, color: '#237804', background: '#f0fff4', border: '1px solid #b7eb8f' }}>
                              ✅ Balans
                            </span>
                          )
                        }
                        // Mənbə balansı özü qaydasındadırsa, amma bölgü kövrəkdirsə —
                        // ayrıca sarı xəbərdarlıq (səhv deyil, risk).
                        if (sb.ok) {
                          return (
                            <span onClick={e => { e.stopPropagation(); setBalanceTree(t) }}
                              title={'Bölgü yalnız məcburi halda oturur: ' +
                                fr.map(x => `"${x.nodeName}" — ${x.capacity} yerə ${x.candidates} namizəd; açıq qalan: ${x.leakTargets.map(t => t.label + ' (' + t.quota + ')').join(', ')}`).join(' · ') +
                                ' — təfsilat üçün klikləyin'}
                              style={{ ...chip, color: '#d46b08', background: '#fff7e6', border: '1px solid #ffd591', cursor: 'pointer' }}>
                              ⚠️ Kövrək bölgü — {frSeats} yer risk altında
                            </span>
                          )
                        }
                        const parts: string[] = []
                        if (sb.mülki.unfillable > 0) parts.push(`M +${sb.mülki.unfillable}`)
                        if (sb.mülki.deficit    > 0) parts.push(`M −${sb.mülki.deficit}`)
                        if (sb.lisey.unfillable > 0) parts.push(`L +${sb.lisey.unfillable}`)
                        if (sb.lisey.deficit    > 0) parts.push(`L −${sb.lisey.deficit}`)
                        // Səbəb cins limitidirsə, nişanda dərhal görünsün
                        const genderCause = sb.capIssues.length > 0 || sb.genderTight.length > 0
                        const femOut = sb.mülki.femaleForced + sb.lisey.femaleForced
                        const malOut = sb.mülki.maleForced   + sb.lisey.maleForced
                        if (femOut > 0) parts.push(`♀ −${femOut}`)
                        if (malOut > 0) parts.push(`♂ −${malOut}`)
                        if (frSeats > 0) parts.push(`kövrək ${frSeats}`)
                        const tip = genderCause
                          ? (sb.capIssues.length > 0
                              ? `Cins limiti kvotadan azdır: ${sb.capIssues.map(c => c.name).slice(0, 3).join(', ')} — təfsilat üçün klikləyin`
                              : `Cins limiti darboğazdır: ${sb.genderTight.map(g => `${g.name} (${g.gender})`).slice(0, 3).join(', ')} — təfsilat üçün klikləyin`)
                          : '+ boş qalacaq yer · − yersiz qalacaq namizəd — təfsilat üçün klikləyin'
                        return (
                          <span onClick={e => { e.stopPropagation(); setBalanceTree(t) }}
                            title={tip}
                            style={{ ...chip, color: '#cf1322', background: '#fff2f0', border: '1px solid #ffccc7', cursor: 'pointer' }}>
                            ⚠️ Balans{parts.length ? ` ${parts.join(' · ')}` : ' pozulub'}
                          </span>
                        )
                      })()}

                      {/* Real seçimlərlə kənarda qala biləcəklər — arxa planda simulyasiya */}
                      {t.institution && (t.nodes || []).length > 0 && (
                        <SimChip users={usersForTree(t)} tree={t} onOpen={() => setBalanceTree(t)} />
                      )}

                      {/* Ümumi kvota təhsilalan sayına bərabərdirmi — fərq olsa ya boş yer
                          qalacaq, ya da kimsə yersiz qalacaq (mənbə rejimindən asılı deyil) */}
                      {(() => {
                        if (!t.institution || !(t.nodes || []).length) return null
                        const cnt = usersForTree(t).length
                        if (cnt === 0 || cnt === quota) return null
                        const diff = quota - cnt
                        const over = diff > 0
                        return (
                          <span onClick={e => { e.stopPropagation(); setBalanceTree(t) }}
                            title={over
                              ? `Ümumi kvota (${quota}) təhsilalan sayından (${cnt}) ${diff} çoxdur — ${diff} yer boş qalacaq`
                              : `Təhsilalan sayı (${cnt}) ümumi kvotadan (${quota}) ${-diff} çoxdur — ən azı ${-diff} nəfər yersiz qalacaq`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap', cursor: 'pointer',
                              color: '#cf1322', background: '#fff2f0', border: '1px solid #ffccc7',
                            }}>
                            ⚠️ Kvota {quota} ≠ təhsilalan {cnt} ({over ? `${diff} boş yer` : `${-diff} nəfər yersiz`})
                          </span>
                        )
                      })()}

                      {/* Kvota rəqəmləri strukturla uyğundurmu (mənbə bölgüsündən asılı deyil) */}
                      {(() => {
                        const tUsers = t.institution
                          ? usersForTree(t)
                          : []
                        if (tUsers.length === 0 || !(t.nodes || []).length) return null
                        const f = feasibility(tUsers, t.nodes || [])
                        if (f.ok) return null
                        return (
                          <span onClick={e => { e.stopPropagation(); setBalanceTree(t) }}
                            title={`Kvota rəqəmlərinə görə ${f.deficit} təhsilalan heç bir halda yerləşə bilmir — təfsilat üçün klikləyin`}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              fontSize: 10, fontWeight: 700, borderRadius: 6, padding: '1px 7px',
                              whiteSpace: 'nowrap', color: '#874d00', background: '#fffbe6',
                              border: '1px solid #ffe58f', cursor: 'pointer',
                            }}>
                            ⚠️ Kvota: {f.deficit} nəfər kənarda
                          </span>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Düymələr */}
                  <div className="spec-tree-actions" onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

                    {/* ── Hesablamaların aparıldığı təhsilalan qrupu ──────────
                        Struktur qrupa aid deyil; bu seçici yalnız balans/kvota
                        rəqəmlərinin hansı qrupun namizədləri üzrə hesablanacağını
                        müəyyən edir. */}
                    {(() => {
                      const list = cohortsOf(t.institution || '')
                      if (list.length < 1) return null
                      const cid = t.cohort || ''
                      const cnt = usersForTree(t).length
                      return (
                        <div title="Bu struktur hansı təhsilalan qrupu üçündür — ona bağlı seçimlər də bu qrupu əhatə edəcək"
                          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Qrup:</span>
                          <select
                            value={cid}
                            onChange={e => pickCohort(t.id, e.target.value)}
                            style={{
                              fontSize: 11.5, fontWeight: 700, padding: '4px 8px', borderRadius: 8,
                              border: '1.5px solid ' + (cid ? '#adc6ff' : '#ffd591'),
                              background: cid ? '#f0f5ff' : '#fff7e6',
                              color: cid ? '#0958d9' : '#d46b08',
                              cursor: 'pointer', maxWidth: 220,
                            }}>
                            <option value="">— Bütün müəssisə —</option>
                            {list.map((c: any) => (
                              <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                          </select>
                          <span style={{
                            fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10,
                            background: cid ? '#e6f0ff' : '#ffe7ba',
                            color: cid ? '#0958d9' : '#d46b08', whiteSpace: 'nowrap',
                          }}>{cnt}</span>
                        </div>
                      )
                    })()}

                    {/* ── Proporsional bölgü toggle ── */}
                    <div
                      onClick={async () => {
                        const next = !t.sourceProportional
                        await treeDb.update(t.id, { sourceProportional: next })
                        await refreshTrees()
                        await addLog('admin', next ? 'success' : 'info',
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
                        message: `"${t.name}" ixtisas strukturu və ona bağlı bütün seçimlər arxivə köçürüləcək. Heç nə silinmir — nəticələr və təhsilalanlar olduğu kimi qalır, bərpa edəndə hər şey geri qayıdır.`,
                        confirmLabel: 'Arxivlə', confirmColor: '#9a7b1e',
                        onConfirm: async () => {
                          try {
                            await treeDb.archive(t.id)
                          } catch (e) {
                            showApiError('Struktur arxivlənmədi', e)
                            return
                          }
                          if (openTreeId === t.id) setOpenTreeId(null)
                          await addLog('admin', 'info', `İxtisas strukturu arxivləndi: "${t.name}"`, `İl: ${t.year || '—'}`)
                          await refreshTrees()
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
                    <button className="btn btn-danger btn-sm" style={{ border: '1.5px solid transparent' }}
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
                        // Yalnız seçilmiş təhsilalan qrupunun namizədləri
                        const instUsers = tInstId ? usersForTree(t) : []
                        const hasGender = instUsers.some((u: any) => u.gender)
                        return nodes.map((node: TNode) => (
                          <NodeRow
                            key={node.id}
                            node={node}
                            depth={0}
                            treeNodes={t.nodes || []}
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

/** Struktur kartındakı nişan: sadə üsulun simulyasiyasına görə kənarda qala biləcəklər */
function SimChip({ users, tree, onOpen }: { users: any[]; tree: any; onOpen: () => void }) {
  // Simulyasiya yalnız qrup kəsişməsi olanda lazımdır (yoxsa blok hesabı dəqiqdir)
  const conf = groupBlocks(users, tree?.nodes || []).conflicts.length > 0
  const sim = useBalanceSim(conf ? users : [], tree)
  if (!sim || sim.max === 0) return null   // hesablanır və ya hamı yerləşir
  const chip = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    fontSize: 10, fontWeight: 700, borderRadius: 6,
    padding: '1px 7px', whiteSpace: 'nowrap' as const,
  }
  const range = sim.min === sim.max ? String(sim.max) : `${sim.min}–${sim.max}`
  return (
    <span onClick={e => { e.stopPropagation(); onOpen() }}
      title={`Sadə üsul ${sim.runs} dəfə təsadüfi seçimlərlə işlədildi (hər kəs ona açıq bütün ixtisasları seçir): ${range} nəfər kənarda qalır` +
        (sim.emptyLeaves.length ? `. Ən çox boş qalan: ${sim.emptyLeaves.slice(0, 3).map(l => l.name).join(', ')}` : '') + ' — təfsilat üçün klikləyin'}
      style={{ ...chip, color: '#d46b08', background: '#fff7e6', border: '1px solid #ffd591', cursor: 'pointer' }}>
      ⚠️ Kənarda qala bilər: {range}{sim.min !== sim.max ? ` (adətən ${sim.median})` : ''}
    </span>
  )
}
