import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectionDb, treeDb, userDb, institutionDb, cohortDb, addLog } from '../../db'
import { readActiveInst, writeActiveInst } from '../../activeInst'
import { FlatView, NestedView, treeToNested, nestedToFlat } from '../../components/SpecialtyViews'
import InstIcon from '../../components/InstIcon'
import { filterTreeByBranch, collapseLevel } from '../student/SelectionPage'

// ── Təhsilalan görünüşü önizləmə overlay ─────────────────────────────────────────
function ViewPreviewOverlay({
  tree: fullTree, viewMode, onClose, onSelect, preAssignLevel,
}: {
  tree: any
  viewMode: 'list' | 'nested'
  onClose: () => void
  onSelect: (v: 'list' | 'nested') => void
  /** Əvvəlcədən bölgü səviyyəsi — təhsilalan yalnız öz bölməsini görür */
  preAssignLevel?: number | null
}) {
  const current = viewMode
  // Bölgü səviyyəsindəki bölmə adları (məs. bütün mülki ixtisaslar)
  const branches = (() => {
    if (preAssignLevel == null) return [] as string[]
    const out: string[] = []
    const walk = (ns: any[], d: number) => ns.forEach(n => {
      if (d === preAssignLevel) { if (!out.includes(n.name)) out.push(n.name) }
      else if (n.children?.length) walk(n.children, d + 1)
    })
    walk(fullTree?.nodes || [], 0)
    return out
  })()
  const [branch, setBranch] = useState<string>(branches[0] || '')
  // Tələbə səhifəsi ilə eyni: bölmə süzülür, bölgü səviyyəsi yığışdırılır
  const tree = preAssignLevel != null && branch
    ? collapseLevel(filterTreeByBranch(fullTree, branch, preAssignLevel), preAssignLevel)
    : fullTree
  const levelNames: string[] = preAssignLevel != null && branch
    ? (fullTree?.levelNames || []).filter((_: string, i: number) => i !== preAssignLevel)
    : fullTree?.levelNames
  const nested = treeToNested(tree)
  const flat   = nestedToFlat(nested)

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>

        <div className="preview-head">
          <div>
            <div className="preview-head-title">👁 Təhsilalan Görünüşü — Önizləmə</div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {branches.length > 0 && (
              <select value={branch} onChange={e => setBranch(e.target.value)} title="Hansı bölmənin təhsilalanı kimi baxılsın"
                style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid #ffffff55', background: '#fff', fontSize: 12.5, maxWidth: 220 }}>
                {branches.map(b => <option key={b} value={b}>{(fullTree?.levelNames?.[preAssignLevel!] || 'Bölmə') + ': ' + b}</option>)}
              </select>
            )}
            <button className="btn btn-outline btn-sm" style={{ color: '#fff', background: '#ffffff22', borderColor: '#ffffff55' }} onClick={onClose}>
              ✕ Bağla
            </button>
          </div>
        </div>

        <div className="preview-body">
          {/* Görünüş */}
          {current === 'list'
            ? <FlatView flat={flat} submitted={true} levelNames={levelNames} />
            : <NestedView nested={nested} submitted={true} />
          }

        </div>
      </div>
    </div>
  )
}

