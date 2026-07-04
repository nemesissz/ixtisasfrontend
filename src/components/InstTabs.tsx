import React from 'react'
import InstIcon from './InstIcon'

// ── Bütün bölmələrdə eyni standart müəssisə tabları ──
// insts: müəssisə siyahısı, activeId: seçili, onSelect: klik
// onEdit: (varsa) hər tabın yanında ✏️ düyməsi
// trailing: sonda əlavə düymə (məs. "+ Yeni Müəssisə")
export default function InstTabs({ insts, activeId, onSelect, onEdit, trailing }: {
  insts: any[]
  activeId: string
  onSelect: (id: string) => void
  onEdit?: (inst: any) => void
  trailing?: React.ReactNode
}) {
  if (!insts || insts.length === 0) return trailing ? <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>{trailing}</div> : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap', flexShrink: 0 }}>
      {insts.map((inst: any) => {
        const active = inst.id === activeId
        return (
          <div key={inst.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => onSelect(inst.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '10px 22px', borderRadius: 10, height: 42,
                border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap',
                background: active ? 'var(--blue)' : '#f0f2fa',
                color: active ? '#fff' : 'var(--muted)',
                boxShadow: active ? '0 2px 10px #c9962a33' : 'none',
                transition: 'all .15s',
              }}
            >
              <InstIcon icon={inst.icon} size={16} />
              {inst.label}
            </button>
            {onEdit && (
              <button onClick={(e) => { e.stopPropagation(); onEdit(inst) }} title="Redaktə et"
                style={{ width: 26, height: 26, borderRadius: 7, border: '1.5px solid #e4e8f5', background: active ? '#eef1ff' : '#f4f7ff', color: '#7a88cc', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                ✏️
              </button>
            )}
          </div>
        )
      })}
      {trailing}
    </div>
  )
}
