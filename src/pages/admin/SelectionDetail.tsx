import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { selectionDb, treeDb, institutionDb, userDb, resetAndAutoSeedSubmissions, addLog } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import InstIcon from '../../components/InstIcon'
import { FlatView, NestedView, treeToNested, nestedToFlat } from '../../components/SpecialtyViews'

// ── Preview overlay ──────────────────────────────────────────────────────────
function PreviewOverlay({ sel, tree, onClose, onSaveView }: {
  sel: any; tree: any
  onClose: () => void
  onSaveView: (v: 'list' | 'nested') => void
}) {
  const savedView: 'list' | 'nested' = sel.viewMode || 'list'
  const [view, setView] = useState<'list' | 'nested'>(savedView)
  const [saved, setSaved] = useState(false)

  const nested = treeToNested(tree)
  const flat   = nestedToFlat(nested)

  function handleSave() {
    onSaveView(view)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-panel" onClick={e => e.stopPropagation()} style={{ maxWidth: 900 }}>

        {/* Başlıq */}
        <div className="preview-head">
          <div>
            <div className="preview-head-title">👁 Tələbə Görünüşü — {sel.name}</div>
            <div style={{ fontSize: 11, color: '#8a8ab0', marginTop: 2 }}>
              Görünüşü seçin, yoxlayın, sonra <b>Təyin et</b> düyməsinə basın.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span className="preview-head-badge">ÖNİZLƏMƏ</span>
            <button className="btn btn-outline btn-sm" style={{ color: '#fff', borderColor: '#3a3a6a' }} onClick={onClose}>
              ✕ Bağla
            </button>
          </div>
        </div>

        <div className="preview-body">

          {/* ── Görünüş seçimi paneli ── */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            background: '#ffffff', border: '1.5px solid #e7eaf0',
            borderRadius: 12, padding: '14px 20px', marginBottom: 18,
          }}>
            <div style={{ color: '#5a6070', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Görünüş seçin:</div>

            {/* Toggle */}
            <div style={{ display: 'flex', background: '#f0f2f8', borderRadius: 10, padding: 3, gap: 2 }}>
              {([['list','📋','Siyahı görünüşü'],['nested','⠿','Qrup görünüşü']] as const).map(([v, icon, label]) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setSaved(false) }}
                  style={{
                    padding: '8px 20px', borderRadius: 8, border: 'none',
                    background: view === v ? '#c9962a' : 'transparent',
                    color: view === v ? '#fff' : '#8a909c',
                    fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    boxShadow: view === v ? '0 2px 8px #c9962a44' : 'none',
                    transition: 'all .15s', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ fontSize: 15 }}>{icon}</span>{label}
                </button>
              ))}
            </div>

            <div style={{ flex: 1 }} />

            {/* Cari vəziyyət */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {savedView === view
                ? <span style={{ fontSize: 12, color: '#52c41a', fontWeight: 600 }}>✅ Bu görünüş artıq seçilidir</span>
                : <span style={{ fontSize: 12, color: '#8a909c' }}>
                    Cari seçilmiş: <b style={{ color: '#2b2f3a' }}>{savedView === 'list' ? '📋 Siyahı' : '⠿ Qrup'}</b>
                  </span>
              }
              <button
                onClick={handleSave}
                disabled={savedView === view}
                style={{
                  padding: '8px 20px', borderRadius: 9, border: 'none',
                  background: savedView === view ? '#e7eaf0' : saved ? '#237804' : '#c9962a',
                  color: savedView === view ? '#aab' : '#fff',
                  fontWeight: 800, fontSize: 13,
                  cursor: savedView === view ? 'default' : 'pointer',
                  transition: 'background .2s',
                }}
              >
                {saved ? '✓ Saxlanıldı!' : 'Bu görünüşü təyin et →'}
              </button>
            </div>
          </div>

          {/* ── İzahat ── */}
          <div className="info-box" style={{ marginBottom: 14 }}>
            {view === 'list'
              ? '📋 Siyahı: Tələbə bütün ixtisasları bir-bir sürüşdürərək prioritet sırasını müəyyənləşdirəcək.'
              : '⠿ Qrup: Tələbə ana qrupları, alt qrupları və ixtisasları öz daxillərində ayrı-ayrı sürüşdürə biləcək.'}
          </div>

          {/* ── Görünüş (statik önizlə) ── */}
          {view === 'list'
            ? <FlatView flat={flat} submitted={true} />
            : <NestedView nested={nested} submitted={true} />
          }

          {/* Alt düymə */}
          <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Tələbə sürüşdürə bilər, lakin bu önizlədə sürüşdürmə deaktivdir.
            </span>
            <button className="btn btn-outline btn-sm" disabled>
              Seçimi Təsdiqlə (tələbə tərəfindən aktivləşir)
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function SelectionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [preview,       setPreview]       = useState(false)
  const [previewInEdit, setPreviewInEdit] = useState(false)
  const [resetDone,     setResetDone]     = useState(false)
  const [editing,       setEditing]       = useState(searchParams.get('edit') === 'true')
  const [editForm,      setEditForm]      = useState<{ name: string; treeId: string; viewMode: 'list' | 'nested'; sourceProportional: boolean; status: string } | null>(null)
  const [, forceRefresh] = useState(0)
  const refresh = () => forceRefresh(n => n + 1)
  const { dialog, showConfirm, closeDialog } = useDialog()

  const sel   = selectionDb.get(id!)
  const tree  = sel ? treeDb.get(sel.treeId) : null
  const insts = institutionDb.getAll()
  const allTrees = treeDb.getAll() as any[]
  const instObj = insts.find((i: any) => i.id === sel?.institution)
  const instLabel = instObj
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><InstIcon icon={instObj.icon} size={16} /> {instObj.label}</span>
    : '—'

  function buildEditForm(s: any) {
    return { name: s.name, treeId: s.treeId || '', viewMode: s.viewMode || 'list', sourceProportional: !!s.sourceProportional, status: s.status || 'draft' }
  }

  // editForm başladıc
  useEffect(() => {
    if (sel && editing && !editForm) setEditForm(buildEditForm(sel))
  }, [sel, editing])

  function openEdit() {
    if (!sel) return
    setEditForm(buildEditForm(sel))
    setEditing(true)
    setSearchParams({ edit: 'true' })
  }

  function cancelEdit() {
    setEditing(false)
    setEditForm(null)
    setSearchParams({})
  }

  function saveEdit() {
    if (!editForm || !sel) return
    if (!editForm.name.trim() || !editForm.treeId) {
      alert('Ad və struktur məcburidir')
      return
    }
    selectionDb.update(sel.id, {
      name:               editForm.name.trim(),
      treeId:             editForm.treeId,
      viewMode:           editForm.viewMode,
      sourceProportional: editForm.sourceProportional,
      status:             editForm.status,
    })
    addLog('selection', 'info', `Seçim redaktə edildi: "${editForm.name.trim()}"`, `id: ${sel.id}`)
    setEditing(false)
    setEditForm(null)
    setSearchParams({})
    refresh()
  }

  if (!sel) {
    return (
      <div className="empty-state">
        <div className="empty-icon">❌</div>
        <div className="empty-title">Seçim tapılmadı</div>
        <button className="btn btn-outline" onClick={() => navigate('/admin/selections')}>Geri</button>
      </div>
    )
  }

  const totalQuota   = tree ? treeDb.totalQuota(tree) : 0
  const totalSpec    = tree ? treeDb.countSpecialties(tree) : 0
  const instUsers    = (userDb.getAll() as any[]).filter((u: any) => u.institution === sel.institution)
  const hasSources   = instUsers.some((u: any) => u.source)
  const mülkiCount   = instUsers.filter((u: any) => u.source === 'mülki').length
  const liseyCount   = instUsers.filter((u: any) => u.source === 'lisey').length
  const spActive     = !!(sel.sourceProportional)

  function toggleSourceProp() {
    selectionDb.update(sel.id, { sourceProportional: !spActive })
    addLog('selection', 'info',
      `Proporsional bölgü ${!spActive ? 'aktivləşdirildi' : 'deaktiv edildi'}: "${sel.name}"`,
      !spActive ? `Mülki ${mülkiCount} · Lisey ${liseyCount}` : undefined)
    refresh()
  }

  const STATUS_COLOR: Record<string, string> = {
    draft: 'badge-gray', published: 'badge-green', closed: 'badge-orange',
  }
  const STATUS_LABEL: Record<string, string> = {
    draft: 'Qaralama', published: 'Yayımlanıb', closed: 'Bağlanıb',
  }

  function handleReset() {
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Seçimləri sıfırla',
      message: `"${sel!.name}" seçimi üçün ${instUsers.length} tələbənin bütün mövcud seçimləri silinəcək. Bu əməliyyat geri alına bilməz.`,
      confirmLabel: 'Sıfırla', confirmColor: '#ff4d4f',
      onConfirm: () => {
        const subList = JSON.parse(localStorage.getItem('mmu_submissions') || '[]')
        const filtered = subList.filter((s: any) => s.selectionId !== sel!.id)
        localStorage.setItem('mmu_submissions', JSON.stringify(filtered))
        addLog('selection', 'warning', `Seçimlər sıfırlandı: "${sel!.name}"`, `${subList.length - filtered.length} seçim silindi`)
        refresh()
      },
    })
  }

  function handleSeed() {
    showConfirm({
      icon: '🔄', iconBg: '#fff7e6', iconColor: '#d46b08',
      title: 'Seçimləri avtomatik doldur',
      message: `"${sel!.name}" seçimi üçün ${instUsers.length} tələbəyə avtomatik seçim yaradılacaq. Mövcud seçimlər silinəcək.`,
      confirmLabel: 'Doldur', confirmColor: '#d46b08',
      onConfirm: () => {
        const { count } = resetAndAutoSeedSubmissions(sel!.id)
        addLog('selection', 'info', `Seçimlər avtomatik dolduruldu: "${sel!.name}"`, `${count} tələbə üçün seçim yaradıldı`)
        setResetDone(true)
        setTimeout(() => setResetDone(false), 4000)
        refresh()
      },
    })
  }

  return (
    <>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}
      {preview && (() => {
        const previewTree = previewInEdit && editForm
          ? allTrees.find((t: any) => t.id === editForm.treeId) ?? tree
          : tree
        const previewSel = previewInEdit && editForm
          ? { ...sel, viewMode: editForm.viewMode }
          : sel
        return previewTree ? (
          <PreviewOverlay
            sel={previewSel} tree={previewTree}
            onClose={() => { setPreview(false); setPreviewInEdit(false) }}
            onSaveView={(v) => {
              if (previewInEdit) {
                setEditForm(f => f ? { ...f, viewMode: v } : f)
              } else {
                selectionDb.update(sel.id, { viewMode: v })
                refresh()
                addLog('selection', 'info', `Tələbə görünüşü dəyişdirildi: "${v}" — "${sel.name}"`)
              }
            }}
          />
        ) : null
      })()}

      {/* ── Action bar ── */}
      <div className="flex-row" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <button className="btn btn-outline btn-sm" onClick={() => navigate('/admin/selections')}>
          ← Geri
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Sıfırla */}
          <button
            onClick={handleReset}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', border:'1.5px solid #ffccc7', background:'#fff0f0', color:'#cf1322', transition:'all .2s' }}
          >
            🗑 Sıfırla
          </button>
          {/* Doldur */}
          <button
            onClick={handleSeed}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', border:`1.5px solid ${resetDone ? '#52c41a' : '#ffa940'}`, background: resetDone ? '#f0fff4' : '#fff8ec', color: resetDone ? '#237804' : '#d46b08', transition:'all .2s' }}
          >
            {resetDone ? '✅ Dolduruldu!' : '🔄 Doldur'}
          </button>

          {sel.status === 'draft' && (
            <button className="btn btn-green" onClick={() => { selectionDb.publish(sel.id); refresh(); addLog('selection', 'success', `Seçim yayımlandı: "${sel.name}"`, `id: ${sel.id}`) }}>
              🚀 Yayımla
            </button>
          )}
          {sel.status === 'published' && (
            <button className="btn btn-danger" onClick={() => { selectionDb.close(sel.id); refresh(); addLog('selection', 'warning', `Seçim bağlandı: "${sel.name}"`, `id: ${sel.id}`) }}>
              ⛔ Seçimi Bitir
            </button>
          )}
        </div>
      </div>

      {sel.status === 'draft' && (
        <div className="info-box">
          ℹ️ Bu seçim hələ yayımlanmayıb. Tələbələr görə bilmir. Yayımlamadan əvvəl tələbə görünüşünü yoxlayın.
        </div>
      )}
      {sel.status === 'published' && (
        <div style={{ background: '#e6faf2', border: '1.5px solid #a3e8c8', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#1a6e4a', marginBottom: 16 }}>
          ✅ Seçim yayımlanıb. Tələbələr öz seçimlərini edə bilər.
        </div>
      )}

      <div className="two-col">
        {/* ── Sol: Əsas məlumat ── */}
        <div>
          <div className="card">
            <div className="card-head">
              <div className="card-title">Seçim Məlumatları</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className={`badge ${STATUS_COLOR[sel.status]}`}>{STATUS_LABEL[sel.status]}</span>
                {!editing && (
                  <button className="btn btn-sm btn-outline" onClick={openEdit}>✏️ Düzəlt</button>
                )}
              </div>
            </div>
            <div className="card-body pad">
              {editing && editForm ? (
                /* ── Redaktə formu ── */
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="form-group">
                    <label className="form-label">Seçim Adı *</label>
                    <input
                      className="form-input"
                      value={editForm.name}
                      onChange={e => setEditForm(f => f ? { ...f, name: e.target.value } : f)}
                      placeholder="Seçim adı"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">İxtisas Strukturu *</label>
                    <select
                      className="form-select"
                      value={editForm.treeId}
                      onChange={e => setEditForm(f => f ? { ...f, treeId: e.target.value } : f)}
                    >
                      <option value="">— Struktur seçin —</option>
                      {allTrees
                        .filter((t: any) => !t.institution || t.institution === sel.institution)
                        .map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name}{t.year ? ` · ${t.year}` : ''}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Tələbə Görünüşü</label>
                    <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                      {([
                        { v: 'list',   icon: '📋', label: 'Siyahı görünüşü' },
                        { v: 'nested', icon: '⠿',  label: 'Qrup görünüşü' },
                      ] as const).map(opt => {
                        const active = editForm.viewMode === opt.v
                        return (
                          <button
                            key={opt.v}
                            onClick={() => setEditForm(f => f ? { ...f, viewMode: opt.v } : f)}
                            style={{
                              flex: 1, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                              border: `2px solid ${active ? '#c9962a' : '#e0e4f0'}`,
                              background: active ? '#fbf1d6' : '#fff',
                              fontWeight: 700, fontSize: 13,
                              color: active ? '#c9962a' : 'var(--text)',
                              display: 'flex', alignItems: 'center', gap: 8,
                              transition: 'all .15s',
                            }}
                          >
                            <span style={{ fontSize: 16 }}>{opt.icon}</span>{opt.label}
                            {active && <span style={{ marginLeft: 'auto', background: '#c9962a', color: '#fff', fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6 }}>SEÇİLİB</span>}
                          </button>
                        )
                      })}
                    </div>
                    <button
                      className="btn btn-outline btn-sm"
                      disabled={!editForm.treeId}
                      style={{ opacity: editForm.treeId ? 1 : 0.4 }}
                      onClick={() => { setPreviewInEdit(true); setPreview(true) }}
                    >
                      👁 Önizlə
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 4 }}>
                    <button className="btn btn-outline btn-sm" onClick={cancelEdit}>Ləğv et</button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={saveEdit}
                      disabled={!editForm.name.trim() || !editForm.treeId}
                      style={{ opacity: (!editForm.name.trim() || !editForm.treeId) ? 0.5 : 1 }}
                    >
                      ✓ Saxla
                    </button>
                  </div>
                </div>
              ) : (
                /* ── Normal baxış ── */
                <table style={{ fontSize: 12 }}>
                  <tbody>
                    {[
                      ['Ad',           sel.name],
                      ['Müəssisə',     instLabel],
                      ['Tələbə sayı',  sel.studentCount],
                      ['Seçim sayı',   sel.choiceCount],
                      ['Yaradılıb',    new Date(sel.createdAt).toLocaleDateString('az-AZ')],
                      ['Tələbə görünüşü', sel.viewMode === 'nested' ? '⠿ Qrup görünüşü' : '📋 Siyahı görünüşü'],
                    ].map(([k, v]) => (
                      <tr key={k as string}>
                        <td style={{ padding: '7px 0', color: 'var(--muted)', width: 140 }}>{k}</td>
                        <td style={{ padding: '7px 0', fontWeight: 600 }}>{v as any}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* ── İxtisas strukturu ── */}
          {!editing && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">İxtisas Strukturu</div>
              </div>
              <div className="card-body pad">
                {tree ? (
                  <>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>{tree.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {totalSpec} ixtisas · Ümumi kvota: {totalQuota}
                    </div>
                    {totalQuota < sel.studentCount && (
                      <div className="warn-box" style={{ marginTop: 10 }}>
                        ⚠️ Kvota ({totalQuota}) tələbə sayından ({sel.studentCount}) azdır!
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-muted">Struktur tapılmadı</div>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </>
  )
}
