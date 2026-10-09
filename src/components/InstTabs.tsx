import React from 'react'
import InstIcon from './InstIcon'
import { P, L, DS, IS_LIGHT_MODE } from '../palette'

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
  // Açıq rejim (İSP dizayn sistemi): tablar bir boz qrup içində, aktiv tab ağ «pill»,
  // adın yanında müəssisənin rəng nöqtəsi
  const DOTS = [DS.data1, DS.data3, DS.data2, DS.data4]
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap', flexShrink: 0 }}>
      <div style={IS_LIGHT_MODE ? { display: 'inline-flex', gap: 4, background: DS.sunken, padding: 4, borderRadius: 10, flexWrap: 'wrap' } : { display: 'contents' }}>
      {insts.map((inst: any, idx: number) => {
        const active = inst.id === activeId
        return (
          <div key={inst.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={() => onSelect(inst.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: L('8px 16px', '10px 22px'), borderRadius: L(6, 10), height: L(36, 42),
                border: 'none', cursor: 'pointer', fontWeight: L(600, 700), fontSize: 14, whiteSpace: 'nowrap',
                background: active ? L(DS.raised, 'var(--blue)') : L('transparent', '#f0f2fa'),
                color: active ? L(DS.ink, '#fff') : 'var(--muted)',
                boxShadow: active ? L(DS.shadow, `0 2px 10px ${P.navy}33`) : 'none',
                transition: 'all .15s',
              }}
            >
              {IS_LIGHT_MODE
                ? <span style={{ width: 8, height: 8, borderRadius: 9999, background: DOTS[idx % DOTS.length], flexShrink: 0 }} />
                : <InstIcon icon={inst.icon} size={16} />}
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
      </div>
      {trailing}
    </div>
  )
}
