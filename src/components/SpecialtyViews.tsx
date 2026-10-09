import { useState, useRef } from 'react'
import { P, O, L } from '../palette'

// Son səviyyə (hərbi uçot ixtisası) rəngləri — açıq rejimdə qəhvəyi əvəzinə mavi tonlar
const LAST_HEAD_BG = L('#d4e2ef', '#fff4ef')
const LAST_HEAD_FG = L('#1d5a8c', '#8c3a1f')
const LAST_ACCENT  = L('#1d5a8c', '#ff7c4f')
const LAST_BOX_BG  = L('#f4f8fc', '#fff9f6')
const LAST_BOX_BD  = L('#d4e2ef', '#fde8dc')
const LAST_ITEM_BG = L('#eef4fa', '#fff4ef')
const LAST_ITEM_OV = L('#dbe8f4', '#ffe8d8')
const LAST_ITEM_BD = L('#c9dbeb', '#ffd5c2')
const LAST_ITEM_FG = L('#1d3a5c', '#7a2a10')
const LAST_SHADOW  = L('rgba(29,90,140,.45)', 'rgba(255,124,79,.5)')

// ── Types ─────────────────────────────────────────────────────────────────────
export interface SpecEntry  { specId: string; specName: string; quota: number }
// Brauzerin kursor yanında göstərdiyi yarımşəffaf "kölgə" sətri gizlədilir —
// sətrin özü onsuz da siyahıda yer dəyişir.
const EMPTY_IMG = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }) : null
export function hideGhost(e: React.DragEvent) {
  if (EMPTY_IMG) { try { e.dataTransfer.setDragImage(EMPTY_IMG, 0, 0) } catch {} }
}