// ── Ana form ──────────────────────────────────────────────────────────────────
export default function SelectionNew() {
  const navigate     = useNavigate()
  const [trees, setTrees]             = useState<any[]>([])
  const [institutions, setInstitutions] = useState<any[]>([])
  const [allUsers, setAllUsers]       = useState<any[]>([])
  const [cohorts, setCohorts]         = useState<any[]>([])
  const [loaded, setLoaded]           = useState(false)

  const [form, setForm] = useState({
    name:               '',
    institution:        '',
    treeId:             '',
    sourceProportional: false,
    viewMode:           'list' as 'list' | 'nested',
    preAssignLevel:     null as number | null,
  })
  const [showPreview, setShowPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<'list' | 'nested'>('list')

  useEffect(() => {
    let cancelled = false
    Promise.all([treeDb.getAll(), institutionDb.getAll(), userDb.getAll(), cohortDb.getAll()]).then(([t, i, u, c]) => {
      if (cancelled) return
      setTrees(t); setInstitutions(i); setAllUsers(u); setCohorts(c); setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    // Defolt: digər səhifələrdə son açılmış müəssisə; yoxdursa (və ya silinibsə) birincisi
    if (loaded && !form.institution && institutions[0]?.id) {
      const last = readActiveInst()
      const id = institutions.some((i: any) => i.id === last) ? last : institutions[0].id
      setForm(f => ({ ...f, institution: id }))
    }
  }, [loaded, institutions, form.institution])

  if (!loaded) return <div className="card"><div className="card-body pad">Yüklənir...</div></div>

  // ── Hesablamalar ─────────────────────────────────────────────────────────────
  const instStudents = allUsers.filter((u: any) => u.institution === form.institution)
  const instTrees    = trees.filter((t: any) => !t.institution || t.institution === form.institution)
  const selectedTree = trees.find((t: any) => t.id === form.treeId)
  // İştirakçılar STRUKTURDAN gəlir: qrup strukturda təyin olunur, seçim sadəcə
  // struktur seçməklə kimin üçün açıldığını müəyyənləşdirir.
  const selectedCohort = selectedTree?.cohort
    ? cohorts.find((c: any) => c.id === selectedTree.cohort) || null
    : null
  const participants = selectedCohort
    ? instStudents.filter((u: any) => u.cohort === selectedCohort.id)
    : instStudents
  const studentCount = selectedTree ? participants.length : instStudents.length
  const totalQuota   = selectedTree ? treeDb.totalQuota(selectedTree)       : 0
  const totalSpec    = selectedTree ? treeDb.countSpecialties(selectedTree) : 0
  const activeInst   = institutions.find((i: any) => i.id === form.institution)
  // Yarpaq (son) səviyyənin adı — strukturda təyin olunan ad dinamik gəlir
  const leafLevelName = (() => {
    if (!selectedTree) return 'İxtisas'
    const lv: string[] = selectedTree.levelNames || []
    let depth = 0
    const walk = (nodes: any[], cur: number) => { for (const n of nodes || []) { depth = Math.max(depth, cur + 1); if (n.children?.length) walk(n.children, cur + 1) } }
    walk(selectedTree.nodes || [], 0)
    return lv[Math.max(depth, lv.length) - 1] || 'İxtisas'
  })()

  function set(key: string, val: any) {
    setForm(f => {
      const next = { ...f, [key]: val }
      if (key === 'institution') { next.treeId = ''; next.sourceProportional = false; next.preAssignLevel = null; writeActiveInst(val) }
      if (key === 'treeId') { next.preAssignLevel = null }
      return next
    })
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.treeId) {
      alert('Zəhmət olmasa bütün məcburi sahələri doldurun')
      return
    }
    const sel = await selectionDb.create({
      name:               form.name.trim(),
      institution:        form.institution,
      studentCount,
      choiceCount:        totalSpec || 40,
      treeId:             form.treeId,
      tiebreaker:         ['math', 'physics', 'language'],
      viewMode:           form.viewMode,
      sourceProportional: form.sourceProportional,
      preAssignLevel:     form.preAssignLevel,
    })
    addLog('selection', 'success', `Yeni seçim yaradıldı: "${form.name.trim()}"`,
      `Müəssisə: ${activeInst?.label || form.institution} · Qrup: ${selectedCohort?.label || 'bütün müəssisə'} · Təhsilalan: ${studentCount} · Kvota: ${totalQuota} · Görünüş: ${form.viewMode}${form.sourceProportional ? ' · Proporsional bölgü aktiv' : ''}`)
    navigate(`/admin/selections/${sel.id}`)
  }

  const VIEW_LABELS = { list: '📋 Siyahı görünüşü', nested: '⠿ Qrup görünüşü' }

  return (
    <>
      {showPreview && selectedTree && (
        <ViewPreviewOverlay
          tree={selectedTree}
          viewMode={previewMode}
          preAssignLevel={form.preAssignLevel}
          onClose={() => setShowPreview(false)}
          onSelect={v => set('viewMode', v)}
        />
      )}

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Yeni Seçim Yarat</div>
            <div className="card-sub">Seçim sessiyasının parametrlərini təyin edin</div>
          </div>
        </div>
        <div className="card-body pad">

          {/* ── Ad + Müəssisə ── */}
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Seçim Adı *</label>
              <input className="form-input" placeholder="Məs: 2025 — Yaz Dövrü"
                value={form.name} onChange={e => set('name', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Müəssisə *</label>
              <select className="form-select" value={form.institution}
                onChange={e => set('institution', e.target.value)}>
                {institutions.map((inst: any) => (
                  <option key={inst.id} value={inst.id}>{inst.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Müəssisə kartı ── */}
          {activeInst && (
            <div style={{
              display: 'flex', gap: 12, marginBottom: 16,
              padding: '14px 18px', borderRadius: 12,
              background: 'linear-gradient(135deg,#f6f8fb,#eef2f7)',
              border: '1.5px solid #c9d4e2',
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: '#fff', border: '1.5px solid #c9d4e2',
                display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              }}>
                <InstIcon icon={activeInst.icon} size={26} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--blue)', marginBottom: 4 }}>
                  {activeInst.label}
                </div>
                <span style={{
                  display: 'inline-block', padding: '2px 10px', borderRadius: 20,
                  background: studentCount > 0 ? '#eef2f7' : '#f5f5f5',
                  color: studentCount > 0 ? '#3b5a7d' : 'var(--muted)',
                  fontWeight: 800, fontSize: 13,
                }}>👥 {studentCount}</span>
                <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>təhsilalan qeydiyyatda</span>
              </div>
              {studentCount === 0 && (
                <div style={{ fontSize: 11, color: '#d46b08', alignSelf: 'center' }}>
                  ⚠ Bu müəssisədə hələ təhsilalan yoxdur
                </div>
              )}
            </div>
          )}

          {/* ── İxtisas Strukturu ── */}
          <div className="form-group">
            <label className="form-label">İxtisas Strukturu *</label>
            <select className="form-select" value={form.treeId}
              onChange={e => set('treeId', e.target.value)}>
              <option value="">— Struktur seçin —</option>
              {instTrees.length === 0
                ? <option value="" disabled>Bu müəssisə üçün struktur yoxdur</option>
                : instTrees.map((t: any) => (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.year ? ` · ${t.year}` : ''}
                  </option>
                ))
              }
            </select>
          </div>

          {/* ── Strukturun təhsilalan qrupu (yalnız məlumat üçün) ──
              Qrup strukturda təyin olunur; burada dəyişdirilmir. */}
          {selectedTree && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, marginTop: -6, marginBottom: 16,
              padding: '10px 14px', borderRadius: 10,
              background: selectedCohort ? '#f0f5ff' : '#fff7e6',
              border: '1.5px solid ' + (selectedCohort ? '#adc6ff' : '#ffd591'),
            }}>
              <span style={{ fontSize: 15 }}>{selectedCohort ? '👥' : '🏛️'}</span>
              <div style={{ flex: 1, lineHeight: 1.45 }}>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: selectedCohort ? '#0958d9' : '#d46b08' }}>
                  {selectedCohort ? selectedCohort.label : 'Bütün müəssisə'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Bu seçim <b>{studentCount}</b> təhsilalan üçün açılacaq — struktur onlar üçün qurulub.
                  Qrupu dəyişmək üçün İxtisas Strukturu səhifəsinə keçin.
                </div>
              </div>
            </div>
          )}

          {/* ── Əvvəlcədən bölgü səviyyəsi ── */}
          {selectedTree && (selectedTree.levelNames?.length > 0) && (
            <div className="form-group">
              <label className="form-label">Əvvəlcədən bölgü səviyyəsi</label>
              <select className="form-select" value={form.preAssignLevel ?? ''}
                onChange={e => set('preAssignLevel', e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">— Yoxdur (təhsilalan bütün ixtisasları seçə bilər) —</option>
                {selectedTree.levelNames.map((ln: string, i: number) => (
                  <option key={i} value={i}>{ln}</option>
                ))}
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                Təhsilalanlar bu səviyyəyə görə əvvəlcədən bölünübsə seçin. Hər təhsilalan öz dəyərinə görə yalnız aid olduğu bölmənin ixtisaslarını görəcək (dəyər Excel idxalı və ya təhsilalan redaktəsi ilə doldurulur).
              </div>
            </div>
          )}

          {/* ── Struktur stat kartları ── */}
          {selectedTree && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: `${leafLevelName} sayı`,  value: totalSpec,    icon: '📚', color: '#1f3f6b', bg: '#eef2f7' },
                { label: 'Ümumi kvota',   value: totalQuota,   icon: '🎯', color: '#237804', bg: '#f0fff4' },
                { label: 'Təhsilalan sayı',   value: studentCount, icon: '👥', color: '#152c4d', bg: '#eef2f7' },
              ].map(item => (
                <div key={item.label} style={{
                  padding: '14px 16px', borderRadius: 12, textAlign: 'center',
                  background: item.bg, border: `1.5px solid ${item.color}22`,
                }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>{item.icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: item.color, lineHeight: 1 }}>{item.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, fontWeight: 600 }}>{item.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Xəbərdarlıqlar ── */}
          {selectedTree && totalQuota > 0 && totalQuota < studentCount && (
            <div className="warn-box">
              ⚠️ Ümumi kvota ({totalQuota}) təhsilalan sayından ({studentCount}) <strong>azdır</strong> — bəzi təhsilalanlar ixtisassız qala bilər.
            </div>
          )}
          {selectedTree && totalQuota > 0 && totalQuota > studentCount && studentCount > 0 && (
            <div style={{ background: '#eef2f7', border: '1.5px solid #c9d4e2', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#3b5a7d', marginBottom: 12 }}>
              ℹ️ Ümumi kvota ({totalQuota}) təhsilalan sayından ({studentCount}) <strong>çoxdur</strong> — bəzi ixtisas yerləri boş qala bilər.
            </div>
          )}

          {/* ── Görünüş Seçimi ── */}
          <div style={{
            border: '1.5px solid #e0e4f0', borderRadius: 14,
            overflow: 'hidden', marginBottom: 16,
          }}>
            {/* Seçim toggle */}
            <div style={{ padding: '14px 16px', display: 'flex', gap: 10 }}>
              {([
                { v: 'list',   icon: '📋', label: 'Siyahı görünüşü',  desc: 'Bütün ixtisaslar bir siyahıda sürüşdürülür' },
                { v: 'nested', icon: '⠿',  label: 'Qrup görünüşü',    desc: 'Qruplar və alt qruplar ayrı-ayrı sürüşdürülür' },
              ] as const).map(opt => {
                const active = form.viewMode === opt.v
                return (
                  <div
                    key={opt.v}
                    onClick={() => set('viewMode', opt.v)}
                    style={{
                      flex: 1, padding: '12px 16px', borderRadius: 12, cursor: 'pointer',
                      border: `2px solid ${active ? '#1f3f6b' : '#e0e4f0'}`,
                      background: active ? '#eef2f7' : '#fff',
                      textAlign: 'left', transition: 'all .15s', position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>{opt.icon}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: active ? '#1f3f6b' : 'var(--text)' }}>
                        {opt.label}
                      </span>
                      {active && (
                        <span style={{ background: '#1f3f6b', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6 }}>
                          SEÇİLİB
                        </span>
                      )}
                      {/* Göz ikonu — önizləmə */}
                      <span
                        onClick={e => {
                          e.stopPropagation()
                          if (!selectedTree) return
                          setPreviewMode(opt.v)
                          setShowPreview(true)
                        }}
                        title={selectedTree ? 'Önizlə' : 'Əvvəlcə struktur seçin'}
                        style={{
                          marginLeft: 'auto', flexShrink: 0,
                          width: 30, height: 30, borderRadius: 8,
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          border: '1.5px solid #c9d4e2', background: '#fff',
                          fontSize: 15, cursor: selectedTree ? 'pointer' : 'not-allowed',
                          opacity: selectedTree ? 1 : 0.4, transition: 'all .15s',
                        }}
                        onMouseEnter={ev => { if (selectedTree) { (ev.currentTarget as HTMLElement).style.background = '#eef2f7'; (ev.currentTarget as HTMLElement).style.borderColor = '#1f3f6b' } }}
                        onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.background = '#fff'; (ev.currentTarget as HTMLElement).style.borderColor = '#c9d4e2' }}
                      >👁</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 26 }}>{opt.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── Düymələr ── */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => navigate('/admin/selections')}>
              Ləğv et
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!form.name.trim() || !form.treeId}
              style={{ opacity: (!form.name.trim() || !form.treeId) ? 0.5 : 1 }}
            >
              ✓ Seçim Yarat
            </button>
          </div>

        </div>
      </div>
    </>
  )
}
