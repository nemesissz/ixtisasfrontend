import { useState, useMemo } from 'react'
import { institutionDb, userDb, treeDb, selectionDb, submissionDb } from '../../db'
import InstIcon from '../../components/InstIcon'
import InstTabs from '../../components/InstTabs'

// ── Köməkçilər ────────────────────────────────────────────────────────────────
function getLeaves(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes || []) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeaves(n.children, [...anc, n]))
  }
  return res
}
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

// ── SVG halqa (donut) ─────────────────────────────────────────────────────────
function Donut({ segments, size = 150, stroke = 20, center }: {
  segments: { value: number; color: string; label: string }[]; size?: number; stroke?: number; center?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const circ = 2 * Math.PI * r
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#eef0f7" strokeWidth={stroke} />
        {segments.map((s, i) => {
          const len = (s.value / total) * circ
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset}
              style={{ transition: 'stroke-dasharray .6s' }} />
          )
          offset += len
          return el
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {center}
      </div>
    </div>
  )
}

// ── Üfüqi sütun ─────────────────────────────────────────────────────────────
function Bars({ data, max }: { data: { label: string; value: number; color: string; sub?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 120, fontSize: 12, color: 'var(--text)', fontWeight: 600, textAlign: 'right', flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
          <div style={{ flex: 1, background: '#f0f2f8', borderRadius: 6, height: 22, position: 'relative', overflow: 'hidden' }}>
            <div style={{ width: `${pct(d.value, m)}%`, background: d.color, height: '100%', borderRadius: 6, minWidth: d.value > 0 ? 3 : 0, transition: 'width .5s' }} />
          </div>
          <div style={{ width: 64, fontSize: 12, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>{d.value}{d.sub ? <span style={{ color: 'var(--muted)', fontWeight: 500 }}> {d.sub}</span> : ''}</div>
        </div>
      ))}
    </div>
  )
}

function Card({ title, icon, children, span }: { title: string; icon?: string; children: React.ReactNode; span?: number }) {
  return (
    <div style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 16, padding: '18px 20px', gridColumn: span ? `span ${span}` : undefined, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon && <span>{icon}</span>}{title}
      </div>
      {children}
    </div>
  )
}


