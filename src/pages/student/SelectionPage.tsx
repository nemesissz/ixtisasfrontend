import DragDemo from '../../components/DragDemo'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { selectionDb, treeDb, userDb, submissionDb, systemSettingsDb, addLog } from '../../db'
import { getStudentSession, clearStudentSession } from '../../api/auth'
import { BASE_URL } from '../../api/http'
import {
  FlatView, NestedView,
  treeToNested, nestedToFlat, flatToNested,
  type FlatRow, type GroupEntry,
} from '../../components/SpecialtyViews'

// ── Qrupa görə ağacı filtrə et ───────────────────────────────────────────────
function filterTreeByGroup(tree: any, studentGroup: string | null | undefined): any {
  if (!studentGroup) return tree
  function filterNodes(nodes: any[]): any[] {
    return nodes.map(node => {
      if (node.groups && node.groups.length > 0 && !node.groups.includes(studentGroup)) return null
      if (node.children?.length > 0) {
        const filtered = filterNodes(node.children)
        if (filtered.length === 0) return null
        return { ...node, children: filtered }
      }
      return node
    }).filter(Boolean)
  }
  return { ...tree, nodes: filterNodes(tree.nodes || []) }
}

// ── Əvvəlcədən bölgü səviyyəsinə görə ağacı filtrə et ────────────────────────
// preAssignLevel-dəki node adı təhsilalanın branch dəyəri ilə uyğun gələn alt ağac saxlanılır
export function filterTreeByBranch(tree: any, branchName: string | null | undefined, level: number | null | undefined): any {
  if (!tree || level == null || !branchName) return tree
  const target = String(branchName).trim().toLowerCase()
  function walk(nodes: any[], depth: number): any[] {
    if (depth === level) {
      return nodes.filter(n => String(n.name).trim().toLowerCase() === target)
    }
    return nodes.map(n => {
      if (!n.children?.length) return null   // bu səviyyədən dayaz yarpaqlar (uyğun deyil) atılır
      const ch = walk(n.children, depth + 1)
      return ch.length ? { ...n, children: ch } : null
    }).filter(Boolean)
  }
  const nodes = walk(tree.nodes || [], 0)
  return { ...tree, nodes }
}

// ── Təyin edilmiş səviyyəni ağacdan yığışdır ─────────────────────────────────
// Qoşun növü seçimdə əvvəlcədən təyin edilibsə, kursant onu görməməlidir —
// həmin səviyyənin node-ları silinir, uşaqları bir səviyyə yuxarı qaldırılır.
export function collapseLevel(tree: any, level: number): any {
  function walk(nodes: any[], depth: number): any[] {
    if (depth === level) return nodes.flatMap(n => n.children || [])
    return nodes.map(n => n.children?.length ? { ...n, children: walk(n.children, depth + 1) } : n)
  }
  return { ...tree, nodes: walk(tree.nodes || [], 0) }
}

// ── Cinsə görə ağacı filtrə et ───────────────────────────────────────────────
// Təhsilalanın cinsinə icazə verilməyən ixtisaslar siyahıdan çıxarılır
function filterTreeByGender(tree: any, gender: string | null | undefined): any {
  if (!tree || !gender) return tree
  function filterNodes(nodes: any[]): any[] {
    return nodes.map(node => {
      if (node.children?.length > 0) {
        const ch = filterNodes(node.children)
        return ch.length ? { ...node, children: ch } : null
      }
      // leaf — cinsə icazə yoxdursa çıxar
      if (gender === 'qadın' && node.allowFemale === false) return null
      if (gender === 'kişi'  && node.allowMale   === false) return null
      return node
    }).filter(Boolean)
  }
  return { ...tree, nodes: filterNodes(tree.nodes || []) }
}