export interface SubEntry   { subId: string; subName: string; specialties: SpecEntry[] }
export interface GroupEntry { groupId: string; groupName: string; subgroups: SubEntry[] }
export interface FlatRow    {
  groupId: string; groupName: string
  subId: string;   subName: string
  specId: string;  specName: string; quota: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Rekursiv ağacdan yarpaqları topla (hər yarpaq üçün əcdad zənciri)
function collectLeaves(nodes: any[], ancestors: any[]): Array<{ leaf: any; anc: any[] }> {
  const result: Array<{ leaf: any; anc: any[] }> = []
  for (const n of nodes) {
    if (!n.children?.length) result.push({ leaf: n, anc: ancestors })
    else result.push(...collectLeaves(n.children, [...ancestors, n]))
  }
  return result
}

export function treeToNested(tree: any): GroupEntry[] {
  // Köhnə format (groups/subgroups/specialties) — geriyə uyğunluq
  if (tree?.groups && !tree?.nodes) {
    return (tree.groups || []).map((g: any) => ({
      groupId: g.id, groupName: g.name,
      subgroups: (g.subgroups || []).map((sg: any) => ({
        subId: sg.id, subName: sg.name,
        specialties: (sg.specialties || []).map((sp: any) => ({
          specId: sp.id, specName: sp.name, quota: sp.quota || 0,
        })),
      })),
    }))
  }

  // Yeni dinamik format (nodes rekursiv)
  const rootNodes: any[] = tree?.nodes || []
  const allLeaves = collectLeaves(rootNodes, [])
  if (!allLeaves.length) return []

  const gOrder: string[] = []
  const gMap = new Map<string, { name: string; sOrder: string[]; sMap: Map<string, { name: string; specs: SpecEntry[] }> }>()

  for (const { leaf, anc } of allLeaves) {
    // 1-ci əcdad → qrup, 2-ci əcdad → alt qrup
    const gNode = anc[0] || { id: '__root__', name: 'Ümumi' }
    const sNode = anc[1] || { id: `__sub_${gNode.id}`, name: gNode.id === '__root__' ? 'Ümumi' : gNode.name }

    if (!gMap.has(gNode.id)) { gOrder.push(gNode.id); gMap.set(gNode.id, { name: gNode.name, sOrder: [], sMap: new Map() }) }
    const gm = gMap.get(gNode.id)!
    if (!gm.sMap.has(sNode.id)) { gm.sOrder.push(sNode.id); gm.sMap.set(sNode.id, { name: sNode.name, specs: [] }) }
    gm.sMap.get(sNode.id)!.specs.push({ specId: leaf.id, specName: leaf.name, quota: leaf.quota || 0 })
  }

  return gOrder.map(gid => {
    const gm = gMap.get(gid)!
    return {
      groupId: gid, groupName: gm.name,
      subgroups: gm.sOrder.map(sid => { const sm = gm.sMap.get(sid)!; return { subId: sid, subName: sm.name, specialties: sm.specs } }),
    }
  })
}

export function nestedToFlat(groups: GroupEntry[]): FlatRow[] {
  const rows: FlatRow[] = []
  for (const g of groups)
    for (const s of g.subgroups)
      for (const sp of s.specialties)
        rows.push({ groupId: g.groupId, groupName: g.groupName, subId: s.subId, subName: s.subName, specId: sp.specId, specName: sp.specName, quota: sp.quota })
  return rows
}

export function flatToNested(flat: FlatRow[]): GroupEntry[] {
  const gOrder: string[] = []
  const gMap = new Map<string, { name: string; sOrder: string[]; sMap: Map<string, { name: string; specs: SpecEntry[] }> }>()
  for (const r of flat) {
    if (!gMap.has(r.groupId)) { gOrder.push(r.groupId); gMap.set(r.groupId, { name: r.groupName, sOrder: [], sMap: new Map() }) }
    const gm = gMap.get(r.groupId)!
    if (!gm.sMap.has(r.subId)) { gm.sOrder.push(r.subId); gm.sMap.set(r.subId, { name: r.subName, specs: [] }) }
    gm.sMap.get(r.subId)!.specs.push({ specId: r.specId, specName: r.specName, quota: r.quota })
  }
  return gOrder.map(gid => {
    const gm = gMap.get(gid)!
    return { groupId: gid, groupName: gm.name, subgroups: gm.sOrder.map(sid => { const sm = gm.sMap.get(sid)!; return { subId: sid, subName: sm.name, specialties: sm.specs } }) }
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// 📋  Siyahı Görünüşü
// ══════════════════════════════════════════════════════════════════════════════
export function FlatView({ flat, onChange, submitted = false, levelNames }: {
  flat: FlatRow[]
  onChange?: (f: FlatRow[]) => void
  submitted?: boolean
  levelNames?: string[]
}) {
  const lv = levelNames && levelNames.length ? levelNames : []
  const dragIdx  = useRef<number | null>(null)
  const movedId  = useRef<string | null>(null)
  const [dragging,    setDragging]    = useState<number | null>(null)
  const [overIdx,     setOverIdx]     = useState<number | null>(null)
  const [flashedId,   setFlashedId]   = useState<string | null>(null)

  const interactive = !submitted && !!onChange

  // 2 səviyyəli ağac (məs. qoşun növü əvvəlcədən təyin edilib yığışdırılanda):
  // treeToNested alt qrupu sintetik "__sub_" id ilə doldurur — o sütun gizlədilir
  const twoLevel = flat.length > 0 && flat.every(r => String(r.subId).startsWith('__sub_'))
  // 1 səviyyəli ağac (yalnız yarpaqlar, məs. ancaq qoşun növləri): sintetik "Ümumi" sütunu gizlədilir
  const oneLevel = twoLevel && flat.every(r => r.groupId === '__root__')
  const gridCols = oneLevel
    ? '40px minmax(0,1fr) 44px'
    : twoLevel
    ? '40px minmax(0,1fr) minmax(0,1fr) 44px'
    : '40px minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) 44px'
  const headCells: Array<[string, string, string, string]> = oneLevel
    ? [['№','center',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`], [lv[0] || 'Səviyyə 1','left',LAST_HEAD_BG,LAST_HEAD_FG], ['','center',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`]]
    : twoLevel
    ? [['№','center',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`], [lv[0] || 'Səviyyə 1','left',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`], [lv[1] || 'Səviyyə 2','left',LAST_HEAD_BG,LAST_HEAD_FG], ['','center',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`]]
    : [['№','center',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`], [lv[0] || 'Səviyyə 1','left',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`], [lv[1] || 'Səviyyə 2','left',`${O(P.tint, '#f7eccf')}`,`${O(P.navyDk, '#6a4a12')}`], [lv[2] || 'Səviyyə 3','left',LAST_HEAD_BG,LAST_HEAD_FG], ['','center',`${P.line3}`,`${O(P.navyDk, '#5a4a12')}`]]

  // Siçanla sürükləmə pointer hadisələri ilə aparılır: brauzerin öz (HTML5) sürükləməsində
  // kursoru dəyişmək mümkün deyil, burada isə bütün müddət "sıxılmış əl" (grabbing) görünür.
  // Toxunma ekranlarında köhnə (HTML5) sürükləmə qalır.
  const pointerKind = useRef<string>('')
  const flatRef = useRef(flat); flatRef.current = flat
  function moveTo(i: number) {
    if (dragIdx.current === null || dragIdx.current === i) return
    setOverIdx(i)
    const next = [...flatRef.current]; const [m] = next.splice(dragIdx.current, 1); next.splice(i, 0, m)
    movedId.current = m.specId
    dragIdx.current = i; flatRef.current = next; onChange!(next)
  }
  function onPointerDown(e: React.PointerEvent, i: number) {
    pointerKind.current = e.pointerType
    if (!interactive || e.pointerType === 'touch' || e.button !== 0) return
    e.preventDefault()
    dragIdx.current = i; setDragging(i)
    // Sürükləmə bitənə qədər səhifənin hər yerində "sıxılmış əl" — sətirlərin öz "grab" kursoru da örtülür
    const cursorStyle = document.createElement('style')
    cursorStyle.textContent = '*, *::before, *::after { cursor: grabbing !important; }'
    document.head.appendChild(cursorStyle)
    const move = (ev: PointerEvent) => {
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest('[data-flat-idx]') as HTMLElement | null
      if (el) moveTo(Number(el.dataset.flatIdx))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      cursorStyle.remove()
      onDragEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  function onDragStart(e: React.DragEvent, i: number) {
    if (!interactive) return
    if (pointerKind.current !== 'touch') { e.preventDefault(); return }
    hideGhost(e)
    dragIdx.current = i; setDragging(i)
  }
  function onDragOver(e: React.DragEvent, i: number) {
    if (!interactive) return
    e.preventDefault()
    moveTo(i)
  }
  function onDragEnd() {
    setDragging(null); setOverIdx(null); dragIdx.current = null
    if (movedId.current) {
      setFlashedId(movedId.current)
      movedId.current = null
      setTimeout(() => setFlashedId(null), 2000)
    }
  }

  return (
    <>
      {/* Başlıq sətiri */}
      <div style={{
        display: 'grid', gridTemplateColumns: gridCols,
        background: `${P.line3}`, border: `2px solid ${P.line}`,
        borderRadius: '12px 12px 0 0', overflow: 'hidden',
      }}>
        {headCells.map(([h, align, bg, color], i) => (
          <div key={i} style={{
            padding: '10px 14px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word',
            borderRight: i < headCells.length - 1 ? `2px solid ${P.line}` : 'none', textAlign: align as any,
            background: bg, color,
          }}>{h}</div>
        ))}
      </div>

      {/* Sətirler */}
      <div style={{ border: `2px solid ${P.line}`, borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden', marginBottom: 10 }}>
        {flat.map((row, i) => {
          const isDrag  = dragging === i
          const isOver  = overIdx === i
          const isFlash = flashedId === row.specId
          // Seçilmiş/sürüklənən sətir bütövlükdə rənglənsin — sütunların öz fonu örtməsin
          const hl = isDrag || isFlash

          return (
            <div
              key={row.specId}
              data-flat-idx={i}
              draggable={interactive}
              onPointerDown={e => onPointerDown(e, i)}
              onDragStart={e => onDragStart(e, i)}
              onDragOver={e => onDragOver(e, i)}
              onDragEnd={onDragEnd}
              style={{
                display: 'grid', gridTemplateColumns: gridCols,
                alignItems: 'stretch',
                borderBottom: i < flat.length - 1 ? '1.5px solid #eef0f8' : 'none',
                background: isFlash ? '#fffbe6' : isDrag ? `${P.tint3}` : '#fff',
                opacity: 1,
                position: 'relative',
                zIndex: isDrag ? 2 : undefined,
                cursor: interactive ? (dragging !== null ? 'grabbing' : 'grab') : 'default',
                userSelect: 'none',
                transition: isFlash ? 'background 1.8s ease, box-shadow 1.8s ease' : 'background .1s',
              }}
            >
              {/* Haşiyə üst qatda çəkilir — xanaların fonu onu örtməsin, bütün sətir işarələnsin */}
              {(isFlash || isDrag || isOver) && <div style={{
                position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1,
                boxShadow: isFlash ? 'inset 0 0 0 2px #f5a623'
                  : isDrag ? `inset 0 0 0 2px ${P.navy}`
                  : `inset 0 2px 0 ${P.navy}, inset 0 -2px 0 ${P.navy}`,
              }} />}
              {/* Sıra # */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${P.navy}`, color: '#fff', fontWeight: 800, fontSize: 12, borderRight: `2px solid ${P.line}` }}>
                {i + 1}
              </div>
              {/* Ana Qrup — 1 səviyyəli rejimdə gizlidir */}
              {!oneLevel && <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', fontSize: 12, fontWeight: 500, color: `${O(P.navyDk, '#5a4a12')}`, background: hl ? 'transparent' : '#f8f9ff', borderRight: '2px solid #dde2f5' }}>
                {row.groupName}
              </div>}
              {/* Alt Qrup — 2 səviyyəli rejimdə gizlidir */}
              {!twoLevel && (
                <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', fontSize: 12, fontWeight: 500, color: `${O(P.navyDk, '#5a4a12')}`, background: hl ? 'transparent' : '#faf8ff', borderRight: '1.5px solid #ece8ff' }}>
                  {row.subName}
                </div>
              )}
              {/* İxtisas */}
              <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', fontSize: 12, fontWeight: 500, color: `${O(P.navyDk, '#5a4a12')}` }}>
                {row.specName}
              </div>
              {/* Sürükləmə tutacağı */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1.5px solid #eef0f8' }}>
                {interactive && <span style={{ color: '#ccc', fontSize: 13 }}>⠿</span>}
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ⠿  Qrup Görünüşü
// ══════════════════════════════════════════════════════════════════════════════
export function NestedView({ nested, onChange, submitted = false }: {
  nested: GroupEntry[]
  onChange?: (g: GroupEntry[]) => void
  submitted?: boolean
}) {
  const gDrag = useRef<number | null>(null)
  const sDrag = useRef<{ gi: number; si: number } | null>(null)
  const pDrag = useRef<{ gi: number; si: number; pi: number } | null>(null)

  const [gDragging, setGDragging] = useState<number | null>(null)
  const [sDragging, setSDragging] = useState<string | null>(null)
  const [pDragging, setPDragging] = useState<string | null>(null)
  const [gOverIdx,  setGOverIdx]  = useState<number | null>(null)
  const [sOverKey,  setSOverKey]  = useState<string | null>(null)
  const [pOverKey,  setPOverKey]  = useState<string | null>(null)
  const [flashKey,  setFlashKey]  = useState<string | null>(null)

  const interactive = !submitted && !!onChange
  const clone = () => JSON.parse(JSON.stringify(nested)) as GroupEntry[]

  function flash(key: string) {
    setFlashKey(key)
    setTimeout(() => setFlashKey(null), 2000)
  }

  // ── Group ──
  function gStart(gi: number) { if (!interactive) return; gDrag.current = gi; setGDragging(gi) }
  function gDragOver(e: React.DragEvent, gi: number) {
    e.preventDefault(); e.stopPropagation()
    if (!interactive || gDrag.current === null) return
    if (gOverIdx !== gi) setGOverIdx(gi)
  }
  function gDrop(gi: number) {
    const src = gDrag.current; if (!interactive || src === null || src === gi) return
    const next = clone(); const [m] = next.splice(src, 1); next.splice(gi, 0, m)
    onChange!(next); gDrag.current = null; setGDragging(null); setGOverIdx(null)
    flash(`g-${next[gi].groupId}`)
  }
  function gEnd() { setGDragging(null); setGOverIdx(null); gDrag.current = null }

  // ── Subgroup ──
  function sStart(e: React.DragEvent, gi: number, si: number) {
    e.stopPropagation(); if (!interactive) return; sDrag.current = { gi, si }; setSDragging(`${gi}-${si}`)
  }
  function sDragOver(e: React.DragEvent, gi: number, si: number) {
    e.preventDefault(); e.stopPropagation()
    const src = sDrag.current; if (!interactive || !src || src.gi !== gi) return
    const k = `${gi}-${si}`; if (sOverKey !== k) setSOverKey(k)
  }
  function sDrop(e: React.DragEvent, gi: number, si: number) {
    e.stopPropagation()
    const src = sDrag.current; if (!interactive || !src || src.gi !== gi || src.si === si) return
    const next = clone(); const subs = next[gi].subgroups
    const [m] = subs.splice(src.si, 1); subs.splice(si, 0, m)
    onChange!(next); sDrag.current = null; setSDragging(null); setSOverKey(null)
    flash(`s-${next[gi].groupId}-${m.subId}`)
  }
  function sEnd() { setSDragging(null); setSOverKey(null); sDrag.current = null }

  // ── Specialty ──
  function pStart(e: React.DragEvent, gi: number, si: number, pi: number) {
    e.stopPropagation(); if (!interactive) return; pDrag.current = { gi, si, pi }; setPDragging(`${gi}-${si}-${pi}`)
  }
  function pDragOver(e: React.DragEvent, gi: number, si: number, pi: number) {
    e.preventDefault(); e.stopPropagation()
    const src = pDrag.current; if (!interactive || !src || src.gi !== gi || src.si !== si) return
    const k = `${gi}-${si}-${pi}`; if (pOverKey !== k) setPOverKey(k)
  }
  function pDrop(e: React.DragEvent, gi: number, si: number, pi: number) {
    e.stopPropagation()
    const src = pDrag.current; if (!interactive || !src || src.gi !== gi || src.si !== si || src.pi === pi) return
    const next = clone(); const specs = next[gi].subgroups[si].specialties
    const [m] = specs.splice(src.pi, 1); specs.splice(pi, 0, m)
    onChange!(next); pDrag.current = null; setPDragging(null); setPOverKey(null)
    flash(`p-${m.specId}`)
  }
  function pEnd() { setPDragging(null); setPOverKey(null); pDrag.current = null }

  let gr = 0, sr = 0, pr = 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 10 }}>
      {nested.map((group, gi) => {
        gr++; const gn = gr
        const isDG  = gDragging === gi
        const isOG  = gOverIdx === gi && gDragging !== null && gDragging !== gi
        const isFG  = flashKey === `g-${group.groupId}`

        return (
          <div key={group.groupId} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
            {/* Ana Qrup */}
            <div
              draggable={interactive}
              onDragStart={() => gStart(gi)}
              onDragOver={e => gDragOver(e, gi)}
              onDrop={() => gDrop(gi)}
              onDragEnd={gEnd}
              style={{
                width: 180, flexShrink: 0, display: 'flex', alignItems: 'stretch',
                background: isFG ? '#fffbe6' : isOG ? '#e8eeff' : '#eef1ff',
                border: `2px solid ${isFG ? '#f5a623' : isOG ? `${P.navy}` : `${P.line}`}`,
                borderRadius: 12, overflow: 'hidden',
                cursor: interactive ? 'grab' : 'default',
                opacity: 1,
                boxShadow: isFG ? '0 0 0 3px #f5a62330' : isDG ? `0 8px 18px ${P.navy}80, 0 0 0 2px ${P.navy}` : isOG ? `0 0 0 3px ${P.navy}28` : 'none',
                userSelect: 'none',
                transition: isFG ? 'background 1.8s ease, border-color 1.8s ease' : 'border-color .1s',
              }}
            >
              <div style={{ minWidth: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${P.navy}`, fontSize: 14, fontWeight: 800, color: '#fff' }}>{gn}</div>
              <div style={{ flex: 1, padding: '14px 10px', fontSize: 12, fontWeight: 700, color: `${O(P.navyDk, '#5a4a12')}`, lineHeight: 1.4 }}>{group.groupName}</div>
              {interactive && <div style={{ display: 'flex', alignItems: 'center', padding: '0 8px', color: '#bbc', fontSize: 15 }}>⠿</div>}
            </div>

            {/* Alt qruplar */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, background: '#fff', border: '2px solid #e0e4f5', borderRadius: 12, padding: 8 }}>
              {group.subgroups.map((sub, si) => {
                sr++; const sn = sr
                const sk = `${gi}-${si}`
                const isDS = sDragging === sk
                const isOS = sOverKey === sk && sDragging !== null && sDragging !== sk
                const isFS = flashKey === `s-${group.groupId}-${sub.subId}`

                // Sintetik alt qrup (2 səviyyəli ağac — qoşun növü yığışdırılıb) göstərilmir
                const syntheticSub = String(sub.subId).startsWith('__sub_')

                return (
                  <div key={sub.subId} style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                    {/* Alt Qrup */}
                    {!syntheticSub && (
                    <div
                      draggable={interactive}
                      onDragStart={e => sStart(e, gi, si)}
                      onDragOver={e => sDragOver(e, gi, si)}
                      onDrop={e => sDrop(e, gi, si)}
                      onDragEnd={sEnd}
                      style={{
                        width: 160, flexShrink: 0, display: 'flex', alignItems: 'stretch',
                        background: isFS ? '#fffbe6' : isOS ? '#e8d8ff' : '#f4f0ff',
                        border: `2px solid ${isFS ? '#f5a623' : isOS ? `${P.navyDk}` : `${O(P.tint, '#f3e9cf')}`}`,
                        borderRadius: 8, overflow: 'hidden',
                        cursor: interactive ? 'grab' : 'default',
                        opacity: 1,
                        boxShadow: isFS ? '0 0 0 2px #f5a62330' : isDS ? `0 8px 18px ${P.navyDk}80, 0 0 0 2px ${P.navyDk}` : isOS ? `0 0 0 2px ${P.navyDk}28` : 'none',
                        userSelect: 'none',
                        transition: isFS ? 'background 1.8s ease, border-color 1.8s ease' : 'border-color .1s',
                      }}
                    >
                      <div style={{ minWidth: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${P.navyDk}`, fontSize: 11, fontWeight: 700, color: '#fff' }}>{sn}</div>
                      <div style={{ flex: 1, padding: 9, fontSize: 11, fontWeight: 600, color: `${O(P.navyDk, '#6a4a12')}`, lineHeight: 1.3 }}>{sub.subName}</div>
                      {interactive && <div style={{ display: 'flex', alignItems: 'center', padding: '0 6px', color: '#ccc', fontSize: 13 }}>⠿</div>}
                    </div>
                    )}

                    {/* İxtisaslar */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, background: LAST_BOX_BG, border: `1.5px solid ${LAST_BOX_BD}`, borderRadius: 8, padding: 6 }}>
                      {sub.specialties.map((spec, pi) => {
                        pr++; const pn = pr
                        const pk = `${gi}-${si}-${pi}`
                        const isDP = pDragging === pk
                        const isOP = pOverKey === pk && pDragging !== null && pDragging !== pk
                        const isFP = flashKey === `p-${spec.specId}`

                        return (
                          <div
                            key={spec.specId}
                            draggable={interactive}
                            onDragStart={e => pStart(e, gi, si, pi)}
                            onDragOver={e => pDragOver(e, gi, si, pi)}
                            onDrop={e => pDrop(e, gi, si, pi)}
                            onDragEnd={pEnd}
                            style={{
                              display: 'flex', alignItems: 'stretch',
                              background: isFP ? '#fffbe6' : isOP ? LAST_ITEM_OV : LAST_ITEM_BG,
                              border: `1.5px solid ${isFP ? '#f5a623' : isOP ? LAST_ACCENT : LAST_ITEM_BD}`,
                              borderRadius: 6, overflow: 'hidden',
                              cursor: interactive ? 'grab' : 'default',
                              opacity: 1,
                              boxShadow: isFP ? '0 0 0 2px #f5a62330' : isDP ? `0 8px 18px ${LAST_SHADOW}, 0 0 0 2px ${LAST_ACCENT}` : isOP ? `0 0 0 2px ${LAST_ACCENT}28` : 'none',
                              userSelect: 'none',
                              transition: isFP ? 'background 1.8s ease, border-color 1.8s ease' : 'border-color .1s',
                            }}
                          >
                            <div style={{ minWidth: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: LAST_ACCENT, fontSize: 10, fontWeight: 700, color: '#fff' }}>{pn}</div>
                            <div style={{ flex: 1, padding: '7px 8px', fontSize: 11, fontWeight: 500, color: LAST_ITEM_FG, lineHeight: 1.3 }}>{spec.specName}</div>
                            {interactive && <div style={{ display: 'flex', alignItems: 'center', padding: '0 5px', color: '#ddd', fontSize: 11 }}>⠿</div>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
