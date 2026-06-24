import { useState, useMemo } from 'react'
import { userDb, submissionDb, selectionDb, treeDb, institutionDb, useLocalState, addLog } from '../../db'
import InstIcon from '../../components/InstIcon'
import { AppDialog, useDialog } from '../../components/AppDialog'
import { can } from '../../permissions'

// ── Tiebreaker köməkçiləri (Yerləşdirmə ilə eyni məntiq) ──────────────────────
const UMUMI_KEY = 'Ümumi imtahan nəticəsi'
function getLeavesWithPath(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeavesWithPath(n.children, [...anc, n]))
  }
  return res
}
function genderAllowed(leaf: any, gender: any): boolean {
  if (!leaf) return true
  if (gender === 'qadın' && leaf.allowFemale === false) return false
  if (gender === 'kişi'  && leaf.allowMale   === false) return false
  return true
}
function genderCapReached(leaf: any, gender: any, femCount: number, malCount: number): boolean {
  if (!leaf) return false
  if (gender === 'qadın' && leaf.maxFemale != null && femCount >= leaf.maxFemale) return true
  if (gender === 'kişi'  && leaf.maxMale   != null && malCount >= leaf.maxMale)   return true
  return false
}
function getTiebreakerSubjects(specId: string, userGroup: string | null, pathMap: Record<string, any[]>): string[] {
  const path = pathMap[specId] || []
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i]
    if (node.groupTiebreakers && userGroup && node.groupTiebreakers[String(userGroup)]) return node.groupTiebreakers[String(userGroup)]
    if (node.tiebreaker?.length) return node.tiebreaker
  }
  return []
}
function sortScore(u: any, tb: string[]): number[] {
  return [u.score || 0, ...tb.map(s => s === UMUMI_KEY ? (u.score || 0) : (u.subjects?.[s] ?? -1))]
}
function compareStudents(a: any, b: any, tb: string[]): number {
  const sa = sortScore(a, tb), sb = sortScore(b, tb)
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const d = (sb[i] ?? -1) - (sa[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

// ── Balı qoruyan max-flow yenidən-tarazlama (qismən bölgü üçün) ──
// Greedy nəticəsi (res) başlanğıc axın kimi saxlanılır; boş yer + yerləşməyən
// qaldıqda cins-qapılı max-flow ilə kvotanı aşmadan maksimum yerləşmə tapılır.
function maxflowRebalancePartial(opts: {
  pool: any[]; subs: any[]; quotas: Record<string, number>;
  leafById: Record<string, any>;
  res: Record<string, { specId: string; choiceNum: number }>;
}) {
  const { pool, subs, quotas, leafById, res } = opts
  const specs = Object.keys(quotas)
  const placed: Record<string, number> = {}
  for (const uid in res) { const s = res[uid].specId; if (quotas[s] !== undefined) placed[s] = (placed[s] || 0) + 1 }
  const hasEmpty = specs.some(s => (quotas[s] || 0) - (placed[s] || 0) > 0)
  const hasUnplaced = pool.some(u => !res[u.id])
  if (!hasEmpty || !hasUnplaced) return
  const rankingOf = (uid: string): string[] => subs.find((s: any) => s.userId === uid)?.ranking || []

  let n = 2; const S = 0, T = 1
  const uN: Record<string, number> = {}, fg: Record<string, number> = {}, mg: Record<string, number> = {}, sp: Record<string, number> = {}
  for (const u of pool) uN[u.id] = n++
  for (const s of specs) { fg[s] = n++; mg[s] = n++; sp[s] = n++ }
  const cap: Array<Record<number, number>> = Array.from({ length: n }, () => ({}))
  const adj: number[][] = Array.from({ length: n }, () => [])
  const add = (a: number, b: number, c: number) => {
    if (cap[a][b] === undefined) { adj[a].push(b); cap[a][b] = 0 }
    if (cap[b][a] === undefined) { adj[b].push(a); cap[b][a] = 0 }
    cap[a][b] += c
  }
  for (const u of pool) add(S, uN[u.id], 1)
  for (const s of specs) {
    const l = leafById[s], q = quotas[s] || 0
    const maxF = (l?.allowFemale === false) ? 0 : (l?.maxFemale != null ? Math.min(l.maxFemale, q) : q)
    const maxM = (l?.allowMale === false) ? 0 : (l?.maxMale != null ? Math.min(l.maxMale, q) : q)
    add(fg[s], sp[s], maxF); add(mg[s], sp[s], maxM); add(sp[s], T, q)
  }
  const gate = (g: any, s: string) => g === 'qadın' ? fg[s] : g === 'kişi' ? mg[s] : sp[s]
  for (const u of pool) for (const s of rankingOf(u.id)) { if (quotas[s] === undefined) continue; add(uN[u.id], gate(u.gender, s), 1) }
  const push = (a: number, b: number) => { cap[a][b] -= 1; cap[b][a] += 1 }
  for (const u of pool) {
    const a = res[u.id]; if (!a) continue
    const s = a.specId; if (quotas[s] === undefined) continue
    const gt = gate(u.gender, s); push(S, uN[u.id]); push(uN[u.id], gt); push(gt, sp[s]); push(sp[s], T)
  }
  const bfs = (): number[] | null => {
    const par = new Array(n).fill(-1); par[S] = S; const q = [S]
    while (q.length) { const v = q.shift()!; for (const w of adj[v]) if (par[w] < 0 && cap[v][w] > 0) { par[w] = v; if (w === T) return par; q.push(w) } }
    return null
  }
  let par: number[] | null
  while ((par = bfs())) { for (let v = T; v !== S; v = par[v]) { cap[par[v]][v] -= 1; cap[v][par[v]] += 1 } }
  for (const k in res) delete res[k]
  for (const u of pool) {
    const g = u.gender
    for (const s of rankingOf(u.id)) {
      if (quotas[s] === undefined) continue
      const gt = gate(g, s)
      if (cap[gt][uN[u.id]] > 0) { const i = rankingOf(u.id).indexOf(s); res[u.id] = { specId: s, choiceNum: i >= 0 ? i + 1 : 0 }; break }
    }
  }
}

export default function Redistribute() {
  const [users, refreshUsers] = useLocalState(userDb.getAll)
  const institutions = institutionDb.getAll() as any[]
  const allSels = selectionDb.getAll().filter((s: any) => s.status !== 'draft') as any[]
  const { dialog, showConfirm, showInfo, closeDialog } = useDialog()

  const [instId, setInstId]   = useState<string>(institutions[0]?.id || '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<Record<string, { specId: string; choiceNum: number }> | null>(null)
  const [busy, setBusy] = useState(false)

  const allUsers = users as any[]
  // Bu müəssisə üzrə yerləşmə olan seçim
  const instSels = allSels.filter((s: any) => s.institution === instId)
  const sel = instSels.find((s: any) => allUsers.some((u: any) => u.placedSelectionId === s.id && u.placedSpecialty)) || instSels[0] || null
  const tree = sel ? treeDb.get(sel.treeId) : null
  const subs = sel ? (submissionDb.getBySelection(sel.id) as any[]) : []

  const { leafStats, pathMap, placedById } = useMemo(() => {
    const leaves = tree ? getLeavesWithPath(tree.nodes || []) : []
    const pm: Record<string, any[]> = {}
    leaves.forEach(({ leaf, path }) => { pm[leaf.id] = path })
    const placedUsers = allUsers.filter((u: any) => sel && u.placedSelectionId === sel.id && u.placedSpecialty)
    const pbi: Record<string, any[]> = {}
    for (const u of placedUsers) {
      const sid = u.placedSpecialtyId
      if (sid) (pbi[sid] = pbi[sid] || []).push(u)
    }
    const stats = leaves.map(({ leaf, path }) => ({
      id: leaf.id, name: leaf.name,
      pathStr: path.slice(0, -1).map((n: any) => n.name).join(' › '),
      fullPath: path.map((n: any) => n.name).join(' → '),
      quota: leaf.quota || 0,
      placedCount: (pbi[leaf.id] || []).length,
    })).filter(s => s.quota > 0 || s.placedCount > 0)
    return { leafStats: stats, pathMap: pm, placedById: pbi }
  }, [sel?.id, JSON.stringify(tree?.nodes || []), allUsers.length])

  // Hovuz (seçilmiş ixtisaslardakı təhsil alanlar) + balans
  const pool        = leafStats.filter(s => selected.has(s.id)).flatMap(s => placedById[s.id] || [])
  const selQuotaSum = leafStats.filter(s => selected.has(s.id)).reduce((a, s) => a + s.quota, 0)
  const balanced    = selected.size > 0 && selQuotaSum === pool.length
  const nameById    = (id: string) => leafStats.find(s => s.id === id)?.name || '—'

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    setPreview(null)
  }
  function changeInst(id: string) { setInstId(id); setSelected(new Set()); setPreview(null) }

  function computePartial(): Record<string, { specId: string; choiceNum: number }> {
    const avail: Record<string, number> = {}
    leafStats.filter(s => selected.has(s.id)).forEach(s => { avail[s.id] = s.quota })
    const sorted = [...pool].sort((a, b) => {
      const aSid = subs.find(s => s.userId === a.id)?.ranking?.find((sid: string) => avail[sid] !== undefined) || ''
      const bSid = subs.find(s => s.userId === b.id)?.ranking?.find((sid: string) => avail[sid] !== undefined) || ''
      const aTb = getTiebreakerSubjects(aSid, a.group, pathMap)
      const bTb = getTiebreakerSubjects(bSid, b.group, pathMap)
      return compareStudents(a, b, aTb.length >= bTb.length ? aTb : bTb)
    })
    const res: Record<string, { specId: string; choiceNum: number }> = {}
    const femP: Record<string, number> = {}
    const malP: Record<string, number> = {}
    const leafOf = (sid: string) => { const p = pathMap[sid]; return p ? p[p.length - 1] : null }
    for (const u of sorted) {
      const ranking = subs.find(s => s.userId === u.id)?.ranking || []
      for (let ci = 0; ci < ranking.length; ci++) {
        const sid = ranking[ci]
        if (avail[sid] === undefined) continue
        if (avail[sid] > 0) {
          const leaf = leafOf(sid)
          const g = (u as any).gender
          if (!genderAllowed(leaf, g)) continue
          if (genderCapReached(leaf, g, femP[sid] || 0, malP[sid] || 0)) continue
          avail[sid]--
          if (g === 'qadın') femP[sid] = (femP[sid] || 0) + 1
          else if (g === 'kişi') malP[sid] = (malP[sid] || 0) + 1
          res[u.id] = { specId: sid, choiceNum: ci + 1 }
          break
        }
      }
    }
    // Balı qoruyan max-flow tarazlama: boş yer + yerləşməyən eyni anda qalmasın
    const quotas: Record<string, number> = {}
    const leafById: Record<string, any> = {}
    leafStats.filter(s => selected.has(s.id)).forEach(s => {
      quotas[s.id] = s.quota
      const p = pathMap[s.id]; leafById[s.id] = p ? p[p.length - 1] : null
    })
    maxflowRebalancePartial({ pool, subs, quotas, leafById, res })
    return res
  }

  function handlePreview() {
    if (!balanced) return
    setPreview(computePartial())
  }

  function handleApply() {
    if (!preview || !sel) return
    showConfirm({
      icon: '⚖️', iconBg: '#fbf1d6', iconColor: '#c9962a',
      title: 'Qismən yerləşdirməni tətbiq et',
      message: `${pool.length} təhsil alanın yerləşməsi yenidən hesablanıb bazaya yazılacaq. Əvvəlki vəziyyət snapshot kimi saxlanılacaq (geri alına bilər).`,
      confirmLabel: 'Tətbiq et', confirmColor: '#c9962a',
      onConfirm: () => {
        setBusy(true)
        // Snapshot — köhnə yerləşmə + köhnə kvotalar (= seçilmiş ixtisasların köhnə yerləşən sayı)
        try {
          const snaps = JSON.parse(localStorage.getItem('dist_snapshots') || '[]')
          const userStates = pool.map((u: any) => ({ id: u.id, placedSpecialty: u.placedSpecialty, choiceNum: u.choiceNum, placedSpecialtyId: u.placedSpecialtyId, placedSelectionId: u.placedSelectionId }))
          const oldQuotas: Record<string, number> = {}
          leafStats.filter(s => selected.has(s.id)).forEach(s => { oldQuotas[s.id] = s.placedCount })
          const snap = { id: Date.now().toString(), ts: new Date().toISOString(), selName: `${sel.name} (qismən)`, algorithm: 'partial', method: 'partial', placedCount: pool.length, userStates, treeId: tree?.id, quotas: oldQuotas }
          localStorage.setItem('dist_snapshots', JSON.stringify([snap, ...snaps].slice(0, 8)))
        } catch {}
        // Yaz: əvvəlcə hovuzdakı köhnə yerləşməni təmizlə, sonra yenisini yaz
        pool.forEach((u: any) => {
          if (!preview[u.id]) {
            userDb.update(u.id, { placedSpecialty: null, choiceNum: null, placedSpecialtyId: null, placedSelectionId: null })
          }
        })
        Object.entries(preview).forEach(([uid, a]) => {
          const path = pathMap[a.specId] || []
          userDb.update(uid, {
            placedSpecialty:   path.map((n: any) => n.name).join(' → '),
            choiceNum:         a.choiceNum,
            placedSpecialtyId: a.specId,
            placedSelectionId: sel.id,
          })
        })
        const changed = pool.filter((u: any) => preview[u.id]?.specId !== u.placedSpecialtyId).length
        addLog('distribution', 'success', `Qismən yenidən yerləşdirmə: ${pool.length} təhsil alan`,
          `Seçilmiş ixtisas: ${selected.size} · Yerini dəyişən: ${changed} · Seçim: ${sel.name}`)
        refreshUsers(); setPreview(null); setSelected(new Set()); setBusy(false)
        showInfo({ icon: '✅', iconBg: '#f0fff4', iconColor: '#52c41a', title: 'Tətbiq edildi', message: `${pool.length} təhsil alan yenidən bölündü (${changed} təhsil alan yerini dəyişdi).`, confirmLabel: 'Bağla' })
      },
    })
  }

  if (!can('dist.partial')) {
    return <div style={{ background: '#fff', border: '1.5px dashed #ffccc7', borderRadius: 16, padding: '48px', textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>🔒</div>
      <div style={{ fontWeight: 800, color: '#cf1322' }}>Bu əməliyyat üçün icazəniz yoxdur</div>
    </div>
  }

  const hasPlacement = leafStats.some(s => s.placedCount > 0)

  return (
    <>
      {dialog && <AppDialog cfg={dialog} onClose={closeDialog} />}

      {/* Müəssisə seçimi */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {institutions.map((inst: any) => (
          <button key={inst.id} onClick={() => changeInst(inst.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13,
              border: `1.5px solid ${instId === inst.id ? '#c9962a' : '#e0e4f0'}`, background: instId === inst.id ? '#c9962a' : '#fff', color: instId === inst.id ? '#fff' : '#777' }}>
            <InstIcon icon={inst.icon} size={14} /> {inst.label}
          </button>
        ))}
      </div>

      {!sel || !hasPlacement ? (
        <div style={{ background: '#fafbff', border: '1.5px dashed #d8dcf0', borderRadius: 16, padding: '48px 32px', textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12, opacity: .5 }}>📭</div>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 6 }}>Bazada yerləşdirmə yoxdur</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Əvvəlcə Yerləşdirmə bölməsində yerləşdirməni bazaya yazın.</div>
        </div>
      ) : (
        <>
          {/* İzah */}
          <div style={{ background: '#fbf1d6', border: '1.5px solid #ecd9a0', borderRadius: 12, padding: '12px 16px', marginBottom: 16, fontSize: 12.5, color: '#3a4cad', lineHeight: 1.6 }}>
            ℹ️ Kvota dəyişdiyi ixtisasları seçin. <b>Yalnız seçilmiş ixtisaslardakı təhsil alanlar</b> yenidən bölünür (digərlərinə toxunulmur).
            Seçilmiş ixtisasların <b>yeni kvota cəmi = bu ixtisaslardakı təhsil alan sayı</b> olmalıdır.
          </div>

          {/* İxtisas seçimi */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><div><div className="card-title">İxtisasları seç</div><div className="card-sub">Kvota ≠ yerləşən olan ixtisaslar vurğulanır</div></div></div>
            <div className="card-body" style={{ padding: 0 }}>
              <div style={{ overflowX: 'auto' }}>
                <div style={{ display: 'grid', minWidth: 560, gridTemplateColumns: '40px 1fr 110px 90px 90px', gap: 8, padding: '9px 18px', background: '#f8f9fd', borderBottom: '2px solid #eef0f8', fontSize: 10, fontWeight: 700, color: '#9090a8', letterSpacing: .5 }}>
                  <span></span><span>İXTİSAS</span><span style={{ textAlign: 'center' }}>YERLƏŞƏN</span><span style={{ textAlign: 'center' }}>YENİ KVOTA</span><span style={{ textAlign: 'center' }}>FƏRQ</span>
                </div>
                {leafStats.map((s, i) => {
                  const diff = s.quota - s.placedCount
                  const isSel = selected.has(s.id)
                  return (
                    <label key={s.id} style={{ display: 'grid', minWidth: 560, gridTemplateColumns: '40px 1fr 110px 90px 90px', gap: 8, padding: '10px 18px', alignItems: 'center', cursor: 'pointer',
                      borderBottom: i < leafStats.length - 1 ? '1px solid #f4f5fb' : 'none', background: isSel ? '#fbf1d6' : diff !== 0 ? '#fffbe6' : i % 2 === 0 ? '#fff' : '#fafbff' }}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} style={{ accentColor: '#c9962a', width: 16, height: 16 }} />
                      <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{s.name}</div>{s.pathStr && <div style={{ fontSize: 10, color: '#aaa' }}>{s.pathStr}</div>}</div>
                      <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, color: '#555' }}>{s.placedCount}</span>
                      <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, color: '#c9962a' }}>{s.quota}</span>
                      <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, color: diff > 0 ? '#10b981' : diff < 0 ? '#ef4444' : '#bbb' }}>{diff > 0 ? `+${diff}` : diff}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Balans + əməliyyat */}
          {selected.size > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
              background: balanced ? '#f0fff4' : '#fff1f0', border: `1.5px solid ${balanced ? '#b7eb8f' : '#ffccc7'}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: balanced ? '#237804' : '#cf1322' }}>
                {balanced
                  ? `✅ Balans düzdür: ${selected.size} ixtisas · ${pool.length} təhsil alan = ${selQuotaSum} yeni kvota`
                  : `⚠️ Balans pozulub: ${pool.length} təhsil alan ≠ ${selQuotaSum} yeni kvota — fərq ${Math.abs(pool.length - selQuotaSum)}`}
              </div>
              <button onClick={handlePreview} disabled={!balanced}
                style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: balanced ? 'pointer' : 'not-allowed',
                  background: balanced ? 'linear-gradient(135deg,#c9962a,#b8860b)' : '#e4e7ee', color: balanced ? '#fff' : '#aab', fontWeight: 800, fontSize: 13 }}>
                Önbaxış →
              </button>
            </div>
          )}

          {/* Önbaxış nəticəsi */}
          {preview && (
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">Önbaxış — nəticə</div>
                  <div className="card-sub">{pool.filter((u: any) => preview[u.id]?.specId !== u.placedSpecialtyId).length} təhsil alan yerini dəyişir · {pool.length} cəmi</div>
                </div>
                <button onClick={handleApply} disabled={busy}
                  style={{ padding: '9px 22px', borderRadius: 10, border: 'none', cursor: 'pointer', background: '#1d6f42', color: '#fff', fontWeight: 800, fontSize: 13 }}>
                  ✓ Bazaya yaz
                </button>
              </div>
              <div className="card-body" style={{ padding: 0, maxHeight: 460, overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr 1fr 70px', gap: 8, padding: '9px 18px', background: '#f8f9fd', borderBottom: '2px solid #eef0f8', fontSize: 10, fontWeight: 700, color: '#9090a8', letterSpacing: .5, position: 'sticky', top: 0 }}>
                  <span>TƏHSİL ALAN</span><span style={{ textAlign: 'center' }}>BAL</span><span>ƏVVƏL</span><span>İNDİ</span><span style={{ textAlign: 'center' }}>SEÇİM №</span>
                </div>
                {[...pool].sort((a: any, b: any) => (b.score || 0) - (a.score || 0)).map((u: any, i: number) => {
                  const nw = preview[u.id]
                  const changed = nw?.specId !== u.placedSpecialtyId
                  return (
                    <div key={u.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 1fr 1fr 70px', gap: 8, padding: '9px 18px', alignItems: 'center', borderBottom: '1px solid #f4f5fb', background: changed ? '#fffbe6' : i % 2 === 0 ? '#fff' : '#fafbff' }}>
                      <div><div style={{ fontWeight: 700, fontSize: 12.5 }}>{u.name}</div><div style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>{u.fin}</div></div>
                      <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#c9962a' }}>{(u.score || 0).toFixed(1)}</span>
                      <span style={{ fontSize: 11.5, color: '#999' }}>{nameById(u.placedSpecialtyId)}</span>
                      <span style={{ fontSize: 11.5, fontWeight: changed ? 800 : 400, color: changed ? '#237804' : '#555' }}>{changed ? '→ ' : ''}{nw ? nameById(nw.specId) : '—'}</span>
                      <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 12, color: '#b8860b' }}>{nw?.choiceNum ?? '—'}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
