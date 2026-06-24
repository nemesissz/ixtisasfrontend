import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectionDb, institutionDb, useLocalState, addLog } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import InstIcon from '../../components/InstIcon'
import { useTopbar } from '../../contexts/TopbarContext'

const STATUS_BADGE: Record<string, string> = {
  draft:     'badge badge-gray',
  published: 'badge badge-green',
  closed:    'badge badge-orange',
  archived:  'badge badge-gray',
}
const STATUS_LABEL: Record<string, string> = {
  draft:     'Qaralama',
  published: 'Yayımlanıb',
  closed:    'Bağlanıb',
  archived:  'Arxivləndi',
}

export default function Selections() {
  const navigate = useNavigate()
  const [list, refresh]           = useLocalState(selectionDb.getAll)
  const [institutions]            = useLocalState(institutionDb.getAll)
  const [tab, setTab]             = useState<string>('')
  const [filter, setFilter]       = useState('all')

  // resolve active tab (default to first institution)
  const { dialog, showConfirm, closeDialog } = useDialog()

  const { setSlot, clearSlot } = useTopbar()

  const insts: any[] = institutions
  const activeTab = tab || insts[0]?.id || ''

  const byInstitution = list.filter((s: any) => s.institution === activeTab)

  // ── Müəssisə tablarını topbara inject et ──
  useEffect(() => {
    const token = setSlot(
      insts.length === 0
        ? <></>
        : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {insts.map((inst: any) => (
              <button
                key={inst.id}
                onClick={() => { setTab(inst.id); setFilter('all') }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 8,
                  border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13,
                  transition: 'all .15s',
                  background: activeTab === inst.id ? 'var(--blue)' : '#f0f2fa',
                  color:      activeTab === inst.id ? '#fff'        : 'var(--muted)',
                  boxShadow:  activeTab === inst.id ? '0 2px 8px #c9962a33' : 'none',
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
  }, [insts, activeTab])

  const filtered = filter === 'all'
    ? byInstitution.filter((s: any) => s.status !== 'archived')
    : byInstitution.filter((s: any) => s.status === filter)

  function handleArchive(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    showConfirm({
      icon: '🗄️', iconBg: '#f0f2fa', iconColor: '#9a7b1e',
      title: 'Seçimi arxivlə',
      message: 'Bu seçim arxivlənəcək. Arxiv bölməsindən istənilən vaxt bərpa edə bilərsiniz.',
      confirmLabel: 'Arxivlə', confirmColor: '#9a7b1e',
      onConfirm: () => { selectionDb.archive(id); refresh(); addLog('selection', 'info', `Seçim arxivləndi`, `id: ${id}`) },
    })
  }

  function handlePublish(s: any, e: React.MouseEvent) {
    e.stopPropagation()
    showConfirm({
      icon: '🚀', iconBg: '#f0fff4', iconColor: '#52c41a',
      title: 'Seçimi yayımla',
      message: `"${s.name}" seçimi yayımlanacaq. Təhsil Alanlar öz seçimlərini edə biləcək.`,
      confirmLabel: 'Yayımla', confirmColor: '#52c41a',
      onConfirm: () => { selectionDb.publish(s.id); refresh(); addLog('selection', 'success', `Seçim yayımlandı: "${s.name}"`, `id: ${s.id}`) },
    })
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Seçimi sil',
      message: 'Bu seçim tamamilə silinəcək. Əməliyyat geri alına bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: () => { selectionDb.delete(id); refresh(); addLog('selection', 'warning', `Seçim silindi`, `id: ${id}`) },
    })
  }

  return (
    <>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}

      {/* Status filter + New button row */}
      <div className="flex-row" style={{ marginBottom: 16, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {['all','draft','published','closed'].map(f => (
            <button
              key={f}
              className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? 'Hamısı' : STATUS_LABEL[f]}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/admin/selections/new')}>
          + Yeni Seçim
        </button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🗳</div>
          <div className="empty-title">Seçim yoxdur</div>
          <div className="empty-sub">
            {insts.find((i: any) => i.id === activeTab)?.label ?? ''} üçün hələ ki heç bir seçim yaradılmayıb
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/admin/selections/new')}>
            İlk Seçimi Yarat
          </button>
        </div>
      ) : (
        filtered.map((s: any, i: number) => (
          <div
            key={s.id}
            className="sel-card"
            onClick={() => navigate(`/admin/selections/${s.id}`)}
          >
            <div className="sel-card-num">{i + 1}</div>
            <div className="sel-card-body">
              <div className="sel-card-name">{s.name}</div>
              <div className="sel-card-meta">
                {s.studentCount ? `${s.studentCount} təhsil alan · ` : ''}{s.packetCount ? `${s.packetCount} paket · ` : ''}{s.choiceCount ? `${s.choiceCount} seçim · ` : ''}
                {s.startDate || '—'} → {s.endDate || '—'}
              </div>
            </div>
            <span className={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</span>
            <div className="sel-card-actions" onClick={e => e.stopPropagation()}>
              <button
                className="btn btn-sm btn-outline"
                onClick={e => { e.stopPropagation(); navigate(`/admin/selections/${s.id}?edit=true`) }}
              >
                ✏️ Düzəlt
              </button>
              {s.status === 'draft' && (
                <button
                  className="btn btn-sm"
                  style={{ background: '#f0fff4', color: '#389e0d', border: '1.5px solid #b7eb8f', fontWeight: 700 }}
                  onClick={e => handlePublish(s, e)}
                >
                  🚀 Yayımla
                </button>
              )}
              {s.status === 'published' && (
                <button className="btn btn-sm btn-danger" onClick={e => { e.stopPropagation(); selectionDb.close(s.id); refresh(); addLog('selection', 'warning', `Seçim bağlandı: "${s.name}"`, `id: ${s.id}`) }}>
                  — Seçimi Bitir
                </button>
              )}
              <button
                className="btn btn-sm"
                onClick={e => handleArchive(s.id, e)}
                style={{ background: '#f0f2fa', color: '#9a7b1e', border: '1.5px solid #d0d4f0' }}
              >
                🗄️ Arxivlə
              </button>
              <button className="btn btn-sm btn-outline" onClick={e => handleDelete(s.id, e)}>🗑</button>
            </div>
          </div>
        ))
      )}
    </>
  )
}
