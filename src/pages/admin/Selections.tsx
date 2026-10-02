import { useState } from 'react'
import { useActiveInst } from '../../activeInst'
import { useNavigate } from 'react-router-dom'
import { selectionDb, institutionDb, useLocalState, addLog } from '../../db'
import { AppDialog, useDialog } from '../../components/AppDialog'
import InstTabs from '../../components/InstTabs'

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
  const [tab, setTab]             = useActiveInst(institutions as any[])
  const [filter, setFilter]       = useState('all')

  // resolve active tab (default to first institution)
  const { dialog, showConfirm, showInfo, closeDialog } = useDialog()

  if (!list || !institutions) return <div className="empty-state">Yüklənir...</div>

  const insts: any[] = institutions
  const activeTab = tab || insts[0]?.id || ''

  const byInstitution = list.filter((s: any) => s.institution === activeTab)

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
      onConfirm: async () => { await selectionDb.archive(id); await refresh(); addLog('selection', 'info', `Seçim arxivləndi`, `id: ${id}`) },
    })
  }

  function handlePublish(s: any, e: React.MouseEvent) {
    e.stopPropagation()
    showConfirm({
      icon: '🚀', iconBg: '#f0fff4', iconColor: '#52c41a',
      title: 'Seçimi yayımla',
      message: `"${s.name}" seçimi yayımlanacaq. Təhsilalanlar öz seçimlərini edə biləcək.`,
      confirmLabel: 'Yayımla', confirmColor: '#52c41a',
      onConfirm: async () => {
        try {
          await selectionDb.publish(s.id)
        } catch (err: any) {
          // Server mənbə balansı pozulanda 409 qaytarır — səbəbi olduğu kimi göstər
          const raw = String(err?.message ?? err ?? '')
          const m = raw.match(/\{[\s\S]*\}/)
          let text = raw
          try { if (m) text = JSON.parse(m[0])?.message || raw } catch { /* mətn olduğu kimi qalsın */ }
          showInfo({
            icon: '⚖️', iconBg: '#fff2f0', iconColor: '#cf1322',
            title: 'Yayım mümkün deyil',
            message: text || 'Seçimi yayımlamaq alınmadı.',
          })
          return
        }
        await refresh()
        addLog('selection', 'success', `Seçim yayımlandı: "${s.name}"`, `id: ${s.id}`)
      },
    })
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    showConfirm({
      icon: '🗑️', iconBg: '#fff0f0', iconColor: '#ff4d4f',
      title: 'Seçimi sil',
      message: 'Bu seçim tamamilə silinəcək. Əməliyyat geri alına bilməz.',
      confirmLabel: 'Sil', confirmColor: '#ff4d4f',
      onConfirm: async () => { await selectionDb.delete(id); await refresh(); addLog('selection', 'warning', `Seçim silindi`, `id: ${id}`) },
    })
  }

  return (
    <>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}

      {/* Müəssisə tabları */}
      <InstTabs insts={insts} activeId={activeTab} onSelect={(id) => { setTab(id); setFilter('all') }} />

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
                {s.studentCount ? `${s.studentCount} təhsilalan · ` : ''}{s.packetCount ? `${s.packetCount} paket · ` : ''}{s.choiceCount ? `${s.choiceCount} seçim · ` : ''}
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
                <button className="btn btn-sm btn-danger" onClick={async e => { e.stopPropagation(); await selectionDb.close(s.id); await refresh(); addLog('selection', 'warning', `Seçim bağlandı: "${s.name}"`, `id: ${s.id}`) }}>
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
