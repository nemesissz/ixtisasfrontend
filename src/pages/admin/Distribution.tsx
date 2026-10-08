import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { useActiveInst } from '../../activeInst'
import * as XLSX from 'xlsx'
import { userDb, submissionDb, selectionDb, treeDb, institutionDb, systemSettingsDb, useLocalState, addLog, selectionParticipants } from '../../db'
import InstIcon from '../../components/InstIcon'
import InstTabs from '../../components/InstTabs'
import { can } from '../../permissions'
import { poolCounts, autoSplit, globalSourceSplitCached } from '../../quota-pool'
import { allocatePacketSpecs, splitPacketStudents } from '../../packet-alloc'
import { UMUMI_KEY, isSumCrit } from '../../tiebreak'
import { compareStudents, makeMeritCompare, pairTiebreaker, decidingCriterion, tieTrace, buildDefaultTiebreaker, setDefaultTiebreaker, getLeavesWithPath, genderAllowed, genderCapReached, rebalanceUnplaced, runPacketPlacement, runPlacement } from '../../placement'

// ── Gale-Shapley (Deferred Acceptance) alqoritmi ─────────────────────────────
function runGaleShapley(users: any[], subs: any[], tree: any) {
  const leavesWithPath = getLeavesWithPath(tree?.nodes || [])
  const quotas: Record<string, number> = {}
  const pathMap: Record<string, any[]> = {}
  const leafById: Record<string, any> = {}
  for (const { leaf, path } of leavesWithPath) {
    quotas[leaf.id] = leaf.quota || 0
    pathMap[leaf.id] = path
    leafById[leaf.id] = leaf
  }

  const userOf: Record<string, any> = {}
  const genderOf: Record<string, any> = {}
  for (const u of users) { userOf[u.id] = u; genderOf[u.id] = u.gender }
  // İxtisasın gözündə x y-dən öndədirmi (bal, bərabərdirsə həmin ixtisasın prioriteti)
  const ahead = (x: string, y: string, sid: string) =>
    compareStudents(userOf[x], userOf[y], pairTiebreaker(userOf[x], userOf[y], sid, sid, pathMap)) < 0
  const sortHolders = (h: string[], sid: string) =>
    h.sort((a, b) => compareStudents(userOf[a], userOf[b], pairTiebreaker(userOf[a], userOf[b], sid, sid, pathMap)))

  const userRankings: Record<string, string[]> = {}
  for (const sub of subs) {
    if (users.find((u: any) => u.id === sub.userId)) {
      userRankings[sub.userId] = (sub.ranking || []).filter((sid: string) => quotas[sid] !== undefined)
    }
  }

  const proposalIdx: Record<string, number> = {}
  for (const u of users) proposalIdx[u.id] = 0

  const holders: Record<string, string[]> = {}
  for (const sid of Object.keys(quotas)) holders[sid] = []

  const free = new Set(
    users.filter((u: any) => (userRankings[u.id]?.length || 0) > 0).map((u: any) => u.id)
  )

  const MAX_ITER = (users.length + 1) * (Object.keys(quotas).length + 1)
  let iter = 0

  while (free.size > 0 && iter < MAX_ITER) {
    iter++
    const uid = [...free][0]
    const ranking = userRankings[uid] || []
    const idx = proposalIdx[uid] || 0
    if (idx >= ranking.length) { free.delete(uid); continue }

    const specId = ranking[idx]
    proposalIdx[uid] = idx + 1
    const quota = quotas[specId] || 0
    const h = holders[specId]
    const leaf = leafById[specId]
    const g = genderOf[uid]

    // Cinsə icazə yoxdursa — bu ixtisası ötür (təhsilalan azad qalır, növbəti seçimə keçəcək)
    if (!genderAllowed(leaf, g)) continue

    const gCount = h.filter(x => genderOf[x] === g).length
    const capG = g === 'qadın' ? (leaf?.maxFemale ?? Infinity)
               : g === 'kişi'  ? (leaf?.maxMale   ?? Infinity)
               : Infinity

    if (gCount < capG && h.length < quota) {
      // Yer var və cins limiti dolmayıb → birbaşa qəbul
      h.push(uid)
      sortHolders(h, specId)
      free.delete(uid)
    } else {
      // Sıxışdırma namizədləri: cins limiti dolubsa yalnız eyni cinsdən olanlar
      const pool = gCount >= capG ? h.filter(x => genderOf[x] === g) : h
      if (pool.length) {
        const worstUid = pool.reduce((w, x) => (ahead(w, x, specId) ? x : w), pool[0])
        if (ahead(uid, worstUid, specId)) {
          h.splice(h.indexOf(worstUid), 1)
          h.push(uid)
          sortHolders(h, specId)
          free.delete(uid)
          free.add(worstUid)
        }
      }
    }
  }

  const assignments: Record<string, { specId: string; choiceNum: number }> = {}
  const placed: Record<string, number> = {}
  const femP: Record<string, number> = {}
  const malP: Record<string, number> = {}
  for (const [specId, uids] of Object.entries(holders)) {
    for (const uid of uids) {
      const choiceNum = (userRankings[uid] || []).indexOf(specId) + 1
      assignments[uid] = { specId, choiceNum: choiceNum > 0 ? choiceNum : 1 }
      placed[specId] = (placed[specId] || 0) + 1
      if (genderOf[uid] === 'qadın') femP[specId] = (femP[specId] || 0) + 1
      else if (genderOf[uid] === 'kişi') malP[specId] = (malP[specId] || 0) + 1
    }
  }
  // Boş yer + yerləşməyən eyni anda qalmasın deyə balı qoruyan yenidən-tarazlama
  rebalanceUnplaced({ users, subs, leafById, quotas, pathMap, placed, femP, malP, assignments })
  return { assignments, placed, quotas, pathMap }
}

type Mode   = null | 'sim' | 'distribute'
type Method = null | 'simple' | 'packet'

// ── Simulyasiya sürəti ────────────────────────────────────────────────────────
const SPEED_DELAY: Record<number, number> = { 0: 800, 1: 280, 3: 90, 10: 25 }
const SPEED_NEXT:  Record<number, 0|1|3|10> = { 0: 1, 1: 3, 3: 10, 10: 0 }
const SPEED_LABEL: Record<number, string>   = { 0: '0.5×', 1: '1×', 3: '3×', 10: '10×' }

// Paket rəngləri
const PACK_COLORS = [
  { bg: 'linear-gradient(135deg,#c9962a,#b8860b)', shadow: '#c9962a44', light: '#fbf1d6', text: '#c9962a' },
  { bg: 'linear-gradient(135deg,#52c41a,#237804)', shadow: '#52c41a44', light: '#f0fff4', text: '#237804' },
  { bg: 'linear-gradient(135deg,#f5a623,#d46b08)', shadow: '#f5a62344', light: '#fff8e6', text: '#d46b08' },
  { bg: 'linear-gradient(135deg,#ff4d4f,#cf1322)', shadow: '#ff4d4f44', light: '#fff0f0', text: '#cf1322' },
  { bg: 'linear-gradient(135deg,#722ed1,#531dab)', shadow: '#722ed144', light: '#f9f0ff', text: '#722ed1' },
  { bg: 'linear-gradient(135deg,#13c2c2,#006d75)', shadow: '#13c2c244', light: '#e6fffb', text: '#006d75' },
]

/** Meyar dəyəri: -1 = məlumat yoxdur */
const critFmt = (v: any) => (v == null || Number(v) < 0) ? '—' : Number(v).toFixed(1)
const critNum = (v: any) => (v == null || Number(v) < 0) ? 'yoxdur' : String(+Number(v).toFixed(2))
type TieStep = { label: string; w: number; l: number; decided: boolean }
/** Prioritet müqayisəsinin oxunaqlı izahı: "1) Riyaziyyat: 52 = 52 · 2) ..." */
function tieTraceText(trace: TieStep[] | undefined, winner: string, me = 'bu təhsilalan') {
  if (!trace) return ''
  if (!trace.length) return ' Bu ixtisas üçün prioritet meyarı təyin edilməyib — sıra siyahıdakı ardıcıllıqla müəyyənləşdi.'
  const parts = trace.map((t, i) => t.decided
    ? `${i + 1}) ${t.label}: ${winner} ${critNum(t.w)}, ${me} ${critNum(t.l)} — fərq buradadır`
    : `${i + 1}) ${t.label}: ${critNum(t.w)} = ${critNum(t.l)} (bərabər)`)
  const last = trace[trace.length - 1]
  return ` Prioritet meyarları sıra ilə müqayisə olundu: ${parts.join('; ')}.` + (last.decided
    ? ` ${winner} öndə olduğu üçün yer ona çatdı.`
    : ` Bütün meyarlar eyni çıxdı — sıra siyahıdakı ardıcıllıqla müəyyənləşdi.`)
}

function TieTraceView({ trace, winner }: { trace: TieStep[]; winner: string }) {
  const B = { color: '#5a4a12' }
  if (!trace.length) return <> Bu ixtisas üçün prioritet meyarı təyin edilməyib — sıra siyahıdakı ardıcıllıqla müəyyənləşdi, bu təhsilalan həmin ixtisasa yerləşdirilmədi.</>
  const last = trace[trace.length - 1]
  return (
    <>
      {' '}Prioritet meyarları sıra ilə müqayisə olundu:
      <ol style={{ margin: '6px 0 6px', paddingLeft: 22 }}>
        {trace.map((t, i) => (
          <li key={i}>
            <b style={B}>{t.label}</b>:{' '}
            {t.decided
              ? <><b style={B}>{winner}</b> <b style={{ color: '#237804' }}>{critNum(t.w)}</b>, bu təhsilalan <b style={{ color: '#cf1322' }}>{critNum(t.l)}</b> — <b style={B}>fərq buradadır</b></>
              : <>{critNum(t.w)} = {critNum(t.l)} <span style={{ color: '#a08a4a' }}>(bərabər, növbəti meyara keçildi)</span></>}
          </li>
        ))}
      </ol>
      {last.decided
        ? <><b style={B}>{winner}</b> öndə olduğu üçün bu təhsilalan həmin ixtisasa yerləşdirilmədi.</>
        : <>Bütün meyarlar eyni çıxdı — sıra siyahıdakı ardıcıllıqla müəyyənləşdi, bu təhsilalan həmin ixtisasa yerləşdirilmədi.</>}
    </>
  )
}

