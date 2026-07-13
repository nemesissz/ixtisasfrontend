import { useState, useEffect, useMemo } from 'react'
import { logDb, type LogEntry, type LogCategory, type LogType } from '../../db'

// ── Sabit etiketlər ──────────────────────────────────────────────────────────
const CAT_LABEL: Record<LogCategory, string> = {
  system: 'Sistem', selection: 'Seçim', distribution: 'Yerləşdirmə', user: 'Təhsilalan', admin: 'Admin',
}
const CAT_ICON: Record<LogCategory, string> = {
  system: '⚙️', selection: '🗳️', distribution: '⚖️', user: '👤', admin: '🔐',
}
const CAT_COLOR: Record<LogCategory, { bg: string; text: string; border: string; bar: string }> = {
  system:       { bg: '#f0f5ff', text: '#2f54eb', border: '#adc6ff', bar: '#2f54eb' },
  selection:    { bg: '#e6fffb', text: '#006d75', border: '#87e8de', bar: '#13c2c2' },
  distribution: { bg: '#fff7e6', text: '#d46b08', border: '#ffd591', bar: '#fa8c16' },
  user:         { bg: '#f9f0ff', text: '#531dab', border: '#d3adf7', bar: '#722ed1' },
  admin:        { bg: '#fff0f6', text: '#c41d7f', border: '#ffadd2', bar: '#eb2f96' },
}
const TYPE_LABEL: Record<LogType, string> = { info: 'Məlumat', success: 'Uğurlu', warning: 'Xəbərdarlıq', error: 'Xəta' }
const TYPE_ICON: Record<LogType, string> = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }
const TYPE_COLOR: Record<LogType, { bg: string; text: string; dot: string }> = {
  info:    { bg: '#e6f4ff', text: '#0958d9', dot: '#4096ff' },
  success: { bg: '#f6ffed', text: '#237804', dot: '#52c41a' },
  warning: { bg: '#fffbe6', text: '#ad6800', dot: '#faad14' },
  error:   { bg: '#fff0f0', text: '#a8071a', dot: '#ff4d4f' },
}

