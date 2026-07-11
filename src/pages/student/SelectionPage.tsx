import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { selectionDb, treeDb, userDb, submissionDb, systemSettingsDb, addLog } from '../../db'
import { getStudentSession, clearStudentSession } from '../../api/auth'
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
function filterTreeByBranch(tree: any, branchName: string | null | undefined, level: number | null | undefined): any {
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
  const viewMode: 'list' | 'nested' = selection?.viewMode || 'list'

  // ── State ─────────────────────────────────────────────────────────────────
  const [flat,        setFlat]        = useState<FlatRow[]>([])
  const [nested,      setNested]      = useState<GroupEntry[]>([])
  const [isDirty,     setIsDirty]     = useState(false)
  const [submitted,   setSubmitted]   = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)  // təzəcə göndərdi → təsdiq səhifəsi
  const [redirectIn,    setRedirectIn]    = useState(10)  // geri sayım (saniyə)

  useEffect(() => {
    (async () => {
      const sel = await selectionDb.get(selId!)
      const t   = sel ? await treeDb.get(sel.treeId) : null
      const delay = await systemSettingsDb.getRedirectDelay()
      setSelection(sel); setTree(t); setRedirectSeconds(delay); setRedirectIn(delay)
      setLoaded(true)
    })()
  }, [selId])

  useEffect(() => {
    if (!tree || !student) return
    (async () => {
      const branchName = selection?.preAssignLevel != null ? student.branchByLevel?.[selection.preAssignLevel] : null
      const filteredTree = filterTreeByGender(
        filterTreeByBranch(filterTreeByGroup(tree, student.group), branchName, selection?.preAssignLevel),
        student.gender,
      )
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
      } else {
        setFlat(initFlat)
        setNested(initNested)
      }
    })()
  }, [tree?.id])

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
    addLog('selection', 'success', `Təhsilalan seçimini göndərdi: ${student!.name}`,
      `FİN: ${student!.fin || '—'} · ${ranking.length} ixtisas sıralandı`, student!.name)
    setSaving(false)
    setSubmitted(true)
    setIsDirty(false)
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
          <div style={{ fontSize: 15, color: '#8a909c', marginTop: 2, marginBottom: 16 }}>İxtisas Seçimi Formu</div>
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
                      background: i === 0 ? '#e0a92e' : i === 1 ? '#caa23e' : i === 2 ? '#d8be7a' : '#c2c8d4',
                      color: '#fff', fontWeight: 800, fontSize: 12,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{i + 1}</div>
                    <div style={{ fontSize: 13, color: '#1a1f3c', fontWeight: i === 0 ? 700 : 400 }}>
                      <span style={{ color: '#888', fontSize: 11 }}>{r.groupName} → {r.subName} → </span>
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
        <div style={{ fontSize: 13, color: '#8a909c', marginTop: 1, marginBottom: 10 }}>
          İxtisas Seçimi Formu
        </div>
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
          {/* İkon */}
          <div style={{
            width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
            border: '1.5px solid #e7eaf0',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
          }}>
            👤
          </div>

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
          </div>
        </div>
      </div>


      {/* ── Görünüş ── */}
      {viewMode === 'list'
        ? <FlatView   flat={flat}     onChange={submitted ? undefined : handleFlatChange}   submitted={submitted} levelNames={tree?.levelNames} />
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