// ── İzahlı (hekayə) simulyasiya — Sadə və Paket üsulu üçün ──────────────────────
function StorySim({ students, packets, subs, tree, poolUsers, preAssignLevel, finalAssignments, onClose }: {
  students?: any[]; packets?: any[]; subs: any[]; tree: any
  /** mənbə nisbətinin hesablandığı tam siyahı — runPlacement ilə eyni olmalıdır */
  poolUsers?: any[]
  preAssignLevel?: number | null
  /**
   * "Yerləşdir" düyməsinin işlətdiyi mühərrikin YEKUN nəticəsi.
   * Simulyasiya gedişatı öz addımlarını göstərir, amma son söz bu nəticənindir —
   * əks halda tarazlama mərhələsindəki kiçik fərqlər ucbatından iki ekran
   * fərqli adam üçün "kənarda qaldı" yazırdı.
   */
  finalAssignments?: Record<string, { specId: string; choiceNum: number }>
  onClose: () => void
}) {
  const [idx, setIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1200)
  const [selLeaf, setSelLeaf] = useState<string | null>(null)
  const [focusCol, setFocusCol] = useState<'left' | 'center' | 'right' | null>(null)
  // Ada görə axtarış: seçilən təhsilalanın ixtisası açılır, sətri qısa müddət yanıb-sönür
  const [findQ, setFindQ] = useState('')
  const [findOpen, setFindOpen] = useState(false)
  const [flashId, setFlashId] = useState<string | null>(null)

  const data = useMemo(() => {
    const leaves = getLeavesWithPath(tree?.nodes || [])
    const pathMap: Record<string, any[]> = {}, leafName: Record<string, string> = {}, leafPath: Record<string, string> = {}
    leaves.forEach(({ leaf, path }) => { pathMap[leaf.id] = path; leafName[leaf.id] = leaf.name; leafPath[leaf.id] = path.slice(0, -1).map((n: any) => n.name).join(' › ') })
    // Paketlər: verilmişsə onlar, yoxsa hamısı bir "paket" (sadə üsul)
    const pkts = (packets && packets.length)
      ? packets.map((p: any) => ({ num: p.num, students: p.students || [], specs: (p.specs || []).map((s: any) => ({ id: s.id, quota: s.quota, mülkiQuota: s.mülkiQuota, liseyQuota: s.liseyQuota })) }))
      : [{ num: 1, students: students || [], specs: leaves.map(({ leaf }) => ({ id: leaf.id, quota: leaf.quota || 0 })) }]

    const leafById: Record<string, any> = {}
    leaves.forEach(({ leaf }) => { leafById[leaf.id] = leaf })

    const steps: any[] = []
    const pkMeta: { num: number; specIds: string[]; quota: Record<string, number>; minScore: number; maxScore: number; count: number }[] = []
    const rebalanced: { name: string; score: number; fromSpec: string | null; toSpec: string; packetNum: number }[] = []
    for (const pk of pkts) {
      const quota: Record<string, number> = {}; pk.specs.forEach((s: any) => { quota[s.id] = s.quota })
      const withSub = pk.students.filter((u: any) => (subs.find((s: any) => s.userId === u.id)?.ranking || []).length)
      // Yerləşdirmə mühərriki ilə EYNİ sıra (bal, bərabərdirsə prioritet meyarları)
      const meritCmp = makeMeritCompare(subs, pathMap, sid => quota[sid] !== undefined)
      const sorted = [...withSub].sort(meritCmp)
      const scores = withSub.map((u: any) => u.score || 0)
      pkMeta.push({ num: pk.num, specIds: pk.specs.map((s: any) => s.id), quota, minScore: scores.length ? Math.min(...scores) : 0, maxScore: scores.length ? Math.max(...scores) : 0, count: sorted.length })
      const avail = { ...quota }
      const femP: Record<string, number> = {}, malP: Record<string, number> = {}
      const assignments: Record<string, { specId: string; choiceNum: number }> = {}
      const lastInLeaf: Record<string, { name: string; score: number; user: any }> = {}
      const stepStart = steps.length

      // ── Mənbə nisbəti aktivdirsə real yerləşdirmə kimi 3 mərhələ işləyir:
      //    1) mülki öz payı üzrə · 2) lisey öz payı üzrə · 3) qalan yerlər hamıya.
      //    Simulyasiya bunu etmədiyi üçün "Yerləşdir" ilə fərqli nəticə verirdi.
      const spActive = !!(tree?.sourceProportional)
      const mQ: Record<string, number> = {}, lQ: Record<string, number> = {}
      if (spActive) {
        const base = (poolUsers && poolUsers.length ? poolUsers : (students || pk.students)) as any[]
        const simTable = globalSourceSplitCached(base, tree?.nodes || [], { preAssignLevel })
        const pkSpec: Record<string, any> = {}; pk.specs.forEach((s: any) => { pkSpec[s.id] = s })
        for (const sid of Object.keys(quota)) {
          const leaf = leafById[sid]
          const q = quota[sid]
          // Paket üsulu: paketin öz mənbə payları hazırdır (packet-alloc) — onlar
          // götürülür. Əks halda ixtisasın BÜTÜN mülki/lisey yerləri paketə
          // yazılırdı (məs. paketdə 3 yer, simulyasiyada 9 nəfər yerləşirdi).
          if (pkSpec[sid]?.mülkiQuota != null && pkSpec[sid]?.liseyQuota != null) {
            mQ[sid] = pkSpec[sid].mülkiQuota
            lQ[sid] = pkSpec[sid].liseyQuota
          } else if (leaf?.quotaMode === 'manual' && leaf?.mülkiQuota != null && leaf?.liseyQuota != null) {
            const orig = leaf.quota || 0
            const r = orig > 0 ? q / orig : 0
            mQ[sid] = Math.round(leaf.mülkiQuota * r)
            lQ[sid] = q - mQ[sid]
          } else {
            const sp = autoSplit(leaf, poolCounts(base, pathMap[sid] || [], { preAssignLevel }), simTable)
            mQ[sid] = sp.mülki
            lQ[sid] = sp.lisey
          }
        }
      }
      // 3-cü mərhələnin növbəsi runPlacement-dəki ilə eyni qurulur:
      // [mülki, lisey, mənbəsiz] ardıcıllığı, sonra eyni müqayisə ilə sıralama.
      // Bərabər ballılarda sıra məhz bundan asılıdır — fərqli olsa, kənarda
      // qalanlar simulyasiya ilə real yerləşdirmədə fərqlənirdi.
      const byScore = meritCmp
      const rest = [
        ...withSub.filter((u: any) => u.source === 'mülki'),
        ...withSub.filter((u: any) => u.source === 'lisey'),
        ...withSub.filter((u: any) => !u.source),
      ].sort(byScore)

      const stages: { key: string; pool: any[]; av: Record<string, number> }[] = spActive
        ? [
            { key: 'mülki',  pool: withSub.filter((u: any) => u.source === 'mülki').sort(byScore), av: mQ },
            { key: 'lisey',  pool: withSub.filter((u: any) => u.source === 'lisey').sort(byScore), av: lQ },
            { key: 'qalıq',  pool: rest, av: avail },
          ]
        : [{ key: '', pool: sorted, av: avail }]

      for (const stage of stages) {
        // 3-cü mərhələnin tutumu — əvvəlki iki mərhələdən qalanların cəmi
        if (stage.key === 'qalıq') for (const sid of Object.keys(quota)) avail[sid] = (mQ[sid] || 0) + (lQ[sid] || 0)
        const av = stage.av
      for (const u of stage.pool) {
        if (assignments[u.id]) continue
        const ranking = (subs.find((s: any) => s.userId === u.id)?.ranking || []).filter((id: string) => quota[id] !== undefined)
        const attempts: { id: string; full: boolean; tie?: boolean; rival?: string; blocked?: 'gender' | 'cap' }[] = []
        let placed: string | null = null
        const tieRivals: { id: string; rival: string; score: number; trace?: TieStep[]; subject?: string; rivalSubjScore?: number; mySubjScore?: number }[] = []
        const sc = u.score || 0, g = u.gender
        for (const sid of ranking) {
          const leaf = leafById[sid]
          if (!genderAllowed(leaf, g)) { attempts.push({ id: sid, full: true, blocked: 'gender' }); continue }
          if (av[sid] > 0 && !genderCapReached(leaf, g, femP[sid] || 0, malP[sid] || 0)) {
            av[sid]--; placed = sid
            if (g === 'qadın') femP[sid] = (femP[sid] || 0) + 1; else if (g === 'kişi') malP[sid] = (malP[sid] || 0) + 1
            attempts.push({ id: sid, full: false }); lastInLeaf[sid] = { name: u.name, score: sc, user: u }; break
          } else if (av[sid] > 0) {
            attempts.push({ id: sid, full: true, blocked: 'cap' })
          } else {
            const last = lastInLeaf[sid]
            const tie = !!last && Math.abs((last.score || 0) - sc) < 1e-9
            attempts.push({ id: sid, full: true, tie, rival: tie ? last!.name : undefined })
            if (tie) {
              // Bərabərliyi hansı prioritet meyarı həll etdi — sıralamanın İŞLƏTDİYİ
              // meyarlarla (yoxsa izah faktiki qərardan fərqli fənni göstərirdi)
              const firstIn = (x: any) => (subs.find((s: any) => s.userId === x.id)?.ranking || []).find((id: string) => quota[id] !== undefined) || ''
              const tbs = pairTiebreaker(last!.user, u, firstIn(last!.user), firstIn(u), pathMap)
              let dec: { subject?: string; rivalSubjScore?: number; mySubjScore?: number } = {}
              const trace = tieTrace(last!.user, u, tbs)
              const d = decidingCriterion(last!.user, u, tbs)
              if (d) {
                const lbl = d.crit === UMUMI_KEY ? 'Ümumi bal' : isSumCrit(d.crit) ? 'Σ ' + d.crit : d.crit
                dec = { subject: lbl, rivalSubjScore: d.w, mySubjScore: d.l }
              }
              tieRivals.push({ id: sid, rival: last!.name, score: sc, trace, ...dec })
            }
          }
        }
        if (placed) assignments[u.id] = { specId: placed, choiceNum: ranking.indexOf(placed) + 1 }
        steps.push({ packetNum: pk.num, u, ranking, attempts, placed, choiceNum: placed ? ranking.indexOf(placed) + 1 : 0, tieRivals, stage: stage.key })
      }
      }
      // ── Yenidən-tarazlama (real yerləşdirmə ilə eyni) ──
      const greedyAssign: Record<string, string> = {}
      for (const uid of Object.keys(assignments)) greedyAssign[uid] = assignments[uid].specId
      const placedMap: Record<string, number> = {}
      for (const uid of Object.keys(assignments)) { const s = assignments[uid].specId; placedMap[s] = (placedMap[s] || 0) + 1 }
      // Yekun mənzərə: real yerləşdirmə mühərrikinin nəticəsi varsa o götürülür,
      // yoxdursa (məs. paket önizləməsi) eyni tarazlama burada işlədilir.
      const useReal = !!finalAssignments && Object.keys(finalAssignments).length > 0
      if (useReal) {
        for (const uid of Object.keys(assignments)) delete assignments[uid]
        for (const u of pk.students) {
          const a = finalAssignments![u.id]
          if (a) assignments[u.id] = a
        }
      } else {
        rebalanceUnplaced({ users: pk.students, subs, leafById, quotas: quota, pathMap, placed: placedMap, femP, malP, assignments })
      }
      // Hər addıma yekun (tarazlamadan sonrakı) vəziyyəti yaz
      for (let i = stepStart; i < steps.length; i++) {
        const st = steps[i]; const fin = assignments[st.u.id]
        st.finalSpec = fin ? fin.specId : null
        st.finalChoiceNum = fin ? fin.choiceNum : 0
        st.rebalanced = !!fin && greedyAssign[st.u.id] !== fin.specId
        if (st.rebalanced) rebalanced.push({ name: st.u.name, score: st.u.score || 0, fromSpec: greedyAssign[st.u.id] || null, toSpec: fin.specId, packetNum: pk.num })
      }
    }
    // Mərhələli rejimdə bir təhsilalan iki addımda görünə bilər — say təkrarlanmasın
    const greedyPlaced = new Set(steps.filter(s => s.placed).map(s => s.u.id)).size
    const finalPlaced = new Set(steps.filter(s => s.finalSpec).map(s => s.u.id)).size
    // Mərhələli (proporsional) rejimdə bir təhsilalan iki addımda görünə bilər —
    // ona görə "təhsilalan sayı" addım sayından ayrıca hesablanır.
    const studentCount = new Set(steps.map(s => s.u.id)).size
    const staged = steps.some(s => s.stage)
    return { steps, leafName, leafPath, pkMeta, multiPacket: pkts.length > 1, rebalanced, greedyPlaced, finalPlaced, studentCount, staged }
  }, [students, packets, subs, tree, poolUsers, preAssignLevel, finalAssignments])

  const total = data.steps.length
  // Simulyasiya sona çatıbsa ekran YEKUN (tarazlamadan sonrakı) nəticəni göstərir —
  // axtarışın dediyi ixtisasla açılan siyahı eyni olsun.
  const done = total > 0 && idx >= total - 1
  // Hər təhsilalanın son addımı (mərhələli rejimdə bir nəfər iki addımda ola bilər)
  const finalSteps = useMemo(() => {
    const m = new Map<string, any>()
    for (const s of data.steps) m.set(s.u.id, s)
    return [...m.values()]
  }, [data])
  const findMatches = useMemo(() => {
    const norm = (x: string) => (x || '').toLocaleLowerCase('az')
    const t = norm(findQ.trim())
    if (!t) return []
    return finalSteps
      .filter(s => norm(s.u.name).includes(t) || norm(s.u.fin || '').includes(t))
      .sort((a, b) => (Number(!norm(a.u.name).startsWith(t)) - Number(!norm(b.u.name).startsWith(t))) || (a.u.name || '').localeCompare(b.u.name || '', 'az'))
      .slice(0, 5)
  }, [findQ, finalSteps])
  function goToStudent(s: any) {
    if (!s?.finalSpec) return
    setPlaying(false)
    setIdx(total - 1)
    setSelLeaf(s.finalSpec)
    setFlashId(s.u.id)
    setFindQ('')
    setFindOpen(false)
  }
  useEffect(() => {
    if (!flashId) return
    const t1 = setTimeout(() => {
      document.querySelector(`[data-sim-uid="${CSS.escape(flashId)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 80)
    const t2 = setTimeout(() => setFlashId(null), 3600)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [flashId])

  useEffect(() => {
    if (!playing) return
    if (idx >= total - 1) { setPlaying(false); return }
    const next = idx + 1
    const t = setTimeout(() => {
      setIdx(next)
      // Bal bərabərliyi (toqquşma) olan addıma çatanda avtomatik dayan
      if (data.steps[next]?.tieRivals?.length) setPlaying(false)
    }, speed)
    return () => clearTimeout(t)
  }, [playing, idx, speed, total, data])

  // cari vəziyyət
  const cur = idx >= 0 ? data.steps[idx] : null
  const curPk = cur ? cur.packetNum : (data.pkMeta[0]?.num ?? 1)
  const curMeta = data.pkMeta.find(m => m.num === curPk) || data.pkMeta[0]
  const pkIndex = data.pkMeta.findIndex(m => m.num === curPk)
  // Simulyasiya bitəndə ixtisaslar BÜTÜN paketlər üzrə yekunla göstərilir —
  // yoxsa sonda yalnız son (ən aşağı ballı) paketin adamları görünürdü.
  const showAll = data.multiPacket && total > 0 && idx >= total - 1
  const viewMeta = useMemo(() => {
    const quota: Record<string, number> = {}, ids: string[] = []
    for (const m of data.pkMeta) for (const id of m.specIds) { if (quota[id] === undefined) { quota[id] = 0; ids.push(id) }; quota[id] += m.quota[id] || 0 }
    return { specIds: ids, quota }
  }, [data])
  const inView = (pn: number) => showAll || pn === curPk
  const filled: Record<string, number> = {}        // cari paket üzrə
  const cutoff: Record<string, number> = {}         // cari paket üzrə keçid balı
  let placedTotal = 0, firstChoice = 0              // ümumi (bütün paketlər)
  if (done) {
    for (const s of finalSteps) {
      if (!s.finalSpec) continue
      placedTotal++; if (s.finalChoiceNum === 1) firstChoice++
      if (inView(s.packetNum)) {
        filled[s.finalSpec] = (filled[s.finalSpec] || 0) + 1
        const sc = s.u.score || 0
        if (cutoff[s.finalSpec] === undefined || sc < cutoff[s.finalSpec]) cutoff[s.finalSpec] = sc
      }
    }
  } else for (let i = 0; i <= idx && i < total; i++) {
    const s = data.steps[i]
    if (s.placed) {
      placedTotal++; if (s.choiceNum === 1) firstChoice++
      if (inView(s.packetNum)) {
        filled[s.placed] = (filled[s.placed] || 0) + 1
        const sc = s.u.score || 0
        if (cutoff[s.placed] === undefined || sc < cutoff[s.placed]) cutoff[s.placed] = sc
      }
    }
  }
  const queue = data.steps.slice(idx + 1, idx + 5)
  // cari paketin daxili gedişatı
  const pkProcessed = idx >= 0 ? data.steps.slice(0, idx + 1).filter(s => s.packetNum === curPk).length : 0
  // yalnız cari paket (son addımda filled bütün paketləri saxlayır)
  const pkPlaced = idx >= 0 ? data.steps.slice(0, idx + 1).filter(s => s.placed && s.packetNum === curPk).length : 0
  const pkQuota = curMeta ? Object.values(curMeta.quota).reduce((a, b) => a + b, 0) : 0
  const pkTotal = curMeta?.count ?? 0
  const pkSteps = data.steps.map((s, i) => ({ s, i })).filter(x => x.s.packetNum === curPk)   // cari paketin təhsilalanları (sıra ilə)

  const narration = (() => {
    if (!cur) return 'Başlamaq üçün “Növbəti addım” və ya “Avtomatik” düyməsini seçin. Təhsilalanlar bala görə ardıcıl yerləşdiriləcək.'
    const nm = cur.u.name, sc = Number(cur.u.score).toFixed(1)
    if (!cur.placed) {
      // Bu addımda yer tapılmadı — amma sonrakı tarazlama mərhələsi onu
      // yerləşdirmiş ola bilər. Yekun nəticəni gizlətməmək üçün qeyd edilir.
      if (cur.finalSpec) return `${nm} (${sc} bal): bu addımda seçdiyi ixtisaslar dolu idi, lakin tarazlama mərhələsində “${data.leafName[cur.finalSpec] || ''}” ixtisasına yerləşdirildi.`
      return `${nm} (${sc} bal): bütün seçdiyi ixtisaslar dolu olduğu üçün bu təhsilalan yerləşdirilmədi (əl ilə baxılmalıdır).`
    }
    const fulls = cur.attempts.filter(a => a.full)
    const tr0 = cur.tieRivals[0]
    const tieDecide = tr0?.trace ? tieTraceText(tr0.trace, tr0.rival)
      : tr0 && tr0.subject
      ? ` Üstünlük meyarı “${tr0.subject}” oldu: ${tr0.rival}-ın balı ${critFmt(tr0.rivalSubjScore)}, bu təhsilalanınkı ${critFmt(tr0.mySubjScore)} — ${tr0.rival} öndə olduğu üçün oraya yerləşdirildi.`
      : tr0 ? ` Bütün prioritet meyarları da eyni idi — sıra siyahıdakı ardıcıllıqla müəyyənləşdi.` : ''
    const tieNote = cur.tieRivals.length
      ? ` ⚖️ Bərabər bal: “${data.leafName[tr0.id]}” üçün ${tr0.rival} ilə ${sc} bal eyni idi.${tieDecide} Ona görə bu təhsilalan oraya yerləşdirilmədi.`
      : ''
    if (fulls.length === 0) return `${nm} (${sc} bal): 1-ci seçimi “${data.leafName[cur.placed]}”-də boş yer olduğu üçün birbaşa oraya yerləşdirildi.`
    return `${nm} (${sc} bal): ${fulls.map((a, i) => `${i + 1}-ci seçim “${data.leafName[a.id]}” dolu`).join(', ')} → ${cur.choiceNum}-ci seçim “${data.leafName[cur.placed]}”-ə yerləşdirildi.${tieNote}`
  })()

  const Seat = ({ on, color }: { on: boolean; color: string }) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? color : 'transparent', border: on ? 'none' : '1px solid #d6dae3', flexShrink: 0 }} />

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: "#eef1f5 url('/background.jpeg') center center / cover no-repeat fixed", display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes simFlash { 0%, 100% { background: #fff; box-shadow: 0 0 0 0 transparent } 50% { background: #fff1b8; box-shadow: 0 0 0 2px #e0a92e } }
        .sim-flash { animation: simFlash .6s ease-in-out 6 }`}</style>
      {/* Üst: idarə paneli (tam eni tutur) */}
      <div style={{ padding: '12px 20px', background: '#fff', borderBottom: '1px solid #e7eaf0', boxShadow: '0 2px 10px #1a1f3c0a', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        {data.multiPacket && (
          <span style={{ fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 20, background: '#fffdf5', color: '#9a7b1e', border: '1px solid #e0a92e', whiteSpace: 'nowrap' }}>
            📦 Paket {curPk}/{data.pkMeta.length}{curMeta ? ` · bal ${curMeta.minScore.toFixed(0)}–${curMeta.maxScore.toFixed(0)}` : ''}
          </span>
        )}
        <span style={{ fontSize: 13, color: '#8a909c' }}>Addım <b style={{ color: '#2b2f3a' }}>{Math.max(0, idx + 1)}</b> / {total}</span>
        <button onClick={() => { setPlaying(false); setIdx(i => Math.max(i - 1, -1)) }} disabled={idx < 0}
          style={{ padding: '8px 16px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#5a6070', fontWeight: 700, fontSize: 13, cursor: idx < 0 ? 'not-allowed' : 'pointer', opacity: idx < 0 ? .4 : 1 }}>◀ Əvvəlki</button>
        <button onClick={() => { setPlaying(false); setIdx(i => Math.min(i + 1, total - 1)) }} disabled={idx >= total - 1}
          style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: '#e0a92e', color: '#fff', fontWeight: 800, fontSize: 13, boxShadow: '0 4px 14px #e0a92e55', cursor: idx >= total - 1 ? 'not-allowed' : 'pointer', opacity: idx >= total - 1 ? .4 : 1 }}>Növbəti addım ▶</button>
        <button onClick={() => setPlaying(p => !p)} disabled={idx >= total - 1}
          style={{ padding: '8px 16px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: playing ? '#f5a623' : '#fff', color: playing ? '#fff' : '#5a6070', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{playing ? '⏸ Dayandır' : '⏵ Avtomatik'}</button>
        <button onClick={() => setSpeed(s => s === 1200 ? 500 : s === 500 ? 150 : s === 150 ? 60 : 1200)} title="Sürət"
          style={{ padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#8a909c', fontSize: 12, cursor: 'pointer' }}>{speed === 1200 ? '1×' : speed === 500 ? '2×' : speed === 150 ? '5×' : '10×'}</button>
        <button onClick={() => { setPlaying(false); setIdx(total - 1) }} disabled={idx >= total - 1}
          title="Sona keç — yekun nəticəni göstər"
          style={{ padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#5a6070', fontWeight: 700, fontSize: 13, cursor: idx >= total - 1 ? 'not-allowed' : 'pointer', opacity: idx >= total - 1 ? .4 : 1 }}>⏭ Sona</button>
        <button onClick={() => { setIdx(-1); setPlaying(false) }} title="Başa qayıt" style={{ padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#8a909c', fontSize: 13, cursor: 'pointer' }}>↺</button>
        {/* Ada görə axtarış — yerləşən təhsilalanın ixtisasını açır */}
        <div style={{ position: 'relative' }}>
          <input value={findQ} placeholder="🔍 Təhsilalan axtar…"
            onChange={e => { setFindQ(e.target.value); setFindOpen(true) }}
            onFocus={() => setFindOpen(true)}
            onBlur={() => setTimeout(() => setFindOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setFindQ(''); setFindOpen(false) }
              if (e.key === 'Enter') goToStudent(findMatches.find(s => s.finalSpec))
            }}
            style={{ width: 220, padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e0e4f0', fontSize: 13, outline: 'none', background: '#fff', color: '#2b2f3a' }} />
          {findOpen && findQ.trim() && (
            <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, width: 320, background: '#fff', border: '1px solid #e7eaf0', borderRadius: 10, boxShadow: '0 12px 32px #1a1f3c26', zIndex: 30, overflow: 'hidden' }}>
              {findMatches.length === 0
                ? <div style={{ padding: '10px 12px', fontSize: 12.5, color: '#8a909c' }}>Tapılmadı</div>
                : findMatches.map(s => {
                    const ok = !!s.finalSpec
                    return (
                      <button key={s.u.id} disabled={!ok}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => goToStudent(s)}
                        title={ok ? 'İxtisasını aç' : 'Bu təhsilalan yerləşməyib'}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', borderBottom: '1px solid #f4f5fb', background: '#fff', textAlign: 'left', cursor: ok ? 'pointer' : 'not-allowed', opacity: ok ? 1 : .5 }}
                        onMouseEnter={e => { if (ok) e.currentTarget.style.background = '#fffdf5' }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#fff' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.u.name}</div>
                          <div style={{ fontSize: 11, color: ok ? '#2faf5f' : '#cf1322', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ok ? `→ ${data.leafName[s.finalSpec]}${data.multiPacket ? ` · Paket ${s.packetNum}` : ''}` : 'yerləşməyib'}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, fontWeight: 800, color: '#c9962a' }}>{Number(s.u.score).toFixed(1)}</span>
                      </button>
                    )
                  })}
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6, borderLeft: '1px solid #e7eaf0' }}>
          <span style={{ fontSize: 11, color: '#9aa0ac', marginRight: 2 }}>Önə çıxar:</span>
          {([['left', '📚', 'İxtisaslar'], ['center', '👤', 'Təhsilalan'], ['right', '📦', 'Paket/Növbə']] as const).map(([k, ic, lbl]) => (
            <button key={k} onClick={() => setFocusCol(focusCol === k ? null : k)} title={lbl}
              style={{ width: 32, height: 32, borderRadius: 8, fontSize: 14, cursor: 'pointer',
                border: `1.5px solid ${focusCol === k ? '#e0a92e' : '#e0e4f0'}`,
                background: focusCol === k ? '#fffdf5' : '#fff', color: focusCol === k ? '#9a7b1e' : '#8a909c' }}>{ic}</button>
          ))}
        </div>
        <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#8a909c', fontSize: 17, cursor: 'pointer' }}>✕</button>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns:
        focusCol === 'left'   ? 'minmax(0,2.2fr) minmax(0,1fr) 200px'
        : focusCol === 'center' ? '170px minmax(0,2.4fr) 200px'
        : focusCol === 'right'  ? '200px minmax(0,1fr) minmax(0,2.2fr)'
        : '260px minmax(0,1fr) 230px', overflow: 'hidden', transition: 'grid-template-columns .25s' }}>
        {/* SOL: ixtisaslar dolur */}
        <div style={{ overflowY: 'auto', borderRight: '1px solid #e7eaf0', padding: '12px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9aa0ac', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📚 İxtisaslar dolur{data.multiPacket ? (showAll ? ' · Bütün paketlər (yekun)' : ` · Paket ${curPk}`) : ''}</div>
          {((showAll ? viewMeta : curMeta)?.specIds || []).map((id: string) => {
            const q = (showAll ? viewMeta : curMeta).quota[id], f = filled[id] || 0, isFull = f >= q && q > 0
            const justPlaced = cur?.placed === id
            return (
              <div key={id} onClick={() => setSelLeaf(id)} title="Yerləşən təhsilalanları gör"
                style={{ marginBottom: 10, padding: 8, borderRadius: 10, cursor: 'pointer', background: justPlaced ? '#fffdf5' : '#fff', border: justPlaced ? '1px solid #e0a92e' : '1px solid #eef0f5', transition: 'all .2s' }}
                onMouseEnter={e => { if (!justPlaced) (e.currentTarget as HTMLElement).style.background = '#f7f8fc' }}
                onMouseLeave={e => { if (!justPlaced) (e.currentTarget as HTMLElement).style.background = '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span style={{ color: isFull ? '#237804' : '#2b2f3a', fontWeight: justPlaced ? 800 : 500 }}>{data.leafName[id]}</span>
                  <span style={{ color: isFull ? '#237804' : '#8a909c', fontWeight: 700 }}>{f}/{q}{isFull ? ' ✓' : ''}</span>
                </div>
                {q <= 26
                  ? <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{Array.from({ length: q }, (_, k) => <Seat key={k} on={k < f} color={isFull ? '#52c41a' : '#e0a92e'} />)}</div>
                  : <div style={{ height: 8, borderRadius: 8, background: '#f0ead2', overflow: 'hidden' }}><div style={{ width: `${q ? (f / q) * 100 : 0}%`, height: '100%', background: isFull ? '#52c41a' : '#e0a92e', transition: 'width .25s' }} /></div>}
                {f > 0 && (
                  <div style={{ marginTop: 5, fontSize: 10.5, fontWeight: 700, color: isFull ? '#237804' : '#8a909c', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {isFull ? '🔒 keçid balı:' : 'ən aşağı:'} <span style={{ color: isFull ? '#237804' : '#5a6070' }}>{cutoff[id].toFixed(2)}</span>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ORTA: cari təhsilalan */}
        <div style={{ overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {cur ? (
            <div style={{ background: '#fff', borderRadius: 16, padding: 18, border: '1px solid #e7eaf0', boxShadow: '0 10px 40px #1a1f3c12' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 46, height: 46, borderRadius: '50%', background: '#fbf1d6', color: '#b8860b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16 }}>{(cur.u.name || '?').split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1a2e' }}>{cur.u.name}</div>
                  <div style={{ fontSize: 12, color: '#8892b0', fontFamily: 'monospace' }}>FİN: {cur.u.fin || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: '#c9962a' }}>{Number(cur.u.score).toFixed(1)}</div>
                  <div style={{ fontSize: 10, color: '#8892b0' }}>bal</div>
                </div>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#8892b0', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 7 }}>Seçim sırası <span style={{ color: '#c9962a' }}>({cur.ranking.length})</span></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {cur.ranking.map((rid: string, k: number) => {
                  const tried = cur.attempts.find(a => a.id === rid)
                  const isPlaced = cur.placed === rid
                  const isFull = tried?.full
                  return (
                    <div key={rid} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 10px', borderRadius: 8,
                      background: isPlaced ? '#f6ffed' : isFull ? '#fff1f0' : '#f7f8fc' }}>
                      <span style={{ fontWeight: 800, color: isPlaced ? '#237804' : isFull ? '#cf1322' : '#aab' }}>{k + 1}.</span>
                      <span style={{ flex: 1, color: isPlaced ? '#237804' : isFull ? '#cf1322' : '#555', fontWeight: isPlaced ? 700 : 400 }}>{data.leafName[rid]}</span>
                      {isPlaced && <span style={{ fontSize: 11, fontWeight: 700, color: '#52c41a' }}>✓ yerləşdi</span>}
                      {isFull && <span style={{ fontSize: 11, color: '#cf1322', whiteSpace: 'nowrap' }}>{
                        tried?.blocked === 'gender' ? '🚫 cins məhdudiyyəti'
                        : tried?.blocked === 'cap' ? '🚫 cins kvotası dolub'
                        : `${tried?.tie ? '⚖️ bərabər bal · ' : ''}dolu${cutoff[rid] !== undefined ? ` · keçid ${cutoff[rid].toFixed(1)}` : ''}`
                      }</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#8a909c', marginTop: 60 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🎬</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#2b2f3a' }}>{data.studentCount} təhsilalan bala görə sıralandı</div>
              {data.staged && (
                <div style={{ fontSize: 11.5, color: '#8a909c', marginTop: 6, lineHeight: 1.6 }}>
                  Mənbə nisbəti aktivdir — yerləşdirmə 3 mərhələdə gedir:
                  <b> 1) mülki payı</b> · <b>2) lisey payı</b> · <b>3) qalan yerlər hamıya</b>.
                  Bir təhsilalan öz mərhələsində yer tapmasa, 3-cü mərhələdə yenidən cəhd edir.
                </div>
              )}
              <div style={{ fontSize: 13, marginTop: 6 }}>Addım-addım izləmək üçün “Növbəti addım”, ardıcıl izləmək üçün “Avtomatik” istifadə edin.</div>
            </div>
          )}

          {/* Bərabər bal toqquşması banneri */}
          {cur && cur.tieRivals.length > 0 && (
            <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18 }}>⚖️</span>
              <div style={{ fontSize: 13, color: '#8a6d1b', lineHeight: 1.55 }}>
                <b style={{ color: '#5a4a12' }}>Bərabər bal toqquşması:</b> “{data.leafName[cur.tieRivals[0].id]}” üçün <b style={{ color: '#5a4a12' }}>{cur.tieRivals[0].rival}</b> ilə hər ikisinin ümumi balı <b style={{ color: '#5a4a12' }}>{cur.tieRivals[0].score.toFixed(2)}</b> idi. Son yer bir nəfərə qalır.{cur.tieRivals[0].trace ? (<TieTraceView trace={cur.tieRivals[0].trace} winner={cur.tieRivals[0].rival} />) : cur.tieRivals[0].subject ? (<> —
                  üstünlük meyarı <b style={{ color: '#5a4a12' }}>“{cur.tieRivals[0].subject}”</b> oldu: <b style={{ color: '#5a4a12' }}>{cur.tieRivals[0].rival}</b> = <b style={{ color: '#237804' }}>{critFmt(cur.tieRivals[0].rivalSubjScore)}</b>, bu təhsilalan = <b style={{ color: '#cf1322' }}>{critFmt(cur.tieRivals[0].mySubjScore)}</b> — {cur.tieRivals[0].rival} öndə olduğu üçün bu təhsilalan həmin ixtisasa yerləşdirilmədi.
                </>) : (<> Bütün prioritet meyarları da eyni idi — sıra siyahıdakı ardıcıllıqla müəyyənləşdi, bu təhsilalan həmin ixtisasa yerləşdirilmədi.</>)}
              </div>
            </div>
          )}

          {/* İzah sətri */}
          <div style={{ background: '#fffdf5', border: '1px solid #f1ead4', borderLeft: '3px solid #e0a92e', padding: '12px 16px', borderRadius: 6 }}>
            <span style={{ fontSize: 13.5, color: '#6a5a2e', lineHeight: 1.6 }}><b style={{ color: '#2b2f3a' }}>İzah: </b>{narration}</span>
          </div>
        </div>

        {/* SAĞ: növbə + sayğaclar */}
        <div style={{ overflowY: 'auto', borderLeft: '1px solid #e7eaf0', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.multiPacket && curMeta && (
            <div style={{ background: '#fffdf5', borderRadius: 10, padding: '12px', border: '1px solid #e0a92e' }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#9a7b1e', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>📦 Cari paket {curPk}/{data.pkMeta.length}</div>
              <div style={{ fontSize: 11, color: '#8a909c', marginBottom: 8 }}>Bal: {curMeta.minScore.toFixed(1)} – {curMeta.maxScore.toFixed(1)} · {pkTotal} təhsilalan · {pkQuota} kvota</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#5a6070', marginBottom: 4 }}>
                <span>İşlənən</span><b>{pkProcessed} / {pkTotal}</b>
              </div>
              <div style={{ height: 8, borderRadius: 8, background: '#f0ead2', overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ width: `${pkTotal ? (pkProcessed / pkTotal) * 100 : 0}%`, height: '100%', background: '#e0a92e', transition: 'width .25s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: '#237804' }}>
                <span>Yerləşən</span><b style={{ color: '#237804' }}>{pkPlaced} / {pkQuota}</b>
              </div>
              <div style={{ height: 8, borderRadius: 8, background: '#e8f5e9', overflow: 'hidden', marginTop: 4 }}>
                <div style={{ width: `${pkQuota ? (pkPlaced / pkQuota) * 100 : 0}%`, height: '100%', background: '#52c41a', transition: 'width .25s' }} />
              </div>
              {pkProcessed >= pkTotal && pkTotal > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#237804', marginTop: 8 }}>✅ Bu paket tamamlandı</div>}
              {/* Paketin təhsilalanları (adı ilə, status) */}
              <div style={{ marginTop: 10, borderTop: '1px solid #f1ead4', paddingTop: 8, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                {pkSteps.map(({ s, i }) => {
                  const now = i === idx, done = i <= idx
                  const bg = now ? '#fff7e6' : 'transparent'
                  return (
                    <div key={s.u.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, background: bg, border: now ? '1px solid #e0a92e' : '1px solid transparent' }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: now ? 800 : 500, color: !done ? '#aab0bd' : '#2b2f3a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.u.name}</span>
                      {s.u.source && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap', flexShrink: 0,
                          background: s.u.source === 'mülki' ? '#fbf1d6' : '#e8f3ee',
                          color: s.u.source === 'mülki' ? '#b8860b' : '#2f8a5b',
                          opacity: done ? 1 : .5 }}>{s.u.source === 'mülki' ? 'mülki' : 'lisey'}</span>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 700, color: !done ? '#aab0bd' : '#8a909c' }}>{Number(s.u.score).toFixed(1)}</span>
                      {!done
                        ? <span style={{ fontSize: 9.5, color: '#aab0bd', minWidth: 52, textAlign: 'right' }}>gözləyir</span>
                        : s.placed
                          ? <span title={data.leafName[s.placed]} style={{ fontSize: 9.5, color: '#2faf5f', minWidth: 52, maxWidth: 80, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>→ {data.leafName[s.placed]}</span>
                          : <span style={{ fontSize: 9.5, color: '#cf1322', minWidth: 52, textAlign: 'right' }}>yerləşmədi</span>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {!data.multiPacket && <div style={{ background: '#fff', border: '1px solid #e7eaf0', borderRadius: 10, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#9aa0ac', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 8 }}>Növbə (bala görə)</div>
            {queue.length === 0 ? <div style={{ fontSize: 12, color: '#8a909c' }}>— son —</div> : queue.map((s, k) => (
              <div key={s.u.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: k === 0 ? '#2b2f3a' : '#8a909c', marginBottom: 4 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.u.name}</span>
                <span style={{ fontWeight: 700 }}>{Number(s.u.score).toFixed(1)}</span>
              </div>
            ))}
          </div>}
          <div style={{ background: '#fff', border: '1px solid #e7eaf0', borderRadius: 10, padding: '12px' }}>
            <div style={{ fontSize: 11, color: '#8a909c' }}>Yerləşən</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#2faf5f' }}>{placedTotal}<span style={{ fontSize: 12, color: '#aab0bd', fontWeight: 500 }}> / {data.studentCount}</span></div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e7eaf0', borderRadius: 10, padding: '12px' }}>
            <div style={{ fontSize: 11, color: '#8a909c' }}>1-ci seçiminə düşən</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#c9962a' }}>{placedTotal ? Math.round((firstChoice / placedTotal) * 100) : 0}%</div>
          </div>
          {idx >= total - 1 && total > 0 && data.rebalanced.length > 0 && (
            <div style={{ background: '#fffdf5', borderRadius: 10, padding: '12px', border: '1px solid #e0a92e' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#9a7b1e' }}>⚖️ Tarazlama mərhələsi</div>
              <div style={{ fontSize: 11, color: '#8a6d1b', marginTop: 4, lineHeight: 1.5 }}>
                İlkin yerləşdirmədən sonra boş yerlər qalmışdı. Bal sıralaması pozulmadan <b>{data.rebalanced.length} təhsilalan</b> köçürülərək boş yerlər dolduruldu və yer çatmayanlara yer açıldı:
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 140, overflowY: 'auto' }}>
                {data.rebalanced.map((r, k) => (
                  <div key={k} style={{ fontSize: 10.5, color: '#5a4a12' }}>
                    • {r.name} ({r.score.toFixed(1)}): {r.fromSpec ? `${data.leafName[r.fromSpec]} → ` : 'yerləşmədi → '}<b>{data.leafName[r.toSpec]}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
          {idx >= total - 1 && total > 0 && (
            <div style={{ background: '#f6ffed', borderRadius: 10, padding: '12px', border: '1px solid #b7eb8f' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#237804' }}>✅ Simulyasiya bitdi</div>
              <div style={{ fontSize: 11.5, color: '#3a7a2e', marginTop: 4 }}>
                {data.finalPlaced} təhsilalan yerləşdirildi{data.finalPlaced !== data.greedyPlaced ? ` (ilkin: ${data.greedyPlaced} + tarazlama: ${data.finalPlaced - data.greedyPlaced})` : ''}. Bazaya yazmaq üçün bağlayıb “📋 Yerləşdir → Bazaya Yaz” seçin.
              </div>
            </div>
          )}
        </div>
      </div>

      {selLeaf && (() => {
        // Mənbə sırası: əvvəl mülki, sonra lisey (hər qrup öz içində bala görə)
        const srcRank = (s?: string) => s === 'mülki' ? 0 : s === 'lisey' ? 1 : 2
        const list = (done
          ? finalSteps.filter(s => s.finalSpec === selLeaf && inView(s.packetNum)).map(s => ({ u: s.u, choiceNum: s.finalChoiceNum, packetNum: s.packetNum as number }))
          : data.steps.slice(0, idx + 1).filter(s => s.placed === selLeaf && inView(s.packetNum)).map(s => ({ u: s.u, choiceNum: s.choiceNum, packetNum: s.packetNum as number }))
        ).sort((a, b) => (srcRank(a.u.source) - srcRank(b.u.source)) || ((b.u.score || 0) - (a.u.score || 0)))
        const q = (showAll ? viewMeta : curMeta)?.quota[selLeaf] ?? 0
        const fillP = q ? Math.round((list.length / q) * 100) : 0
        const isFull = list.length >= q && q > 0
        const minS = list.length ? Math.min(...list.map(it => it.u.score || 0)) : 0
        const maxS = list.length ? Math.max(...list.map(it => it.u.score || 0)) : 0
        const avgS = list.length ? list.reduce((a, it) => a + (it.u.score || 0), 0) / list.length : 0
        // keçid balı mənbə üzrə ayrı — hər iki mənbə varsa iki sətir göstərilir
        const srcMin = (src: string) => {
          const ss = list.filter(it => it.u.source === src).map(it => it.u.score || 0)
          return ss.length ? Math.min(...ss) : null
        }
        const minMülki = srcMin('mülki'), minLisey = srcMin('lisey')
        const splitPass = minMülki != null && minLisey != null
        const stat = (label: string, val: string, color: string) => (
          <div style={{ flex: 1, textAlign: 'center', padding: '10px 4px', background: '#f7f8fc', borderRadius: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color }}>{val}</div>
            <div style={{ fontSize: 10.5, color: '#8892b0', marginTop: 2 }}>{label}</div>
          </div>
        )
        const passStat = () => (
          <div style={{ flex: 1, textAlign: 'center', padding: '10px 4px', background: '#f7f8fc', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10, lineHeight: 1.15 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#1677ff' }}>{minMülki!.toFixed(2)}</div>
                <div style={{ fontSize: 9.5, color: '#1677ff', opacity: 0.75 }}>mülki</div>
              </div>
              <div style={{ width: 1, background: '#e4e7f2' }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 900, color: '#531dab' }}>{minLisey!.toFixed(2)}</div>
                <div style={{ fontSize: 9.5, color: '#531dab', opacity: 0.75 }}>lisey</div>
              </div>
            </div>
            <div style={{ fontSize: 10.5, color: '#8892b0', marginTop: 3 }}>Keçid balı</div>
          </div>
        )
        return (
          <div onClick={() => setSelLeaf(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, width: 660, maxWidth: '95%', maxHeight: '88%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 70px #000b' }}>
              {/* Başlıq */}
              <div style={{ background: 'linear-gradient(135deg,#b8860b,#e0a92e)', padding: '20px 24px', color: '#fff', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#ffffff99', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>İxtisasa yerləşənlər{data.multiPacket ? (showAll ? ' · Bütün paketlər' : ` · Paket ${curPk}`) : ''}</div>
                    <div style={{ fontSize: 19, fontWeight: 900 }}>{data.leafName[selLeaf]}</div>
                    {data.leafPath[selLeaf] && <div style={{ fontSize: 12, color: '#ffffffaa', marginTop: 3 }}>{data.leafPath[selLeaf]}</div>}
                  </div>
                  <button onClick={() => setSelLeaf(null)} style={{ width: 34, height: 34, borderRadius: 9, border: 'none', background: '#ffffff22', color: '#fff', cursor: 'pointer', fontSize: 17, flexShrink: 0 }}>✕</button>
                </div>
                {/* Kvota doluluğu */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
                  <div style={{ flex: 1, height: 10, borderRadius: 10, background: '#ffffff2e', overflow: 'hidden' }}>
                    <div style={{ width: `${fillP}%`, height: '100%', background: isFull ? '#52c41a' : '#fff', transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 900, whiteSpace: 'nowrap' }}>{list.length} / {q} yer{isFull ? ' · DOLU' : ''}</span>
                </div>
              </div>

              {/* Statistika zolağı */}
              {list.length > 0 && (
                <div style={{ display: 'flex', gap: 10, padding: '14px 24px 4px', flexShrink: 0 }}>
                  {stat('Yerləşən', String(list.length), '#1a1a2e')}
                  {splitPass ? passStat() : stat('Keçid balı', minS.toFixed(2), isFull ? '#237804' : '#722ed1')}
                  {stat('Orta bal', avgS.toFixed(2), '#c9962a')}
                  {stat('Ən yüksək', maxS.toFixed(2), '#d46b08')}
                </div>
              )}

              {/* Siyahı */}
              <div style={{ overflowY: 'auto', padding: '10px 16px 16px' }}>
                {list.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#8892b0', fontSize: 14 }}>Bu addıma qədər bu ixtisasa heç kim yerləşməyib.</div>
                ) : list.map((it, i) => (
                  <Fragment key={it.u.id}>
                  {i > 0 && srcRank(it.u.source) !== srcRank(list[i - 1].u.source) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 2px 8px' }}>
                      <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg,#1677ff33,#531dab55)' }} />
                      <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: .6, textTransform: 'uppercase', color: '#531dab', background: '#f6f0ff', border: '1px solid #d9c7f5', borderRadius: 12, padding: '3px 10px', whiteSpace: 'nowrap' }}>
                        {it.u.source === 'lisey' ? 'Lisey' : it.u.source === 'mülki' ? 'Mülki' : 'Digər'}
                      </span>
                      <div style={{ flex: 1, height: 2, background: 'linear-gradient(90deg,#531dab55,#1677ff33)' }} />
                    </div>
                  )}
                  <div data-sim-uid={it.u.id} className={flashId === it.u.id ? 'sim-flash' : undefined}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', borderRadius: 10, background: i % 2 ? '#fafbff' : '#fff', borderBottom: '1px solid #f4f5fb' }}>
                    <span style={{ width: 26, color: '#aab', fontWeight: 800, fontSize: 13, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#fbf1d6', color: '#b8860b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{(it.u.name || '?').split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.u.name}</div>
                      <div style={{ fontSize: 11, color: '#8892b0', fontFamily: 'monospace' }}>{it.u.fin || '—'}</div>
                    </div>
                    {flashId === it.u.id && <span style={{ fontSize: 11.5, fontWeight: 800, color: '#ad6800', background: '#fff1b8', border: '1px solid #ffd666', padding: '3px 10px', borderRadius: 14, whiteSpace: 'nowrap', flexShrink: 0 }}>📍 Axtarılan</span>}
                    {showAll && <span title="Paket" style={{ fontSize: 11.5, fontWeight: 800, color: '#4a5fc1', background: '#eef1ff', border: '1px solid #d0d8f8', padding: '3px 10px', borderRadius: 14, whiteSpace: 'nowrap', flexShrink: 0 }}>📦 Paket {it.packetNum}</span>}
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: it.choiceNum === 1 ? '#237804' : '#b8860b', background: it.choiceNum === 1 ? '#f6ffed' : '#fbf1d6', border: `1px solid ${it.choiceNum === 1 ? '#b7eb8f' : '#ecd9a0'}`, padding: '3px 10px', borderRadius: 14, whiteSpace: 'nowrap', flexShrink: 0 }}>{it.choiceNum}-ci seçim</span>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#c9962a', minWidth: 52, textAlign: 'right', flexShrink: 0 }}>{Number(it.u.score).toFixed(2)}</span>
                  </div>
                  </Fragment>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function Distribution() {
  // Polling söndürülüb: bu aktiv iş səhifəsidir (paket qurma, yerləşdirmə
  // simulyasiyası) — arxa fonda avtomatik yenilənmə iş prosesini poza bilər.
  // Yeni göndərişlər onsuz da monitor səhifələrində (Statistika, Nəticələr,
  // Seçim detalı) canlı görünür.
  const [users, refreshUsers]       = useLocalState(userDb.getAll, { poll: false })
  const [allTrees, refreshAllTrees] = useLocalState(treeDb.getAll, { poll: false })

  const [institutions, setInstitutions] = useState<any[]>([])
  const [allSelections, setAllSelections] = useState<any[]>([])
  useEffect(() => {
    Promise.all([institutionDb.getAll(), selectionDb.getAll()]).then(([insts, sels]) => {
      setInstitutions(insts)
      setAllSelections(sels.filter((s: any) => s.status !== 'draft'))
    })
  }, [])

  // ── Əsas state ───────────────────────────────────────────────────────────
  const [instId,   setInstId]   = useActiveInst(institutions)
  const [selId,    setSelId]    = useState<string>('')
  // İlk yüklənmədə default institution/selection seç
  useEffect(() => {
    if (institutions.length && !instId) setInstId(institutions[0].id)
  }, [institutions])
  useEffect(() => {
    if (allSelections.length && !selId) setSelId(allSelections[0].id)
  }, [allSelections])
  const [method,   setMethod]   = useState<Method>(null)
  const [storyOpen, setStoryOpen] = useState(false)
  const [mode,     setMode]     = useState<Mode>(null)
  const [saved,    setSaved]    = useState(false)
  const [running,  setRunning]  = useState(false)
  const [runStep,  setRunStep]  = useState(0)
  const [runDur,   setRunDur]   = useState(3000)
  const [showConf, setShowConf] = useState(false)
  const [algorithm, setAlgorithm] = useState<'greedy' | 'gale-shapley'>('greedy')
  const [animEnabled]  = useState(true)    // animasiya həmişə aktiv
  const [prezMode]     = useState(false)   // prezentasiya sayğacları söndürülüb
  const [showPrep,     setShowPrep]     = useState(false)   // hazırlıq paneli
  const [showSummary,  setShowSummary]  = useState(false)   // executive summary
  const [showRollback, setShowRollback] = useState(false)
  const [rollbackTarget, setRollbackTarget] = useState<typeof snapshots[0] | null>(null)
  const [snapshots, setSnapshots] = useState<Array<{id:string;ts:string;selName:string;algorithm:string;method:string;placedCount:number;userStates:any[];treeId?:string;quotas?:Record<string,number>}>>(() => {
    try { return JSON.parse(localStorage.getItem('dist_snapshots') || '[]') } catch { return [] }
  })

  // ── Simulyasiya animasiya state ───────────────────────────────────────────
  const [simStep,     setSimStep]    = useState(0)
  const [simRunning,  setSimRunning] = useState(false)
  const [simSpeed,    setSimSpeed]   = useState<0|1|3|10>(0)
  const [simStarted,  setSimStarted] = useState(false)
  const [simFinished, setSimFinished] = useState(false)
  const [collisionPause, setCollisionPause] = useState<any>(null)  // bərabər ballı toqquşma fasiləsi
  const simTotalRef = useRef(0)
  const animEnabledRef = useRef(false)
  useEffect(() => { animEnabledRef.current = animEnabled }, [animEnabled])
  const collisionRef = useRef<Map<number, any>>(new Map())  // step → toqquşma məlumatı
  const ackedRef     = useRef<Set<number>>(new Set())       // təsdiqlənmiş toqquşma addımları
  const skipAllRef   = useRef(false)                         // bütün toqquşmaları ötür
  const simStepRef   = useRef(0)                             // cari addım (etibarlı sayğac)
  useEffect(() => { simStepRef.current = simStep }, [simStep])

  // ── Paket state ───────────────────────────────────────────────────────────
  const [packetCount,    setPacketCount]   = useState(4)
  const [packetsReady,   setPacketsReady]  = useState(false)
  const [animStep,       setAnimStep]      = useState(0)
  const [selectedPacket, setSelectedPacket] = useState<any>(null)
  const [modalTab,       setModalTab]       = useState<'students' | 'specs'>('students')

  // ── Filtr ────────────────────────────────────────────────────────────────
  const [statusFlt, setStatusFlt] = useState('all')
  const [scoreMin,  setScoreMin]  = useState('')
  const [scoreMax,  setScoreMax]  = useState('')
  const [nameQ,     setNameQ]     = useState('')

  // Seçim dəyişdikdə tree-ni localStorage-dən birbaşa yenilə
  // (eyni tab-da window.storage event gəlmir, remount olarsa da təhlükəsizdir)
  useEffect(() => { refreshAllTrees() }, [selId, instId])

  // ── Məlumat ───────────────────────────────────────────────────────────────
  const activeInst     = institutions.find((i: any) => i.id === instId) || institutions[0]
  const instSelections = allSelections.filter((s: any) => s.institution === instId)
  const sel  = instSelections.find((s: any) => s.id === selId) || instSelections[0] || null
  const tree = sel ? ((allTrees ?? []).find((t: any) => t.id === sel.treeId) || null) : null
  // tree məzmunu dəyişəndə memo-lar yenilensin
  const treeKey = JSON.stringify(tree?.nodes || [])
  const [sels, setSels] = useState<any[]>([])
  useEffect(() => {
    if (!sel) { setSels([]); return }
    let cancelled = false
    submissionDb.getBySelection(sel.id).then(list => { if (!cancelled) setSels(list) })
    return () => { cancelled = true }
  }, [sel?.id])

  // Seçimin iştirakçıları (seçim etmiş-etməmiş). Qrup seçimin öz parametri
  // deyil — seçdiyi strukturdan (tree.cohort) gəlir.
  const allInstUsers   = sel
    ? selectionParticipants(sel, tree, users ?? [])
    : (users ?? []).filter((u: any) => u.institution === instId)
  const submittedUsers = allInstUsers.filter(u => sels.find((s: any) => s.userId === u.id))

  // ── Default prioritet: strukturda prioritet təyin edilməyən ixtisaslar üçün ──
  // Bərabər ballılar idxal şablonundakı fənn sırası ilə ayrılır. Siyahı bütün
  // hesablamalardan (yerləşdirmə, paket, simulyasiya) ƏVVƏL qurulmalıdır.
  const [storedPrio, setStoredPrio] = useState<string[]>([])
  useEffect(() => { systemSettingsDb.getPrioritySubjects().then(l => setStoredPrio(l || [])) }, [])
  const subjKey = allInstUsers.map((u: any) => Object.keys(u.subjects || {}).join(',')).join('|')
  const defaultTbKey = useMemo(() => {
    const list = buildDefaultTiebreaker(storedPrio, allInstUsers)
    setDefaultTiebreaker(list)
    return list.join('|')
  }, [storedPrio.join('|'), subjKey])

  // ── Ağacın ən az kvotalı yarpağı → maks paket sayı ───────────────────────
  const { minQuota, minLeafName } = useMemo(() => {
    const leaves = getLeavesWithPath(tree?.nodes || [])
    if (!leaves.length) return { minQuota: 20, minLeafName: '' }
    let min = Infinity, name = ''
    for (const { leaf } of leaves) {
      const q = leaf.quota || 0
      if (q < min) { min = q; name = leaf.name }
    }
    return { minQuota: min === Infinity ? 20 : min, minLeafName: name }
  }, [treeKey])

  const maxPackets = Math.max(2, minQuota)

  useEffect(() => {
    if (packetCount > maxPackets) setPacketCount(maxPackets)
  }, [maxPackets])

  // ── Animasiya taymer (dramatik anlarda avtomatik yavaşlama) ───────────────
  useEffect(() => {
    if (!simRunning) return
    const total = simTotalRef.current
    let cancelled = false
    let timer: any

    const tick = () => {
      if (cancelled) return
      const next = simStepRef.current + 1
      if (next >= total) {
        simStepRef.current = total
        setSimStep(total)
        setSimRunning(false)
        setSimFinished(true)
        return
      }
      simStepRef.current = next
      setSimStep(next)
      // Bərabər ballı toqquşma — simulyasiyanı dayandır və xəbərdarlıq et
      if (!skipAllRef.current && collisionRef.current.has(next) && !ackedRef.current.has(next)) {
        setSimRunning(false)
        setCollisionPause(collisionRef.current.get(next))
        return  // növbəti tick planlaşdırılmır — "Davam et" gözlənilir
      }
      // Bu addımda ixtisas doldusa — dramatik fasilə ver
      const baseDelay = SPEED_DELAY[simSpeed]
      const isDramatic = animEnabledRef.current && simSpeed <= 3 && dramaticRef.current.has(next)
      const delay = isDramatic ? Math.max(baseDelay, 700) : baseDelay
      timer = setTimeout(tick, delay)
    }
    timer = setTimeout(tick, SPEED_DELAY[simSpeed])
    return () => { cancelled = true; clearTimeout(timer) }
  }, [simRunning, simSpeed])


  // Bal/mənbə/qrup/cins dəyişəndə paketlər yenidən qurulmalıdır (say eyni qalsa belə)
  const usersKey = allInstUsers.map((u: any) => `${u.id}:${u.score}:${u.source}:${u.group}:${u.gender}`).join("|")
  // ── Paketlər ──────────────────────────────────────────────────────────────
  const packets = useMemo(() => {
    if (!packetsReady || method !== 'packet') return []

    const leaves = getLeavesWithPath(tree?.nodes || [])
    const P = packetCount

    // ── Addım 1: təhsilalanları paketlərə böl ────────────────────────────
    // Proporsional rejimdə mülki və lisey AYRICA bölünür (bax: splitPacketStudents)
    const pm: Record<string, any[]> = {}
    for (const { leaf, path } of leaves) pm[leaf.id] = path
    const pkUsers = splitPacketStudents(allInstUsers, P, !!(tree?.sourceProportional), makeMeritCompare(sels, pm))

    // ── Addım 2: kvotanın paketlərə bölgüsü ─────────────────────────────
    // Yerlər HƏR MƏNBƏ ÜZRƏ AYRICA paylanır: paketə düşən mülki yer = paketdəki
    // mülki təhsilalan sayı, lisey yer = lisey sayı. Hər ixtisas üzrə paketlərin
    // cəmi sadə üsulun bölgüsünə dəqiq bərabərdir.
    const perPacketSpecs = allocatePacketSpecs(leaves, allInstUsers, pkUsers, tree, sel?.preAssignLevel ?? null)

    const result = []
    for (let i = 0; i < P; i++) {
      const studs = pkUsers[i]
      if (studs.length === 0) continue
      result.push({
        num:        i + 1,
        students:   studs,
        count:      studs.length,
        minScore:   studs.length ? Math.min(...studs.map((s: any) => s.score || 0)) : 0,
        maxScore:   studs.length ? Math.max(...studs.map((s: any) => s.score || 0)) : 0,
        specs:      perPacketSpecs[i],
        totalQuota: perPacketSpecs[i].reduce((s, x) => s + x.quota, 0),
      })
    }
    return result
  }, [packetsReady, packetCount, usersKey, treeKey, tree?.sourceProportional, sel?.preAssignLevel, sels, defaultTbKey])

  // ── Hər paketin müstəqil yerləşdirməsi (simulyasiya üçün) ────────────────────
  const packetPlacements = useMemo(() => {
    if (!packets.length || !sels.length) return []
    const spActive = !!(tree?.sourceProportional)
    return (packets as any[]).map((p: any) =>
      runPacketPlacement(p.students, sels, p.specs || [], spActive)
    )
  }, [packets, sels, tree?.sourceProportional, defaultTbKey])

  // ── Paket sim üçün addım-addım animasiya sırası ───────────────────────────
  const animSteps = useMemo(() => {
    if (!(packets as any[]).length || !packetPlacements.length) return []
    const steps: any[] = []
    ;(packets as any[]).forEach((p: any, pIdx: number) => {
      steps.push({ type: 'open-packet', pIdx })
      const pkAssign = packetPlacements[pIdx]?.assignments || {}
      ;(p.specs || []).forEach((spec: any, sIdx: number) => {
        steps.push({ type: 'open-spec', pIdx, sIdx })
        // Bu spec-i ranking-ində olan paketin təhsilalanları
        const competitors = (p.students || [])
          .filter((u: any) => {
            const sub = sels.find((s: any) => s.userId === u.id)
            return sub?.ranking?.includes(spec.id)
          })
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
        if (competitors.length === 0) {
          steps.push({ type: 'no-competitors', pIdx, sIdx })
        } else {
          competitors.forEach((student: any) => {
            const isWinner = pkAssign[student.id]?.specId === spec.id
            steps.push({ type: 'competitor', pIdx, sIdx, student, isWinner })
          })
        }
        steps.push({ type: 'spec-done', pIdx, sIdx })
      })
      steps.push({ type: 'packet-done', pIdx })
    })
    steps.push({ type: 'all-done' })
    return steps
  }, [packets, packetPlacements, sels])

  // ── Yerləşdirmə nəticəsi ──────────────────────────────────────────────────
  const placement = useMemo(() => {
    // Qeyd: əvvəl burada `!mode` yoxlaması vardı və nəticə yalnız "Yerləşdir"
    // basıldıqdan sonra hesablanırdı. İzahlı simulyasiya bu nəticəyə söykəndiyi
    // üçün (yekun söz onundur) hesablama daha erkən aparılır — nəticə panelləri
    // onsuz da `mode === 'distribute'` şərti ilə göstərilir.
    if (!tree) return null

    // Paket üsulunda hər paketin öz kvotası tətbiq edilir
    if (method === 'packet' && packets.length > 0 && packetPlacements.length > 0) {
      const assignments: Record<string, { specId: string; choiceNum: number }> = {}
      const placed:      Record<string, number>   = {}
      const quotas:      Record<string, number>   = {}
      const pathMap:     Record<string, any[]>    = {}
      ;(packets as any[]).forEach((p: any, pIdx: number) => {
        const pp = packetPlacements[pIdx]
        if (!pp) return
        Object.assign(assignments, pp.assignments)
        Object.assign(pathMap,     pp.pathMap)
        for (const [sid, cnt] of Object.entries(pp.placed as Record<string, number>)) {
          placed[sid] = (placed[sid] || 0) + cnt
        }
        for (const spec of (p.specs || [])) {
          quotas[spec.id] = (quotas[spec.id] || 0) + spec.quota
        }
      })
      return { assignments, placed, quotas, pathMap }
    }

    if (algorithm === 'gale-shapley') return runGaleShapley(submittedUsers, sels, tree)
    return runPlacement(submittedUsers, sels, tree, !!(tree?.sourceProportional),
      allInstUsers, sel?.preAssignLevel ?? null)
  }, [mode, method, selId, treeKey, (users ?? []).length, packets, packetPlacements, tree?.sourceProportional, algorithm, sels, defaultTbKey])

  const placedCount   = placement ? Object.keys(placement.assignments).length : 0
  const unplacedCount = submittedUsers.length - placedCount

  // Filtersiz sıra — animasiya üçün
  // Yerləşdirmə ilə eyni sıra: bal, bərabərdirsə prioritet meyarları
  const meritCmp = useMemo(() => makeMeritCompare(sels, placement?.pathMap || {}, sid => !!placement?.pathMap?.[sid]),
    [sels, placement, defaultTbKey])
  const allStudentRows = useMemo(() => {
    if (!placement) return []
    return submittedUsers
      .map(u => {
        const a    = placement.assignments[u.id]
        const path = a ? (placement.pathMap[a.specId] || []) : []
        return { user: u, assignment: a, path }
      })
      .sort((a, b) => meritCmp(a.user, b.user))
  }, [placement])

  // ── Placement hazır olanda simTotal-ı yenilə ─────────────────────────────
  useEffect(() => {
    if (mode === 'sim' && placement) {
      if (method === 'simple') {
        simTotalRef.current = allStudentRows.length
      } else {
        simTotalRef.current = Math.max(0, animSteps.length - 1)
      }
    }
  }, [mode, placement, allStudentRows.length, animSteps.length])

  // ── Dramatik addımlar: bir ixtisas məhz bu addımda dolur ──────────────────
  const dramaticSteps = useMemo(() => {
    const set = new Set<number>()
    if (!placement || method !== 'simple') return set
    const fill: Record<string, number> = {}
    allStudentRows.forEach((r: any, idx: number) => {
      if (r.assignment) {
        const sid = r.assignment.specId
        fill[sid] = (fill[sid] || 0) + 1
        const quota = placement.quotas[sid] || 0
        if (quota > 0 && fill[sid] === quota) set.add(idx + 1) // bu addımda doldu
      }
    })
    return set
  }, [placement, allStudentRows, method])
  const dramaticRef = useRef<Set<number>>(new Set())
  dramaticRef.current = dramaticSteps

  // ── Bərabər ballı toqquşmalar: bir ixtisas dolanda eyni ballı başqa təhsilalan onu istəyirsə ──
  const collisionMap = useMemo(() => {
    const map = new Map<number, any>()
    if (!placement || method !== 'simple') return map
    const scoreOf = (u: any) => u.score || 0
    const firstIn = (u: any) => (rankingOf[u.id] || []).find(id => !!placement.pathMap[id]) || ''
    // Bərabərliyi hansı prioritet meyarı həll etdi (sıralamanın işlətdiyi meyarlarla)
    const decide = (w: any, l: any) => {
      const tb = pairTiebreaker(w, l, firstIn(w), firstIn(l), placement.pathMap)
      const trace = tieTrace(w, l, tb)
      const d = decidingCriterion(w, l, tb)
      if (!d) return { trace, none: true }
      return { label: d.crit === UMUMI_KEY ? 'Ümumi bal' : isSumCrit(d.crit) ? 'Σ ' + d.crit : d.crit, w: d.w, l: d.l, trace }
    }
    const rankingOf: Record<string, string[]> = {}
    for (const s of sels) rankingOf[s.userId] = s.ranking || []
    const nameOf  = (sid: string) => { const p = placement.pathMap[sid] || []; return p.length ? p[p.length - 1].name : sid }
    const assignOf  = placement.assignments
    const remaining: Record<string, number> = { ...placement.quotas }
    allStudentRows.forEach((row: any, idx: number) => {
      const a = row.assignment
      if (!a) return
      const sid = a.specId
      if (remaining[sid] == null) return
      remaining[sid]--
      if (remaining[sid] === 0) {                       // ixtisas məhz bu addımda doldu
        const sc = scoreOf(row.user)
        const losers = submittedUsers.filter((u: any) =>
          u.id !== row.user.id && scoreOf(u) === sc &&
          (rankingOf[u.id] || []).includes(sid) &&
          (assignOf[u.id]?.specId !== sid))            // eyni ballı, bu ixtisası istəyib amma ala bilməyən
        if (losers.length > 0) {
          map.set(idx + 1, {
            step: idx + 1, score: sc, specName: nameOf(sid),
            winner: { name: row.user.name, fin: row.user.fin, choiceNum: a.choiceNum },
            losers: losers.map((u: any) => ({
              name: u.name, fin: u.fin, dec: decide(row.user, u),
              got: assignOf[u.id] ? nameOf(assignOf[u.id].specId) : 'Yerləşmədi',
              gotChoice: assignOf[u.id]?.choiceNum ?? null,
            })),
          })
        }
      }
    })
    return map
  }, [placement, allStudentRows, method, sels, submittedUsers])
  collisionRef.current = collisionMap

  const studentRows = useMemo(() => {
    if (!placement) return []
    return submittedUsers
      .map(u => {
        const a    = placement.assignments[u.id]
        const path = a ? (placement.pathMap[a.specId] || []) : []
        return { user: u, assignment: a, path }
      })
      .filter(r => {
        const q = nameQ.toLowerCase()
        if (q && !r.user.name.toLowerCase().includes(q) &&
            !(r.user.fin || '').toLowerCase().includes(q)) return false
        if (statusFlt === 'placed'   && !r.assignment) return false
        if (statusFlt === 'unplaced' &&  r.assignment) return false
        if (scoreMin && r.user.score < Number(scoreMin)) return false
        if (scoreMax && r.user.score > Number(scoreMax)) return false
        return true
      })
      .sort((a, b) => (b.user.score || 0) - (a.user.score || 0))
  }, [placement, statusFlt, scoreMin, scoreMax, nameQ])

  // ── Reset funksiyaları ────────────────────────────────────────────────────
  function resetSim() {
    setSimStep(0); setSimRunning(false); setSimStarted(false); setSimFinished(false)
    setCollisionPause(null); ackedRef.current = new Set(); skipAllRef.current = false
  }

  // Toqquşma fasiləsindən sonra davam et
  function continueCollision(skipAll = false) {
    if (collisionPause) ackedRef.current.add(collisionPause.step)
    if (skipAll) skipAllRef.current = true
    setCollisionPause(null)
    setSimRunning(true)
  }

  function fullReset() {
    setMethod(null); setMode(null); setSaved(false); setShowConf(false)
    setPacketsReady(false); setAnimStep(0); setSelectedPacket(null)
    setStatusFlt('all'); setScoreMin(''); setScoreMax(''); setNameQ('')
    resetSim()
  }

  // ── Paket mode üçün: neçə təhsilalan işlənib ────────────────────────────────
  function getPacketProcessed(pIndex: number, step: number): number {
    let offset = 0
    for (let i = 0; i < pIndex; i++) offset += packets[i].count
    return Math.max(0, Math.min(step - offset, packets[pIndex]?.count || 0))
  }

  function changeInst(id: string) {
    setInstId(id); fullReset()
    const first = allSelections.find((s: any) => s.institution === id)
    if (first) setSelId(first.id)
  }

  function changeSelection(id: string) {
    setSelId(id); fullReset()
  }

  // ── Paket animasiyası ──────────────────────────────────────────────────────
  function createPackets() {
    setPacketsReady(true)
    setAnimStep(0)
    let step = 0
    const interval = setInterval(() => {
      step++
      setAnimStep(step)
      if (step >= packetCount) clearInterval(interval)
    }, 220)
  }

  // Nəticə paneli ekranda paket kartlarının altında qalır — modal bağlananda
  // avtomatik ora sürüşdürülür, yoxsa istifadəçi "nəticə yoxdur" zənn edir.
  const resultRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (running || mode !== 'distribute') return
    const t = setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => clearTimeout(t)
  }, [running, mode, method])

  // ── Yerləşdir ──────────────────────────────────────────────────────────────
  function handleDistribute() {
    if (running) return
    // Dinamik müddət: hər 100 nəfərə 1.5 saniyə (minimum 3s)
    const total = Math.max(3000, Math.round(submittedUsers.length / 100 * 1500))
    // Paket üsulunda hər paket ayrı mərhələ, sadə üsulda 3 mərhələ
    const stageCount = (method === 'packet' && (packets as any[]).length > 0) ? (packets as any[]).length : 3
    setRunDur(total); setRunning(true); setRunStep(0)
    for (let i = 1; i < stageCount; i++) {
      setTimeout(() => setRunStep(i), (total * i) / stageCount)
    }
    setTimeout(() => {
      setSaved(false); setMode('distribute'); resetSim()
      addLog('distribution', 'info', `Yerləşdirmə hesablandı`, `Seçim: ${sel?.name} · Metod: ${method} · Alqoritm: ${algorithm}`)
      setRunStep(stageCount) // uğur mesajı — istifadəçi "Bağla" basana qədər qalır
    }, total)
  }

  async function handleConfirm() {
    if (!placement) return
    // Üsul-spesifik icazə: sadə → dist.simple, paket → dist.packet
    const needPerm = method === 'packet' ? 'dist.packet' : 'dist.simple'
    if (!can(needPerm)) {
      setShowConf(false)
      addLog('distribution', 'warning', 'Yerləşdirmə icazəsi yoxdur',
        `${method === 'packet' ? 'Paket' : 'Sadə'} üsulu ilə bazaya yazma icazəsi verilməyib`)
      return
    }
    // Bu yerləşdirmədən təsirlənən bütün təhsilalanlar: seçim edənlər + əvvəl bu seçimə yerləşənlər
    const submittedIds = new Set(sels.map((s: any) => s.userId))
    const affected = (allInstUsers as any[]).filter((u: any) =>
      submittedIds.has(u.id) || u.placedSelectionId === sel!.id || placement.assignments[u.id])
    // Snapshot: təsirlənənlərin tam cari vəziyyəti (rollback üçün — yerləşməyənlər də daxil)
    const userStates = affected.map((u: any) => ({
      id: u.id, placedSpecialty: u.placedSpecialty, choiceNum: u.choiceNum,
      placedSpecialtyId: u.placedSpecialtyId, placedSelectionId: u.placedSelectionId,
    }))
    const leafQuotas: Record<string, number> = {}
    getLeavesWithPath(tree?.nodes || []).forEach(({ leaf }) => { leafQuotas[leaf.id] = leaf.quota || 0 })
    const snap = { id: Date.now().toString(), ts: new Date().toISOString(), selName: sel!.name, algorithm, method: method || '', placedCount: Object.keys(placement.assignments).length, userStates, treeId: tree?.id, quotas: leafQuotas }
    const newSnaps = [snap, ...snapshots].slice(0, 8)
    localStorage.setItem('dist_snapshots', JSON.stringify(newSnaps))
    setSnapshots(newSnaps)

    // Əvvəlcə köhnə yerləşdirməni təmizlə, sonra yenisini yaz (köhnə nəticələr qalmasın) — bir sorğuda
    const patches = affected.map((u: any) => {
      const a = placement.assignments[u.id]
      if (a) {
        const path = placement.pathMap[a.specId] || []
        return {
          id: u.id,
          placedSpecialty:   path.map((n: any) => n.name).join(' → '),
          choiceNum:         a.choiceNum,
          placedSpecialtyId: a.specId,
          placedSelectionId: sel!.id,
        }
      }
      // bu yerləşdirmədə yerləşmədi → köhnə yerləşdirməni sil
      return { id: u.id, placedSpecialty: null, choiceNum: null, placedSpecialtyId: null, placedSelectionId: null }
    })
    await userDb.bulkUpdate(patches, method === 'packet' ? 'packet' : 'simple')

    // Paket üsulu ilə yazılıbsa kvota bölgüsünü saxla — Statistika səhifəsi göstərir.
    // Sadə üsulda köhnə qeyd silinir ki, kart yalnız paket yerləşdirməsində görünsün.
    try {
      const store = JSON.parse(localStorage.getItem('dist_packet_alloc') || '{}')
      if (method === 'packet' && packets.length > 0) {
        const allocLeaves = getLeavesWithPath(tree?.nodes || [])
        store[sel!.id] = {
          ts: new Date().toISOString(),
          packetNums: packets.map((p: any) => p.num),
          packetTotals: packets.map((p: any) => p.totalQuota),
          rows: allocLeaves.map(({ leaf, path }) => ({
            id: leaf.id, name: leaf.name,
            path: path.slice(0, -1).map((n: any) => n.name).join(' → '),
            quota: leaf.quota || 0,
            perPacket: packets.map((p: any) => (p.specs.find((s: any) => s.id === leaf.id)?.quota ?? 0)),
          })),
        }
      } else {
        delete store[sel!.id]
      }
      localStorage.setItem('dist_packet_alloc', JSON.stringify(store))
    } catch { /* saxlama alınmasa yerləşdirməyə mane olma */ }

    await refreshUsers(); setSaved(true); setShowConf(false)
    addLog('distribution', 'success', `Yerləşdirmə bazaya yazıldı: ${Object.keys(placement.assignments).length} təhsilalan`,
      `Seçim: ${sel?.name} · Metod: ${method} · Alqoritm: ${algorithm}${tree?.sourceProportional ? ' · Proporsional bölgü' : ''}`)
  }

  async function handleRollback(snap: typeof snapshots[0]) {
    await userDb.bulkUpdate(snap.userStates.map(us => ({
      id: us.id, placedSpecialty: us.placedSpecialty || null, choiceNum: us.choiceNum || null,
      placedSpecialtyId: us.placedSpecialtyId || null, placedSelectionId: us.placedSelectionId || null,
    })))
    // Kvotaları da bərpa et (snapshot anındakı dəyərlərə)
    if (snap.treeId && snap.quotas) {
      const t = await treeDb.get(snap.treeId)
      if (t) {
        const q = snap.quotas
        const restore = (nodes: any[]): any[] => nodes.map((n: any) =>
          n.children?.length ? { ...n, children: restore(n.children) } : (q[n.id] !== undefined ? { ...n, quota: q[n.id] } : n))
        await treeDb.update(snap.treeId, { ...t, nodes: restore(t.nodes || []) })
      }
    }
    const newSnaps = snapshots.filter(s => s.id !== snap.id)
    localStorage.setItem('dist_snapshots', JSON.stringify(newSnaps))
    setSnapshots(newSnaps)
    await refreshUsers(); setSaved(false); setShowRollback(false)
    addLog('distribution', 'warning', `Rollback edildi: ${snap.selName}`, `Snapshot: ${new Date(snap.ts).toLocaleString('az-AZ')}`)
  }

  function exportExcel() {
    const data = studentRows.map((r, i) => ({
      '№': i + 1, 'Təhsilalan': r.user.name, 'FİN': r.user.fin || '—',
      'Bal': Number(r.user.score).toFixed(2),
      'Status': r.assignment ? 'Yerləşdirilib' : 'Yerləşdirilməyib',
      'Yerləşdiyi ixtisas': r.path.map((n: any) => n.name).join(' → ') || '—',
      'Seçim №': r.assignment?.choiceNum || '—',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 4 }, { wch: 24 }, { wch: 10 }, { wch: 8 }, { wch: 18 }, { wch: 42 }, { wch: 8 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Yerləşdirmə')
    XLSX.writeFile(wb, `Yerleshdirme_${new Date().toLocaleDateString('az-AZ').replace(/\./g, '-')}.xlsx`)
  }

  // ════════════════════════════════════════════════════════════════════════
  return (
    <>
      {/* ── Bərabər ballı toqquşma modalı ── */}
      {collisionPause && (
        <div style={{ position: 'fixed', inset: 0, background: '#0009', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1300, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 20, width: 560, maxWidth: '96vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 24px 80px #0005' }}>
            <div style={{ background: 'linear-gradient(135deg,#b45309,#f59e0b)', padding: '20px 26px', color: '#fff' }}>
              <div style={{ fontSize: 13, fontWeight: 700, opacity: .9, letterSpacing: .5 }}>⏸ SİMULYASİYA DAYANDIRILDI</div>
              <div style={{ fontSize: 19, fontWeight: 900, marginTop: 4 }}>⚠️ Bərabər ballı toqquşma</div>
              <div style={{ fontSize: 12.5, opacity: .95, marginTop: 6, lineHeight: 1.5 }}>
                Addım {collisionPause.step} — eyni <b>{collisionPause.score}</b> ballı təhsilalanlar
                «<b>{collisionPause.specName}</b>» ixtisası üçün rəqabət apardı. Yer məhdud olduğu üçün biri yerləşdi, digər(lər)i ala bilmədi. Aşağıda bərabərliyi həll edən prioritet meyarı göstərilir.
              </div>
            </div>
            <div style={{ padding: '20px 26px' }}>
              {/* Qazanan */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: '#ecfdf5', border: '1.5px solid #6ee7b7', marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>✅</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#065f46' }}>{collisionPause.winner.name}</div>
                  <div style={{ fontSize: 11.5, color: '#047857' }}>
                    Bu ixtisası aldı ({collisionPause.winner.choiceNum}-ci seçimi)
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#065f46', background: '#fff', borderRadius: 8, padding: '4px 10px', border: '1px solid #6ee7b7' }}>QAZANDI</span>
              </div>
              {/* Uduzanlar */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9090a8', textTransform: 'uppercase', letterSpacing: .5, margin: '4px 0 8px' }}>
                Bu ixtisası ala bilməyən eyni ballı təhsilalan{collisionPause.losers.length > 1 ? 'lar' : ''} ({collisionPause.losers.length})
              </div>
              {collisionPause.losers.map((l: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '1px solid #fed7aa', marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>↩️</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#9a3412' }}>{l.name}</div>
                    <div style={{ fontSize: 11.5, color: '#b45309' }}>
                      {l.dec?.trace?.length
                        ? l.dec.trace.map((t: TieStep, j: number) => (
                            <span key={j}>{j > 0 && ' → '}{t.label}: <b>{critNum(t.w)}</b>{t.decided ? ' vs ' : ' = '}<b>{critNum(t.l)}</b>{t.decided ? ' (fərq)' : ''}</span>
                          ))
                        : l.dec?.label
                          ? <>Meyar «{l.dec.label}»: qazanan <b>{critFmt(l.dec.w)}</b>, bu təhsilalan <b>{critFmt(l.dec.l)}</b></>
                          : <>Prioritet meyarı yoxdur</>}
                      {l.dec?.none && l.dec.trace?.length > 0 && <> · hamısı eyni</>}
                      {' · '}əvəzində: {l.got}{l.gotChoice ? ` (${l.gotChoice}-ci seçimi)` : ''}
                    </div>
                  </div>
                </div>
              ))}
              {/* Düymələr */}
              <div style={{ display: 'flex', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                <button onClick={() => continueCollision(false)}
                  style={{ flex: 1, minWidth: 140, padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 14, background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', boxShadow: '0 4px 14px #10b98144' }}>
                  ▶ Davam et
                </button>
                <button onClick={() => continueCollision(true)}
                  style={{ padding: '12px 16px', borderRadius: 12, border: '1.5px solid #e0e4f0', cursor: 'pointer', fontWeight: 700, fontSize: 12.5, background: '#fff', color: '#777' }}>
                  Hamısını ötür
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Təsdiq modalı ── */}
      {showConf && (
        <div style={{ position: 'fixed', inset: 0, background: '#0008', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }}>
          <div style={{ background: '#fff', borderRadius: 20, width: 440, maxWidth: '94vw', boxShadow: '0 24px 80px #0004', overflow: 'hidden' }}>
            <div style={{ background: '#f0f2f8', padding: '22px 26px', textAlign: 'center' }}>
              <div style={{ fontSize: 38, marginBottom: 10 }}>⚠️</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#2b2f3a', marginBottom: 6 }}>Nəticələri bazaya yazmaq istəyirsiniz?</div>
              <div style={{ fontSize: 12, color: '#8892b0', lineHeight: 1.6 }}>
                <span style={{ color: '#f5a623', fontWeight: 700 }}>{placedCount} təhsilalan</span> üçün yerləşdirmə nəticəsi bazaya yazılacaq.
              </div>
            </div>
            <div style={{ padding: '20px 26px', borderBottom: '1.5px solid #f0f2fa' }}>
              {[
                { label: 'Ümumi təhsilalan',    val: submittedUsers.length, color: '#c9962a' },
                { label: 'Yerləşdirilib',    val: placedCount,           color: '#52c41a' },
                { label: 'Yerləşdirilməyib', val: unplacedCount,         color: '#ff4d4f' },
              ].map(s => (
                <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: '#555' }}>{s.label}</span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: s.color }}>{s.val}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '16px 26px', display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConf(false)} style={{ flex: 1, padding: '12px', borderRadius: 10, border: '1.5px solid #e0e4f0', background: '#fff', color: '#555', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>← Geri qayıt</button>
              <button onClick={handleConfirm} style={{ flex: 1, padding: '12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#52c41a,#237804)', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer', boxShadow: '0 4px 16px #52c41a44' }}>✓ Bəli, bazaya yaz</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rollback təsdiq modalı ── */}
      {rollbackTarget && (() => {
        const snap = rollbackTarget
        const d = new Date(snap.ts)
        const dateStr = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
        return (
          <div onClick={() => setRollbackTarget(null)} style={{ position:'fixed', inset:0, background:'#000c', zIndex:1300, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:20, width:420, maxWidth:'96vw', boxShadow:'0 24px 80px #0005', overflow:'hidden' }}>
              <div style={{ background:'#f0f2f8', padding:'22px 26px', textAlign:'center' }}>
                <div style={{ fontSize:36, marginBottom:10 }}>↩</div>
                <div style={{ fontSize:16, fontWeight:800, color:'#fff', marginBottom:6 }}>Rollback edilsin?</div>
                <div style={{ fontSize:12, color:'#8892b0', lineHeight:1.6 }}>
                  <span style={{ color:'#f5a623', fontWeight:700 }}>"{snap.selName}"</span> seçimi üçün<br/>
                  <span style={{ color:'#fff', fontWeight:700 }}>{dateStr}</span> tarixli vəziyyətə qayıdılacaq
                </div>
              </div>
              <div style={{ padding:'18px 26px', borderBottom:'1.5px solid #f0f2fa' }}>
                {[
                  { label:'Seçim',        val: snap.selName,                                       color:'#1a1f3c' },
                  { label:'Tarix',         val: dateStr,                                             color:'#8a909c' },
                  { label:'Yerləşdirilmiş', val: `${snap.placedCount} təhsilalan`,                    color:'#c9962a' },
                  { label:'Metod',         val: snap.method === 'packet' ? '📦 Paket' : '📋 Sadə', color:'#8a909c' },
                ].map(s => (
                  <div key={s.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontSize:13, color:'var(--muted)' }}>{s.label}</span>
                    <span style={{ fontWeight:700, fontSize:13, color:s.color }}>{s.val}</span>
                  </div>
                ))}
                <div style={{ marginTop:10, padding:'9px 12px', borderRadius:9, background:'#fff8e6', border:'1.5px solid #ffd591', fontSize:12, color:'#d46b08', fontWeight:600 }}>
                  ⚠️ Bu əməliyyat {snap.placedCount} təhsilalanın yerləşdirmə nəticəsini silir. Geri alına bilməz.
                </div>
              </div>
              <div style={{ padding:'16px 26px', display:'flex', gap:10 }}>
                <button onClick={() => setRollbackTarget(null)} style={{ flex:1, padding:'12px', borderRadius:10, border:'1.5px solid #e0e4f0', background:'#fff', color:'#555', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                  Ləğv et
                </button>
                <button onClick={() => { handleRollback(snap); setRollbackTarget(null) }}
                  style={{ flex:1, padding:'12px', borderRadius:10, border:'none', background:'linear-gradient(135deg,#ff4d4f,#cf1322)', color:'#fff', fontWeight:800, fontSize:13, cursor:'pointer', boxShadow:'0 4px 16px #ff4d4f44' }}>
                  ↩ Bəli, rollback et
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Rollback modalı ── */}
      {showRollback && (
        <div onClick={() => setShowRollback(false)} style={{ position:'fixed', inset:0, background:'#000a', zIndex:1200, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#fff', borderRadius:20, width:560, maxWidth:'96vw', maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 24px 80px #0004' }}>
            <div style={{ background:'#f0f2f8', padding:'20px 24px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:14, fontWeight:800, color:'#fff' }}>🕓 Snapshot & Rollback</div>
                <div style={{ fontSize:11, color:'#8a909c', marginTop:3 }}>Əvvəlki yerləşdirməni bərpa edin</div>
              </div>
              <button onClick={() => setShowRollback(false)} style={{ width:34, height:34, borderRadius:9, border:'1.5px solid #e7eaf0', background:'transparent', color:'#8a909c', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
            <div style={{ flex:1, overflowY:'auto', padding:'14px 20px' }}>
              {snapshots.length === 0 && (
                <div style={{ textAlign:'center', padding:40, color:'var(--muted)', fontSize:13 }}>
                  <div style={{ fontSize:36, marginBottom:10 }}>📭</div>
                  Hələ snapshot yoxdur. Bazaya yazıldıqdan sonra avtomatik yaranır.
                </div>
              )}
              {snapshots.map(snap => {
                const d = new Date(snap.ts)
                const dateStr = `${d.getDate().toString().padStart(2,'0')}.${(d.getMonth()+1).toString().padStart(2,'0')}.${d.getFullYear()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`
                return (
                  <div key={snap.id} style={{ border:'1.5px solid #e8ecff', borderRadius:12, padding:'14px 18px', marginBottom:10, background:'#fafbff' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:800, color:'#1a1f3c' }}>{snap.selName}</div>
                        <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>
                          {dateStr} · {snap.method === 'packet' ? '📦 Paket' : '📋 Sadə'} · {snap.algorithm === 'gale-shapley' ? '🔬 Gale-Shapley' : '⚡ Greedy'}
                        </div>
                      </div>
                      <span style={{ padding:'4px 12px', borderRadius:8, background:'#fbf1d6', color:'#c9962a', fontWeight:800, fontSize:13 }}>{snap.placedCount} yerləşdi</span>
                    </div>
                    <button onClick={() => setRollbackTarget(snap)}
                      style={{ width:'100%', padding:'9px', borderRadius:9, border:'1.5px solid #ff4d4f55', background:'#fff0f0', color:'#cf1322', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                      ↩ Bu snapshot-a rollback et
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Paket detal modalı ── */}
      {selectedPacket && (() => {
        const p   = selectedPacket
        const col = p.col

        return (
          <div
            onClick={() => setSelectedPacket(null)}
            style={{ position: 'fixed', inset: 0, background: '#000b', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ background: '#fff', borderRadius: 20, width: 860, maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: `0 32px 80px ${col.shadow}` }}
            >
              {/* ── Başlıq ── */}
              <div style={{ background: col.bg, padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#ffffff77', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 }}>Paket {p.num}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: '#fff' }}>
                      👥 {p.count} təhsilalan
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#ffffffbb' }}>
                      📚 {p.totalQuota} kvota · 🎓 {p.specs?.length} ixtisas
                    </div>
                    <div style={{ fontSize: 13, color: '#ffffff88' }}>
                      bal: {p.minScore.toFixed(1)} – {p.maxScore.toFixed(1)}
                    </div>
                  </div>
                  {(() => {
                    const ml = p.students.filter((u: any) => u.source === 'mülki').length
                    const ls = p.students.filter((u: any) => u.source === 'lisey').length
                    if (ml + ls === 0) return null
                    return (
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <span style={{ fontSize: 12, fontWeight: 800, padding: '3px 12px', borderRadius: 20, background: '#ffffff26', color: '#fff' }}>🟦 Mülki: {ml}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, padding: '3px 12px', borderRadius: 20, background: '#ffffff26', color: '#fff' }}>🟪 Lisey: {ls}</span>
                      </div>
                    )
                  })()}
                </div>
                <button onClick={() => setSelectedPacket(null)}
                  style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: '#ffffff22', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  ✕
                </button>
              </div>

              {/* ── Tab seçici ── */}
              <div style={{ display: 'flex', borderBottom: '2px solid #f0f2fa', background: '#fff', flexShrink: 0 }}>
                {([
                  { key: 'students', label: '👥 Təhsilalanlar', count: p.count },
                  { key: 'specs',    label: '🎓 İxtisaslar', count: p.specs?.length },
                ] as const).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setModalTab(tab.key)}
                    style={{
                      flex: 1, padding: '14px 20px', border: 'none', cursor: 'pointer',
                      fontWeight: 700, fontSize: 13, transition: 'all .15s',
                      background: modalTab === tab.key ? '#fff' : '#f8f9fd',
                      color:      modalTab === tab.key ? col.text : '#8892b0',
                      borderBottom: modalTab === tab.key ? `3px solid ${col.text}` : '3px solid transparent',
                      marginBottom: -2,
                    }}
                  >
                    {tab.label}
                    <span style={{
                      marginLeft: 8, padding: '2px 8px', borderRadius: 10, fontSize: 11,
                      background: modalTab === tab.key ? col.light : '#eee',
                      color:      modalTab === tab.key ? col.text  : '#aaa',
                      fontWeight: 800,
                    }}>
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {/* ── Tab məzmunu ── */}
              <div style={{ flex: 1, overflowY: 'auto' }}>

                {/* Təhsilalanlar */}
                {modalTab === 'students' && p.students.map((u: any, idx: number) => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 24px', borderBottom: '1px solid #f4f6fc', background: idx % 2 === 0 ? '#fff' : '#fafbff' }}>
                    <span style={{ fontSize: 12, color: '#ccc', fontWeight: 700, width: 26, textAlign: 'right', flexShrink: 0 }}>{idx + 1}</span>
                    <div style={{ width: 32, height: 32, borderRadius: 9, background: col.light, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0, border: `1.5px solid ${col.text}33` }}>
                      👤
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#1a1f3c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                      <div style={{ fontSize: 11, color: '#bbb', fontFamily: 'monospace' }}>{u.fin || '—'}</div>
                    </div>
                    {u.source && (
                      <span style={{ padding: '2px 10px', borderRadius: 12, fontWeight: 700, fontSize: 11, flexShrink: 0,
                        background: u.source === 'mülki' ? '#fbf1d6' : '#e8f3ee',
                        color: u.source === 'mülki' ? '#b8860b' : '#2f8a5b' }}>
                        {u.source === 'mülki' ? 'mülki' : 'lisey'}
                      </span>
                    )}
                    <span style={{ padding: '3px 12px', borderRadius: 14, background: col.light, color: col.text, fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
                      {Number(u.score).toFixed(2)}
                    </span>
                  </div>
                ))}

                {/* İxtisaslar */}
                {modalTab === 'specs' && (
                  <>
                    {(p.specs || []).map((sp: any, si: number) => (
                      <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 24px', borderBottom: '1px solid #f0f2fa', background: si % 2 === 0 ? '#fff' : '#fafbff' }}>
                        <span style={{ fontSize: 12, color: '#ccc', fontWeight: 700, width: 26, textAlign: 'right', flexShrink: 0 }}>{si + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1f3c', lineHeight: 1.4 }}>{sp.name}</div>
                          <div style={{ fontSize: 11, color: '#bbb', marginTop: 2, lineHeight: 1.3 }}>
                            {sp.path.slice(0, -1).map((n: any) => n.name).join(' → ')}
                          </div>
                        </div>
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontWeight: 900, fontSize: 16, color: col.text }}>{sp.quota}</div>
                          <div style={{ fontSize: 10, color: '#bbb' }}>/ {sp.origQuota}</div>
                        </div>
                      </div>
                    ))}
                    {/* Cəm */}
                    <div style={{ padding: '14px 24px', background: col.light, borderTop: `2px solid ${col.text}22`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: col.text }}>Cəmi kvota</span>
                      <span style={{ fontSize: 20, fontWeight: 900, color: col.text }}>{p.totalQuota}</span>
                    </div>
                  </>
                )}

              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Snapshot düyməsi (gizlədilib) ── */}
      {false && snapshots.length > 0 && can('dist.rollback') && (
        <div style={{ display:'flex', marginBottom:10 }}>
          <button onClick={() => setShowRollback(true)} style={{ padding:'6px 14px', borderRadius:8, border:'1.5px solid #ff4d4f55', background:'#fff0f0', color:'#cf1322', fontWeight:700, fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            🕓 Snapshots ({snapshots.length})
          </button>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <InstTabs
        insts={institutions}
        activeId={instId}
        onSelect={changeInst}
        trailing={instSelections.length > 1 ? (
          <>
            <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginRight: 4 }}>Seçim:</span>
            {instSelections.map((s: any) => (
              <button key={s.id} onClick={() => changeSelection(s.id)}
                style={{
                  padding: '9px 18px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all .15s', height: 42,
                  border: '1.5px solid ' + (sel?.id === s.id ? '#f5a623' : 'var(--border)'),
                  background: sel?.id === s.id ? '#fff8e6' : '#fff',
                  color: sel?.id === s.id ? '#d46b08' : 'var(--muted)',
                }}>
                📋 {s.name}
              </button>
            ))}
          </>
        ) : undefined}
      />

      {/* ── Yerləşdirmə yükləmə animasiyası ── */}
      {running && (() => {
        const runLeaves = getLeavesWithPath(tree?.nodes || [])
        const runQuota  = runLeaves.reduce((s: number, { leaf }: any) => s + (leaf.quota || 0), 0)
        // Yarpaq (son) səviyyənin adı — strukturdan dinamik
        const leafLvl = (() => {
          const lv: string[] = tree?.levelNames || []
          let depth = 0
          const walk = (nodes: any[], cur: number) => { for (const n of nodes || []) { depth = Math.max(depth, cur + 1); if (n.children?.length) walk(n.children, cur + 1) } }
          walk(tree?.nodes || [], 0)
          return lv[Math.max(depth, lv.length) - 1] || 'İxtisas'
        })()
        const isPacket = method === 'packet' && (packets as any[]).length > 0
        const stages = isPacket
          ? (packets as any[]).map((p: any, i: number) => `Paket ${i + 1}/${(packets as any[]).length} — ${(p.students || []).length} təhsilalan yerləşdirilir…`)
          : [
            `${submittedUsers.length} təhsilalan bala görə sıralanır…`,
            `${runLeaves.length} ${leafLvl} üzrə kvotalar yoxlanılır…`,
            `Seçim sıralarına əsasən yerləşdirmə aparılır…`,
          ]
        const done = runStep >= stages.length
        return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(43,47,58,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
          <div style={{ background: '#fff', borderRadius: 16, width: 420, maxWidth: '92vw', overflow: 'hidden', boxShadow: '0 16px 50px rgba(0,0,0,.3)' }}>
            {/* Başlıq */}
            <div style={{ background: done ? 'linear-gradient(135deg,#389e0d,#52c41a)' : 'linear-gradient(135deg,#b8860b,#e0a92e)', padding: '16px 22px', display: 'flex', alignItems: 'center', gap: 12, transition: 'background .4s' }}>
              {done
                ? <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#ffffff2e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, flexShrink: 0 }}>✅</div>
                : <div style={{ width: 30, height: 30, border: '3px solid #ffffff55', borderTopColor: '#fff', borderRadius: '50%', animation: 'distrib-spin 0.8s linear infinite', flexShrink: 0 }} />}
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{done ? 'Yerləşdirmə uğurla tamamlandı' : 'Yerləşdirmə aparılır'}</div>
                <div style={{ fontSize: 11, color: '#ffffffcc', marginTop: 2 }}>{sel?.name || ''}</div>
              </div>
            </div>
            {/* Say kartları */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, padding: '16px 22px 6px' }}>
              {[
                { icon: '👥', val: submittedUsers.length, lbl: 'Təhsilalan' },
                { icon: '🎓', val: runLeaves.length,      lbl: leafLvl },
                { icon: '🎯', val: runQuota,              lbl: 'Kvota' },
              ].map(k => (
                <div key={k.lbl} style={{ background: '#f8f9fd', border: '1.5px solid #eef0f8', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 16 }}>{k.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: '#2b2f3a', lineHeight: 1.2 }}>{k.val}</div>
                  <div style={{ fontSize: 10, color: '#8a909c', fontWeight: 700 }}>{k.lbl}</div>
                </div>
              ))}
            </div>
            {/* Mərhələlər */}
            <div style={{ padding: '10px 22px 4px', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {stages.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: i < runStep ? '#237804' : i === runStep ? '#2b2f3a' : '#c0c4d0', fontWeight: i === runStep ? 700 : 500, transition: 'color .3s' }}>
                  <span style={{ width: 16, textAlign: 'center' }}>{i < runStep ? '✅' : i === runStep ? '⏳' : '○'}</span>
                  {s}
                </div>
              ))}
            </div>
            {/* Progress bar */}
            <div style={{ padding: '12px 22px 18px' }}>
              <div style={{ height: 8, background: '#f0e3bd', borderRadius: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: done ? 'linear-gradient(90deg,#389e0d,#52c41a)' : 'linear-gradient(90deg,#b8860b,#e0a92e)', borderRadius: 5, animationName: 'distrib-fill', animationDuration: `${runDur}ms`, animationTimingFunction: 'linear', animationFillMode: 'forwards', transition: 'background .4s' }} />
              </div>
            </div>
            {/* Bağla düyməsi — yalnız uğur mesajından sonra */}
            {done && (
              <div style={{ padding: '0 22px 20px' }}>
                <button onClick={() => setRunning(false)}
                  style={{ width: '100%', padding: '11px 16px', borderRadius: 10, border: 'none', background: '#52c41a', color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 4px 14px #52c41a44' }}>
                  ✓ Bağla və nəticəyə bax
                </button>
              </div>
            )}
          </div>
          <style>{`@keyframes distrib-spin { to { transform: rotate(360deg) } } @keyframes distrib-fill { from { width: 0% } to { width: 100% } }`}</style>
        </div>
        )
      })()}

      {/* ── Metod seçimi (method === null) ── */}
      {!method && sel && tree && (() => {
        const leaves = getLeavesWithPath(tree?.nodes || [])
        const totalQuota = leaves.reduce((s: number, {leaf}: any) => s + (leaf.quota || 0), 0)
        const zeroQuotaCount = leaves.filter(({leaf}: any) => !leaf.quota).length
        const submRatio = allInstUsers.length > 0 ? submittedUsers.length / allInstUsers.length : 0
        const checks = [
          { ok: leaves.length > 0,                   warn: false, label: 'İxtisas ağacı',     detail: leaves.length > 0 ? `${leaves.length} ixtisas` : 'Ağac tapılmadı' },
          { ok: totalQuota > 0 && zeroQuotaCount === 0, warn: totalQuota > 0 && zeroQuotaCount > 0, label: 'Kvotalar',         detail: zeroQuotaCount > 0 ? `${zeroQuotaCount} ixtisasın kvotası sıfırdır` : `Ümumi: ${totalQuota}` },
          { ok: submittedUsers.length > 0,            warn: false, label: 'Seçimlər',          detail: `${submittedUsers.length} / ${allInstUsers.length} təhsilalan` },
          ...(submRatio < 0.5 && submittedUsers.length > 0 ? [{ ok: false, warn: true, label: 'Aşağı iştirak', detail: `Yalnız ${Math.round(submRatio*100)}% seçim etdi` }] : []),
          ...(totalQuota < submittedUsers.length ? [{ ok: true, warn: true, label: 'Kvota çatışmır', detail: `${submittedUsers.length - totalQuota} təhsilalan yerləşdirilə bilməyə bilər` }] : []),
        ]
        const hasBlock = checks.some(c => !c.ok && !c.warn)
        return (
        <>
        {/* ── Validasiya Paneli ── */}
        <div style={{ background: hasBlock ? '#fff5f5' : '#f8faff', border: `1.5px solid ${hasBlock ? '#ff4d4f44' : '#52c41a33'}`, borderRadius: 14, padding: '12px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: '#8a909c', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>🔍 Sistem Yoxlaması</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {checks.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 8, background: c.ok && !c.warn ? '#f0fff4' : c.warn ? '#fffbe6' : '#fff0f0', border: `1px solid ${c.ok && !c.warn ? '#52c41a33' : c.warn ? '#faad1433' : '#ff4d4f33'}` }}>
                <span style={{ fontSize: 12 }}>{c.ok && !c.warn ? '✅' : c.warn ? '⚠️' : '❌'}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: c.ok && !c.warn ? '#237804' : c.warn ? '#d46b08' : '#cf1322' }}>{c.label}</div>
                  <div style={{ fontSize: 10, color: '#8892b0' }}>{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alqoritm: Greedy sabit işləyir, toggle gizlidir */}

        <div style={{
          background: '#ffffff', border: '1.5px solid #e7eaf0',
          borderRadius: 16, padding: '32px 28px', marginBottom: 20,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>⚖️</div>
          <div style={{ color: '#2b2f3a', fontWeight: 800, fontSize: 18, marginBottom: 6 }}>
            Yerləşdirmə üsulunu seçin
          </div>
          <div style={{ color: '#8a909c', fontSize: 13, marginBottom: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <InstIcon icon={activeInst?.icon} size={14} />
            {activeInst?.label} · {submittedUsers.length} təhsilalan seçim etdi
          </div>

          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* Sadə üsul */}
            {(() => { const okS = can('dist.simple'); return (
            <div
              onClick={() => okS && setMethod('simple')}
              title={okS ? '' : 'Sadə üsulla yazma icazəniz yoxdur'}
              style={{
                width: 220, background: '#ffffff', border: '1.5px solid #e7eaf0',
                borderRadius: 16, padding: '28px 20px', cursor: okS ? 'pointer' : 'not-allowed',
                transition: 'all .2s', textAlign: 'center', opacity: okS ? 1 : 0.55,
              }}
              onMouseEnter={e => { if (!okS) return; (e.currentTarget as HTMLElement).style.background = '#c9962a22'; (e.currentTarget as HTMLElement).style.borderColor = '#c9962a' }}
              onMouseLeave={e => { if (!okS) return; (e.currentTarget as HTMLElement).style.background = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e7eaf0' }}
            >
              <div style={{ fontSize: 40, marginBottom: 14 }}>📋</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#2b2f3a', marginBottom: 8 }}>Sadə üsul</div>
              <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.6 }}>
                Bütün təhsilalanlar eyni anda bala görə ixtisaslara yerləşdirilir
              </div>
              <div style={{ marginTop: 18, display: 'inline-block', padding: '8px 20px', borderRadius: 8, background: okS ? '#c9962a' : '#c2c7d6', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                {okS ? 'Seç →' : '🔒 İcazə yoxdur'}
              </div>
            </div>
            )})()}

            {/* Paket üsulu */}
            {(() => { const okP = can('dist.packet'); return (
            <div
              onClick={() => okP && setMethod('packet')}
              title={okP ? '' : 'Paket üsulu ilə yazma icazəniz yoxdur'}
              style={{
                width: 220, background: '#ffffff', border: '1.5px solid #e7eaf0',
                borderRadius: 16, padding: '28px 20px', cursor: okP ? 'pointer' : 'not-allowed',
                transition: 'all .2s', textAlign: 'center', opacity: okP ? 1 : 0.55,
              }}
              onMouseEnter={e => { if (!okP) return; (e.currentTarget as HTMLElement).style.background = '#f5a62322'; (e.currentTarget as HTMLElement).style.borderColor = '#f5a623' }}
              onMouseLeave={e => { if (!okP) return; (e.currentTarget as HTMLElement).style.background = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e7eaf0' }}
            >
              <div style={{ fontSize: 40, marginBottom: 14 }}>📦</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#2b2f3a', marginBottom: 8 }}>Paket üsulu</div>
              <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.6 }}>
                Təhsilalanlar bala görə paketlərə bölünür, hər paket ayrıca idarə edilir
              </div>
              <div style={{ marginTop: 18, display: 'inline-block', padding: '8px 20px', borderRadius: 8, background: okP ? '#f5a623' : '#c2c7d6', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                {okP ? 'Seç →' : '🔒 İcazə yoxdur'}
              </div>
            </div>
            )})()}
          </div>
        </div>
        </>
        )
      })()}

      {/* ── Aktiv seçim yoxdur ── */}
      {!method && (!sel || !tree) && (
        <div style={{ background: '#fff', border: '1.5px dashed #d0d8f0', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 42, marginBottom: 12 }}>📭</div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', marginBottom: 6, display:'inline-flex', alignItems:'center', gap:6 }}>
            <InstIcon icon={activeInst?.icon} size={16} /> {activeInst?.label} üçün aktiv seçim tapılmadı
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Yerləşdirmə üçün bu müəssisəyə aid seçim yayımlanmalıdır
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          SADƏ ÜSUL
          ════════════════════════════════════════ */}
      {method === 'simple' && (
        <>
          <div style={{ background: '#ffffff', border: '1.5px solid #e7eaf0', borderRadius: 14, padding: '12px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: '#2b2f3a', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📋</span> Sadə Üsul
                <span style={{ fontSize: 13, color: '#8a909c', fontWeight: 500, display:'inline-flex', alignItems:'center', gap:5 }}>— <InstIcon icon={activeInst?.icon} size={14} /> {activeInst?.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fullReset}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #e7eaf0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  ← Geri
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 13, color: '#8892b0', display:'flex', alignItems:'center', gap:8 }}>
                <span>{submittedUsers.length} təhsilalan</span>
                {mode === 'sim'        && <span style={{ color: '#f5a623', fontWeight: 600 }}>— Simulyasiya</span>}
                {mode === 'distribute' && !saved && <span style={{ color: '#52c41a', fontWeight: 600 }}>— Yerləşdirmə hazır</span>}
                {saved && <span style={{ color: '#52c41a', fontWeight: 700 }}>✅ Bazaya yazıldı</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStoryOpen(true)} disabled={submittedUsers.length === 0}
                  title="Addım-addım, izahlı simulyasiya — texniki bilməyənlər üçün"
                  style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e0a92e', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                    background: '#e0a92e', color: '#fff',
                    opacity: submittedUsers.length === 0 ? 0.4 : 1 }}>
                  📖 İzahlı simulyasiya
                </button>
                <button onClick={handleDistribute} disabled={submittedUsers.length === 0 || saved || running}
                  style={{ padding: '10px 22px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                    border: `1.5px solid ${mode === 'distribute' ? '#52c41a' : '#e0e4f0'}`,
                    background: mode === 'distribute' ? '#52c41a' : '#e7eaf0',
                    color: mode === 'distribute' ? '#fff' : '#8892b0',
                    opacity: (submittedUsers.length === 0 || saved) ? 0.4 : 1,
                    boxShadow: mode === 'distribute' ? '0 4px 16px #52c41a44' : 'none' }}>
                  📋 Yerləşdir
                </button>
              </div>
            </div>
          </div>

          {storyOpen && tree && (
            <StorySim students={submittedUsers} subs={sels} tree={tree} poolUsers={allInstUsers} preAssignLevel={sel?.preAssignLevel ?? null} finalAssignments={placement?.assignments} onClose={() => setStoryOpen(false)} />
          )}

          {/* Nəticə — Simulyasiya animasiyalı, Yerləşdir adi */}
          {mode === 'distribute' && placement && <PlacementResult
            mode={mode} saved={saved} placement={placement}
            submittedUsers={submittedUsers} studentRows={studentRows}
            placedCount={placedCount} unplacedCount={unplacedCount}
            statusFlt={statusFlt} setStatusFlt={setStatusFlt}
            scoreMin={scoreMin} setScoreMin={setScoreMin}
            scoreMax={scoreMax} setScoreMax={setScoreMax}
            nameQ={nameQ} setNameQ={setNameQ}
            onExport={exportExcel}
            onSave={() => setShowConf(true)}
          />}
        </>
      )}

      {/* ════════════════════════════════════════
          PAKET ÜSULU
          ════════════════════════════════════════ */}
      {method === 'packet' && (
        <>
          {/* Panel */}
          <div style={{ background: '#ffffff', border: '1.5px solid #e7eaf0', borderRadius: 14, padding: '12px 18px', marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: '#2b2f3a', fontWeight: 800, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📦</span> Paket Üsulu
                <span style={{ fontSize: 13, color: '#8a909c', fontWeight: 500, display:'inline-flex', alignItems:'center', gap:5 }}>— <InstIcon icon={activeInst?.icon} size={14} /> {activeInst?.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fullReset}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #e7eaf0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  ← Geri
                </button>
              </div>
            </div>

            {/* Xəbərdarlıq — seçim yoxdur */}
            {submittedUsers.length === 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                background: '#ff4d4f18', border: '1.5px solid #ff4d4f55',
                borderRadius: 10, padding: '10px 16px', marginBottom: 14,
                fontSize: 13, color: '#cf1322',
              }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                <span>Təhsilalanlar hələ seçim etməyib — <strong>simulyasiya mümkün deyil</strong>. Paketlərə bölmək olar, lakin simulyasiya başlatmaq olmaz.</span>
              </div>
            )}

            {/* Paket sayı seçici */}
            {!packetsReady && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ color: '#8892b0', fontSize: 13 }}>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{allInstUsers.length}</span>
                    <span style={{ color: '#8892b0' }}> təhsilalan · Neçə paketə bölünsün?</span>
                  </div>
                  <input
                    type="number" min={2} max={maxPackets}
                    value={packetCount}
                    onChange={e => {
                      const v = parseInt(e.target.value)
                      if (!isNaN(v) && v >= 2 && v <= maxPackets) setPacketCount(v)
                    }}
                    style={{
                      width: 80, padding: '8px 12px', borderRadius: 9,
                      border: '1.5px solid #f5a623',
                      background: '#fff',
                      color: '#2b2f3a',
                      fontWeight: 800, fontSize: 18,
                      textAlign: 'center', outline: 'none',
                    }}
                  />
                  <button onClick={createPackets} disabled={allInstUsers.length === 0}
                    style={{ padding: '10px 24px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13, background: '#f5a623', color: '#fff', boxShadow: '0 4px 16px #f5a62344', opacity: allInstUsers.length === 0 ? 0.4 : 1 }}>
                    📦 Paket Yarat
                  </button>
                </div>
                {/* Maks paket məhdudiyyəti */}
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  background: '#ffffff0a', border: '1px solid #3a4060',
                  borderRadius: 8, padding: '7px 14px', alignSelf: 'flex-start',
                  fontSize: 12, color: '#8892b0',
                }}>
                  <span style={{ color: '#f5a623' }}>⚠️</span>
                  Maks. paket sayı:
                  <span style={{ color: '#fff', fontWeight: 800 }}>{maxPackets}</span>
                  <span style={{ color: '#3a4060' }}>·</span>
                  Ən az kvotalı ixtisas:
                  <span style={{ color: '#f5a623', fontWeight: 700 }}>«{minLeafName}»</span>
                  <span style={{ color: '#3a4060' }}>(kvota: {minQuota})</span>
                </div>
              </div>
            )}

            {/* Paketlər yarandıqdan sonra yerləşdir düymələri */}
            {packetsReady && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#8892b0' }}>
                  {packets.length} paket · {submittedUsers.length} təhsilalan
                  {mode === 'sim'       && <span style={{ marginLeft: 10, color: '#f5a623', fontWeight: 600 }}>— Simulyasiya</span>}
                  {mode === 'distribute' && !saved && <span style={{ marginLeft: 10, color: '#52c41a', fontWeight: 600 }}>— Yerləşdirmə hazır</span>}
                  {saved && <span style={{ marginLeft: 10, color: '#52c41a', fontWeight: 700 }}>✅ Bazaya yazıldı</span>}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setStoryOpen(true)} disabled={submittedUsers.length === 0}
                    title="Addım-addım, izahlı simulyasiya (paket-paket)"
                    style={{ padding: '10px 20px', borderRadius: 10, border: '1.5px solid #e0a92e', fontWeight: 800, fontSize: 13,
                      cursor: submittedUsers.length === 0 ? 'not-allowed' : 'pointer', background: '#e0a92e', color: '#fff',
                      opacity: submittedUsers.length === 0 ? 0.4 : 1 }}>
                    📖 İzahlı simulyasiya
                  </button>
                  <button onClick={handleDistribute} disabled={saved || running}
                    style={{ padding: '10px 22px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                      border: `1.5px solid ${mode === 'distribute' ? '#52c41a' : '#e0e4f0'}`,
                      background: mode === 'distribute' ? '#52c41a' : '#e7eaf0',
                      color: mode === 'distribute' ? '#fff' : '#8892b0',
                      opacity: saved ? 0.4 : 1,
                      boxShadow: mode === 'distribute' ? '0 4px 16px #52c41a44' : 'none' }}>
                    📋 Yerləşdir
                  </button>
                </div>
              </div>
            )}
          </div>

          {storyOpen && tree && (
            <StorySim packets={packets} subs={sels} tree={tree} poolUsers={allInstUsers} preAssignLevel={sel?.preAssignLevel ?? null} onClose={() => setStoryOpen(false)} />
          )}

          {/* SimControls — simulyasiya rejimində paketlərin üstündə */}
          {/* Paket kartları — animasiyalı */}
          {packetsReady && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
              {packets.map((p, i) => {
                const col     = PACK_COLORS[i % PACK_COLORS.length]
                const visible = i < animStep
                return (
                  <div
                    key={p.num}
                    onClick={() => { if (visible) { setSelectedPacket({ ...p, col }); setModalTab('students') } }}
                    style={{
                      borderRadius: 16, overflow: 'hidden',
                      boxShadow: `0 8px 24px ${col.shadow}`,
                      opacity:    visible ? 1 : 0,
                      transform:  visible ? 'translateY(0) scale(1)' : 'translateY(24px) scale(0.95)',
                      transition: `opacity .35s ease ${i * 0.05}s, transform .35s ease ${i * 0.05}s`,
                      cursor: visible ? 'pointer' : 'default',
                    }}
                    onMouseEnter={e => { if (visible) (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px) scale(1.02)' }}
                    onMouseLeave={e => { if (visible) (e.currentTarget as HTMLElement).style.transform = 'translateY(0) scale(1)' }}
                  >
                    {/* Kart başlığı */}
                    <div style={{ background: col.bg, padding: '18px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff99', textTransform: 'uppercase', letterSpacing: 1 }}>
                          Paket
                        </span>
                        <span style={{ fontSize: 28, fontWeight: 900, color: '#fff' }}>{p.num}</span>
                      </div>
                      <div style={{ fontSize: 26, fontWeight: 900, color: '#fff', marginTop: 6 }}>
                        {p.count}
                        <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6, opacity: 0.8 }}>təhsilalan</span>
                      </div>
                    </div>
                    {/* Kart gövdəsi */}
                    <div style={{ background: col.light, padding: '14px 20px', borderTop: `2px solid ${col.text}22` }}>
                      <div style={{ fontSize: 11, color: col.text, fontWeight: 600, marginBottom: 2 }}>Bal aralığı</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: col.text, marginBottom: 8 }}>
                        {p.minScore.toFixed(1)} – {p.maxScore.toFixed(1)}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 11, color: col.text, opacity: 0.8 }}>
                          📚 Kvota payı: <strong>{p.totalQuota}</strong>
                        </span>
                        <span style={{ fontSize: 11, color: col.text, opacity: 0.8 }}>
                          🎓 {p.specs?.length} ixtisas
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: col.text, opacity: 0.65, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span>👁</span> Ətraflı bax
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}


          {/* Nəticə — Yerləşdir adi, Simulyasiya paket animasiyalı */}
          {mode === 'distribute' && placement && <div ref={resultRef}><PlacementResult
            mode={mode} saved={saved} placement={placement}
            submittedUsers={submittedUsers} studentRows={studentRows}
            placedCount={placedCount} unplacedCount={unplacedCount}
            statusFlt={statusFlt} setStatusFlt={setStatusFlt}
            scoreMin={scoreMin} setScoreMin={setScoreMin}
            scoreMax={scoreMax} setScoreMax={setScoreMax}
            nameQ={nameQ} setNameQ={setNameQ}
            onExport={exportExcel}
            onSave={() => setShowConf(true)}
          /></div>}

        </>
      )}
      </div>
    </>
  )
}


// ── Nəticə cədvəli komponenti ─────────────────────────────────────────────────
function PlacementResult({ mode, saved, placement, submittedUsers, studentRows,
  placedCount, unplacedCount, statusFlt, setStatusFlt, scoreMin, setScoreMin,
  scoreMax, setScoreMax, nameQ, setNameQ, onExport, onSave }: any) {

  const hasSrc = submittedUsers.some((u: any) => u.source)

  // ── İxtisas kvota dolulluğu ─────────────────────────────────────────────
  const quotas  = placement?.quotas  || {}
  const placedQ = placement?.placed  || {}
  const pathMap = placement?.pathMap || {}

  const specSource: Record<string, { mülki: number; lisey: number; other: number }> = {}
  for (const [uid, asgn] of Object.entries(placement?.assignments || {}) as any) {
    const sid  = (asgn as any).specId
    const user = submittedUsers.find((u: any) => u.id === uid)
    if (!specSource[sid]) specSource[sid] = { mülki: 0, lisey: 0, other: 0 }
    if (user?.source === 'mülki')      specSource[sid].mülki++
    else if (user?.source === 'lisey') specSource[sid].lisey++
    else                               specSource[sid].other++
  }

  const specStats = Object.entries(quotas).map(([sid, q]: [string, any]) => {
    const quota   = q as number
    const cnt     = (placedQ[sid] || 0) as number
    const empty   = quota - cnt
    const fillPct = quota > 0 ? Math.round(cnt / quota * 100) : 0
    const path    = pathMap[sid] || []
    const name    = path.length ? path[path.length - 1].name : sid
    const pathStr = path.slice(0, -1).map((n: any) => n.name).join(' › ')
    const src     = specSource[sid] || { mülki: 0, lisey: 0, other: 0 }
    return { sid, quota, cnt, empty, fillPct, name, pathStr, ...src }
  }).sort((a, b) => b.cnt - a.cnt)

  const totQuota     = specStats.reduce((s, r) => s + r.quota, 0)
  const totFilled    = specStats.reduce((s, r) => s + r.cnt, 0)
  const totEmpty     = specStats.reduce((s, r) => s + r.empty, 0)
  const totMülkiSpec = specStats.reduce((s, r) => s + r.mülki, 0)
  const totLiseySpec = specStats.reduce((s, r) => s + r.lisey, 0)

  return (
    <>
      {/* ════ YERLƏŞDİRMƏ HESABATI ════ (gizlədilib — statistika Statistika səhifəsindədir) */}
      {false && placement && (() => {
        const rows = (placement as any)
        const totalSub = submittedUsers.length
        const totalPlaced = placedCount
        const totalUnplaced = unplacedCount
        const placedPct = totalSub > 0 ? Math.round(totalPlaced / totalSub * 100) : 0
        // Seçim sırası bölgüsü
        const choiceDist: Record<number, number> = {}
        for (const asgn of Object.values(rows.assignments || {}) as any[]) {
          const c = asgn.choiceNum || 0
          choiceDist[c] = (choiceDist[c] || 0) + 1
        }
        const firstChoice  = choiceDist[1] || 0
        const secondChoice = choiceDist[2] || 0
        const thirdPlus    = totalPlaced - firstChoice - secondChoice
        const avgChoice    = totalPlaced > 0
          ? Object.entries(choiceDist).reduce((s, [k, v]) => s + Number(k) * v, 0) / totalPlaced : 0
        // Kvota dolulluq xülasəsi
        const specStatQ = specStats
        const fullSpecs  = specStatQ.filter((r: any) => r.fillPct >= 100).length
        const emptySpecs = specStatQ.filter((r: any) => r.cnt === 0).length
        return (
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-head">
              <div className="card-title">📊 Yerləşdirmə Hesabatı</div>
              <div className="card-sub">{mode === 'sim' ? 'Simulyasiya nəticəsi · Bazaya yazılmayıb' : 'Yerləşdirmə nəticəsi'}</div>
            </div>
            <div className="card-body">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10, marginBottom:16 }}>
                {[
                  { label:'Seçim edib',       val:`${totalSub}`,                  color:'#c9962a',  bg:'#fbf1d6' },
                  { label:'Yerləşdirilib',     val:`${totalPlaced} (${placedPct}%)`, color:'#52c41a', bg:'#f0fff4' },
                  { label:'Yerləşdirilməyib', val:`${totalUnplaced}`,              color: totalUnplaced > 0 ? '#ff4d4f' : '#52c41a', bg: totalUnplaced > 0 ? '#fff0f0' : '#f0fff4' },
                  { label:'Orta seçim sırası', val: avgChoice > 0 ? avgChoice.toFixed(2) : '—', color:'#722ed1', bg:'#f9f0ff' },
                ].map(s => (
                  <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:'12px 14px' }}>
                    <div style={{ fontSize:10, color:'#8892b0', fontWeight:700, marginBottom:4 }}>{s.label}</div>
                    <div style={{ fontSize:20, fontWeight:900, color:s.color }}>{s.val}</div>
                  </div>
                ))}
              </div>
              {/* Seçim sırası breakdown */}
              {totalPlaced > 0 && (
                <div style={{ marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#8a909c', marginBottom:8 }}>SEÇİM SIRASI BÖLGÜSÜ</div>
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                    {[
                      { label:'1-ci seçim', count: firstChoice,  color:'#52c41a', bg:'#f0fff4' },
                      { label:'2-ci seçim', count: secondChoice, color:'#c9962a', bg:'#fbf1d6' },
                      { label:'3+ seçim',   count: thirdPlus,    color:'#f5a623', bg:'#fff8e6' },
                    ].filter(x => x.count > 0).map(x => (
                      <div key={x.label} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 14px', borderRadius:9, background:x.bg }}>
                        <span style={{ fontSize:16, fontWeight:900, color:x.color }}>{x.count}</span>
                        <span style={{ fontSize:11, color:'#8a909c' }}>{x.label} <span style={{ color:x.color, fontWeight:700 }}>({Math.round(x.count/totalPlaced*100)}%)</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Kvota summary */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                {[
                  { label:`${fullSpecs} ixtisas tam dolu`,  color:'#52c41a', icon:'✅' },
                  ...(emptySpecs > 0 ? [{ label:`${emptySpecs} ixtisas boş qaldı`, color:'#ff4d4f', icon:'⚠️' }] : []),
                  { label:`${specStatQ.length} ixtisas cəmi`, color:'#c9962a', icon:'📚' },
                ].map(x => (
                  <span key={x.label} style={{ padding:'4px 12px', borderRadius:6, background:'#f4f7ff', fontSize:11, fontWeight:700, color:x.color }}>
                    {x.icon} {x.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════ İXTİSAS KVOTA DOLULLUĞU ════ (gizlədilib — statistika Statistika səhifəsindədir) */}
      {false && specStats.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-head">
            <div>
              <div className="card-title">📚 İxtisas Kvota Dolulluğu</div>
              <div className="card-sub">
                {specStats.length} ixtisas · Ümumi kvota: {totQuota} · Dolu: {totFilled} · Boş: {totEmpty}
                {hasSrc ? ` · Mülki: ${totMülkiSpec} · Lisey: ${totLiseySpec}` : ''}
              </div>
            </div>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            {/* Başlıq sətri */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: hasSrc ? '28px 1fr 60px 60px 50px 60px 60px 140px' : '28px 1fr 60px 60px 50px 140px',
              gap: 8, padding: '8px 16px',
              background: '#f4f7ff', borderBottom: '2px solid #e8ecff',
              fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: 0.5,
            }}>
              <span>№</span>
              <span>İXTİSAS</span>
              <span style={{ textAlign: 'center' }}>KVOTA</span>
              <span style={{ textAlign: 'center' }}>DOLU</span>
              <span style={{ textAlign: 'center' }}>BOŞ</span>
              {hasSrc && <><span style={{ textAlign: 'center', color: '#1677ff' }}>MÜLKİ</span><span style={{ textAlign: 'center', color: '#531dab' }}>LİSEY</span></>}
              <span style={{ textAlign: 'center' }}>DOLULLUQ</span>
            </div>

            {specStats.map((r, i) => {
              const mPct  = r.cnt > 0 ? r.mülki / r.cnt * 100 : 0
              const lPct  = r.cnt > 0 ? r.lisey / r.cnt * 100 : 0
              const fillColor = r.fillPct >= 90 ? '#52c41a' : r.fillPct >= 60 ? '#c9962a' : r.fillPct >= 30 ? '#fa8c16' : '#ff4d4f'
              return (
                <div key={r.sid} style={{
                  display: 'grid',
                  gridTemplateColumns: hasSrc ? '28px 1fr 60px 60px 50px 60px 60px 140px' : '28px 1fr 60px 60px 50px 140px',
                  gap: 8, padding: '9px 16px',
                  borderBottom: i < specStats.length - 1 ? '1px solid #f0f2fa' : 'none',
                  background: i % 2 === 0 ? '#fff' : '#fafbff',
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12, color: 'var(--text)' }}>{r.name}</div>
                    {r.pathStr && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{r.pathStr}</div>}
                  </div>
                  <span style={{ textAlign: 'center', fontWeight: 800, fontSize: 13, color: 'var(--text)' }}>{r.quota}</span>
                  <span style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: r.cnt > 0 ? '#52c41a' : 'var(--muted)' }}>{r.cnt}</span>
                  <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 13, color: r.empty > 0 ? '#d46b08' : 'var(--muted)' }}>
                    {r.empty > 0 ? r.empty : <span style={{ color: '#52c41a' }}>—</span>}
                  </span>
                  {hasSrc && (
                    <>
                      <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: '#1677ff' }}>{r.mülki || '—'}</span>
                      <span style={{ textAlign: 'center', fontWeight: 700, fontSize: 12, color: '#531dab' }}>{r.lisey || '—'}</span>
                    </>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div style={{ height: 6, borderRadius: 3, background: '#f0f2fa', overflow: 'hidden', display: 'flex' }}>
                      {hasSrc && r.cnt > 0
                        ? <>
                            <div style={{ width: `${mPct}%`, background: 'linear-gradient(90deg,#c9962a,#9a7b1e)' }} />
                            <div style={{ width: `${lPct}%`, background: 'linear-gradient(90deg,#722ed1,#b37feb)' }} />
                          </>
                        : <div style={{ width: `${r.fillPct}%`, background: fillColor, borderRadius: 3 }} />
                      }
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 800, color: fillColor, textAlign: 'center' }}>{r.fillPct}%</span>
                  </div>
                </div>
              )
            })}

            {/* Cəmi sətri */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: hasSrc ? '28px 1fr 60px 60px 50px 60px 60px 140px' : '28px 1fr 60px 60px 50px 140px',
              gap: 8, padding: '10px 16px',
              background: 'linear-gradient(135deg,#f0f4ff,#f4f0ff)',
              borderTop: '2px solid #f3e3b8',
              alignItems: 'center',
            }}>
              <span />
              <span style={{ fontWeight: 800, fontSize: 12, color: '#e0e4f0' }}>Ümumi cəm</span>
              <span style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: 'var(--text)' }}>{totQuota}</span>
              <span style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: '#52c41a' }}>{totFilled}</span>
              <span style={{ textAlign: 'center', fontWeight: 900, fontSize: 14, color: totEmpty > 0 ? '#d46b08' : 'var(--muted)' }}>{totEmpty}</span>
              {hasSrc && (
                <>
                  <span style={{ textAlign: 'center', fontWeight: 900, fontSize: 13, color: '#1677ff' }}>{totMülkiSpec}</span>
                  <span style={{ textAlign: 'center', fontWeight: 900, fontSize: 13, color: '#531dab' }}>{totLiseySpec}</span>
                </>
              )}
              <div style={{ height: 6, borderRadius: 3, background: '#f0f2fa', overflow: 'hidden', display: 'flex' }}>
                {hasSrc && totFilled > 0
                  ? <>
                      <div style={{ width: `${totFilled > 0 ? totMülkiSpec/totFilled*100 : 0}%`, background: 'linear-gradient(90deg,#c9962a,#9a7b1e)' }} />
                      <div style={{ width: `${totFilled > 0 ? totLiseySpec/totFilled*100 : 0}%`, background: 'linear-gradient(90deg,#722ed1,#b37feb)' }} />
                    </>
                  : <div style={{ width: `${totQuota > 0 ? totFilled/totQuota*100 : 0}%`, background: '#52c41a' }} />
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Cədvəl */}
      <div className="card" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', marginBottom: 0 }}>
        <div className="card-head" style={{ padding: '10px 18px', flexShrink: 0 }}>
          <div>
            <div className="card-title" style={{ fontSize: 14 }}>{mode === 'sim' ? '👁 Simulyasiya Nəticəsi' : '📋 Yerləşdirmə Nəticəsi'}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 3, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ color: '#8a909c' }}>{studentRows.length} nəticə</span>
              <span style={{ color: '#8a909c' }}>·</span>
              <span style={{ color: '#237804' }}>{placedCount} yerləşdirilib</span>
              <span style={{ color: '#8a909c' }}>·</span>
              <span style={{ color: unplacedCount > 0 ? '#cf1322' : '#8a909c' }}>{unplacedCount} yerləşdirilməyib</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'distribute' && !saved && (
              <button onClick={onSave} style={{ padding: '7px 16px', borderRadius: 9, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#52c41a,#237804)', color: '#fff', fontWeight: 800, fontSize: 12, boxShadow: '0 3px 12px #52c41a44' }}>
                💾 Bazaya Yaz
              </button>
            )}
            {saved && <span style={{ background: '#f0fff4', border: '1.5px solid #52c41a66', borderRadius: 9, padding: '6px 14px', fontSize: 12, color: '#237804', fontWeight: 800 }}>✅ Bazaya yazıldı</span>}
            <button onClick={onExport} style={{ padding: '7px 14px', borderRadius: 9, border: 'none', background: '#1d6f42', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>📥 Excel</button>
          </div>
        </div>

        <div className="search-row" style={{ padding: '8px 18px', flexShrink: 0 }}>
          <input className="search-input" placeholder="🔍  Ad və ya FİN..." value={nameQ} onChange={e => setNameQ(e.target.value)} />
          <select className="filter-select" value={statusFlt} onChange={e => setStatusFlt(e.target.value)}>
            <option value="all">Bütün statuslar</option>
            <option value="placed">Yerləşdirilib</option>
            <option value="unplaced">Yerləşdirilməyib</option>
          </select>
          <input className="search-input" style={{ width: 110 }} placeholder="Min. bal" type="number" value={scoreMin} onChange={e => setScoreMin(e.target.value)} />
          <input className="search-input" style={{ width: 110 }} placeholder="Maks. bal" type="number" value={scoreMax} onChange={e => setScoreMax(e.target.value)} />
        </div>

        <div className="card-body" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
          <table style={{ minWidth: 820 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f8f9fd' }}>
              <tr>
                <th style={{ width: 44 }}>№</th>
                <th>TƏHSİLALAN</th>
                <th style={{ width: 90 }}>BAL</th>
                <th style={{ width: 140 }}>STATUS</th>
                <th>YERLƏŞDİYİ İXTİSAS</th>
                <th style={{ width: 80, textAlign: 'center' }}>SEÇİM №</th>
              </tr>
            </thead>
            <tbody>
              {studentRows.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 13 }}>Nəticə tapılmadı</td></tr>
              )}
              {studentRows.map((r: any, i: number) => (
                <tr key={r.user.id}>
                  <td style={{ color: 'var(--muted)', fontWeight: 700, textAlign: 'center' }}>{i + 1}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 9, background: '#eef1ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>👤</div>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{r.user.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'monospace' }}>{r.user.fin || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 20, background: '#e8f4ff', color: 'var(--blue)', fontWeight: 800, fontSize: 13 }}>
                      {Number(r.user.score).toFixed(2)}
                    </span>
                  </td>
                  <td>
                    {r.assignment
                      ? <span className="badge badge-green">✅ Yerləşdirilib</span>
                      : <span className="badge badge-gray">❌ Yerləşdirilməyib</span>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.path.length > 0
                      ? r.path.map((n: any, pi: number) => (
                        <span key={n.id}>
                          {pi > 0 && <span style={{ color: '#ccc', margin: '0 4px' }}>→</span>}
                          <span style={{ color: pi === r.path.length - 1 ? 'var(--blue)' : 'var(--text)', fontWeight: pi === r.path.length - 1 ? 700 : 400 }}>{n.name}</span>
                        </span>
                      ))
                      : <span style={{ color: '#ccc' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'center', fontWeight: 700, color: 'var(--blue)' }}>
                    {r.assignment?.choiceNum || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>
    </>
  )
}