function fmt(ts: string) {
  const d = new Date(ts)
  return d.toLocaleString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtTime(ts: string) {
  const d = new Date(ts)
  return d.toLocaleTimeString('az-AZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtDate(ts: string) {
  const d = new Date(ts)
  return d.toLocaleDateString('az-AZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtShort(ts: string) {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'İndicə'
  if (mins < 60) return `${mins} dəq. əvvəl`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} saat əvvəl`
  return `${Math.floor(hrs / 24)} gün əvvəl`
}
// Günə görə qruplaşdırma başlığı
function dayKey(ts: string) {
  const d = new Date(ts), t = new Date(), y = new Date(Date.now() - 86400000)
  if (d.toDateString() === t.toDateString()) return 'Bu gün'
  if (d.toDateString() === y.toDateString()) return 'Dünən'
  return fmtDate(ts)
}

function exportCsv(rows: LogEntry[]) {
  const head = ['Vaxt', 'Kateqoriya', 'Növ', 'Mesaj', 'Detal', 'İcraçı']
  const esc = (c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`
  const lines = [head.join(',')]
  rows.forEach(l => lines.push([fmt(l.timestamp), CAT_LABEL[l.category], TYPE_LABEL[l.type], l.message, l.detail || '', l.actor || ''].map(esc).join(',')))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `sistem_loglari_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function Logs() {
  const [logs, setLogs] = useState<LogEntry[]>([])

  useEffect(() => {
    let cancelled = false
    logDb.getAll().then(list => { if (!cancelled) setLogs(list) })
    return () => { cancelled = true }
  }, [])
  const [catFlt, setCatFlt] = useState<string>('all')
  const [typeFlt, setTypeFlt] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const stats = useMemo(() => {
    const byCat: Record<string, number> = {}
    for (const l of logs) byCat[l.category] = (byCat[l.category] || 0) + 1
    return {
      all: logs.length,
      info: logs.filter(l => l.type === 'info').length,
      success: logs.filter(l => l.type === 'success').length,
      warning: logs.filter(l => l.type === 'warning').length,
      error: logs.filter(l => l.type === 'error').length,
      byCat,
    }
  }, [logs])

  const filtered = useMemo(() => logs.filter(l => {
    if (catFlt !== 'all' && l.category !== catFlt) return false
    if (typeFlt !== 'all' && l.type !== typeFlt) return false
    if (search) {
      const q = search.toLowerCase()
      if (!l.message.toLowerCase().includes(q) && !(l.detail || '').toLowerCase().includes(q) && !(l.actor || '').toLowerCase().includes(q)) return false
    }
    if (dateFrom && new Date(l.timestamp) < new Date(dateFrom)) return false
    if (dateTo) { const to = new Date(dateTo); to.setHours(23, 59, 59, 999); if (new Date(l.timestamp) > to) return false }
    return true
  }), [logs, catFlt, typeFlt, search, dateFrom, dateTo])

  // Günə görə qruplaşdır
  const grouped = useMemo(() => {
    const g: { day: string; items: LogEntry[] }[] = []
    for (const l of filtered) {
      const k = dayKey(l.timestamp)
      const last = g[g.length - 1]
      if (last && last.day === k) last.items.push(l)
      else g.push({ day: k, items: [l] })
    }
    return g
  }, [filtered])

  const toggleExpand = (id: string) => setExpanded(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const hasFilter = catFlt !== 'all' || typeFlt !== 'all' || !!search || !!dateFrom || !!dateTo


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Birləşmiş idarə paneli ── */}
      <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Sıra 1: kateqoriya çipləri + əməliyyatlar (bir sətir) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
          <button onClick={() => setCatFlt('all')} style={chip(catFlt === 'all', '#c9962a', '#fbf1d6')}>Hamısı ({stats.all})</button>
          {(Object.keys(CAT_LABEL) as LogCategory[]).map(cat => (
            <button key={cat} onClick={() => setCatFlt(catFlt === cat ? 'all' : cat)}
              style={chip(catFlt === cat, CAT_COLOR[cat].text, CAT_COLOR[cat].bg)}>
              {CAT_ICON[cat]} {CAT_LABEL[cat]} ({stats.byCat[cat] || 0})
            </button>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => exportCsv(filtered)} disabled={!filtered.length} style={{ ...btnStyle('#f6ffed', '#237804', '#b7eb8f'), opacity: filtered.length ? 1 : .5, cursor: filtered.length ? 'pointer' : 'not-allowed' }}>⬇️ İxrac (CSV)</button>
          </div>
        </div>
        {/* Axtarış + tip + tarix */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 170 }}>
            <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 14, color: 'var(--muted)' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mesaj, detal və ya icraçıya görə axtar..."
              style={{ width: '100%', padding: '8px 10px 8px 34px', borderRadius: 9, border: '1.5px solid var(--border)', fontSize: 13, outline: 'none', background: '#fafbff', boxSizing: 'border-box' }} />
          </div>
          <select value={typeFlt} onChange={e => setTypeFlt(e.target.value)} style={selStyle}>
            <option value="all">Bütün növlər</option>
            {(Object.keys(TYPE_LABEL) as LogType[]).map(t => <option key={t} value={t}>{TYPE_ICON[t]} {TYPE_LABEL[t]}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={selStyle} />
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={selStyle} />
          {hasFilter && (
            <button onClick={() => { setCatFlt('all'); setTypeFlt('all'); setSearch(''); setDateFrom(''); setDateTo('') }}
              style={{ padding: '7px 14px', borderRadius: 9, border: '1.5px solid var(--border)', background: '#f5f6fa', color: 'var(--muted)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✕ Sıfırla</button>
          )}
          <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{filtered.length} / {logs.length} qeyd</div>
        </div>
      </div>

      {/* ── Audit siyahısı (günə görə qruplaşdırılmış) ── */}
      <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '56px 0', textAlign: 'center', color: 'var(--muted)' }}>
            <div style={{ fontSize: 38, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Qeyd tapılmadı</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Filtri dəyişin və ya logları yeniləyin</div>
          </div>
        ) : grouped.map(group => (
          <div key={group.day}>
            {/* Gün başlığı */}
            <div style={{ position: 'sticky', top: 0, zIndex: 1, padding: '8px 18px', background: '#f8f9fd', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.6, display: 'flex', justifyContent: 'space-between' }}>
              <span>📅 {group.day}</span>
              <span style={{ fontWeight: 600 }}>{group.items.length} qeyd</span>
            </div>
            {group.items.map(log => {
              const cat = CAT_COLOR[log.category]
              const typ = TYPE_COLOR[log.type]
              const isOpen = expanded.has(log.id)
              return (
                <div key={log.id} style={{ borderBottom: '1px solid #f3f4fa', borderLeft: `3px solid ${cat.bar}`, background: isOpen ? '#fafbff' : '#fff', transition: 'background .12s' }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fafbff' }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fff' }}>
                  <div onClick={() => log.detail && toggleExpand(log.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '11px 16px', cursor: log.detail ? 'pointer' : 'default' }}>
                    {/* Vaxt sütunu */}
                    <div style={{ width: 84, flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace' }}>{fmtTime(log.timestamp)}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 1 }}>{fmtShort(log.timestamp)}</div>
                    </div>
                    {/* Tip nöqtəsi */}
                    <div title={TYPE_LABEL[log.type]} style={{ width: 10, height: 10, borderRadius: '50%', background: typ.dot, flexShrink: 0, boxShadow: `0 0 0 3px ${typ.dot}22` }} />
                    {/* Mesaj */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{log.message}</div>
                      {log.detail && !isOpen && (
                        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.detail}</div>
                      )}
                    </div>
                    {/* Kateqoriya çipi */}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cat.bg, color: cat.text, border: `1px solid ${cat.border}`, flexShrink: 0 }}>
                      {CAT_ICON[log.category]} {CAT_LABEL[log.category]}
                    </span>
                    {/* İcraçı */}
                    {log.actor && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', background: '#f5f6fa', padding: '3px 10px', borderRadius: 20, border: '1px solid var(--border)', whiteSpace: 'nowrap', flexShrink: 0, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>👤 {log.actor}</span>
                    )}
                    {/* Toggle */}
                    <span style={{ width: 16, fontSize: 12, color: 'var(--muted)', flexShrink: 0, textAlign: 'center' }}>{log.detail ? (isOpen ? '▲' : '▼') : ''}</span>
                  </div>
                  {isOpen && log.detail && (
                    <div style={{ margin: '0 16px 12px 100px', padding: '12px 16px', background: cat.bg, borderRadius: 10, fontSize: 12.5, color: cat.text, borderLeft: `3px solid ${cat.bar}`, lineHeight: 1.6 }}>
                      <span style={{ fontWeight: 800, marginRight: 8 }}>📌 Detallar:</span>{log.detail}
                      <div style={{ marginTop: 6, fontSize: 11, opacity: .8 }}>🕐 {fmt(log.timestamp)}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

    </div>
  )
}

// ── Stil köməkçiləri ──────────────────────────────────────────────────────────
const btnStyle = (bg: string, color: string, border: string): React.CSSProperties => ({
  padding: '8px 16px', borderRadius: 10, border: `1.5px solid ${border}`, background: bg, color, fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
})
const selStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 9, border: '1.5px solid var(--border)', fontSize: 13, background: '#fafbff', color: 'var(--text)', outline: 'none',
}
const chip = (active: boolean, color: string, bg: string): React.CSSProperties => ({
  padding: '5px 13px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
  background: active ? bg : '#f5f6fa', color: active ? color : 'var(--muted)',
  border: active ? `1.5px solid ${color}55` : '1.5px solid transparent', transition: 'all .15s',
})