export default function Dashboard() {
  const insts = institutionDb.getAll() as any[]
  const allUsers = userDb.getAll() as any[]
  const allTrees = treeDb.getAll() as any[]
  const allSels = selectionDb.getAll() as any[]
  const [instId, setInstId] = useState<string>(insts[0]?.id || '')
  const [sortBy, setSortBy] = useState<'comp' | 'fill' | 'avg' | 'quota'>('quota')
  const [showAllChoices, setShowAllChoices] = useState(false)

  // ── Qlobal göstəricilər (bütün müəssisələr) ──
  // ── Seçilmiş müəssisə analitikası ──
  const A = useMemo(() => {
    const instUsers = allUsers.filter(u => u.institution === instId)
    const sel = allSels.find(s => s.institution === instId && s.status === 'published')
            || allSels.find(s => s.institution === instId)
    const tree = (sel && allTrees.find(t => t.id === sel.treeId)) || allTrees.find(t => t.institution === instId)
    const leaves = tree ? getLeaves(tree.nodes || []) : []
    const subs = sel ? (submissionDb.getBySelection(sel.id) as any[]) : []
    const firstChoice: Record<string, number> = {}
    for (const s of subs) { const f = s.ranking?.[0]; if (f) firstChoice[f] = (firstChoice[f] || 0) + 1 }

    const placedUsers = instUsers.filter(u => u.placedSpecialtyId)
    const submittedCount = instUsers.filter(u => u.status === 'submitted').length
    const pendingCount = instUsers.length - submittedCount
    const unplacedSubmitted = submittedCount - placedUsers.length

    // leaf üzrə statistika
    const byLeaf = leaves.map(({ leaf, path }) => {
      const us = placedUsers.filter(u => u.placedSpecialtyId === leaf.id)
      const scores = us.map(u => u.score || 0)
      return {
        id: leaf.id, name: leaf.name, path: path.slice(0, -1).map((n: any) => n.name).join(' › '),
        quota: leaf.quota || 0, placed: us.length,
        avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        min: scores.length ? Math.min(...scores) : 0,
        max: scores.length ? Math.max(...scores) : 0,
        demand: firstChoice[leaf.id] || 0,
      }
    })

    // seçim məmnuniyyəti (neçənci seçiminə düşdü)
    const choiceDist: Record<number, number> = {}
    for (const u of placedUsers) { const c = u.choiceNum || 0; if (c > 0) choiceDist[c] = (choiceDist[c] || 0) + 1 }

    // bal paylanması — dinamik: ən aşağı baldan ən yüksəyə qədər bərabər hissələrə bölünür
    const allScores = instUsers.map(u => u.score || 0)
    const sMin = allScores.length ? Math.min(...allScores) : 0
    const sMax = allScores.length ? Math.max(...allScores) : 0
    const N_BINS = 5
    const bLo = Math.floor(sMin), bHi = Math.ceil(sMax)
    const bStep = Math.max(1, Math.ceil((bHi - bLo) / N_BINS))
    const scoreBuckets: number[][] = []
    for (let lo = bLo; lo < bHi || scoreBuckets.length === 0; lo += bStep) scoreBuckets.push([lo, lo + bStep])
    const hist = scoreBuckets.map(([lo, hi], idx) => instUsers.filter(u => {
      const s = u.score || 0
      return s >= lo && (idx === scoreBuckets.length - 1 ? s <= hi : s < hi)
    }).length)

    // demoqrafiya
    const fem = instUsers.filter(u => u.gender === 'qadın').length
    const mal = instUsers.filter(u => u.gender === 'kişi').length
    const hasGender = fem + mal > 0
    const mulki = instUsers.filter(u => u.source === 'mülki').length
    const lisey = instUsers.filter(u => u.source === 'lisey').length
    const hasSource = mulki + lisey > 0

    const totalQuota = byLeaf.reduce((s, l) => s + l.quota, 0)
    const avgScore = instUsers.length ? instUsers.reduce((s, u) => s + (u.score || 0), 0) / instUsers.length : 0

    // bal statistikası (min / max)
    const scores = instUsers.map(u => u.score || 0).filter(s => s > 0).sort((a, b) => a - b)
    const n = scores.length
    const minScore = n ? scores[0] : 0
    const maxScore = n ? scores[n - 1] : 0

    // səviyyə adlarına görə struktur sayları (qoşun növü, mülki ixtisası, …)
    const levelNames: string[] = tree?.levelNames || []
    const levelCounts: number[] = levelNames.map(() => 0)
    const walkLevels = (nodes: any[], depth: number) => {
      for (const nd of nodes || []) {
        if (depth < levelCounts.length) levelCounts[depth]++
        if (nd.children?.length) walkLevels(nd.children, depth + 1)
      }
    }
    walkLevels(tree?.nodes || [], 0)
    const levelStats = levelNames.map((name, i) => ({ name, count: levelCounts[i] || 0 })).filter(l => l.count > 0)

    // qoşun növü (1-ci səviyyə) üzrə bölgü
    const branchStats = (tree?.nodes || []).map((top: any) => {
      const lv = getLeaves([top])
      const ids = new Set(lv.map(x => x.leaf.id))
      return {
        name: top.name,
        specs: lv.length,
        quota: lv.reduce((s, x) => s + (x.leaf.quota || 0), 0),
        placed: placedUsers.filter(u => ids.has(u.placedSpecialtyId)).length,
        demand: lv.reduce((s, x) => s + (firstChoice[x.leaf.id] || 0), 0),
      }
    }).filter((b: any) => b.quota > 0 || b.specs > 0)

    // fənn üzrə orta ballar
    const subjKeys = [...new Set(instUsers.flatMap(u => Object.keys(u.subjects || {}).filter(k => u.subjects[k] != null)))]
    const subjectAvg = subjKeys.map(k => {
      const vals = instUsers.map(u => u.subjects?.[k]).filter((v: any) => v != null) as number[]
      return { name: k, avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, count: vals.length }
    }).sort((a, b) => b.avg - a.avg)

    // rəqabət reytinqi
    const ranked = byLeaf.filter(l => l.quota > 0).map(l => ({ ...l, comp: l.demand / l.quota }))
    // Bütün ixtisaslar iki yarıya bölünür: rəqabətli yarı + az tələb olunan yarı (dinamik)
    const byComp = [...ranked].sort((a, b) => b.comp - a.comp)
    const half = Math.ceil(byComp.length / 2)
    const mostCompetitive = byComp.slice(0, half)
    const leastDemanded = byComp.slice(half).reverse()

    return {
      sel, tree, instUsers, leaves, byLeaf, choiceDist, hist, scoreBuckets, totalQuota, avgScore,
      placed: placedUsers.length, submittedCount, pendingCount, unplacedSubmitted,
      fem, mal, hasGender, mulki, lisey, hasSource,
      minScore, maxScore, branchStats, subjectAvg, mostCompetitive, leastDemanded, levelStats,
      satisfaction: pct(choiceDist[1] || 0, placedUsers.length),
    }
  }, [instId, allUsers, allTrees, allSels])

  const sortedLeaves = useMemo(() => {
    const arr = [...A.byLeaf]
    if (sortBy === 'comp') arr.sort((a, b) => (b.demand / (b.quota || 1)) - (a.demand / (a.quota || 1)))
    else if (sortBy === 'fill') arr.sort((a, b) => pct(b.placed, b.quota) - pct(a.placed, a.quota))
    else if (sortBy === 'avg') arr.sort((a, b) => b.avg - a.avg)
    else arr.sort((a, b) => b.quota - a.quota)
    return arr
  }, [A.byLeaf, sortBy])

  const activeInst = insts.find(i => i.id === instId)

  const LEVEL_ICONS = ['⚔️', '🎖️', '🎓', '📘', '📗']
  const INST_KPIS = [
    { label: 'Təhsilalan', value: A.instUsers.length, icon: '👥', accent: '#722ed1' },
    ...A.levelStats.map((l: any, i: number) => ({ label: l.name, value: l.count, icon: LEVEL_ICONS[i] || '🎓', accent: '#13c2c2' })),
    { label: 'Ümumi kvota', value: A.totalQuota, icon: '🎯', accent: '#fa8c16' },
    { label: 'Yerləşmə', value: `${pct(A.placed, A.instUsers.length)}%`, icon: '✅', accent: '#52c41a', sub: `${A.placed}/${A.instUsers.length}` },
    { label: 'Seçim etdi', value: `${pct(A.submittedCount, A.instUsers.length)}%`, icon: '🗳️', accent: '#eb2f96', sub: `${A.submittedCount}/${A.instUsers.length}` },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Müəssisə seçicisi */}
      <InstTabs insts={insts} activeId={instId} onSelect={setInstId} />

      {!activeInst ? (
        <Card title="Məlumat yoxdur">
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Müəssisə seçin və ya əlavə edin.</div>
        </Card>
      ) : (
        <>
          {/* Müəssisənin fərdi KPI-ları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            {INST_KPIS.map(k => (
              <div key={k.label} style={{ background: '#fff', border: '1.5px solid var(--border)', borderRadius: 14, padding: '15px 16px', display: 'flex', alignItems: 'center', gap: 13 }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${k.accent}14`, color: k.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>{k.icon}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 21, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{k.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{k.label}{k.sub ? ` · ${k.sub}` : ''}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Sıra 1: status donut + bal paylanması */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title={`Yerləşmə statusu — ${activeInst.label}`} icon="🎯">
              <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
                <Donut size={150} segments={[
                  { value: A.placed, color: '#52c41a', label: 'Yerləşdi' },
                  { value: A.unplacedSubmitted, color: '#faad14', label: 'Yerləşmədi' },
                  { value: A.pendingCount, color: '#d9d9d9', label: 'Seçim etmədi' },
                ]} center={<>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text)' }}>{pct(A.placed, A.instUsers.length)}%</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>yerləşdi</div>
                </>} />
                <div style={{ flex: 1, minWidth: 160, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {[
                    { c: '#52c41a', l: 'Yerləşdi', v: A.placed },
                    { c: '#faad14', l: 'Seçim etdi, yerləşdirilmədi', v: A.unplacedSubmitted },
                    { c: '#d9d9d9', l: 'Seçim etmədi', v: A.pendingCount },
                  ].map(x => (
                    <div key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: x.c, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: 'var(--text)' }}>{x.l}</span>
                      <b style={{ color: 'var(--text)' }}>{x.v}</b>
                    </div>
                  ))}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, fontSize: 12, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Kvota doluluğu</span><b style={{ color: '#fa8c16' }}>{pct(A.placed, A.totalQuota)}% ({A.placed}/{A.totalQuota})</b>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                    {[['Ən aşağı', A.minScore, '#ff4d4f'], ['Orta', A.avgScore, '#c9962a'], ['Ən yüksək', A.maxScore, '#52c41a']].map(([l, v, c]: any) => (
                      <div key={l} style={{ flex: 1, textAlign: 'center', background: `${c}10`, borderRadius: 8, padding: '6px 2px' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: c }}>{Number(v).toFixed(1)}</div>
                        <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Bal paylanması" icon="📈">
              <Bars data={A.scoreBuckets.map(([lo, hi], i) => ({
                label: `${lo}–${hi}`, value: A.hist[i], color: '#c9962a',
              }))} />
            </Card>
          </div>

          {/* Sıra 2: seçimlər üzrə qəbul statistikası + demoqrafiya */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title="Seçimlər üzrə qəbul statistikası" icon="📊">
              {Object.keys(A.choiceDist).length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Hələ yerləşdirmə aparılmayıb.</div>
              ) : (
                <>
                  <Bars data={Array.from({ length: Math.max(A.byLeaf.length, 1) }, (_, i) => i + 1)
                    .slice(0, showAllChoices ? undefined : 3)
                    .map(c => ({
                      label: `${c}-ci seçim`, value: A.choiceDist[c] || 0,
                      color: c === 1 ? '#52c41a' : c <= 3 ? '#c9962a' : '#faad14',
                      sub: `(${A.placed > 0 ? ((A.choiceDist[c] || 0) / A.placed * 100).toFixed(2) : '0.00'}%)`,
                    }))} />
                  {A.byLeaf.length > 3 && (
                    <button onClick={() => setShowAllChoices(v => !v)}
                      style={{ marginTop: 10, width: '100%', padding: '8px 12px', borderRadius: 8, border: '1.5px solid var(--border)', background: '#f8f9fd', color: 'var(--blue)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      {showAllChoices ? '▲ Yığ' : `▼ Hamısına bax (${A.byLeaf.length})`}
                    </button>
                  )}
                </>
              )}
            </Card>

            {(A.hasGender || A.hasSource) && (
              <Card title="Demoqrafiya" icon="👥">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {A.hasGender && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Cins</div>
                      <Bars data={[
                        { label: 'Qadın', value: A.fem, color: '#eb2f96', sub: `(${pct(A.fem, A.instUsers.length)}%)` },
                        { label: 'Kişi', value: A.mal, color: '#1677ff', sub: `(${pct(A.mal, A.instUsers.length)}%)` },
                      ]} />
                    </div>
                  )}
                  {A.hasSource && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 8 }}>Mənbə</div>
                      <Bars data={[
                        { label: 'Mülki', value: A.mulki, color: '#c9962a', sub: `(${pct(A.mulki, A.instUsers.length)}%)` },
                        { label: 'Lisey', value: A.lisey, color: '#722ed1', sub: `(${pct(A.lisey, A.instUsers.length)}%)` },
                      ]} />
                    </div>
                  )}
                </div>
              </Card>
            )}
          </div>

          {/* Sıra 2.5: qoşun növü + fənn ortalamaları */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <Card title={`${A.tree?.levelNames?.[0] || 'Qoşun növü'} üzrə bölgü`} icon="⚔️">
              {A.branchStats.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Struktur tapılmadı.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {A.branchStats.map((b: any) => {
                    const fillP = pct(b.placed, b.quota)
                    const comp = b.quota > 0 ? b.demand / b.quota : 0
                    return (
                      <div key={b.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                          <span style={{ fontWeight: 700, color: 'var(--text)' }}>{b.name}</span>
                          <span style={{ color: 'var(--muted)' }}>{b.placed}/{b.quota} · {b.specs} ixtisas · tələb {b.demand} ({comp.toFixed(1)}×)</span>
                        </div>
                        <div style={{ background: '#f0f2f8', borderRadius: 6, height: 10, overflow: 'hidden' }}>
                          <div style={{ width: `${fillP}%`, height: '100%', background: fillP >= 100 ? '#52c41a' : '#c9962a' }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>

            <Card title="Fənn üzrə orta ballar" icon="📚">
              {A.subjectAvg.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Fənn balı datası yoxdur.</div>
              ) : (
                <Bars data={A.subjectAvg.map((s: any) => ({ label: s.name, value: Math.round(s.avg * 10) / 10, color: '#13c2c2' }))} />
              )}
            </Card>
          </div>

          {/* Sıra 3: ixtisas performans cədvəli */}
          <Card title="İxtisas üzrə performans" icon="🎓">
            {A.byLeaf.length === 0 ? (
              <div style={{ color: 'var(--muted)', fontSize: 13, padding: '14px 0' }}>Bu müəssisə üçün ixtisas strukturu tapılmadı.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 720 }}>
                  <thead>
                    <tr style={{ background: '#f8f9fd', color: 'var(--muted)', textAlign: 'left' }}>
                      <th style={{ padding: '9px 12px', fontWeight: 700 }}>İxtisas</th>
                      {([['quota', 'Kvota'], ['fill', 'Yerləşən / Doluluq']] as const).map(([k, lbl]) => (
                        <th key={k} onClick={() => setSortBy(k as any)} style={{ padding: '9px 12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', color: sortBy === k ? '#c9962a' : undefined, textAlign: 'center' }}>
                          {lbl} {sortBy === k ? '▾' : ''}
                        </th>
                      ))}
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Ən aşağı bal</th>
                      <th onClick={() => setSortBy('avg')} style={{ padding: '9px 12px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', color: sortBy === 'avg' ? '#c9962a' : undefined, textAlign: 'center' }}>Orta bal {sortBy === 'avg' ? '▾' : ''}</th>
                      <th style={{ padding: '9px 12px', fontWeight: 700, textAlign: 'center' }}>Ən yüksək bal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLeaves.map((l, i) => {
                      const fillP = pct(l.placed, l.quota)
                      return (
                        <tr key={l.id} style={{ borderTop: '1px solid #f0f2fa', background: i % 2 ? '#fafbff' : '#fff' }}>
                          <td style={{ padding: '9px 12px' }}>
                            <div style={{ fontWeight: 700, color: 'var(--text)' }}>{l.name}</div>
                            {l.path && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.path}</div>}
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700 }}>{l.quota}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <div style={{ flex: 1, background: '#f0f2f8', borderRadius: 5, height: 8, overflow: 'hidden', minWidth: 50 }}>
                                <div style={{ width: `${fillP}%`, height: '100%', background: fillP >= 100 ? '#52c41a' : fillP >= 60 ? '#c9962a' : '#faad14' }} />
                              </div>
                              <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{l.placed}/{l.quota}</span>
                            </div>
                          </td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.min ? '#722ed1' : 'var(--muted)' }}>{l.min ? l.min.toFixed(1) : '—'}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: '#c9962a' }}>{l.avg ? l.avg.toFixed(1) : '—'}</td>
                          <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 700, color: l.max ? '#52c41a' : 'var(--muted)' }}>{l.max ? l.max.toFixed(1) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Sıra 4: rəqabət highlight */}
          {A.byLeaf.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <Card title="Ən rəqabətli ixtisaslar" icon="🔥">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
                  {A.mostCompetitive.map((l: any, i: number) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#fff1f0', color: '#cf1322', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.demand} tələb / {l.quota} yer</span>
                      <b style={{ color: l.comp >= 1.5 ? '#cf1322' : '#d46b08', minWidth: 38, textAlign: 'right' }}>{l.comp.toFixed(1)}×</b>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Ən az tələb olunan ixtisaslar" icon="❄️">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, maxHeight: 340, overflowY: 'auto' }}>
                  {A.leastDemanded.map((l: any, i: number) => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                      <span style={{ width: 22, height: 22, borderRadius: 7, background: '#f0f5ff', color: '#2f54eb', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0 }}>{i + 1}</span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>{l.demand} tələb / {l.quota} yer</span>
                      <b style={{ color: l.comp < 1 ? '#237804' : '#d46b08', minWidth: 38, textAlign: 'right' }}>{l.comp.toFixed(1)}×</b>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  )
}
