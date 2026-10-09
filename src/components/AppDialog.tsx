import { useState } from 'react'
import { P, O } from '../palette'

// ── Tip ───────────────────────────────────────────────────────────────────────
export type DialogCfg = {
  icon: string
  iconBg: string
  iconColor: string
  title: string
  message: string
  confirmLabel?: string
  confirmColor?: string
  cancelLabel?: string
  infoOnly?: boolean
  onConfirm?: () => void
}

// ── Görünüş ───────────────────────────────────────────────────────────────────
export function AppDialog({ cfg, onClose }: { cfg: DialogCfg; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(10,15,40,0.45)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn .15s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: 20, padding: '32px 28px 24px',
          width: 380, maxWidth: '90vw',
          boxShadow: '0 24px 64px rgba(0,0,0,.22)',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          animation: 'scaleIn .18s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        {/* İkon */}
        <div style={{
          width: 64, height: 64, borderRadius: 18, marginBottom: 16,
          background: cfg.iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 30,
          boxShadow: `0 8px 24px ${cfg.iconColor}33`,
        }}>{cfg.icon}</div>

        {/* Başlıq */}
        <div style={{
          fontSize: 17, fontWeight: 800, color: 'var(--text)',
          marginBottom: 10, textAlign: 'center',
        }}>
          {cfg.title}
        </div>

        {/* Mesaj */}
        <div style={{
          fontSize: 13, color: 'var(--muted)', textAlign: 'center',
          lineHeight: 1.65, marginBottom: 26, maxWidth: 300, whiteSpace: 'pre-line',
        }}>
          {cfg.message}
        </div>

        {/* Düymələr */}
        <div style={{ display: 'flex', gap: 10, width: '100%' }}>
          {!cfg.infoOnly && (
            <button
              onClick={onClose}
              style={{
                flex: 1, padding: '11px 0', borderRadius: 12,
                border: '1.5px solid var(--border)',
                background: '#f4f6fb', color: 'var(--muted)',
                fontWeight: 700, fontSize: 14, cursor: 'pointer', transition: 'all .15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${O(P.tint, '#f3e9cf')}` }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#f4f6fb' }}
            >
              {cfg.cancelLabel ?? 'Ləğv et'}
            </button>
          )}
          <button
            onClick={() => { cfg.onConfirm?.(); onClose() }}
            style={{
              flex: 1, padding: '11px 0', borderRadius: 12, border: 'none',
              background: cfg.confirmColor ?? 'var(--blue)',
              color: '#fff', fontWeight: 700, fontSize: 14,
              cursor: 'pointer', transition: 'all .15s',
              boxShadow: `0 4px 14px ${cfg.confirmColor ?? `${P.navy}`}44`,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '.88' }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1' }}
          >
            {cfg.confirmLabel ?? 'Təsdiq et'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useDialog() {
  const [dialog, setDialog] = useState<DialogCfg | null>(null)

  function showConfirm(cfg: DialogCfg) { setDialog(cfg) }

  function showInfo(cfg: Omit<DialogCfg, 'onConfirm'>) {
    setDialog({ ...cfg, infoOnly: true })
  }

  function closeDialog() { setDialog(null) }

  return { dialog, showConfirm, showInfo, closeDialog }
}