// ── Canlı nəzarət siqnalı ────────────────────────────────────────────────────
// Seçimi HEÇ VAXT bloklamır: gözlənilmir, 4 san timeout, xəta udulur, 401-də
// yönləndirmə etmir (ümumi http helper-dən fərqli olaraq). Növbəti interval
// serverdən gəlir — superadmin dəyişəndə açıq səhifələr özü uyğunlaşır.
// selectionId: hər seçimin öz seansı olur, canlı ekranda seçimin adı görünür.
async function sendBeat(submitted: boolean, selectionId: string | undefined): Promise<number | null> {
  const token = getStudentSession()?.token
  if (!token) return null
  const ctl = new AbortController()
  const to = setTimeout(() => ctl.abort(), 4000)
  try {
    const res = await fetch(`${BASE_URL}/api/monitor/beat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ submitted, selectionId }),
      signal: ctl.signal,
      keepalive: submitted,
    })
    if (!res.ok) return null
    const j = await res.json()
    return Number(j?.nextBeatSec) || null
  } catch { return null } finally { clearTimeout(to) }
}

export default function SelectionPage() {
  const { selId } = useParams<{ selId: string }>()
  const navigate  = useNavigate()

  // ── Auth ──────────────────────────────────────────────────────────────────
  const student = getStudentSession()
  useEffect(() => { if (!student) navigate('/student', { replace: true }) }, [])

  // ── Data ──────────────────────────────────────────────────────────────────
  const [loaded,    setLoaded]    = useState(false)
  const [selection, setSelection] = useState<any>(null)
  const [tree,      setTree]      = useState<any>(null)
  const [redirectSeconds, setRedirectSeconds] = useState(10)
  // Təsdiqdən sonrakı elan — superadmin panelindən yazılır, boşdursa göstərilmir
  const [submitNotice, setSubmitNotice] = useState('')
  const viewMode: 'list' | 'nested' = selection?.viewMode || 'list'

  // Kursanta göstərilən səviyyə adları — təyin edilmiş (yığışdırılmış) səviyyə çıxarılır
  const displayLevelNames = useMemo(() => {
    const lv: string[] = tree?.levelNames || []
    const pal = selection?.preAssignLevel
    const branchName = pal != null ? student?.branchByLevel?.[pal] : null
    if (pal == null || !branchName) return lv
    return lv.filter((_: string, i: number) => i !== pal)
  }, [tree, selection, student])

  // ── State ─────────────────────────────────────────────────────────────────
  const [flat,        setFlat]        = useState<FlatRow[]>([])
  const [nested,      setNested]      = useState<GroupEntry[]>([])
  const [isDirty,     setIsDirty]     = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [saving,      setSaving]      = useState(false)
  // Təlimat paneli: yalnız əl ilə açılıb-bağlanır.
  const [howToOpen,   setHowToOpen]   = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)  // təzəcə göndərdi → təsdiq səhifəsi
  // Effekt içində oxumaq üçün (state dəyəri köhnə qala bilər)
  const justSubmittedRef = useRef(false)
  const [redirectIn,    setRedirectIn]    = useState(10)  // geri sayım (saniyə)

  useEffect(() => {
    (async () => {
      const sel = await selectionDb.get(selId!)
      const t   = sel ? await treeDb.get(sel.treeId) : null
      const delay  = await systemSettingsDb.getRedirectDelay()
      const notice = await systemSettingsDb.getSubmitNotice()
      setSelection(sel); setTree(t); setRedirectSeconds(delay); setRedirectIn(delay)
      setSubmitNotice((notice || '').trim())
      setLoaded(true)
    })()
  }, [selId])

  useEffect(() => {
    if (!tree || !student) return
    (async () => {
      const branchName = selection?.preAssignLevel != null ? student.branchByLevel?.[selection.preAssignLevel] : null
      let filteredTree = filterTreeByGender(
        filterTreeByBranch(filterTreeByGroup(tree, student.group), branchName, selection?.preAssignLevel),
        student.gender,
      )
      // Təyin edilmiş səviyyə kursanta göstərilmir — ağacdan yığışdırılır
      if (branchName && selection?.preAssignLevel != null) {
        filteredTree = collapseLevel(filteredTree, selection.preAssignLevel)
      }
      const initNested = treeToNested(filteredTree)
      const initFlat   = nestedToFlat(initNested)
      const existing   = await submissionDb.getByUser(student.id, selId!)

      if (existing) {
        const specMap  = new Map(initFlat.map(r => [r.specId, r]))
        const restored = (existing.ranking as string[])
          .map(id => specMap.get(id)).filter(Boolean) as FlatRow[]
        const seen = new Set(existing.ranking as string[])
        initFlat.forEach(r => { if (!seen.has(r.specId)) restored.push(r) })
        setFlat(restored)
        setNested(flatToNested(restored))
        setSubmitted(true)
        // Səhifə göndərilmiş seçimlə açılıb (təkrar giriş və ya brauzer keşi) —
        // dərhal çıxış edirik ki, növbəti təhsilalan əvvəlkinin siyahısını
        // görməsin. Təzəcə göndərən isə öz təsdiq ekranını görməlidir.
        if (!justSubmittedRef.current) {
          clearStudentSession()
          navigate('/student', { replace: true, state: { alreadySubmitted: true } })
          return
        }
      } else {
        setFlat(initFlat)
        setNested(initNested)
      }
    })()
  }, [tree?.id])

  // Seçim davam etdikcə siqnal — təsdiqdən sonra dayanır
  useEffect(() => {
    if (!loaded || submitted || !student) return
    let stop = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const next = await sendBeat(false, selId)
      if (stop) return
      timer = setTimeout(tick, Math.min(600, Math.max(5, next ?? 30)) * 1000)
    }
    tick()
    return () => { stop = true; if (timer) clearTimeout(timer) }
  }, [loaded, submitted])

  if (!student) return null

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleFlatChange(f: FlatRow[])      { setFlat(f);   setNested(flatToNested(f)); setIsDirty(true) }
  function handleNestedChange(n: GroupEntry[]) { setNested(n); setFlat(nestedToFlat(n));   setIsDirty(true) }

  async function confirmSubmit() {
    setShowConfirm(false)
    setSaving(true)
    const ranking = viewMode === 'list' ? flat.map(r => r.specId) : nestedToFlat(nested).map(r => r.specId)
    await submissionDb.save({ selectionId: selId!, userId: student!.id, userName: student!.name, ranking })
    await userDb.update(student!.id, { status: 'submitted' })
    void sendBeat(true, selId)   // canlı nəzarət: siyahıdan çıxar (gözlənilmir)
    addLog('selection', 'success', `Təhsilalan seçimini göndərdi: ${student!.name}`,
      `FİN: ${student!.fin || '—'} · ${ranking.length} ixtisas sıralandı`, student!.name)
    setSaving(false)
    setSubmitted(true)
    setIsDirty(false)
    justSubmittedRef.current = true
    setJustSubmitted(true)
    // Geri sayım → bitəndə login səhifəsinə qaytar (vaxt super admin paneldən)
    if (redirectSeconds <= 0) {
      clearStudentSession()
      navigate('/student', { replace: true })
      return
    }
    let n = redirectSeconds
    setRedirectIn(n)
    const iv = setInterval(() => {
      n -= 1
      setRedirectIn(n)
      if (n <= 0) {
        clearInterval(iv)
        clearStudentSession()
        navigate('/student', { replace: true })
      }
    }, 1000)
  }

  // ── Yüklənir ──
  if (!loaded) return null

  // ── Not found / institution mismatch ────────────────────────────────────
  if (!selection || !tree) {
    return (
      <div className="empty-state">
        <div className="empty-icon">❌</div>
        <div className="empty-title">Seçim tapılmadı</div>
        <div className="empty-sub">Bu seçim mövcud deyil və ya bağlanıb</div>
      </div>
    )
  }

  if (selection.institution !== student.institution) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🚫</div>
        <div className="empty-title">Giriş qadağandır</div>
        <div className="empty-sub">Bu seçim sizin müəssisəyə aid deyil</div>
      </div>
    )
  }

  // Struktur qrupa bağlıdırsa seçim yalnız həmin qrupun təhsilalanları üçündür
  if (tree.cohort && tree.cohort !== student.cohort) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🚫</div>
        <div className="empty-title">Giriş qadağandır</div>
        <div className="empty-sub">Bu seçim sizin qrupa aid deyil</div>
      </div>
    )
  }



  // ── Mərhələ 3/3: təsdiq səhifəsi ──
  if (justSubmitted) {
    const GOLD = '#e0a92e'
    const pct = redirectSeconds > 0 ? Math.min(100, Math.round((redirectSeconds - redirectIn) / redirectSeconds * 100)) : 100
    return (
      <div style={{
        position: 'fixed', inset: 0, overflowY: 'auto',
        background: '#eef1f5 url(/background.jpeg) center center / cover no-repeat fixed',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px',
        animation: 'mmuBgFade .5s ease both',
      }}>
        <style>{`
          @keyframes mmuBgFade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes mmuFadeUp { from { opacity: 0; transform: translateY(16px) } to { opacity: 1; transform: none } }
          @keyframes mmuPop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.08) } 100% { transform: scale(1); opacity: 1 } }
        `}</style>
        <div style={{ position: 'relative', width: '100%', maxWidth: 1080, margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', animation: 'mmuFadeUp .55s ease both' }}>
          <img src="/mmu-logo.png" alt="MMU"
            style={{ width: 104, height: 104, objectFit: 'contain', marginBottom: 8, filter: 'drop-shadow(0 4px 10px #0002)' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
          <div style={{ fontSize: 28, fontWeight: 800, color: '#2b2f3a', letterSpacing: 0.2 }}>İxtisas Seçim Proqramı</div>
          <div style={{ height: 16 }} />
          {/* Mərhələ 3 / 3 */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {[1, 2, 3].map((n, i) => (
              <div key={n} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: GOLD, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, boxShadow: n === 3 ? `0 3px 10px ${GOLD}66` : 'none' }}>{n < 3 ? '✓' : n}</div>
                {i < 2 && <div style={{ width: 46, height: 3, background: GOLD }} />}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#9aa0ac', marginTop: 6, marginBottom: 22 }}>Mərhələ 3 / 3</div>

          {/* Təsdiq kartı */}
          <div style={{ width: '100%', background: '#fff', borderRadius: 14, border: '1px solid #e7eaf0', boxShadow: '0 10px 40px #1a1f3c12', padding: '34px 30px', textAlign: 'center' }}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#2faf5f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12, animation: 'mmuPop .5s ease both', animationDelay: '.25s' }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div style={{ fontSize: 16, color: '#5a6070', marginBottom: 22 }}>Seçimləriniz uğurla qeyd olundu.</div>

            {/* Superadmin elanı — geri sayım boyunca ekranda qalır.
                whiteSpace: 'pre-wrap' sətir keçidlərini olduğu kimi saxlayır. */}
            {submitNotice && (
              <div style={{
                textAlign: 'left', background: '#fffdf5',
                border: `1.5px solid ${GOLD}55`,
                borderLeft: `5px solid ${GOLD}`, borderRadius: 12,
                padding: '14px 18px', marginBottom: 18,
                display: 'flex', gap: 12, alignItems: 'flex-start',
              }}>
                <div style={{ fontSize: 19, lineHeight: 1.2 }}>📣</div>
                <div style={{ fontSize: 14, color: '#4a5060', lineHeight: 1.7, whiteSpace: 'pre-wrap', flex: 1, minWidth: 0 }}>
                  {submitNotice}
                </div>
              </div>
            )}

            {/* Geri sayım proqres zolağı */}
            <div style={{ border: `1.5px solid ${GOLD}55`, background: '#fffdf5', borderRadius: 10, padding: '12px 16px' }}>
              <div style={{ fontSize: 13, color: '#9a7b1e', fontWeight: 600, marginBottom: 8 }}>
                Səhifə {redirectIn} saniyə sonra avtomatik olaraq yenilənəcək...
              </div>
              <div style={{ height: 8, borderRadius: 5, background: '#f0ead2', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: GOLD, borderRadius: 5, transition: 'width 1s linear' }} />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: '#a6abb6', marginTop: 26, textAlign: 'center' }}>
            © {new Date().getFullYear()} Milli Müdafiə Universiteti. Bütün hüquqlar qorunur.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* ══════════════════════════════════════════
          TƏSDİQ MODALI
          ══════════════════════════════════════════ */}
      {showConfirm && (
        <div style={{
          position: 'fixed', inset: 0, background: '#0008',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 999,
        }}>
          <div style={{
            background: '#fff', borderRadius: 20, width: 440, maxWidth: '94vw',
            boxShadow: '0 24px 80px #0004', overflow: 'hidden',
          }}>
            {/* Modal başlıq */}
            <div style={{
              background: '#fffdf5', borderTop: '4px solid #e0a92e',
              padding: '22px 26px', textAlign: 'center', borderBottom: '1.5px solid #f1ead4',
            }}>
              <div style={{ fontSize: 38, marginBottom: 8 }}>⚠️</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#2b2f3a', marginBottom: 6 }}>
                Seçim sıranızı təsdiqləyirsiniz?
              </div>
              <div style={{ fontSize: 12.5, color: '#8a909c', lineHeight: 1.6 }}>
                Təsdiqləndikdən sonra ixtisas sıranızı<br />
                <span style={{ color: '#cf1322', fontWeight: 700 }}>bir daha dəyişmək mümkün olmayacaq.</span>
              </div>
            </div>

            {/* Bütün seçimlər */}
            <div style={{ padding: '18px 26px', borderBottom: '1.5px solid #f0f2fa' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: .5 }}>
                Bütün seçimləriniz ({(viewMode === 'list' ? flat : nestedToFlat(nested)).length})
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 4 }}>
                {(viewMode === 'list' ? flat : nestedToFlat(nested)).map((r, i) => (
                  <div key={r.specId} style={{
                    display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                  }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 8, flexShrink: 0,
                      // Bütün nömrələr eyni görünür: fərqli rənglər "ilk üçü
                      // qəbul olunub, qalanları yox" kimi oxunurdu. Üstünlük
                      // sırasını rəng yox, sətirlərin ardıcıllığı bildirir.
                      background: '#f0f2fa', border: '1.5px solid #e0e4f0',
                      color: '#2b2f3a', fontWeight: 800, fontSize: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 13, color: '#1a1f3c', fontWeight: i === 0 ? 700 : 400 }}>
                      {(() => { const p = [r.groupId !== '__root__' ? r.groupName : null, !r.subId.startsWith('__sub_') ? r.subName : null].filter(Boolean); return p.length ? <span style={{ color: '#888', fontSize: 11 }}>{p.join(' → ')} → </span> : null })()}
                      {r.specName}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Düymələr */}
            <div style={{ padding: '16px 26px', display: 'flex', gap: 10 }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10,
                  border: '1.5px solid #e0e4f0', background: '#fff',
                  color: '#555', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                }}>
                ← Geri qayıt
              </button>
              <button
                onClick={confirmSubmit}
                style={{
                  flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                  background: '#e0a92e',
                  color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                  boxShadow: '0 4px 16px #e0a92e55',
                }}>
                Bəli, təsdiqləyirəm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Başlıq: gerb + ad + mərhələ göstəricisi ── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', marginBottom: 10 }}>
        <img src="/mmu-logo.png" alt="MMU"
          style={{ width: 74, height: 74, objectFit: 'contain', marginBottom: 4, filter: 'drop-shadow(0 4px 10px #0002)' }}
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
        <div style={{ fontSize: 22, fontWeight: 800, color: '#2b2f3a', letterSpacing: 0.2 }}>
          İxtisas Seçim Proqramı
        </div>
        <div style={{ height: 10 }} />
        {/* Mərhələ 2 / 3 */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {[
            { n: 1, state: 'done' }, { n: 2, state: 'active' }, { n: 3, state: 'todo' },
          ].map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                background: s.state === 'todo' ? '#d6dae3' : '#e0a92e',
                color: s.state === 'todo' ? '#8a909c' : '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 12,
                boxShadow: s.state === 'active' ? '0 3px 10px #e0a92e66' : 'none',
              }}>{s.state === 'done' ? '✓' : s.n}</div>
              {i < 2 && <div style={{ width: 40, height: 3, background: s.n === 1 ? '#e0a92e' : '#d6dae3' }} />}
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: '#9aa0ac', marginTop: 4 }}>Mərhələ 2 / 3</div>
      </div>

      {/* ── Təhsilalan məlumat kartı ── */}
      <div style={{
        background: '#ffffff', border: '1.5px solid #e7eaf0',
        borderRadius: 12, padding: '12px 20px', color: '#2b2f3a',
        display: 'flex', alignItems: 'center', gap: 16,
        borderLeft: '5px solid #e0a92e', marginBottom: 12, boxShadow: '0 2px 10px #1a1f3c0d',
      }}>
        {/* Təhsilalan məlumatları */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Məlumatlar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{student.name}</div>
            <div style={{ fontSize: 12, color: '#8892b0' }}>
              <span style={{ fontWeight: 600 }}>Fin:</span> {student.fin || '—'}
            </div>
            <div style={{ fontSize: 12, color: '#8892b0' }}>
              <span style={{ fontWeight: 600 }}>Abituriyentin iş nömrəsi:</span> {student.workNumber || '—'}
            </div>
            <div style={{ fontSize: 12, color: '#8892b0' }}>
              <span style={{ fontWeight: 600 }}>İmtahan Nəticəsi:</span>{' '}
              <span style={{ color: '#f5a623', fontWeight: 700 }}>{Number(student.score).toFixed(2)}</span>
            </div>
            {/* Təyin edilmiş səviyyə (məs. Qoşun növü: HHQ) — dinamik ad + dəyər */}
            {selection?.preAssignLevel != null && student.branchByLevel?.[selection.preAssignLevel] && (
              <div style={{ fontSize: 12, color: '#8892b0' }}>
                <span style={{ fontWeight: 600 }}>{tree?.levelNames?.[selection.preAssignLevel] || `Səviyyə ${selection.preAssignLevel + 1}`}:</span>{' '}
                <span style={{
                  color: '#1f3864', fontWeight: 800, background: '#eef2fb',
                  border: '1px solid #c9d6f2', borderRadius: 12, padding: '1px 10px',
                }}>{student.branchByLevel[selection.preAssignLevel]}</span>
              </div>
            )}
          </div>
        </div>
      </div>


      {/* ── Təlimat ────────────────────────────────────────────────────────
          Təhsilalanlar "ixtisası necə seçim edim?" deyə soruşurdu: sətirlər
          sürüşdürülərək sıralanır, ayrıca "seç" düyməsi yoxdur. Göndərildikdən
          sonra sıra dəyişmir, ona görə təlimat da göstərilmir. */}
      {!submitted && (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'flex-start',
          background: '#fffdf5', border: '1.5px solid #f1ead4',
          borderLeft: '5px solid #e0a92e', borderRadius: 12,
          padding: '14px 18px', marginBottom: 2,
        }}>
          <div style={{ fontSize: 20, lineHeight: 1.2 }}>💡</div>
          <div style={{ fontSize: 13, color: '#4a5060', lineHeight: 1.7, flex: 1, minWidth: 0 }}>
            <div
              onClick={() => setHowToOpen(v => !v)}
              style={{
                fontWeight: 800, color: '#2b2f3a', fontSize: 13.5, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 10, marginBottom: howToOpen ? 4 : 0, userSelect: 'none',
              }}>
              <span>İxtisas seçimi necə aparılır?</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: '#a9741a', whiteSpace: 'nowrap' }}>
                {howToOpen ? 'Gizlət ▲' : 'Göstər ▼'}
              </span>
            </div>
            {howToOpen && (<>
            Siyahıda göstərilən <b>bütün ixtisaslar seçimə daxildir</b>. İxtisasları istəyinizə
            uyğun olaraq üstünlük sırası ilə yerləşdirin.
            <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <div style={{ flex: '1 1 300px', minWidth: 0 }}>
            <div>
              1. İxtisasın sağ tərəfindəki <span style={{
                color: '#8a909c', fontWeight: 800, background: '#f0f2fa',
                border: '1px solid #e0e4f0', borderRadius: 6, padding: '0 6px',
              }}>⠿</span> işarəsindən tutaraq onu yuxarı və ya aşağı
              sürüşdürün{viewMode === 'nested' ? ' (qrupların özünü də sürüşdürə bilərsiniz)' : ''}.
            </div>
            <div>2. <b>Ən çox istədiyiniz ixtisası birinci</b>, digər ixtisasları isə istəyinizə uyğun ardıcıllıqla sıralayın.</div>
            <div>3. Sıralamanı tamamladıqdan sonra <b>«Təsdiqlə və bitir»</b> düyməsini basın.</div>
            </div>
            <DragDemo />
            </div>
            <div style={{ marginTop: 6 }}>
              <b>Vacib:</b> Yerləşdirmə müəyyən etdiyiniz ixtisas sırasına və imtahan nəticənizə
              uyğun aparılır. Balınız birinci ixtisasa uyğun gəlmədikdə növbəti ixtisas, ona da
              uyğun gəlmədikdə isə siyahı üzrə sonrakı ixtisaslar nəzərə alınır. Buna görə
              <b> bütün ixtisasları həqiqi istəyinizə uyğun ardıcıllıqla</b> sıralayın.
            </div>
            <div style={{ marginTop: 6, color: '#a9741a', fontWeight: 700 }}>
              Diqqət: Seçim təsdiqləndikdən sonra ixtisasların sırasını dəyişmək mümkün olmayacaq.
            </div>
            </>)}
          </div>
        </div>
      )}

      {/* ── Görünüş ── */}
      {viewMode === 'list'
        ? <FlatView   flat={flat}     onChange={submitted ? undefined : handleFlatChange}   submitted={submitted} levelNames={displayLevelNames} />
        : <NestedView nested={nested} onChange={submitted ? undefined : handleNestedChange} submitted={submitted} />
      }

      {/* ── Aşağı: Təsdiqlə və Bitir ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        {submitted ? (
          <span style={{
            background: '#f0fff4', border: '1.5px solid #b7eb8f', borderRadius: 10,
            padding: '12px 26px', fontSize: 14, color: '#237804', fontWeight: 800,
          }}>✅ Göndərildi</span>
        ) : (
          <button
            onClick={() => isDirty && setShowConfirm(true)}
            disabled={!isDirty || saving}
            style={{
              padding: '13px 30px', borderRadius: 10, border: 'none',
              background: isDirty ? '#e0a92e' : '#e4e7ee',
              color: isDirty ? '#fff' : '#aab',
              cursor: isDirty ? 'pointer' : 'default',
              fontWeight: 800, fontSize: 15, transition: 'all .2s',
              boxShadow: isDirty ? '0 4px 16px #e0a92e55' : 'none',
              opacity: saving ? 0.7 : 1,
            }}>
            {saving ? 'Göndərilir...' : 'Təsdiqlə və Bitir →'}
          </button>
        )}
      </div>

      {/* ── Footer ── */}
      <div style={{ fontSize: 12, color: '#a6abb6', marginTop: 14, textAlign: 'center' }}>
        © {new Date().getFullYear()} Milli Müdafiə Universiteti. Bütün hüquqlar qorunur.
      </div>

    </div>
  )
}
