import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectionDb, treeDb, userDb, institutionDb, addLog } from '../../db'
import { FlatView, NestedView, treeToNested, nestedToFlat } from '../../components/SpecialtyViews'
import InstIcon from '../../components/InstIcon'

// ── Təhsil alan görünüşü önizləmə overlay ─────────────────────────────────────────
function ViewPreviewOverlay({
  tree, viewMode, onClose, onSelect,
}: {
  tree: any
  viewMode: 'list' | 'nested'
  onClose: () => void
  onSelect: (v: 'list' | 'nested') => void
}) {
  const current = viewMode
  const nested = treeToNested(tree)
  const flat   = nestedToFlat(nested)

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>

        <div className="preview-head">
          <div>
            <div className="preview-head-title">👁 Təhsil alan Görünüşü — Önizləmə</div>
            <div style={{ fontSize: 11, color: '#ffffffcc', marginTop: 2 }}>
              Təhsil alanın seçim səhifəsini bu görünüşdə görəcəyi kimi yoxlayın.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="preview-head-badge">ÖNİZLƏMƏ</span>
            <button className="btn btn-outline btn-sm" style={{ color: '#fff', background: '#ffffff22', borderColor: '#ffffff55' }} onClick={onClose}>
              ✕ Bağla
            </button>
          </div>
        </div>

        <div className="preview-body">
          {/* İzahat */}
          <div className="info-box" style={{ marginBottom: 14 }}>
            {current === 'list'
              ? '📋 Siyahı: Təhsil alan bütün ixtisasları bir-bir sürüşdürərək prioritet sırasını müəyyənləşdirəcək.'
              : '⠿ Qrup: Təhsil alan ana qrupları, alt qrupları və ixtisasları öz daxillərində ayrı-ayrı sürüşdürə biləcək.'}
          </div>

          {/* Görünüş */}
          {current === 'list'
            ? <FlatView flat={flat} submitted={true} />
            : <NestedView nested={nested} submitted={true} />
          }

          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Təhsil alan sürüşdürə bilər, lakin bu önizlədə sürüşdürmə deaktivdir.
            </span>
            <button className="btn btn-outline btn-sm" disabled>
              Seçimi Təsdiqlə (təhsil alan tərəfindən aktivləşir)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Ana form ──────────────────────────────────────────────────────────────────
export default function SelectionNew() {
  const navigate     = useNavigate()
  const trees        = treeDb.getAll() as any[]
  const institutions = institutionDb.getAll() as any[]
  const allUsers     = userDb.getAll() as any[]

  const [form, setForm] = useState({
    name:               '',
    institution:        institutions[0]?.id || '',
    treeId:             '',
    sourceProportional: false,
    viewMode:           'list' as 'list' | 'nested',
    preAssignLevel:     null as number | null,
  })
  const [showPreview, setShowPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<'list' | 'nested'>('list')

  // ── Hesablamalar ─────────────────────────────────────────────────────────────
  const instStudents = allUsers.filter((u: any) => u.institution === form.institution)
  const studentCount = instStudents.length
  const instTrees    = trees.filter((t: any) => !t.institution || t.institution === form.institution)
  const selectedTree = trees.find((t: any) => t.id === form.treeId)
  const totalQuota   = selectedTree ? treeDb.totalQuota(selectedTree)       : 0
  const totalSpec    = selectedTree ? treeDb.countSpecialties(selectedTree) : 0
  const activeInst   = institutions.find((i: any) => i.id === form.institution)

  function set(key: string, val: any) {
    setForm(f => {
      const next = { ...f, [key]: val }
      if (key === 'institution') { next.treeId = ''; next.sourceProportional = false; next.preAssignLevel = null }
      if (key === 'treeId') { next.preAssignLevel = null }
      return next
    })
  }

  function handleSubmit() {
    if (!form.name.trim() || !form.treeId) {
      alert('Zəhmət olmasa bütün məcburi sahələri doldurun')
      return
    }
    const sel = selectionDb.create({
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
      `Müəssisə: ${activeInst?.label || form.institution} · Təhsil alan: ${studentCount} · Kvota: ${totalQuota} · Görünüş: ${form.viewMode}${form.sourceProportional ? ' · Proporsional bölgü aktiv' : ''}`)
    navigate(`/admin/selections/${sel.id}`)
  }

  const VIEW_LABELS = { list: '📋 Siyahı görünüşü', nested: '⠿ Qrup görünüşü' }

  return (
    <>
      {showPreview && selectedTree && (
        <ViewPreviewOverlay
          tree={selectedTree}
          viewMode={previewMode}
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
              background: 'linear-gradient(135deg,#fffdf5,#fff7e6)',
              border: '1.5px solid #ecd9a0',
            }}>
              <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: '#fff', border: '1.5px solid #ecd9a0',
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
                  background: studentCount > 0 ? '#fbf1d6' : '#f5f5f5',
                  color: studentCount > 0 ? '#9a7b1e' : 'var(--muted)',
                  fontWeight: 800, fontSize: 13,
                }}>👥 {studentCount}</span>
                <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 6 }}>təhsil alan qeydiyyatda</span>
              </div>
              {studentCount === 0 && (
                <div style={{ fontSize: 11, color: '#d46b08', alignSelf: 'center' }}>
                  ⚠ Bu müəssisədə hələ təhsil alan yoxdur
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

          {/* ── Əvvəlcədən bölgü səviyyəsi ── */}
          {selectedTree && (selectedTree.levelNames?.length > 0) && (
            <div className="form-group">
              <label className="form-label">Əvvəlcədən bölgü səviyyəsi</label>
              <select className="form-select" value={form.preAssignLevel ?? ''}
                onChange={e => set('preAssignLevel', e.target.value === '' ? null : Number(e.target.value))}>
                <option value="">— Yoxdur (təhsil alan bütün ixtisasları seçə bilər) —</option>
                {selectedTree.levelNames.map((ln: string, i: number) => (
                  <option key={i} value={i}>{ln}</option>
                ))}
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6, lineHeight: 1.4 }}>
                Təhsil Alanlar bu səviyyəyə görə əvvəlcədən bölünübsə seçin. Hər təhsil alan öz dəyərinə görə yalnız aid olduğu bölmənin ixtisaslarını görəcək (dəyər Excel idxalı və ya təhsil alan redaktəsi ilə doldurulur).
              </div>
            </div>
          )}

          {/* ── Struktur stat kartları ── */}
          {selectedTree && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'İxtisas sayı',  value: totalSpec,    icon: '📚', color: '#c9962a', bg: '#fbf1d6' },
                { label: 'Ümumi kvota',   value: totalQuota,   icon: '🎯', color: '#237804', bg: '#f0fff4' },
                { label: 'Təhsil alan sayı',   value: studentCount, icon: '👥', color: '#b8860b', bg: '#fbf1d6' },
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
              ⚠️ Ümumi kvota ({totalQuota}) təhsil alan sayından ({studentCount}) <strong>azdır</strong> — bəzi təhsil alanlar ixtisassız qala bilər.
            </div>
          )}
          {selectedTree && totalQuota > 0 && totalQuota > studentCount && studentCount > 0 && (
            <div style={{ background: '#fbf1d6', border: '1.5px solid #ecd9a0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#9a7b1e', marginBottom: 12 }}>
              ℹ️ Ümumi kvota ({totalQuota}) təhsil alan sayından ({studentCount}) <strong>çoxdur</strong> — bəzi ixtisas yerləri boş qala bilər.
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
                      border: `2px solid ${active ? '#c9962a' : '#e0e4f0'}`,
                      background: active ? '#fbf1d6' : '#fff',
                      textAlign: 'left', transition: 'all .15s', position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 18 }}>{opt.icon}</span>
                      <span style={{ fontWeight: 800, fontSize: 13, color: active ? '#c9962a' : 'var(--text)' }}>
                        {opt.label}
                      </span>
                      {active && (
                        <span style={{ background: '#c9962a', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6 }}>
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
                          border: '1.5px solid #ecd9a0', background: '#fff',
                          fontSize: 15, cursor: selectedTree ? 'pointer' : 'not-allowed',
                          opacity: selectedTree ? 1 : 0.4, transition: 'all .15s',
                        }}
                        onMouseEnter={ev => { if (selectedTree) { (ev.currentTarget as HTMLElement).style.background = '#fbf1d6'; (ev.currentTarget as HTMLElement).style.borderColor = '#c9962a' } }}
                        onMouseLeave={ev => { (ev.currentTarget as HTMLElement).style.background = '#fff'; (ev.currentTarget as HTMLElement).style.borderColor = '#ecd9a0' }}
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
