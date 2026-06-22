import { useState, useMemo, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { userDb, submissionDb, selectionDb, treeDb, institutionDb, useLocalState, addLog } from '../../db'
import InstIcon from '../../components/InstIcon'
import { can } from '../../permissions'

// ── Tiebreaker: kursantı sıralamaq üçün bal massivi ──────────────────────────
const UMUMI_KEY = 'Ümumi imtahan nəticəsi'

function getTiebreakerSubjects(specId: string, userGroup: string | null, pathMap: Record<string, any[]>): string[] {
  const path = pathMap[specId] || []
  // Yarpaqdan kökə qədər tiebreaker axtarırıq
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i]
    if (node.groupTiebreakers && userGroup && node.groupTiebreakers[String(userGroup)]) {
      return node.groupTiebreakers[String(userGroup)]
    }
    if (node.tiebreaker?.length) return node.tiebreaker
  }
  return []
}

function studentSortScore(user: any, tiebreakers: string[]): number[] {
  const primary = user.score || 0
  const extras  = tiebreakers.map(subj => {
    if (subj === UMUMI_KEY) return user.score || 0
    return (user.subjects?.[subj] ?? -1)
  })
  return [primary, ...extras]
}

function compareStudents(a: any, b: any, tiebreakers: string[]): number {
  const sa = studentSortScore(a, tiebreakers)
  const sb = studentSortScore(b, tiebreakers)
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const diff = (sb[i] ?? -1) - (sa[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}

// ── Yarpaqları əcdad zənciri ilə topla ────────────────────────────────────────
function getLeavesWithPath(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeavesWithPath(n.children, [...anc, n]))
  }
  return res
}

// ── Cinsə görə məhdudiyyət köməkçiləri (leaf node-da allowFemale/allowMale/maxFemale/maxMale) ──
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

// ── Yenidən-tarazlama (balı qoruyan): boş yer + yerləşməyən eyni anda qalmasın ──
// Greedy nəticəsi saxlanılır (bal ədaləti), üstündən cins-qapılı MAX-AXIN (max-flow)
// tətbiq olunur. Greedy yerləşdirmələri başlanğıc axın kimi qoyulur; yalnız yerləşməyənlər
// üçün artırıcı yollar axtarılır. Beləcə kvotanı aşmadan, cins məhdudiyyətlərini pozmadan
// mümkün olan maksimum kursant yerləşir və boş yer kənarda qalanla yanaşı qalmır.
function rebalanceUnplaced(opts: {
  users: any[]; subs: any[];
  leafById: Record<string, any>;
  quotas: Record<string, number>;
  pathMap: Record<string, any[]>;
  placed: Record<string, number>;
  femP: Record<string, number>;
  malP: Record<string, number>;
  assignments: Record<string, { specId: string; choiceNum: number }>;
}) {
  const { users, subs, leafById, quotas, placed, femP, malP, assignments } = opts
  const specs = Object.keys(quotas)
  const hasEmpty = specs.some(sid => (quotas[sid] || 0) - (placed[sid] || 0) > 0)
  const hasUnplaced = users.some(u => !assignments[u.id])
  if (!hasEmpty || !hasUnplaced) return  // boş yer və ya yerləşməyən yoxdursa, iş yoxdur

  const rankingOf = (uid: string): string[] => subs.find((s: any) => s.userId === uid)?.ranking || []

  // ── Şəbəkə qur: S=0, T=1, sonra kursant / femGate / malGate / spec node-ları ──
  let n = 2; const S = 0, T = 1
  const uNode: Record<string, number> = {}, fg: Record<string, number> = {}, mg: Record<string, number> = {}, sp: Record<string, number> = {}
  for (const u of users) uNode[u.id] = n++
  for (const sid of specs) { fg[sid] = n++; mg[sid] = n++; sp[sid] = n++ }
  const cap: Array<Record<number, number>> = Array.from({ length: n }, () => ({}))
  const adj: number[][] = Array.from({ length: n }, () => [])
  const addEdge = (a: number, b: number, c: number) => {
    if (cap[a][b] === undefined) { adj[a].push(b); cap[a][b] = 0 }
    if (cap[b][a] === undefined) { adj[b].push(a); cap[b][a] = 0 }
    cap[a][b] += c
  }
  for (const u of users) addEdge(S, uNode[u.id], 1)
  for (const sid of specs) {
    const leaf = leafById[sid], q = quotas[sid] || 0
    const maxF = (leaf?.allowFemale === false) ? 0 : (leaf?.maxFemale != null ? Math.min(leaf.maxFemale, q) : q)
    const maxM = (leaf?.allowMale === false) ? 0 : (leaf?.maxMale != null ? Math.min(leaf.maxMale, q) : q)
    addEdge(fg[sid], sp[sid], maxF)
    addEdge(mg[sid], sp[sid], maxM)
    addEdge(sp[sid], T, q)
  }
  // gender null/digər → birbaşa spec node-a (tavansız, yalnız ümumi kvota)
  const gateOf = (g: any, sid: string) => g === 'qadın' ? fg[sid] : g === 'kişi' ? mg[sid] : sp[sid]
  for (const u of users) for (const sid of rankingOf(u.id)) {
    if (quotas[sid] === undefined) continue
    addEdge(uNode[u.id], gateOf(u.gender, sid), 1)
  }

  // ── Greedy nəticəsini başlanğıc axın kimi qoy (mövcud yerləşmələr saxlanılsın) ──
  const pushFlow = (a: number, b: number) => { cap[a][b] -= 1; cap[b][a] += 1 }
  for (const u of users) {
    const a = assignments[u.id]; if (!a) continue
    const sid = a.specId; if (quotas[sid] === undefined) continue
    const gate = gateOf(u.gender, sid)
    pushFlow(S, uNode[u.id]); pushFlow(uNode[u.id], gate); pushFlow(gate, sp[sid]); pushFlow(sp[sid], T)
  }

  // ── Edmonds-Karp: qalan boş yerlərə yerləşməyənlər üçün artırıcı yollar ──
  const bfs = (): number[] | null => {
    const par = new Array(n).fill(-1); par[S] = S
    const queue = [S]
    while (queue.length) {
      const v = queue.shift()!
      for (const w of adj[v]) if (par[w] < 0 && cap[v][w] > 0) { par[w] = v; if (w === T) return par; queue.push(w) }
    }
    return null
  }
  let par: number[] | null
  while ((par = bfs())) {
    for (let v = T; v !== S; v = par[v]) { cap[par[v]][v] -= 1; cap[v][par[v]] += 1 }
  }

  // ── Nəticəni oxu və placed/femP/malP/assignments-i yenilə ──
  for (const sid of specs) { placed[sid] = 0; femP[sid] = 0; malP[sid] = 0 }
  for (const uid of Object.keys(assignments)) delete assignments[uid]
  for (const u of users) {
    const g = u.gender
    for (const sid of rankingOf(u.id)) {
      if (quotas[sid] === undefined) continue
      const gate = gateOf(g, sid)
      // bu kursantdan həmin spec-ə axın varsa (reverse residual > 0)
      if (cap[gate][uNode[u.id]] > 0) {
        const i = rankingOf(u.id).indexOf(sid)
        assignments[u.id] = { specId: sid, choiceNum: i >= 0 ? i + 1 : 0 }
        placed[sid] = (placed[sid] || 0) + 1
        if (g === 'qadın') femP[sid] = (femP[sid] || 0) + 1
        else if (g === 'kişi') malP[sid] = (malP[sid] || 0) + 1
        break
      }
    }
  }
}

// ── Paket-daxili yerləşdirmə (hər paket müstəqil işləyir) ────────────────────
function runPacketPlacement(
  packetStudents: any[],
  allSubs: any[],
  packetSpecs: Array<{ id: string; quota: number; mülkiQuota?: number; liseyQuota?: number; path: any[] }>,
  sourceProportional = false
) {
  const pathMap: Record<string, any[]> = {}
  const leafById: Record<string, any> = {}
  for (const spec of packetSpecs) {
    pathMap[spec.id] = spec.path
    leafById[spec.id] = spec.path?.[spec.path.length - 1]
  }

  const placed: Record<string, number> = {}
  const femP: Record<string, number> = {}
  const malP: Record<string, number> = {}
  const assignments: Record<string, { specId: string; choiceNum: number }> = {}

  function tryPlace(students: any[], availQuota: Record<string, number>) {
    const sorted = [...students].sort((a, b) => {
      const aSub = allSubs.find((s: any) => s.userId === a.id)
      const bSub = allSubs.find((s: any) => s.userId === b.id)
      const aSid = aSub?.ranking?.find((sid: string) => availQuota[sid] !== undefined) || ''
      const bSid = bSub?.ranking?.find((sid: string) => availQuota[sid] !== undefined) || ''
      const aTb  = getTiebreakerSubjects(aSid, a.group, pathMap)
      const bTb  = getTiebreakerSubjects(bSid, b.group, pathMap)
      const tb   = aTb.length >= bTb.length ? aTb : bTb
      return compareStudents(a, b, tb)
    })
    for (const user of sorted) {
      if (assignments[user.id]) continue
      const sub = allSubs.find((s: any) => s.userId === user.id)
      if (!sub?.ranking) continue
      for (let ci = 0; ci < sub.ranking.length; ci++) {
        const sid = sub.ranking[ci]
        if (availQuota[sid] === undefined) continue
        if (availQuota[sid] > 0) {
          const leaf = leafById[sid]
          const g = user.gender
          if (!genderAllowed(leaf, g)) continue
          if (genderCapReached(leaf, g, femP[sid] || 0, malP[sid] || 0)) continue
          availQuota[sid]--
          placed[sid] = (placed[sid] || 0) + 1
          if (g === 'qadın') femP[sid] = (femP[sid] || 0) + 1
          else if (g === 'kişi') malP[sid] = (malP[sid] || 0) + 1
          assignments[user.id] = { specId: sid, choiceNum: ci + 1 }
          break
        }
      }
    }
  }

  if (sourceProportional) {
    // ── Mülki kvotaları
    const mülkiQ: Record<string, number> = {}
    const liseyQ: Record<string, number> = {}
    const deficitQ: Record<string, number> = {}
    for (const spec of packetSpecs) {
      mülkiQ[spec.id]  = spec.mülkiQuota ?? 0
      liseyQ[spec.id]  = spec.liseyQuota ?? 0
      deficitQ[spec.id] = 0  // sonra doldurulacaq
    }

    const mülki = packetStudents.filter((u: any) => u.source === 'mülki')
    const lisey = packetStudents.filter((u: any) => u.source === 'lisey')
    const other = packetStudents.filter((u: any) => !u.source)

    // Mərhələ 1: Mülki kursantlar mülki slotlar üçün
    tryPlace(mülki, mülkiQ)
    // Mərhələ 2: Lisey kursantlar lisey slotlar üçün
    tryPlace(lisey, liseyQ)

    // Mərhələ 3: Deficit filling — qalan slotlar hər iki mənbənin
    //            yerləşdirilməmiş kursantlarına verilir
    for (const spec of packetSpecs) {
      deficitQ[spec.id] = mülkiQ[spec.id] + liseyQ[spec.id]  // qalan slotlar
    }
    const unplaced = [...mülki, ...lisey, ...other].filter((u: any) => !assignments[u.id])
    tryPlace(unplaced, deficitQ)

  } else {
    // ── Adi yerləşdirmə
    const quotas: Record<string, number> = {}
    for (const spec of packetSpecs) quotas[spec.id] = spec.quota
    tryPlace(packetStudents, quotas)
  }

  // Boş yer + yerləşməyən eyni anda qalmasın deyə balı qoruyan yenidən-tarazlama
  const totalQuotas: Record<string, number> = {}
  for (const spec of packetSpecs) totalQuotas[spec.id] = spec.quota
  rebalanceUnplaced({ users: packetStudents, subs: allSubs, leafById, quotas: totalQuotas, pathMap, placed, femP, malP, assignments })

  return { assignments, placed, pathMap }
}

// ── Yerləşdirmə alqoritmi ─────────────────────────────────────────────────────
function runPlacement(users: any[], subs: any[], tree: any, sourceProportional = false) {
  const leavesWithPath = getLeavesWithPath(tree?.nodes || [])
  const quotas: Record<string, number> = {}
  const pathMap: Record<string, any[]> = {}
  const leafById: Record<string, any> = {}
  for (const { leaf, path } of leavesWithPath) {
    quotas[leaf.id]  = leaf.quota || 0
    pathMap[leaf.id] = path
    leafById[leaf.id] = leaf
  }
  const placed: Record<string, number> = {}
  const femP: Record<string, number> = {}   // leaf üzrə yerləşən qadın sayı
  const malP: Record<string, number> = {}   // leaf üzrə yerləşən kişi sayı
  const assignments: Record<string, { specId: string; choiceNum: number }> = {}

  function tryPlace(students: any[], availQuota: Record<string, number>) {
    // Hər kursant üçün birinci əlçatan ixtisasın tiebreaker-ına görə sırala
    const sorted = [...students].sort((a, b) => {
      const aSub = subs.find((s: any) => s.userId === a.id)
      const bSub = subs.find((s: any) => s.userId === b.id)
      const aSid = aSub?.ranking?.find((sid: string) => availQuota[sid] !== undefined) || ''
      const bSid = bSub?.ranking?.find((sid: string) => availQuota[sid] !== undefined) || ''
      const aTb  = getTiebreakerSubjects(aSid, a.group, pathMap)
      const bTb  = getTiebreakerSubjects(bSid, b.group, pathMap)
      // Hər ikisinin tiebreaker-ını birləşdir (uzunluq üzrə max)
      const tb   = aTb.length >= bTb.length ? aTb : bTb
      return compareStudents(a, b, tb)
    })
    for (const user of sorted) {
      if (assignments[user.id]) continue
      const sub = subs.find((s: any) => s.userId === user.id)
      if (!sub?.ranking) continue
      for (let ci = 0; ci < sub.ranking.length; ci++) {
        const sid = sub.ranking[ci]
        if (availQuota[sid] === undefined) continue
        if (availQuota[sid] > 0) {
          const leaf = leafById[sid]
          const g = user.gender
          if (!genderAllowed(leaf, g)) continue
          if (genderCapReached(leaf, g, femP[sid] || 0, malP[sid] || 0)) continue
          availQuota[sid]--
          placed[sid] = (placed[sid] || 0) + 1
          if (g === 'qadın') femP[sid] = (femP[sid] || 0) + 1
          else if (g === 'kişi') malP[sid] = (malP[sid] || 0) + 1
          assignments[user.id] = { specId: sid, choiceNum: ci + 1 }
          break
        }
      }
    }
  }

  if (sourceProportional) {
    // ── Mülki / lisey nisbətini hesabla
    const total      = users.length
    const mülkiTotal = users.filter((u: any) => u.source === 'mülki').length

    const mülkiQ: Record<string, number>  = {}
    const liseyQ: Record<string, number>  = {}
    const deficitQ: Record<string, number> = {}
    for (const { leaf } of leavesWithPath) {
      const sid = leaf.id
      const q   = leaf.quota || 0
      if (leaf.quotaMode === 'manual' && leaf.mülkiQuota != null && leaf.liseyQuota != null) {
        // Node üçün manual kvota təyin edilib
        mülkiQ[sid]  = leaf.mülkiQuota
        liseyQ[sid]  = leaf.liseyQuota
      } else {
        // Avtomatik: müəssisə nisbəti
        mülkiQ[sid]  = total > 0 ? Math.round(q * mülkiTotal / total) : q
        liseyQ[sid]  = q - mülkiQ[sid]
      }
      deficitQ[sid] = 0
    }

    const mülki = users.filter((u: any) => u.source === 'mülki')
    const lisey = users.filter((u: any) => u.source === 'lisey')
    const other = users.filter((u: any) => !u.source)

    // Mərhələ 1: mülki
    tryPlace(mülki, mülkiQ)
    // Mərhələ 2: lisey
    tryPlace(lisey, liseyQ)
    // Mərhələ 3: deficit — qalan slotlar hər iki qrupun yerləşdirilməmiş kursantlarına
    for (const sid of Object.keys(quotas)) deficitQ[sid] = mülkiQ[sid] + liseyQ[sid]
    tryPlace([...mülki, ...lisey, ...other].filter((u: any) => !assignments[u.id]), deficitQ)

  } else {
    // ── Adi yerləşdirmə
    const availQuota = { ...quotas }
    tryPlace(users, availQuota)
  }

  // Boş yer + yerləşməyən eyni anda qalmasın deyə balı qoruyan yenidən-tarazlama
  rebalanceUnplaced({ users, subs, leafById, quotas, pathMap, placed, femP, malP, assignments })

  return { assignments, placed, quotas, pathMap }
}

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

  const scoreOf: Record<string, number> = {}
  const genderOf: Record<string, any> = {}
  for (const u of users) { scoreOf[u.id] = u.score || 0; genderOf[u.id] = u.gender }

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

    // Cinsə icazə yoxdursa — bu ixtisası ötür (kursant azad qalır, növbəti seçimə keçəcək)
    if (!genderAllowed(leaf, g)) continue

    const gCount = h.filter(x => genderOf[x] === g).length
    const capG = g === 'qadın' ? (leaf?.maxFemale ?? Infinity)
               : g === 'kişi'  ? (leaf?.maxMale   ?? Infinity)
               : Infinity

    if (gCount < capG && h.length < quota) {
      // Yer var və cins limiti dolmayıb → birbaşa qəbul
      h.push(uid)
      h.sort((a, b) => (scoreOf[b] || 0) - (scoreOf[a] || 0))
      free.delete(uid)
    } else {
      // Sıxışdırma namizədləri: cins limiti dolubsa yalnız eyni cinsdən olanlar
      const pool = gCount >= capG ? h.filter(x => genderOf[x] === g) : h
      if (pool.length) {
        const worstUid = pool.reduce((w, x) => ((scoreOf[x] || 0) < (scoreOf[w] || 0) ? x : w), pool[0])
        if ((scoreOf[uid] || 0) > (scoreOf[worstUid] || 0)) {
          h.splice(h.indexOf(worstUid), 1)
          h.push(uid)
          h.sort((a, b) => (scoreOf[b] || 0) - (scoreOf[a] || 0))
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

// ── İzahlı (hekayə) simulyasiya — Sadə və Paket üsulu üçün ──────────────────────
function StorySim({ students, packets, subs, tree, onClose }: { students?: any[]; packets?: any[]; subs: any[]; tree: any; onClose: () => void }) {
  const [idx, setIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1200)
  const [selLeaf, setSelLeaf] = useState<string | null>(null)
  const [focusCol, setFocusCol] = useState<'left' | 'center' | 'right' | null>(null)

  const data = useMemo(() => {
    const leaves = getLeavesWithPath(tree?.nodes || [])
    const pathMap: Record<string, any[]> = {}, leafName: Record<string, string> = {}, leafPath: Record<string, string> = {}
    leaves.forEach(({ leaf, path }) => { pathMap[leaf.id] = path; leafName[leaf.id] = leaf.name; leafPath[leaf.id] = path.slice(0, -1).map((n: any) => n.name).join(' › ') })
    // Paketlər: verilmişsə onlar, yoxsa hamısı bir "paket" (sadə üsul)
    const pkts = (packets && packets.length)
      ? packets.map((p: any) => ({ num: p.num, students: p.students || [], specs: (p.specs || []).map((s: any) => ({ id: s.id, quota: s.quota })) }))
      : [{ num: 1, students: students || [], specs: leaves.map(({ leaf }) => ({ id: leaf.id, quota: leaf.quota || 0 })) }]

    const leafById: Record<string, any> = {}
    leaves.forEach(({ leaf }) => { leafById[leaf.id] = leaf })

    const steps: any[] = []
    const pkMeta: { num: number; specIds: string[]; quota: Record<string, number>; minScore: number; maxScore: number; count: number }[] = []
    const rebalanced: { name: string; score: number; fromSpec: string | null; toSpec: string; packetNum: number }[] = []
    for (const pk of pkts) {
      const quota: Record<string, number> = {}; pk.specs.forEach((s: any) => { quota[s.id] = s.quota })
      const withSub = pk.students.filter((u: any) => (subs.find((s: any) => s.userId === u.id)?.ranking || []).length)
      const sorted = [...withSub].sort((a: any, b: any) => {
        const aTb = getTiebreakerSubjects(subs.find((s: any) => s.userId === a.id)?.ranking?.[0] || '', a.group, pathMap)
        const bTb = getTiebreakerSubjects(subs.find((s: any) => s.userId === b.id)?.ranking?.[0] || '', b.group, pathMap)
        return compareStudents(a, b, aTb.length >= bTb.length ? aTb : bTb)
      })
      const scores = withSub.map((u: any) => u.score || 0)
      pkMeta.push({ num: pk.num, specIds: pk.specs.map((s: any) => s.id), quota, minScore: scores.length ? Math.min(...scores) : 0, maxScore: scores.length ? Math.max(...scores) : 0, count: sorted.length })
      const avail = { ...quota }
      const femP: Record<string, number> = {}, malP: Record<string, number> = {}
      const assignments: Record<string, { specId: string; choiceNum: number }> = {}
      const lastInLeaf: Record<string, { name: string; score: number }> = {}
      const stepStart = steps.length
      for (const u of sorted) {
        const ranking = (subs.find((s: any) => s.userId === u.id)?.ranking || []).filter((id: string) => quota[id] !== undefined)
        const attempts: { id: string; full: boolean; tie?: boolean; rival?: string; blocked?: 'gender' | 'cap' }[] = []
        let placed: string | null = null
        const tieRivals: { id: string; rival: string; score: number }[] = []
        const sc = u.score || 0, g = u.gender
        for (const sid of ranking) {
          const leaf = leafById[sid]
          if (!genderAllowed(leaf, g)) { attempts.push({ id: sid, full: true, blocked: 'gender' }); continue }
          if (avail[sid] > 0 && !genderCapReached(leaf, g, femP[sid] || 0, malP[sid] || 0)) {
            avail[sid]--; placed = sid
            if (g === 'qadın') femP[sid] = (femP[sid] || 0) + 1; else if (g === 'kişi') malP[sid] = (malP[sid] || 0) + 1
            attempts.push({ id: sid, full: false }); lastInLeaf[sid] = { name: u.name, score: sc }; break
          } else if (avail[sid] > 0) {
            attempts.push({ id: sid, full: true, blocked: 'cap' })
          } else {
            const last = lastInLeaf[sid]
            const tie = !!last && Math.abs((last.score || 0) - sc) < 1e-9
            attempts.push({ id: sid, full: true, tie, rival: tie ? last!.name : undefined })
            if (tie) tieRivals.push({ id: sid, rival: last!.name, score: sc })
          }
        }
        if (placed) assignments[u.id] = { specId: placed, choiceNum: ranking.indexOf(placed) + 1 }
        steps.push({ packetNum: pk.num, u, ranking, attempts, placed, choiceNum: placed ? ranking.indexOf(placed) + 1 : 0, tieRivals })
      }
      // ── Yenidən-tarazlama (real bölüşdürmə ilə eyni) ──
      const greedyAssign: Record<string, string> = {}
      for (const uid of Object.keys(assignments)) greedyAssign[uid] = assignments[uid].specId
      const placedMap: Record<string, number> = {}
      for (const uid of Object.keys(assignments)) { const s = assignments[uid].specId; placedMap[s] = (placedMap[s] || 0) + 1 }
      rebalanceUnplaced({ users: pk.students, subs, leafById, quotas: quota, pathMap, placed: placedMap, femP, malP, assignments })
      // Hər addıma yekun (tarazlamadan sonrakı) vəziyyəti yaz
      for (let i = stepStart; i < steps.length; i++) {
        const st = steps[i]; const fin = assignments[st.u.id]
        st.finalSpec = fin ? fin.specId : null
        st.finalChoiceNum = fin ? fin.choiceNum : 0
        st.rebalanced = !!fin && greedyAssign[st.u.id] !== fin.specId
        if (st.rebalanced) rebalanced.push({ name: st.u.name, score: st.u.score || 0, fromSpec: greedyAssign[st.u.id] || null, toSpec: fin.specId, packetNum: pk.num })
      }
    }
    const greedyPlaced = steps.filter(s => s.placed).length
    const finalPlaced = steps.filter(s => s.finalSpec).length
    return { steps, leafName, leafPath, pkMeta, multiPacket: pkts.length > 1, rebalanced, greedyPlaced, finalPlaced }
  }, [students, packets, subs, tree])

  const total = data.steps.length
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
  const filled: Record<string, number> = {}        // cari paket üzrə
  const cutoff: Record<string, number> = {}         // cari paket üzrə keçid balı
  let placedTotal = 0, firstChoice = 0              // ümumi (bütün paketlər)
  for (let i = 0; i <= idx && i < total; i++) {
    const s = data.steps[i]
    if (s.placed) {
      placedTotal++; if (s.choiceNum === 1) firstChoice++
      if (s.packetNum === curPk) {
        filled[s.placed] = (filled[s.placed] || 0) + 1
        const sc = s.u.score || 0
        if (cutoff[s.placed] === undefined || sc < cutoff[s.placed]) cutoff[s.placed] = sc
      }
    }
  }
  const queue = data.steps.slice(idx + 1, idx + 5)
  // cari paketin daxili gedişatı
  const pkProcessed = idx >= 0 ? data.steps.slice(0, idx + 1).filter(s => s.packetNum === curPk).length : 0
  const pkPlaced = Object.values(filled).reduce((a, b) => a + b, 0)
  const pkQuota = curMeta ? Object.values(curMeta.quota).reduce((a, b) => a + b, 0) : 0
  const pkTotal = curMeta?.count ?? 0
  const pkSteps = data.steps.map((s, i) => ({ s, i })).filter(x => x.s.packetNum === curPk)   // cari paketin kursantları (sıra ilə)

  const narration = (() => {
    if (!cur) return 'Başlamaq üçün “Növbəti addım”a və ya “Avtomatik”a basın. Kursantlar bala görə bir-bir yerləşəcək.'
    const nm = cur.u.name, sc = Number(cur.u.score).toFixed(1)
    if (!cur.placed) return `${nm} (${sc} bal): bütün seçdiyi ixtisaslar dolu idi → bu kursant yerləşmədi (əl ilə baxılmalıdır).`
    const fulls = cur.attempts.filter(a => a.full)
    const tieNote = cur.tieRivals.length
      ? ` ⚖️ Bərabər bal: “${data.leafName[cur.tieRivals[0].id]}” üçün ${cur.tieRivals[0].rival} ilə ${sc} bal eyni idi — tiebreaker (fənn balları) ${cur.tieRivals[0].rival}-ı öndə tutdu, ona görə bu kursant oraya düşmədi.`
      : ''
    if (fulls.length === 0) return `${nm} (${sc} bal): 1-ci seçimi “${data.leafName[cur.placed]}”-də yer var idi → birbaşa oraya yerləşdi.`
    return `${nm} (${sc} bal): ${fulls.map((a, i) => `${i + 1}-ci seçim “${data.leafName[a.id]}” dolu`).join(', ')} → ${cur.choiceNum}-ci seçim “${data.leafName[cur.placed]}”-ə yerləşdi.${tieNote}`
  })()

  const Seat = ({ on, color }: { on: boolean; color: string }) => <span style={{ width: 8, height: 8, borderRadius: '50%', background: on ? color : 'transparent', border: on ? 'none' : '1px solid #d6dae3', flexShrink: 0 }} />

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, background: '#eef1f5', backgroundImage: 'repeating-linear-gradient(135deg,#ffffff 0px,#ffffff 1px,transparent 1px,transparent 26px)', display: 'flex', flexDirection: 'column' }}>
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
        <button onClick={() => setSpeed(s => s === 1200 ? 500 : s === 500 ? 150 : 1200)}
          style={{ padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#8a909c', fontSize: 12, cursor: 'pointer' }}>{speed === 1200 ? '1×' : speed === 500 ? '2×' : '5×'}</button>
        <button onClick={() => { setIdx(-1); setPlaying(false) }} title="Başa qayıt" style={{ padding: '8px 12px', borderRadius: 9, border: '1.5px solid #e0e4f0', background: '#fff', color: '#8a909c', fontSize: 13, cursor: 'pointer' }}>↺</button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6, borderLeft: '1px solid #e7eaf0' }}>
          <span style={{ fontSize: 11, color: '#9aa0ac', marginRight: 2 }}>Böyüt:</span>
          {([['left', '📚', 'İxtisaslar'], ['center', '👤', 'Kursant'], ['right', '📦', 'Paket/Növbə']] as const).map(([k, ic, lbl]) => (
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
          <div style={{ fontSize: 10, fontWeight: 700, color: '#9aa0ac', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📚 İxtisaslar dolur{data.multiPacket ? ` · Paket ${curPk}` : ''}</div>
          {(curMeta?.specIds || []).map((id: string) => {
            const q = curMeta.quota[id], f = filled[id] || 0, isFull = f >= q && q > 0
            const justPlaced = cur?.placed === id
            return (
              <div key={id} onClick={() => setSelLeaf(id)} title="Yerləşən kursantları gör"
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

        {/* ORTA: cari kursant */}
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
                        tried?.blocked === 'gender' ? '🚫 cinsə bağlı'
                        : tried?.blocked === 'cap' ? '🚫 cins tavanı dolub'
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
              <div style={{ fontSize: 16, fontWeight: 700, color: '#2b2f3a' }}>{total} kursant bala görə sıralandı</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>“Növbəti addım” ilə bir-bir, “Avtomatik” ilə ardıcıl izləyin.</div>
            </div>
          )}

          {/* Bərabər bal toqquşması banneri */}
          {cur && cur.tieRivals.length > 0 && (
            <div style={{ background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 18 }}>⚖️</span>
              <div style={{ fontSize: 13, color: '#8a6d1b', lineHeight: 1.55 }}>
                <b style={{ color: '#5a4a12' }}>Bərabər bal toqquşması:</b> “{data.leafName[cur.tieRivals[0].id]}” üçün <b style={{ color: '#5a4a12' }}>{cur.tieRivals[0].rival}</b> ilə hər ikisinin balı <b style={{ color: '#5a4a12' }}>{cur.tieRivals[0].score.toFixed(2)}</b> idi. Son yer bir nəfərə qalır — <b style={{ color: '#5a4a12' }}>tiebreaker (fənn balları)</b> {cur.tieRivals[0].rival}-ı öndə tutdu, bu kursant həmin ixtisasa düşmədi.
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
              <div style={{ fontSize: 11, color: '#8a909c', marginBottom: 8 }}>Bal: {curMeta.minScore.toFixed(1)} – {curMeta.maxScore.toFixed(1)} · {pkTotal} kursant · {pkQuota} kvota</div>
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
              {/* Paketin kursantları (adı ilə, status) */}
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
            <div style={{ fontSize: 24, fontWeight: 900, color: '#2faf5f' }}>{placedTotal}<span style={{ fontSize: 12, color: '#aab0bd', fontWeight: 500 }}> / {total}</span></div>
          </div>
          <div style={{ background: '#fff', border: '1px solid #e7eaf0', borderRadius: 10, padding: '12px' }}>
            <div style={{ fontSize: 11, color: '#8a909c' }}>1-ci seçiminə düşən</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: '#c9962a' }}>{placedTotal ? Math.round((firstChoice / placedTotal) * 100) : 0}%</div>
          </div>
          {idx >= total - 1 && total > 0 && data.rebalanced.length > 0 && (
            <div style={{ background: '#fffdf5', borderRadius: 10, padding: '12px', border: '1px solid #e0a92e' }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#9a7b1e' }}>⚖️ Tarazlama mərhələsi</div>
              <div style={{ fontSize: 11, color: '#8a6d1b', marginTop: 4, lineHeight: 1.5 }}>
                Greedy keçiddən sonra boş yerlər qalmışdı. Balı pozmadan <b>{data.rebalanced.length} kursant</b> köçürülərək boş yerlər dolduruldu və sıxışanlara yer açıldı:
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
                {data.finalPlaced} kursant yerləşdi{data.finalPlaced !== data.greedyPlaced ? ` (greedy: ${data.greedyPlaced} + tarazlama: ${data.finalPlaced - data.greedyPlaced})` : ''}. Yazmaq üçün bağlayıb “📋 Bölüşdür → Bazaya Yaz” edin.
              </div>
            </div>
          )}
        </div>
      </div>

      {selLeaf && (() => {
        const list = data.steps.slice(0, idx + 1).filter(s => s.placed === selLeaf && s.packetNum === curPk).map(s => ({ u: s.u, choiceNum: s.choiceNum })).sort((a, b) => (b.u.score || 0) - (a.u.score || 0))
        const q = curMeta?.quota[selLeaf] ?? 0
        const fillP = q ? Math.round((list.length / q) * 100) : 0
        const isFull = list.length >= q && q > 0
        const minS = list.length ? Math.min(...list.map(it => it.u.score || 0)) : 0
        const maxS = list.length ? Math.max(...list.map(it => it.u.score || 0)) : 0
        const avgS = list.length ? list.reduce((a, it) => a + (it.u.score || 0), 0) / list.length : 0
        const stat = (label: string, val: string, color: string) => (
          <div style={{ flex: 1, textAlign: 'center', padding: '10px 4px', background: '#f7f8fc', borderRadius: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color }}>{val}</div>
            <div style={{ fontSize: 10.5, color: '#8892b0', marginTop: 2 }}>{label}</div>
          </div>
        )
        return (
          <div onClick={() => setSelLeaf(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, width: 660, maxWidth: '95%', maxHeight: '88%', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 70px #000b' }}>
              {/* Başlıq */}
              <div style={{ background: 'linear-gradient(135deg,#b8860b,#e0a92e)', padding: '20px 24px', color: '#fff', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#ffffff99', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>İxtisasa yerləşənlər{data.multiPacket ? ` · Paket ${curPk}` : ''}</div>
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
                  {stat('Keçid balı', minS.toFixed(2), isFull ? '#237804' : '#722ed1')}
                  {stat('Orta bal', avgS.toFixed(2), '#c9962a')}
                  {stat('Ən yüksək', maxS.toFixed(2), '#d46b08')}
                </div>
              )}

              {/* Siyahı */}
              <div style={{ overflowY: 'auto', padding: '10px 16px 16px' }}>
                {list.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: '#8892b0', fontSize: 14 }}>Bu addıma qədər bu ixtisasa heç kim yerləşməyib.</div>
                ) : list.map((it, i) => (
                  <div key={it.u.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', borderRadius: 10, background: i % 2 ? '#fafbff' : '#fff', borderBottom: '1px solid #f4f5fb' }}>
                    <span style={{ width: 26, color: '#aab', fontWeight: 800, fontSize: 13, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
                    <div style={{ width: 38, height: 38, borderRadius: '50%', background: '#fbf1d6', color: '#b8860b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>{(it.u.name || '?').split(' ').map((x: string) => x[0]).slice(0, 2).join('')}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.u.name}</div>
                      <div style={{ fontSize: 11, color: '#8892b0', fontFamily: 'monospace' }}>{it.u.fin || '—'}</div>
                    </div>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: it.choiceNum === 1 ? '#237804' : '#b8860b', background: it.choiceNum === 1 ? '#f6ffed' : '#fbf1d6', border: `1px solid ${it.choiceNum === 1 ? '#b7eb8f' : '#ecd9a0'}`, padding: '3px 10px', borderRadius: 14, whiteSpace: 'nowrap', flexShrink: 0 }}>{it.choiceNum}-ci seçim</span>
                    <span style={{ fontSize: 15, fontWeight: 900, color: '#c9962a', minWidth: 52, textAlign: 'right', flexShrink: 0 }}>{Number(it.u.score).toFixed(2)}</span>
                  </div>
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
  const [users, refreshUsers]       = useLocalState(userDb.getAll)
  const [allTrees, refreshAllTrees] = useLocalState(treeDb.getAll)

  const institutions  = institutionDb.getAll() as any[]
  const allSelections = selectionDb.getAll().filter((s: any) => s.status !== 'draft')

  // ── Əsas state ───────────────────────────────────────────────────────────
  const [instId,   setInstId]   = useState<string>(institutions[0]?.id || '')
  const [selId,    setSelId]    = useState<string>(allSelections[0]?.id || '')
  const [method,   setMethod]   = useState<Method>(null)
  const [storyOpen, setStoryOpen] = useState(false)
  const [mode,     setMode]     = useState<Mode>(null)
  const [saved,    setSaved]    = useState(false)
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
  const tree = sel ? ((allTrees as any[]).find((t: any) => t.id === sel.treeId) || null) : null
  // tree məzmunu dəyişəndə memo-lar yenilensin
  const treeKey = JSON.stringify(tree?.nodes || [])
  const sels = sel ? (submissionDb.getBySelection(sel.id) as any[]) : []

  // Bütün müəssisə kursantları (seçim etmiş-etməmiş)
  const allInstUsers   = (users as any[]).filter((u: any) => u.institution === instId)
  const submittedUsers = allInstUsers.filter(u => sels.find((s: any) => s.userId === u.id))

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


  // ── Paketlər ──────────────────────────────────────────────────────────────
  const packets = useMemo(() => {
    if (!packetsReady || method !== 'packet') return []

    const leaves = getLeavesWithPath(tree?.nodes || [])
    const P = packetCount

    // ── Addım 1: kursant sayını hesabla (dəyişməz qayda) ─────────────────
    const total   = allInstUsers.length
    const stuBase = Math.floor(total / P)
    const stuRem  = total % P
    const stuCount = Array.from({ length: P }, (_, i) => i < stuRem ? stuBase + 1 : stuBase)
    // stuCount = [34, 33, 33] (100 kursant, 3 paket üçün)

    // ── Addım 2: deficit-filling alqoritmi ilə kvota bölgüsü ─────────────
    // Zəmanət: hər paketin toplam kvotası = stuCount[i] → heç bir kursant boşda qalmır
    // Hər ixtisasın kvotası bütün paketlərə bölünür, hər paket öz payı üzrə mübarizə aparır
    const perPacketSpecs: Array<Array<{ id: string; name: string; path: any[]; quota: number; origQuota: number }>> =
      Array.from({ length: P }, () => [])

    if (leaves.length > 0) {
      // Base paylar
      const baseAlloc: number[][] = leaves.map(({ leaf }) =>
        Array(P).fill(Math.floor((leaf.quota || 0) / P))
      )

      // Hər paketin cari cəmi
      const packetTotals = Array.from({ length: P }, (_, i) =>
        baseAlloc.reduce((s, row) => s + row[i], 0)
      )

      // Deficit: hər paketin hələ nə qədər kvotaya ehtiyacı var
      const deficit = stuCount.map((sc, i) => sc - packetTotals[i])

      // Kopyala, sonra remainder slotları deficitə görə paylaşdır
      const alloc = baseAlloc.map(row => [...row])

      for (let j = 0; j < leaves.length; j++) {
        const rem = (leaves[j].leaf.quota || 0) % P
        for (let k = 0; k < rem; k++) {
          let maxI = 0
          for (let i = 1; i < P; i++) {
            if (deficit[i] > deficit[maxI]) maxI = i
          }
          alloc[j][maxI]++
          deficit[maxI]--
        }
      }

      // ── Mənbə nisbəti (sourceProportional aktiv olduqda) ─────────────────
      const spActive    = !!(tree?.sourceProportional)
      const totalUsers  = allInstUsers.length
      const mülkiTotal  = allInstUsers.filter((u: any) => u.source === 'mülki').length
      const liseyTotal  = allInstUsers.filter((u: any) => u.source === 'lisey').length

      // perPacketSpecs-ə yaz
      for (let j = 0; j < leaves.length; j++) {
        const { leaf, path } = leaves[j]
        const origQuota = leaf.quota || 0
        for (let i = 0; i < P; i++) {
          if (alloc[j][i] > 0) {
            const q = alloc[j][i]
            let mülkiQuota: number | undefined
            let liseyQuota: number | undefined
            if (spActive) {
              if (leaf.quotaMode === 'manual' && leaf.mülkiQuota != null && leaf.liseyQuota != null) {
                // Node üçün manual kvota — proporsional böl
                const ratio = origQuota > 0 ? q / origQuota : 0
                mülkiQuota = Math.round(leaf.mülkiQuota * ratio)
                liseyQuota = q - mülkiQuota
              } else if (totalUsers > 0) {
                mülkiQuota = Math.round(q * mülkiTotal / totalUsers)
                liseyQuota = q - mülkiQuota
              }
            }
            perPacketSpecs[i].push({
              id: leaf.id, name: leaf.name, path,
              quota: q, origQuota,
              ...(spActive ? { mülkiQuota, liseyQuota } : {}),
            })
          }
        }
      }
    }

    // ── Addım 3: kursantları bala görə sırala, stuCount-a görə böl ──────
    const sorted = [...allInstUsers].sort((a: any, b: any) => (b.score || 0) - (a.score || 0))

    const result = []
    let cursor = 0
    for (let i = 0; i < P; i++) {
      const size = stuCount[i]
      if (size === 0) continue
      const studs = sorted.slice(cursor, cursor + size)
      cursor += size
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
  }, [packetsReady, packetCount, allInstUsers.length, treeKey, tree?.sourceProportional])

  // ── Hər paketin müstəqil yerləşdirməsi (simulyasiya üçün) ────────────────────
  const packetPlacements = useMemo(() => {
    if (!packets.length || !sels.length) return []
    const spActive = !!(tree?.sourceProportional)
    return (packets as any[]).map((p: any) =>
      runPacketPlacement(p.students, sels, p.specs || [], spActive)
    )
  }, [packets, sels])

  // ── Paket sim üçün addım-addım animasiya sırası ───────────────────────────
  const animSteps = useMemo(() => {
    if (!(packets as any[]).length || !packetPlacements.length) return []
    const steps: any[] = []
    ;(packets as any[]).forEach((p: any, pIdx: number) => {
      steps.push({ type: 'open-packet', pIdx })
      const pkAssign = packetPlacements[pIdx]?.assignments || {}
      ;(p.specs || []).forEach((spec: any, sIdx: number) => {
        steps.push({ type: 'open-spec', pIdx, sIdx })
        // Bu spec-i ranking-ində olan paketin kursantları
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
    if (!mode || !tree) return null

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
    return runPlacement(submittedUsers, sels, tree, !!(tree?.sourceProportional))
  }, [mode, method, selId, treeKey, (users as any[]).length, packets, packetPlacements, tree?.sourceProportional, algorithm])

  const placedCount   = placement ? Object.keys(placement.assignments).length : 0
  const unplacedCount = submittedUsers.length - placedCount

  // Filtersiz sıra — animasiya üçün
  const allStudentRows = useMemo(() => {
    if (!placement) return []
    return submittedUsers
      .map(u => {
        const a    = placement.assignments[u.id]
        const path = a ? (placement.pathMap[a.specId] || []) : []
        return { user: u, assignment: a, path }
      })
      .sort((a, b) => (b.user.score || 0) - (a.user.score || 0))
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

  // ── Bərabər ballı toqquşmalar: bir ixtisas dolanda eyni ballı başqa kursant onu istəyirsə ──
  const collisionMap = useMemo(() => {
    const map = new Map<number, any>()
    if (!placement || method !== 'simple') return map
    const scoreOf = (u: any) => u.score || 0
    const riyOf   = (u: any) => u.subjects?.['Riyaziyyat'] ?? null
    const nameOf  = (sid: string) => { const p = placement.pathMap[sid] || []; return p.length ? p[p.length - 1].name : sid }
    const rankingOf: Record<string, string[]> = {}
    for (const s of sels) rankingOf[s.userId] = s.ranking || []
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
            winner: { name: row.user.name, fin: row.user.fin, riy: riyOf(row.user), choiceNum: a.choiceNum },
            losers: losers.map((u: any) => ({
              name: u.name, fin: u.fin, riy: riyOf(u),
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

  // ── Paket mode üçün: neçə kursant işlənib ────────────────────────────────
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

  // ── Simulyasiya / Bölüşdür ────────────────────────────────────────────────
  function handleSimulate()   { setSaved(false); setMode('sim'); resetSim(); addLog('distribution', 'info', `Simulyasiya başladıldı`, `Seçim: ${sel?.name} · Metod: ${method} · Alqoritm: ${algorithm}`) }
  function handleDistribute() { setSaved(false); setMode('distribute'); resetSim(); addLog('distribution', 'info', `Bölüşdürmə hesablandı`, `Seçim: ${sel?.name} · Metod: ${method} · Alqoritm: ${algorithm}`) }

  function handleConfirm() {
    if (!placement) return
    // Bu bölüşdürmədən təsirlənən bütün kursantlar: seçim edənlər + əvvəl bu seçimə yerləşənlər
    const submittedIds = new Set((sels as any[]).map((s: any) => s.userId))
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

    // Əvvəlcə köhnə yerləşdirməni təmizlə, sonra yenisini yaz (köhnə nəticələr qalmasın)
    affected.forEach((u: any) => {
      const a = placement.assignments[u.id]
      if (a) {
        const path = placement.pathMap[a.specId] || []
        userDb.update(u.id, {
          placedSpecialty:   path.map((n: any) => n.name).join(' → '),
          choiceNum:         a.choiceNum,
          placedSpecialtyId: a.specId,
          placedSelectionId: sel!.id,
        })
      } else {
        // bu bölüşdürmədə yerləşmədi → köhnə yerləşdirməni sil
        userDb.update(u.id, { placedSpecialty: null, choiceNum: null, placedSpecialtyId: null, placedSelectionId: null })
      }
    })
    refreshUsers(); setSaved(true); setShowConf(false)
    addLog('distribution', 'success', `Yerləşdirmə bazaya yazıldı: ${Object.keys(placement.assignments).length} kursant`,
      `Seçim: ${sel?.name} · Metod: ${method} · Alqoritm: ${algorithm}${tree?.sourceProportional ? ' · Proporsional bölgü' : ''}`)
  }

  function handleRollback(snap: typeof snapshots[0]) {
    snap.userStates.forEach(us => {
      userDb.update(us.id, { placedSpecialty: us.placedSpecialty || null, choiceNum: us.choiceNum || null, placedSpecialtyId: us.placedSpecialtyId || null, placedSelectionId: us.placedSelectionId || null })
    })
    // Kvotaları da bərpa et (snapshot anındakı dəyərlərə)
    if (snap.treeId && snap.quotas) {
      const t = treeDb.get(snap.treeId)
      if (t) {
        const q = snap.quotas
        const restore = (nodes: any[]): any[] => nodes.map((n: any) =>
          n.children?.length ? { ...n, children: restore(n.children) } : (q[n.id] !== undefined ? { ...n, quota: q[n.id] } : n))
        treeDb.update(snap.treeId, { ...t, nodes: restore(t.nodes || []) })
      }
    }
    const newSnaps = snapshots.filter(s => s.id !== snap.id)
    localStorage.setItem('dist_snapshots', JSON.stringify(newSnaps))
    setSnapshots(newSnaps)
    refreshUsers(); setSaved(false); setShowRollback(false)
    addLog('distribution', 'warning', `Rollback edildi: ${snap.selName}`, `Snapshot: ${new Date(snap.ts).toLocaleString('az-AZ')}`)
  }

  function exportExcel() {
    const data = studentRows.map((r, i) => ({
      '#': i + 1, 'Kursant': r.user.name, 'FİN': r.user.fin || '—',
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
                Addım {collisionPause.step} — eyni <b>{collisionPause.score}</b> ballı kursantlar
                «<b>{collisionPause.specName}</b>» ixtisası üçün rəqabət apardı. Yer məhdud olduğu üçün biri yerləşdi, digər(lər)i ala bilmədi. Aşağıda hər kəsin Riyaziyyat balı göstərilir.
              </div>
            </div>
            <div style={{ padding: '20px 26px' }}>
              {/* Qazanan */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12, background: '#ecfdf5', border: '1.5px solid #6ee7b7', marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>✅</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#065f46' }}>{collisionPause.winner.name}</div>
                  <div style={{ fontSize: 11.5, color: '#047857' }}>
                    Riyaziyyat: <b>{collisionPause.winner.riy ?? '—'}</b> · bu ixtisası aldı ({collisionPause.winner.choiceNum}-ci seçimi)
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#065f46', background: '#fff', borderRadius: 8, padding: '4px 10px', border: '1px solid #6ee7b7' }}>QAZANDI</span>
              </div>
              {/* Uduzanlar */}
              <div style={{ fontSize: 11, fontWeight: 700, color: '#9090a8', textTransform: 'uppercase', letterSpacing: .5, margin: '4px 0 8px' }}>
                Bu ixtisası ala bilməyən eyni ballı kursant{collisionPause.losers.length > 1 ? 'lar' : ''} ({collisionPause.losers.length})
              </div>
              {collisionPause.losers.map((l: any, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: '#fff7ed', border: '1px solid #fed7aa', marginBottom: 8 }}>
                  <span style={{ fontSize: 18 }}>↩️</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#9a3412' }}>{l.name}</div>
                    <div style={{ fontSize: 11.5, color: '#b45309' }}>
                      Riyaziyyat: <b>{l.riy ?? '—'}</b> · əvəzində: {l.got}{l.gotChoice ? ` (${l.gotChoice}-ci seçimi)` : ''}
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
              <div style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 6 }}>Nəticələri bazaya yazmaq istəyirsiniz?</div>
              <div style={{ fontSize: 12, color: '#8892b0', lineHeight: 1.6 }}>
                <span style={{ color: '#f5a623', fontWeight: 700 }}>{placedCount} kursant</span> üçün yerləşdirmə nəticəsi bazaya yazılacaq.
              </div>
            </div>
            <div style={{ padding: '20px 26px', borderBottom: '1.5px solid #f0f2fa' }}>
              {[
                { label: 'Ümumi kursant',    val: submittedUsers.length, color: '#c9962a' },
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
                  { label:'Yerləşdirilmiş', val: `${snap.placedCount} kursant`,                    color:'#c9962a' },
                  { label:'Metod',         val: snap.method === 'packet' ? '📦 Paket' : '📋 Sadə', color:'#8a909c' },
                ].map(s => (
                  <div key={s.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontSize:13, color:'var(--muted)' }}>{s.label}</span>
                    <span style={{ fontWeight:700, fontSize:13, color:s.color }}>{s.val}</span>
                  </div>
                ))}
                <div style={{ marginTop:10, padding:'9px 12px', borderRadius:9, background:'#fff8e6', border:'1.5px solid #ffd591', fontSize:12, color:'#d46b08', fontWeight:600 }}>
                  ⚠️ Bu əməliyyat {snap.placedCount} kursantın yerləşdirmə nəticəsini silir. Geri alına bilməz.
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
                      👥 {p.count} kursant
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
                  { key: 'students', label: '👥 Kursantlar', count: p.count },
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

                {/* Kursantlar */}
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

      {/* ── Snapshot düyməsi ── */}
      {snapshots.length > 0 && can('dist.rollback') && (
        <div style={{ display:'flex', marginBottom:10 }}>
          <button onClick={() => setShowRollback(true)} style={{ padding:'6px 14px', borderRadius:8, border:'1.5px solid #ff4d4f55', background:'#fff0f0', color:'#cf1322', fontWeight:700, fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            🕓 Snapshots ({snapshots.length})
          </button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginRight: 4 }}>Müəssisə:</span>
        {institutions.map((inst: any) => (
          <button key={inst.id} onClick={() => changeInst(inst.id)}
            style={{
              padding: '9px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontWeight: 700, fontSize: 13, transition: 'all .15s',
              background: instId === inst.id ? 'var(--blue)' : '#f0f2fa',
              color:      instId === inst.id ? '#fff'        : 'var(--muted)',
              boxShadow:  instId === inst.id ? '0 2px 10px #c9962a33' : 'none',
            }}>
            <InstIcon icon={inst.icon} size={16} style={{ marginRight: 4 }} />
            {inst.label}
          </button>
        ))}
        {instSelections.length > 1 && (
          <>
            <div style={{ width: 1, height: 28, background: 'var(--border)', margin: '0 4px' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginRight: 4 }}>Seçim:</span>
            {instSelections.map((s: any) => (
              <button key={s.id} onClick={() => changeSelection(s.id)}
                style={{
                  padding: '9px 18px', borderRadius: 10, cursor: 'pointer', fontWeight: 700, fontSize: 13, transition: 'all .15s',
                  border: '1.5px solid ' + (sel?.id === s.id ? '#f5a623' : 'var(--border)'),
                  background: sel?.id === s.id ? '#fff8e6' : '#fff',
                  color: sel?.id === s.id ? '#d46b08' : 'var(--muted)',
                }}>
                📋 {s.name}
              </button>
            ))}
          </>
        )}
      </div>

      {/* ── Metod seçimi (method === null) ── */}
      {!method && sel && tree && (() => {
        const leaves = getLeavesWithPath(tree?.nodes || [])
        const totalQuota = leaves.reduce((s: number, {leaf}: any) => s + (leaf.quota || 0), 0)
        const zeroQuotaCount = leaves.filter(({leaf}: any) => !leaf.quota).length
        const submRatio = allInstUsers.length > 0 ? submittedUsers.length / allInstUsers.length : 0
        const checks = [
          { ok: leaves.length > 0,                   warn: false, label: 'İxtisas ağacı',     detail: leaves.length > 0 ? `${leaves.length} ixtisas` : 'Ağac tapılmadı' },
          { ok: totalQuota > 0 && zeroQuotaCount === 0, warn: totalQuota > 0 && zeroQuotaCount > 0, label: 'Kvotalar',         detail: zeroQuotaCount > 0 ? `${zeroQuotaCount} ixtisasın kvotası sıfırdır` : `Ümumi: ${totalQuota}` },
          { ok: submittedUsers.length > 0,            warn: false, label: 'Seçimlər',          detail: `${submittedUsers.length} / ${allInstUsers.length} kursant` },
          ...(submRatio < 0.5 && submittedUsers.length > 0 ? [{ ok: false, warn: true, label: 'Aşağı iştirak', detail: `Yalnız ${Math.round(submRatio*100)}% seçim etdi` }] : []),
          ...(totalQuota < submittedUsers.length ? [{ ok: true, warn: true, label: 'Kvota çatışmır', detail: `${submittedUsers.length - totalQuota} kursant yerləşdirilə bilməyə bilər` }] : []),
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
            Bölüşdürmə üsulunu seçin
          </div>
          <div style={{ color: '#8a909c', fontSize: 13, marginBottom: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <InstIcon icon={activeInst?.icon} size={14} />
            {activeInst?.label} · {submittedUsers.length} kursant seçim etdi
          </div>

          <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
            {/* Sadə üsul */}
            <div
              onClick={() => setMethod('simple')}
              style={{
                width: 220, background: '#ffffff', border: '1.5px solid #e7eaf0',
                borderRadius: 16, padding: '28px 20px', cursor: 'pointer',
                transition: 'all .2s', textAlign: 'center',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#c9962a22'; (e.currentTarget as HTMLElement).style.borderColor = '#c9962a' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e7eaf0' }}
            >
              <div style={{ fontSize: 40, marginBottom: 14 }}>📋</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#2b2f3a', marginBottom: 8 }}>Sadə üsul</div>
              <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.6 }}>
                Bütün kursantlar eyni anda bala görə ixtisaslara yerləşdirilir
              </div>
              <div style={{ marginTop: 18, display: 'inline-block', padding: '8px 20px', borderRadius: 8, background: '#c9962a', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                Seç →
              </div>
            </div>

            {/* Paket üsulu */}
            <div
              onClick={() => setMethod('packet')}
              style={{
                width: 220, background: '#ffffff', border: '1.5px solid #e7eaf0',
                borderRadius: 16, padding: '28px 20px', cursor: 'pointer',
                transition: 'all .2s', textAlign: 'center',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f5a62322'; (e.currentTarget as HTMLElement).style.borderColor = '#f5a623' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = '#e7eaf0' }}
            >
              <div style={{ fontSize: 40, marginBottom: 14 }}>📦</div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#2b2f3a', marginBottom: 8 }}>Paket üsulu</div>
              <div style={{ fontSize: 12, color: '#8a909c', lineHeight: 1.6 }}>
                Kursantlar bala görə paketlərə bölünür, hər paket ayrıca idarə edilir
              </div>
              <div style={{ marginTop: 18, display: 'inline-block', padding: '8px 20px', borderRadius: 8, background: '#f5a623', color: '#fff', fontWeight: 700, fontSize: 12 }}>
                Seç →
              </div>
            </div>
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
            Bölüşdürmə üçün bu müəssisəyə aid seçim yayımlanmalıdır
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          SADƏ ÜSUL
          ════════════════════════════════════════ */}
      {method === 'simple' && (
        <>
          <div style={{ background: '#ffffff', border: '1.5px solid #e7eaf0', borderRadius: 16, padding: '22px 26px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ color: '#2b2f3a', fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📋</span> Sadə Üsul
                <span style={{ fontSize: 13, color: '#8a909c', fontWeight: 500, display:'inline-flex', alignItems:'center', gap:5 }}>— <InstIcon icon={activeInst?.icon} size={14} /> {activeInst?.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fullReset}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #e7eaf0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  ← Geri
                </button>
                {mode && (
                  <button onClick={() => { setMode(null); setSaved(false) }}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #ff4d4f', background: 'transparent', color: '#ff4d4f', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    🔄 Sıfırla
                  </button>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ fontSize: 13, color: '#8892b0', display:'flex', alignItems:'center', gap:8 }}>
                <span>{submittedUsers.length} kursant</span>
                {mode === 'sim'        && <span style={{ color: '#f5a623', fontWeight: 600 }}>— Simulyasiya</span>}
                {mode === 'distribute' && !saved && <span style={{ color: '#52c41a', fontWeight: 600 }}>— Bölüşdürmə hazır</span>}
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
                <button onClick={handleSimulate} disabled={submittedUsers.length === 0}
                  style={{ padding: '10px 22px', borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13, cursor: 'pointer',
                    background: mode === 'sim' ? '#f5a623' : '#c9962a', color: '#fff',
                    opacity: submittedUsers.length === 0 ? 0.4 : 1,
                    boxShadow: mode === 'sim' ? '0 4px 16px #f5a62344' : '0 4px 16px #c9962a44' }}>
                  ⚡ Simulyasiya
                </button>
                <button onClick={handleDistribute} disabled={submittedUsers.length === 0 || saved}
                  style={{ padding: '10px 22px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                    border: `1.5px solid ${mode === 'distribute' ? '#52c41a' : '#e0e4f0'}`,
                    background: mode === 'distribute' ? '#52c41a' : '#e7eaf0',
                    color: mode === 'distribute' ? '#fff' : '#8892b0',
                    opacity: (submittedUsers.length === 0 || saved) ? 0.4 : 1,
                    boxShadow: mode === 'distribute' ? '0 4px 16px #52c41a44' : 'none' }}>
                  📋 Bölüşdür
                </button>
              </div>
            </div>
          </div>

          {storyOpen && tree && (
            <StorySim students={submittedUsers} subs={sels} tree={tree} onClose={() => setStoryOpen(false)} />
          )}

          {/* Nəticə — Simulyasiya animasiyalı, Bölüşdür adi */}
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
          {mode === 'sim' && placement && (
            <SimAnimation
              allStudentRows={allStudentRows}
              tree={tree}
              placement={placement}
              sels={sels}
              simStep={simStep} simStarted={simStarted}
              simFinished={simFinished} simRunning={simRunning} simSpeed={simSpeed}
              simTotal={simTotalRef.current}
              animEnabled={animEnabled}
              prezMode={prezMode}
              onStart={() => { setSimStarted(true); setSimRunning(true) }}
              onPause={() => setSimRunning(false)}
              onResume={() => setSimRunning(true)}
              onSkip={() => { setSimStep(simTotalRef.current); setSimRunning(false); setSimStarted(true); setSimFinished(true) }}
              onSpeedCycle={() => setSimSpeed(s => SPEED_NEXT[s])}
              onRestart={() => { setSimStep(0); setSimRunning(false); setSimStarted(false); setSimFinished(false) }}
              onStepBack={() => setSimStep(s => Math.max(0, s - 1))}
              onStepFwd={() => setSimStep(s => Math.min(simTotalRef.current, s + 1))}
              instLabel={activeInst?.label || ''}
              selName={sel?.name || ''}
            />
          )}
        </>
      )}

      {/* ════════════════════════════════════════
          PAKET ÜSULU
          ════════════════════════════════════════ */}
      {method === 'packet' && (
        <>
          {/* Panel */}
          <div style={{ background: '#ffffff', border: '1.5px solid #e7eaf0', borderRadius: 16, padding: '22px 26px', marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ color: '#2b2f3a', fontWeight: 800, fontSize: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span>📦</span> Paket Üsulu
                <span style={{ fontSize: 13, color: '#8a909c', fontWeight: 500, display:'inline-flex', alignItems:'center', gap:5 }}>— <InstIcon icon={activeInst?.icon} size={14} /> {activeInst?.label}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={fullReset}
                  style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #e7eaf0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  ← Geri
                </button>
                {packetsReady && (
                  <button onClick={() => { setPacketsReady(false); setAnimStep(0); setMode(null); setSaved(false) }}
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1.5px solid #ff4d4f', background: 'transparent', color: '#ff4d4f', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    🔄 Sıfırla
                  </button>
                )}
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
                <span>Kursantlar hələ seçim etməyib — <strong>simulyasiya mümkün deyil</strong>. Paketlərə bölmək olar, lakin simulyasiya başlatmaq olmaz.</span>
              </div>
            )}

            {/* Paket sayı seçici */}
            {!packetsReady && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                  <div style={{ color: '#8892b0', fontSize: 13 }}>
                    <span style={{ color: '#fff', fontWeight: 700 }}>{allInstUsers.length}</span>
                    <span style={{ color: '#8892b0' }}> kursant · Neçə paketə bölünsün?</span>
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
                      background: '#f0f2f8',
                      color: '#fff',
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

            {/* Paketlər yarandıqdan sonra bölüşdür düymələri */}
            {packetsReady && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#8892b0' }}>
                  {packets.length} paket · {submittedUsers.length} kursant
                  {mode === 'sim'       && <span style={{ marginLeft: 10, color: '#f5a623', fontWeight: 600 }}>— Simulyasiya</span>}
                  {mode === 'distribute' && !saved && <span style={{ marginLeft: 10, color: '#52c41a', fontWeight: 600 }}>— Bölüşdürmə hazır</span>}
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
                  <button onClick={handleSimulate} disabled={submittedUsers.length === 0}
                    title={submittedUsers.length === 0 ? 'Kursantlar hələ seçim etməyib — simulyasiya mümkün deyil' : undefined}
                    style={{ padding: '10px 22px', borderRadius: 10, border: 'none', fontWeight: 800, fontSize: 13,
                      cursor: submittedUsers.length === 0 ? 'not-allowed' : 'pointer',
                      background: mode === 'sim' ? '#f5a623' : '#c9962a', color: '#fff',
                      opacity: submittedUsers.length === 0 ? 0.4 : 1,
                      boxShadow: mode === 'sim' ? '0 4px 16px #f5a62344' : '0 4px 16px #c9962a44' }}>
                    ⚡ Simulyasiya
                  </button>
                  <button onClick={handleDistribute} disabled={saved}
                    style={{ padding: '10px 22px', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer',
                      border: `1.5px solid ${mode === 'distribute' ? '#52c41a' : '#e0e4f0'}`,
                      background: mode === 'distribute' ? '#52c41a' : '#e7eaf0',
                      color: mode === 'distribute' ? '#fff' : '#8892b0',
                      opacity: saved ? 0.4 : 1,
                      boxShadow: mode === 'distribute' ? '0 4px 16px #52c41a44' : 'none' }}>
                    📋 Bölüşdür
                  </button>
                </div>
              </div>
            )}
          </div>

          {storyOpen && tree && (
            <StorySim packets={packets} subs={sels} tree={tree} onClose={() => setStoryOpen(false)} />
          )}

          {/* SimControls — simulyasiya rejimində paketlərin üstündə */}
          {packetsReady && mode === 'sim' && placement && !simStarted && (
            <div style={{ marginBottom: 16 }}>
              <SimControls
                simStep={simStep} simTotal={simTotalRef.current}
                simStarted={simStarted} simFinished={simFinished}
                simRunning={simRunning} simSpeed={simSpeed}
                onStart={() => { setSimStarted(true); setSimRunning(true) }}
                onPause={() => setSimRunning(false)}
                onResume={() => setSimRunning(true)}
                onSkip={() => { setSimStep(simTotalRef.current); setSimRunning(false); setSimStarted(true); setSimFinished(true) }}
                onSpeedCycle={() => setSimSpeed(s => SPEED_NEXT[s])}
                onRestart={() => { setSimStep(0); setSimRunning(false); setSimStarted(false); setSimFinished(false) }}
              />
            </div>
          )}

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
                        <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6, opacity: 0.8 }}>kursant</span>
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

          {/* ── İxtisas bölgü cədvəli ── */}
          {packetsReady && packets.length > 0 && (() => {
            const leaves = getLeavesWithPath(tree?.nodes || [])
            return (
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="card-head">
                  <div>
                    <div className="card-title">📊 İxtisas Kvota Bölgüsü</div>
                    <div className="card-sub">Hər ixtisasın kvotası paketlərə görə</div>
                  </div>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ minWidth: 500 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', minWidth: 200 }}>İXTİSAS</th>
                        <th style={{ textAlign: 'center', width: 70 }}>CƏMİ</th>
                        {packets.map((p, i) => (
                          <th key={p.num} style={{ textAlign: 'center', width: 70, color: PACK_COLORS[i % PACK_COLORS.length].text }}>
                            P{p.num}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {leaves.map(({ leaf, path }, li) => {
                        return (
                          <tr key={leaf.id}>
                            <td>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{leaf.name}</div>
                              <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                                {path.slice(0, -1).map((n: any) => n.name).join(' → ')}
                              </div>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--text)' }}>
                              {leaf.quota}
                            </td>
                            {packets.map((p, i) => {
                              const sp = p.specs.find((s: any) => s.id === leaf.id)
                              const q  = sp?.quota ?? 0
                              const col = PACK_COLORS[i % PACK_COLORS.length]
                              return (
                                <td key={p.num} style={{ textAlign: 'center' }}>
                                  {q > 0
                                    ? <span style={{ display: 'inline-block', minWidth: 28, padding: '2px 8px', borderRadius: 8, background: col.light, color: col.text, fontWeight: 800, fontSize: 13 }}>{q}</span>
                                    : <span style={{ color: '#ddd', fontSize: 13 }}>—</span>
                                  }
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: '2px solid var(--border)' }}>
                        <td style={{ fontWeight: 700, fontSize: 13 }}>Cəmi kvota</td>
                        <td style={{ textAlign: 'center', fontWeight: 900, fontSize: 15 }}>
                          {leaves.reduce((s, { leaf }) => s + (leaf.quota || 0), 0)}
                        </td>
                        {packets.map((p, i) => {
                          const col = PACK_COLORS[i % PACK_COLORS.length]
                          return (
                            <td key={p.num} style={{ textAlign: 'center' }}>
                              <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 8, background: col.light, color: col.text, fontWeight: 900, fontSize: 14 }}>
                                {p.totalQuota}
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* Nəticə — Bölüşdür adi, Simulyasiya paket animasiyalı */}
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

          {mode === 'sim' && placement && (
            <PacketSimAnimation
              packets={packets}
              animSteps={animSteps}
              sels={sels}
              simStep={simStep} simStarted={simStarted}
              simFinished={simFinished} simRunning={simRunning} simSpeed={simSpeed}
              simTotal={simTotalRef.current}
              onStart={() => { setSimStarted(true); setSimRunning(true) }}
              onPause={() => setSimRunning(false)}
              onResume={() => setSimRunning(true)}
              onSkip={() => { setSimStep(simTotalRef.current); setSimRunning(false); setSimStarted(true); setSimFinished(true) }}
              onSpeedCycle={() => setSimSpeed(s => SPEED_NEXT[s])}
              onRestart={() => { setSimStep(0); setSimRunning(false); setSimStarted(false); setSimFinished(false) }}
            />
          )}
        </>
      )}
    </>
  )
}

// ── Animasiya CSS ─────────────────────────────────────────────────────────────
const SIM_STYLES = `
  @keyframes simRowIn {
    from { opacity:0; transform:translateX(32px); }
    to   { opacity:1; transform:translateX(0); }
  }
  @keyframes simFlash {
    0%   { background:#52c41a20; }
    100% { background:transparent; }
  }
  @keyframes simCardIn {
    from { opacity:0; transform:translateY(18px) scale(0.97); }
    to   { opacity:1; transform:translateY(0) scale(1); }
  }
  @keyframes simPulse {
    0%,100% { opacity:1; }
    50%     { opacity:0.5; }
  }
  @keyframes flyToSpec {
    0%   { transform:scale(1) translateY(0); opacity:1; }
    50%  { transform:scale(1.1) translateY(-8px); opacity:0.8; }
    100% { transform:scale(0.8) translateY(-20px); opacity:0; }
  }
  @keyframes heatPulse {
    0%   { box-shadow:0 0 0 0 rgba(82,196,26,0.5); }
    70%  { box-shadow:0 0 0 10px rgba(82,196,26,0); }
    100% { box-shadow:0 0 0 0 rgba(82,196,26,0); }
  }
  @keyframes counterUp {
    from { transform:translateY(8px); opacity:0; }
    to   { transform:translateY(0);   opacity:1; }
  }
  @keyframes gradientFlow {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes slideInLeft {
    from { opacity:0; transform:translateX(-24px); }
    to   { opacity:1; transform:translateX(0); }
  }
  @keyframes fadeInScale {
    from { opacity:0; transform:scale(0.92); }
    to   { opacity:1; transform:scale(1); }
  }
  .anim-enabled .heat-card { transition: background .5s ease, border-color .4s ease, box-shadow .4s ease !important; }
  .anim-enabled .progress-bar { transition: width .6s cubic-bezier(.4,0,.2,1) !important; }
  .anim-enabled .counter-val  { animation: counterUp .3s ease; }
  .anim-enabled .heat-full    { animation: heatPulse 1.5s ease; }
  @keyframes confettiFall {
    0%   { transform: translateY(-20px) rotate(0deg); opacity:1; }
    100% { transform: translateY(105vh) rotate(720deg); opacity:0; }
  }
  @keyframes finishPop {
    0%   { transform: scale(0.6); opacity:0; }
    50%  { transform: scale(1.08); opacity:1; }
    100% { transform: scale(1); opacity:1; }
  }
  @keyframes studentLand {
    0%   { transform: translateY(-14px) scale(1.04); box-shadow:0 0 24px #0d948866; }
    60%  { transform: translateY(2px) scale(1.01); }
    100% { transform: translateY(0) scale(1); box-shadow:0 0 0 transparent; }
  }
  @keyframes badgePop {
    0%   { transform: scale(0); }
    60%  { transform: scale(1.3); }
    100% { transform: scale(1); }
  }
  @media print {
    body * { visibility: hidden !important; }
    #report-overlay { position: absolute !important; inset: auto !important; background: #fff !important; padding: 0 !important; overflow: visible !important; display: block !important; }
    #official-report, #official-report * { visibility: visible !important; }
    #official-report { position: absolute; left: 0; top: 0; width: 100% !important; max-width: none !important; box-shadow: none !important; border-radius: 0 !important; }
    .no-print { display: none !important; }
    #official-report table { page-break-inside: auto; }
    #official-report tr { page-break-inside: avoid; }
    @page { margin: 12mm; }
  }
`

// ── Ortaq idarəetmə paneli ────────────────────────────────────────────────────
function SimControls({ simStep, simTotal, simStarted, simFinished, simRunning, simSpeed,
  onStart, onPause, onResume, onSkip, onSpeedCycle, onRestart, onStepBack, onStepFwd }: any) {
  const pct = simTotal > 0 ? Math.round((simStep / simTotal) * 100) : 0
  const barColor = pct === 100 ? '#52c41a' : pct >= 60 ? '#00b96b' : pct >= 30 ? '#f5a623' : '#c9962a'

  return (
    <div style={{
      background: '#ffffff', border: '1.5px solid #e7eaf0',
      borderRadius: 10, padding: '0 14px',
      display: 'flex', alignItems: 'center', gap: 12,
      height: 70,
    }}>
      {/* Başlıq + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
        <span style={{ fontSize: 13 }}>⚡</span>
        <span style={{ color: '#2b2f3a', fontWeight: 800, fontSize: 12 }}>Simulyasiya</span>
        {simStarted && !simFinished && simRunning && (
          <span style={{ fontSize: 10, color: '#f5a623', fontWeight: 700, animation: 'simPulse 1s infinite' }}>● Davam edir</span>
        )}
        {simFinished && (
          <span style={{ fontSize: 10, color: '#52c41a', fontWeight: 700 }}>✅ Bitdi</span>
        )}
      </div>

      {/* Progress bar + faiz */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{ flex: 1, height: 5, borderRadius: 4, background: '#f0f2f8', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 4,
            background: `linear-gradient(90deg, ${barColor}, ${barColor}bb)`,
            width: `${pct}%`, transition: 'width .25s ease, background .3s',
            boxShadow: `0 0 6px ${barColor}66`,
          }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 900, color: barColor, flexShrink: 0 }}>
          {simStep}<span style={{ fontSize: 10, color: '#8a909c', fontWeight: 400 }}>/{simTotal}</span>
          <span style={{ marginLeft: 5, fontSize: 11 }}>{pct}%</span>
        </span>
      </div>

      {/* Düymələr */}
      <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
        {!simStarted && !simFinished && (
          <button onClick={onStart} style={{ padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#c9962a,#b8860b)', color: '#fff', fontWeight: 800, fontSize: 11 }}>▶ Başlat</button>
        )}
        {simStarted && !simFinished && (
          simRunning
            ? <button onClick={onPause} style={{ padding: '5px 12px', borderRadius: 7, border: '1.5px solid #f5a623', background: 'transparent', color: '#f5a623', fontWeight: 800, fontSize: 11, cursor: 'pointer' }}>⏸</button>
            : <button onClick={onResume} style={{ padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#c9962a,#b8860b)', color: '#fff', fontWeight: 800, fontSize: 11 }}>▶ Davam et</button>
        )}
        {/* Addım-addım nəzarət (pauza zamanı) */}
        {simStarted && !simRunning && !simFinished && (
          <>
            <button onClick={onStepBack} disabled={simStep <= 0} title="Bir addım geri"
              style={{ padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e0e4f0', background: 'transparent', color: simStep<=0?'#2a3560':'#8892b0', fontWeight: 800, fontSize: 11, cursor: simStep<=0?'default':'pointer' }}>⏮</button>
            <button onClick={onStepFwd} disabled={simStep >= simTotal} title="Bir addım irəli"
              style={{ padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e0e4f0', background: 'transparent', color: simStep>=simTotal?'#2a3560':'#8892b0', fontWeight: 800, fontSize: 11, cursor: simStep>=simTotal?'default':'pointer' }}>⏭</button>
          </>
        )}
        {simStarted && (
          <button onClick={onSpeedCycle} style={{ padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e0e4f0', background: 'transparent', color: '#8892b0', fontWeight: 800, fontSize: 11, cursor: 'pointer', minWidth: 46 }}>⚡ {SPEED_LABEL[simSpeed]}</button>
        )}
        {simStarted && !simFinished && (
          <button onClick={onSkip} style={{ padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e0e4f0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>⏭ Atla</button>
        )}
        {!simStarted && (
          <button onClick={onSkip} style={{ padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e0e4f0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>⏭ Birbaşa</button>
        )}
        {simFinished && (
          <button onClick={onRestart} style={{ padding: '5px 10px', borderRadius: 7, border: '1.5px solid #e0e4f0', background: 'transparent', color: '#8892b0', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>🔄 Yenidən</button>
        )}
      </div>
    </div>
  )
}

// ── Sadə üsul simulyasiya görünüşü ────────────────────────────────────────────
function SimAnimation({ allStudentRows, tree, placement, sels, simStep, simStarted, simFinished, simRunning,
  simSpeed, simTotal, onStart, onPause, onResume, onSkip, onSpeedCycle, onRestart,
  animEnabled = false, prezMode = false, onStepBack, onStepFwd,
  instLabel = '', selName = '' }: any) {
  const [rightTab, setRightTab] = useState<'heat'|'groups'|'feed'>('heat')
  const [showExec, setShowExec] = useState(false)
  const [showFinish, setShowFinish] = useState(false)

  const [selStudent, setSelStudent] = useState<any>(null)   // kursant modal
  const [selSpecId,  setSelSpecId]  = useState<string|null>(null) // ixtisas modal
  const [simSearch,  setSimSearch]  = useState('')          // kursant axtarışı
  const [infoSpec,   setInfoSpec]   = useState<string|null>(null) // ixtisas info popover

  // Final animasiyası: simFinished true olduqda bir dəfə göstər
  useEffect(() => {
    if (simFinished) {
      setShowFinish(true)
      const t = setTimeout(() => setShowFinish(false), 3500)
      return () => clearTimeout(t)
    }
  }, [simFinished])

  // Bitəndə Canlı Lent tabından İstilik Xəritəsinə keç
  useEffect(() => {
    if (simFinished && rightTab === 'feed') setRightTab('heat')
  }, [simFinished])

  const visibleRows: any[] = simStarted ? allStudentRows.slice(0, simStep) : []
  const visPlaced   = visibleRows.filter((r: any) => r.assignment).length
  const visUnplaced = visibleRows.length - visPlaced

  // Son yerləşdirilən ixtisas (highlight üçün)
  const lastPlacedSpec: string | null = (() => {
    for (let i = visibleRows.length - 1; i >= 0; i--) {
      if (visibleRows[i].assignment) return visibleRows[i].assignment.specId
    }
    return null
  })()

  // Hər ixtisas üçün cari dolma sayı
  const fillMap: Record<string, number> = {}
  for (const r of visibleRows) {
    if (r.assignment) {
      const sid = r.assignment.specId
      fillMap[sid] = (fillMap[sid] || 0) + 1
    }
  }

  // Ağacı qruplara ayır (top-level → alt → yarpaq)
  const leavesWithPath = getLeavesWithPath(tree?.nodes || [])
  const groups: Array<{
    id: string; name: string; color: string; bg: string;
    subs: Array<{ id: string; name: string; leaves: Array<{ id: string; name: string; quota: number }> }>
  }> = []
  const gIdxMap = new Map<string, number>()
  const sKeyMap = new Map<string, number>()
  const GRP_COLORS_SIM = [
    { color: '#0d9488', bg: '#0d1e3a', border: '#1e3a6a' },
    { color: '#52d41a', bg: '#0d2a14', border: '#1a4a20' },
    { color: '#f5a623', bg: '#2a1a00', border: '#4a3000' },
    { color: '#a04fff', bg: '#1a0d2a', border: '#36186a' },
    { color: '#ff6b6b', bg: '#2a0d0d', border: '#5a1a1a' },
    { color: '#00d4aa', bg: '#002a22', border: '#004a3a' },
  ]
  for (const { leaf, path } of leavesWithPath) {
    const g0 = path[0] || { id: 'root', name: 'Ümumi' }
    const g1 = path[1] || { id: `sub_${g0.id}`, name: g0.name }
    if (!gIdxMap.has(g0.id)) {
      const c = GRP_COLORS_SIM[groups.length % GRP_COLORS_SIM.length]
      gIdxMap.set(g0.id, groups.length)
      groups.push({ id: g0.id, name: g0.name, color: c.color, bg: c.bg, subs: [] })
    }
    const gi = gIdxMap.get(g0.id)!
    const sKey = `${g0.id}__${g1.id}`
    if (!sKeyMap.has(sKey)) {
      sKeyMap.set(sKey, groups[gi].subs.length)
      groups[gi].subs.push({ id: g1.id, name: g1.name, leaves: [] })
    }
    const si = sKeyMap.get(sKey)!
    groups[gi].subs[si].leaves.push({ id: leaf.id, name: leaf.name, quota: leaf.quota || 0 })
  }

  // İxtisas adı xəritəsi (id → name) + tam path
  const specNameMap: Record<string, string> = {}
  const specPathMap: Record<string, string> = {}
  for (const { leaf, path } of leavesWithPath) {
    specNameMap[leaf.id] = leaf.name
    specPathMap[leaf.id] = path.slice(0, -1).map((n: any) => n.name).join(' → ')
  }

  // Hər ixtisasa düşən kursantlar (cari addıma qədər)
  const specStudentsMap: Record<string, any[]> = {}
  for (const r of visibleRows) {
    if (r.assignment) {
      const sid = r.assignment.specId
      if (!specStudentsMap[sid]) specStudentsMap[sid] = []
      specStudentsMap[sid].push(r)
    }
  }

  const simControlsProps = { simStep, simTotal, simStarted, simFinished, simRunning, simSpeed,
    onStart, onPause, onResume, onSkip, onSpeedCycle, onRestart, onStepBack, onStepFwd }

  // Kursant modalı üçün ranking
  const studentRanking: string[] = selStudent
    ? (sels as any[]).find((s: any) => s.userId === selStudent.user.id)?.ranking || []
    : []
  const studentPlacedSpec: string | null = selStudent?.assignment?.specId || null

  // İxtisas modalı
  const specModalStudents: any[] = selSpecId ? (specStudentsMap[selSpecId] || []) : []
  const specModalQuota: number   = selSpecId
    ? (leavesWithPath.find(({ leaf }) => leaf.id === selSpecId)?.leaf.quota || 0)
    : 0

  // ══ Canlı statistika hesablamaları ══════════════════════════════════════════
  const totalCount  = allStudentRows.length
  const placedPct   = totalCount ? Math.round((visPlaced / totalCount) * 100) : 0
  // Orta seçim sırası (yalnız yerləşdirilənlər)
  const avgChoice   = visPlaced
    ? visibleRows.filter((r: any) => r.assignment).reduce((s: number, r: any) => s + (r.assignment.choiceNum || 0), 0) / visPlaced
    : 0
  // Keçən addım faizi (vaxt yerinə)
  const stepPct = simTotal ? Math.round((Math.min(simStep, simTotal) / simTotal) * 100) : 0

  // ── Mənbə (mülki/lisey) bölgüsü ──────────────────────────────────────────
  const hasSrc = allStudentRows.some((r: any) => r.user.source)
  const srcStats: Record<string, { total: number; placed: number }> = {}
  for (const r of allStudentRows as any[]) {
    const src = r.user.source || 'digər'
    if (!srcStats[src]) srcStats[src] = { total: 0, placed: 0 }
    srcStats[src].total++
  }
  for (const r of visibleRows) {
    if (r.assignment) {
      const src = r.user.source || 'digər'
      srcStats[src].placed++
    }
  }

  // ── Qrup bölgüsü (kursant.group üzrə) ─────────────────────────────────────
  const grpStats: Record<string, { total: number; placed: number }> = {}
  for (const r of allStudentRows as any[]) {
    const g = String(r.user.group || '—')
    if (!grpStats[g]) grpStats[g] = { total: 0, placed: 0 }
    grpStats[g].total++
  }
  for (const r of visibleRows) {
    if (r.assignment) {
      const g = String(r.user.group || '—')
      grpStats[g].placed++
    }
  }
  const grpKeys = Object.keys(grpStats).sort((a, b) => {
    if (a === '*') return 1; if (b === '*') return -1
    const na = Number(a), nb = Number(b)
    return isNaN(na) || isNaN(nb) ? a.localeCompare(b) : na - nb
  })
  // Real qrup təyin olunubmu? (yalnız '—' varsa qrup yoxdur)
  const hasRealGroups = grpKeys.some(g => g !== '—')

  // ── Seçim sırası bölgüsü ──────────────────────────────────────────────────
  const choiceDist: Record<number, number> = {}
  for (const r of visibleRows) {
    if (r.assignment) {
      const c = r.assignment.choiceNum || 0
      choiceDist[c] = (choiceDist[c] || 0) + 1
    }
  }
  const choice1 = choiceDist[1] || 0
  const choice2 = choiceDist[2] || 0
  const choice3p = visPlaced - choice1 - choice2

  // ── Canlı feed (son yerləşdirilənlər) ─────────────────────────────────────
  const feedRows = [...visibleRows].reverse().slice(0, 14)

  // ── Canlı nağıletmə (indi nə baş verir) ───────────────────────────────────
  const lastRow = visibleRows.length ? visibleRows[visibleRows.length - 1] : null
  // Mərhələ təyini (irəliləyişə görə)
  const stageInfo = (() => {
    if (!simStarted) return null
    if (simFinished) return { icon:'🏁', text:'Yerləşdirmə tamamlandı', color:'#52c41a' }
    if (stepPct < 34) return { icon:'🔝', text:'Yüksək ballı kursantlar yerləşdirilir', color:'#0d9488' }
    if (stepPct < 67) return { icon:'⚖️', text:'Orta ballı kursantlar yerləşdirilir', color:'#f5a623' }
    return { icon:'🎯', text:'Son mərhələ — qalan kursantlar yerləşdirilir', color:'#a04fff' }
  })()
  // Cari hadisə mətni
  const eventText = (() => {
    if (!lastRow) return null
    const name = lastRow.user.name
    const score = Number(lastRow.user.score).toFixed(2)
    if (lastRow.assignment) {
      const spec = specNameMap[lastRow.assignment.specId] || '—'
      const cn = lastRow.assignment.choiceNum
      const ordinal = cn === 1 ? 'ilk' : `${cn}-ci`
      return { name, score, spec, cn, ordinal, placed: true }
    }
    return { name, score, placed: false }
  })()

  // ── Hər ixtisas üçün tələb (neçə kursant seçib) ────────────────────────────
  const demandMap: Record<string, number> = {}
  for (const sub of sels as any[]) {
    for (const sid of sub.ranking || []) demandMap[sid] = (demandMap[sid] || 0) + 1
  }

  // ── Hədd balı (cari addıma görə) hər ixtisas üçün ─────────────────────────
  const thresholdMap: Record<string, number> = {}
  for (const [sid, studs] of Object.entries(specStudentsMap)) {
    const scores = (studs as any[]).map((r: any) => r.user.score || 0)
    thresholdMap[sid] = scores.length ? Math.min(...scores) : 0
  }

  // ── YEKUN keçid balı (bütün yerləşdirmə üzrə, addımdan asılı deyil) ─────────
  const finalThresholdMap: Record<string, number> = {}
  const finalQuotaMap: Record<string, number> = {}
  for (const { leaf } of leavesWithPath) finalQuotaMap[leaf.id] = leaf.quota || 0
  for (const r of allStudentRows as any[]) {
    if (r.assignment) {
      const sid = r.assignment.specId
      const sc = r.user.score || 0
      if (finalThresholdMap[sid] === undefined || sc < finalThresholdMap[sid]) finalThresholdMap[sid] = sc
    }
  }

  // ── İstilik xəritəsi rəng funksiyası ──────────────────────────────────────
  function heatColor(pct: number, isFull: boolean) {
    if (isFull) return { bg: 'linear-gradient(135deg,#52c41a,#237804)', text: '#fff', border: '#52c41a' }
    if (pct >= 0.75) return { bg: 'linear-gradient(135deg,#7cc41a,#4a9410)', text: '#fff', border: '#7cc41a' }
    if (pct >= 0.5)  return { bg: 'linear-gradient(135deg,#f5c623,#d4920b)', text: '#1a1a2e', border: '#f5c623' }
    if (pct >= 0.25) return { bg: 'linear-gradient(135deg,#f59623,#d46b08)', text: '#fff', border: '#f59623' }
    if (pct > 0)     return { bg: 'linear-gradient(135deg,#c9962a,#b8860b)', text: '#fff', border: '#c9962a' }
    return { bg: '#0f1530', text: '#3a4860', border: '#e7eaf0' }
  }

  // ── Executive Summary üçün: tam analiz (simFinished olduqda) ───────────────
  const execData = (() => {
    const placedRows = allStudentRows.filter((r: any) => r.assignment)
    const unplacedRows = allStudentRows.filter((r: any) => !r.assignment)
    const cd: Record<number, number> = {}
    for (const r of placedRows) { const c = r.assignment.choiceNum || 0; cd[c] = (cd[c] || 0) + 1 }
    // Ən rəqabətli ixtisaslar (final)
    const specRows = leavesWithPath.map(({ leaf }: any) => {
      const filled = (specStudentsMap[leaf.id] || []).length
      return {
        id: leaf.id, name: leaf.name, quota: leaf.quota || 0, filled,
        empty: (leaf.quota || 0) - filled,
        demand: demandMap[leaf.id] || 0,
        ratio: leaf.quota ? (demandMap[leaf.id] || 0) / leaf.quota : 0,
        threshold: thresholdMap[leaf.id] || 0,
        fillPct: leaf.quota ? Math.round(filled / leaf.quota * 100) : 0,
      }
    })
    const avgC = placedRows.length
      ? placedRows.reduce((s: number, r: any) => s + (r.assignment.choiceNum || 0), 0) / placedRows.length : 0

    // ── Ədalət: mənbə (mülki/lisey) bölgüsü ──
    const srcBreak: Record<string, { total: number; placed: number; c1: number }> = {}
    for (const r of allStudentRows as any[]) {
      const src = r.user.source || 'digər'
      if (!srcBreak[src]) srcBreak[src] = { total: 0, placed: 0, c1: 0 }
      srcBreak[src].total++
      if (r.assignment) { srcBreak[src].placed++; if (r.assignment.choiceNum === 1) srcBreak[src].c1++ }
    }
    // ── Ədalət: qrup bölgüsü ──
    const grpBreak: Record<string, { total: number; placed: number; c1: number }> = {}
    for (const r of allStudentRows as any[]) {
      const g = String(r.user.group || '—')
      if (!grpBreak[g]) grpBreak[g] = { total: 0, placed: 0, c1: 0 }
      grpBreak[g].total++
      if (r.assignment) { grpBreak[g].placed++; if (r.assignment.choiceNum === 1) grpBreak[g].c1++ }
    }

    // ── Məmnunluq balı (0-100): ilk seçim 100, hər sıra aşağı düşdükcə azalır ──
    const totalQuota = specRows.reduce((s, r) => s + r.quota, 0)
    const satisfaction = placedRows.length
      ? Math.round(placedRows.reduce((s: number, r: any) => {
          const cn = r.assignment.choiceNum || 1
          return s + Math.max(0, 100 - (cn - 1) * 12)
        }, 0) / placedRows.length)
      : 0
    const c1pct = placedRows.length ? Math.round((cd[1] || 0) / placedRows.length * 100) : 0

    // ── Tövsiyələr (avtomatik) ──
    const recs: Array<{ icon: string; type: 'good'|'warn'|'info'; text: string }> = []
    if (unplacedRows.length === 0) recs.push({ icon:'✅', type:'good', text:'Bütün kursantlar yerləşdirildi — heç kim kənarda qalmadı.' })
    else recs.push({ icon:'⚠️', type:'warn', text:`${unplacedRows.length} kursant yer tapmadı. Onlara boş ixtisaslardan təklif edilə bilər.` })
    if (c1pct >= 50) recs.push({ icon:'😍', type:'good', text:`Kursantların yarıdan çoxu (${c1pct}%) məhz ilk istədiyi ixtisasa düşdü.` })
    else if (c1pct < 25) recs.push({ icon:'📉', type:'warn', text:`Yalnız ${c1pct}% kursant ilk seçimini aldı — rəqabət yüksək idi.` })
    const emptyCount = specRows.filter(s => s.empty > 0).length
    if (emptyCount > 0) recs.push({ icon:'📭', type:'info', text:`${emptyCount} ixtisasda boş yer qaldı. Gələn il kvotalar yenidən bölünə bilər.` })
    const fullCount = specRows.filter(s => s.empty === 0 && s.quota > 0).length
    if (fullCount > 0) recs.push({ icon:'🎯', type:'good', text:`${fullCount} ixtisas tam dolduruldu — kvotalar səmərəli istifadə edildi.` })

    return {
      placedRows, unplacedRows, cd, specRows, avgChoice: avgC,
      topComp: [...specRows].sort((a, b) => b.ratio - a.ratio).slice(0, 5),
      emptySpecs: specRows.filter(s => s.empty > 0).sort((a, b) => b.empty - a.empty),
      srcBreak, grpBreak, satisfaction, c1pct, totalQuota,
      hasSrc: Object.keys(srcBreak).some(k => k === 'mülki' || k === 'lisey'),
      recs,
    }
  })()

  return (
    <>
      <style>{SIM_STYLES}</style>

      {/* ══ Kursant detail modalı ══ */}
      {selStudent && (
        <div onClick={() => setSelStudent(null)} style={{ position:'fixed', inset:0, background:'#000c', backdropFilter:'blur(3px)', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#ffffff', border:'1px solid #e7eaf0', borderRadius:20, width:560, maxWidth:'96vw', maxHeight:'94vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 40px 100px #000000aa' }}>
            {/* Başlıq */}
            <div style={{ background:'linear-gradient(135deg,#b8860b,#e0a92e)', padding:'14px 20px', display:'flex', alignItems:'center', gap:13, flexShrink:0, position:'relative' }}>
              <div style={{ width:42, height:42, borderRadius:11, flexShrink:0, background:'#ffffff14', border:'1.5px solid #ffffff22', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>👤</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:9, color:'#9aa0ac', fontWeight:700, marginBottom:2, textTransform:'uppercase', letterSpacing:1.2 }}>Kursant Məlumatı</div>
                <div style={{ fontSize:17, fontWeight:900, color:'#fff', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{selStudent.user.name}</div>
                <div style={{ fontSize:11, color:'#8a909c', marginTop:2, display:'flex', alignItems:'center', gap:12 }}>
                  <span>FİN: <span style={{ color:'#5a6070', fontFamily:'monospace' }}>{selStudent.user.fin || '—'}</span></span>
                  <span>Bal: <span style={{ color:'#c9962a', fontWeight:800, fontSize:13 }}>{Number(selStudent.user.score).toFixed(2)}</span></span>
                </div>
              </div>
              <button onClick={() => setSelStudent(null)} style={{ position:'absolute', top:12, right:12, width:30, height:30, borderRadius:8, border:'1px solid #ffffff22', background:'#ffffff10', color:'#9aa0ac', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>✕</button>
            </div>
            {/* Nəticə */}
            {selStudent.assignment && (
              <div style={{ padding:'9px 20px', background:'#f6ffed', borderBottom:'1px solid #cdeccd', flexShrink:0, display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:15 }}>✅</span>
                <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
                  <span style={{ fontSize:10, color:'#3a8050', fontWeight:700, textTransform:'uppercase', letterSpacing:.5 }}>{selStudent.assignment.choiceNum}-ci seçim:</span>
                  <span style={{ fontSize:14, color:'#52c41a', fontWeight:800 }}>{specNameMap[studentPlacedSpec!] || '—'}</span>
                </div>
              </div>
            )}
            {!selStudent.assignment && (
              <div style={{ padding:'9px 20px', background:'#fff0f0', borderBottom:'1px solid #ffd6d6', flexShrink:0, display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:15 }}>❌</span>
                <div style={{ fontSize:13, color:'#cf1322', fontWeight:800 }}>Heç bir ixtisasa yerləşdirilməyib</div>
              </div>
            )}

            {/* ── "Niyə?" izah paneli ── */}
            <div style={{ padding:'11px 20px', background:'#fffdf5', borderBottom:'1px solid #e7eaf0', flexShrink:0 }}>
              <div style={{ fontSize:9, color:'#9a7b1e', fontWeight:800, textTransform:'uppercase', letterSpacing:1, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                <span>🔍</span> Niyə bu nəticə?
              </div>
              {(() => {
                const a = selStudent.assignment
                const ranking = studentRanking
                if (a) {
                  const placedSid = a.specId
                  const threshold = thresholdMap[placedSid]
                  const score = selStudent.user.score || 0
                  // Yuxarı seçimlər niyə alınmadı?
                  const higherChoices = ranking.slice(0, a.choiceNum - 1)
                  // Bərabər ballı rəqib varmı? (eyni ixtisas, eyni bal)
                  const equalCompetitors = (specStudentsMap[placedSid] || []).filter((r: any) =>
                    r.user.id !== selStudent.user.id && Math.abs((r.user.score || 0) - score) < 0.001
                  )
                  // Tiebreaker fənlərini al
                  const pathMap2: Record<string, any[]> = {}
                  for (const { leaf, path } of leavesWithPath) pathMap2[leaf.id] = path
                  const tbSubjects = getTiebreakerSubjects(placedSid, selStudent.user.group || null, pathMap2)
                  // Hər fən üzrə kursantın balı vs rəqiblərin orta balı
                  let tieDecisive: { subj: string; my: number; theirs: number } | null = null
                  if (equalCompetitors.length && tbSubjects.length) {
                    for (const subj of tbSubjects) {
                      const mine = subj === UMUMI_KEY ? score : (selStudent.user.subjects?.[subj] ?? -1)
                      const theirsArr = equalCompetitors.map((c: any) =>
                        subj === UMUMI_KEY ? (c.user.score || 0) : (c.user.subjects?.[subj] ?? -1)
                      )
                      const theirsMax = Math.max(...theirsArr)
                      if (mine !== theirsMax) { tieDecisive = { subj, my: mine, theirs: theirsMax }; break }
                    }
                  }
                  return (
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                        <span style={{ color:'#52c41a', fontSize:12, flexShrink:0 }}>✓</span>
                        <span style={{ fontSize:12, color:'#5a6070', lineHeight:1.4 }}>
                          <b style={{ color:'#52c41a' }}>{specNameMap[placedSid]}</b> onun <b>{a.choiceNum}-ci seçimi</b> idi
                        </span>
                      </div>
                    </div>
                  )
                } else {
                  return (
                    <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                      <span style={{ color:'#ff4d4f', fontSize:12, flexShrink:0 }}>✗</span>
                      <span style={{ fontSize:12, color:'#8892b0', lineHeight:1.4 }}>
                        Seçdiyi bütün ixtisaslar onun balından yüksək ballı kursantlarla dolduğu üçün yer qalmadı
                      </span>
                    </div>
                  )
                }
              })()}
            </div>

            {/* Sıralama */}
            <div style={{ flex:1, overflowY:'auto', padding:'12px 20px' }}>
              <div style={{ fontSize:10, color:'#8a909c', fontWeight:800, marginBottom:8, textTransform:'uppercase', letterSpacing:1 }}>İxtisas Sıralaması · {studentRanking.length} seçim</div>
              {studentRanking.length === 0 && (
                <div style={{ color:'#3a4060', fontSize:13, textAlign:'center', padding:20 }}>Seçim məlumatı yoxdur</div>
              )}
              {studentRanking.map((specId: string, idx: number) => {
                const isPlaced = specId === studentPlacedSpec
                const quota    = finalQuotaMap[specId] || 0
                const thr      = finalThresholdMap[specId]
                const myScore  = selStudent.user.score || 0
                const couldEnter = thr === undefined || myScore >= thr
                const placedCount = (specStudentsMap[specId] || []).length
                const wasFull = placedCount >= quota
                // Tiebreaker analiz
                const pmap: Record<string, any[]> = {}
                for (const { leaf, path } of leavesWithPath) pmap[leaf.id] = path
                let tieLost: { subj: string; my: number; theirs: number; rivals: any[] } | null = null
                if (!isPlaced && couldEnter && wasFull && thr !== undefined && Math.abs(myScore - thr) < 0.001) {
                  const equalsHere = (specStudentsMap[specId] || []).filter((r: any) => Math.abs((r.user.score || 0) - myScore) < 0.001)
                  if (equalsHere.length) {
                    const tbS = getTiebreakerSubjects(specId, selStudent.user.group || null, pmap)
                    for (const subj of tbS) {
                      const mine = subj === UMUMI_KEY ? myScore : (selStudent.user.subjects?.[subj] ?? -1)
                      const theirsMax = Math.max(...equalsHere.map((c: any) =>
                        subj === UMUMI_KEY ? (c.user.score || 0) : (c.user.subjects?.[subj] ?? -1)
                      ))
                      if (mine < theirsMax) { tieLost = { subj, my: mine, theirs: theirsMax, rivals: equalsHere }; break }
                    }
                  }
                }
                const isInfoOpen = infoSpec === specId
                return (
                  <div key={specId} style={{ position:'relative', marginBottom:4 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 10px', borderRadius:9, background: isPlaced ? '#0d2a14' : '#0f1530', border:`1px solid ${isPlaced ? '#52c41a55' : '#e7eaf0'}`, transition:'all .2s' }}>
                      <span style={{ width:22, height:22, borderRadius:6, flexShrink:0, fontSize:11, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center', background: isPlaced ? '#52c41a' : '#1a2040', color: isPlaced ? '#fff' : '#4a5680' }}>{idx + 1}</span>
                      <div style={{ flex:1, minWidth:0, display:'flex', alignItems:'baseline', gap:10 }}>
                        <span style={{ fontSize:12, fontWeight: isPlaced ? 800 : 600, color: isPlaced ? '#52c41a' : '#aeb8d8', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', flexShrink:1, minWidth:0 }}>
                          {specNameMap[specId] || specId}
                        </span>
                        <span style={{ fontSize:10, color:'#4a5680', whiteSpace:'nowrap', flexShrink:0 }}>
                          Kvota {quota} · Keçid <b style={{ color: thr !== undefined ? '#f5a623' : '#3a4860' }}>{thr !== undefined ? thr.toFixed(2) : '—'}</b>
                        </span>
                      </div>
                      {/* Info ikonu — yalnız yerləşməyibsə */}
                      {!isPlaced && (
                        <button onClick={() => setInfoSpec(isInfoOpen ? null : specId)} title="Niyə bu ixtisasa düşmədi?"
                          style={{ width:20, height:20, borderRadius:'50%', flexShrink:0, background: isInfoOpen ? '#c9962a' : '#1a2040', border:'1px solid #e7eaf0', color: isInfoOpen ? '#fff' : '#7088b0', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:900, padding:0 }}>
                          ⓘ
                        </button>
                      )}
                      {/* Statuslu nişan */}
                      {isPlaced
                        ? <span style={{ fontSize:9, fontWeight:800, flexShrink:0, color:'#52c41a', letterSpacing:.3 }}>● YERLƏŞDİ</span>
                        : <span style={{ fontSize:9, fontWeight:800, flexShrink:0, padding:'2px 8px', borderRadius:5, letterSpacing:.2,
                            background: thr === undefined ? '#1a2040' : couldEnter ? '#2a2000' : '#2a1010',
                            color: thr === undefined ? '#4a5680' : couldEnter ? '#f5a623' : '#ff7875' }}>
                            {thr === undefined ? 'BOŞ' : couldEnter ? 'çatırdı' : 'çatmır'}
                          </span>
                      }
                    </div>

                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ Info modal — niyə bu ixtisasa düşmədi? ══ */}
      {infoSpec && selStudent && (() => {
        const specId = infoSpec
        const thr      = finalThresholdMap[specId]
        const quota    = finalQuotaMap[specId] || 0
        const myScore  = selStudent.user.score || 0
        const couldEnter = thr === undefined || myScore >= thr
        const placedCount = (specStudentsMap[specId] || []).length
        const wasFull = placedCount >= quota
        const pmap: Record<string, any[]> = {}
        for (const { leaf, path } of leavesWithPath) pmap[leaf.id] = path
        let tieLost: { subj: string; my: number; theirs: number; rivals: any[] } | null = null
        if (couldEnter && wasFull && thr !== undefined && Math.abs(myScore - thr) < 0.001) {
          const equalsHere = (specStudentsMap[specId] || []).filter((r: any) => Math.abs((r.user.score || 0) - myScore) < 0.001)
          if (equalsHere.length) {
            const tbS = getTiebreakerSubjects(specId, selStudent.user.group || null, pmap)
            for (const subj of tbS) {
              const mine = subj === UMUMI_KEY ? myScore : (selStudent.user.subjects?.[subj] ?? -1)
              const theirsMax = Math.max(...equalsHere.map((c: any) =>
                subj === UMUMI_KEY ? (c.user.score || 0) : (c.user.subjects?.[subj] ?? -1)
              ))
              if (mine < theirsMax) { tieLost = { subj, my: mine, theirs: theirsMax, rivals: equalsHere }; break }
            }
          }
        }
        return (
          <div onClick={() => setInfoSpec(null)} style={{ position:'fixed', inset:0, background:'#000c', zIndex:1300, display:'flex', alignItems:'center', justifyContent:'center', padding:24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background:'#ffffff', border:'1px solid #e7eaf0', borderRadius:18, width:480, maxWidth:'94vw', maxHeight:'82vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px #000a' }}>
              <div style={{ background:'linear-gradient(135deg,#b8860b,#e0a92e)', padding:'16px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
                <div>
                  <div style={{ fontSize:10, color:'#a78bff', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:3 }}>Niyə bu ixtisasa düşmədi?</div>
                  <div style={{ fontSize:15, fontWeight:900, color:'#fff' }}>{specNameMap[specId]}</div>
                  <div style={{ fontSize:11, color:'#a78bff', marginTop:2 }}>Kvota {quota} · Keçid balı {thr !== undefined ? thr.toFixed(2) : '—'}</div>
                </div>
                <button onClick={() => setInfoSpec(null)} style={{ width:30, height:30, borderRadius:8, border:'1px solid #4a3a6a', background:'#ffffff10', color:'#5a6070', fontSize:14, cursor:'pointer' }}>✕</button>
              </div>
              <div style={{ flex:1, overflowY:'auto', padding:'18px 22px' }}>
                {tieLost ? (
                  <>
                    <div style={{ padding:'12px 14px', borderRadius:10, background:'#fff7e6', border:'1px solid #f5a62355', marginBottom:14 }}>
                      <div style={{ fontSize:12, color:'#f5a623', fontWeight:800, marginBottom:6 }}>🏆 Bərabər balda prioritetlə uduzdu</div>
                      <div style={{ fontSize:13, color:'#ffd591', lineHeight:1.6 }}>
                        <b style={{ color:'#fff' }}>{tieLost.subj}</b> fənni üzrə müqayisə:<br/>
                        <span style={{ display:'inline-flex', alignItems:'center', gap:8, marginTop:6, flexWrap:'wrap' }}>
                          <span style={{ padding:'4px 12px', borderRadius:7, background:'#fff0f0', color:'#cf1322', fontWeight:900, fontSize:14 }}>{Number(tieLost.my).toFixed(2)}</span>
                          <span style={{ color:'#8a909c' }}>sənin</span>
                          <span style={{ color:'#8a909c' }}>vs</span>
                          <span style={{ padding:'4px 12px', borderRadius:7, background:'#f0fff4', color:'#52c41a', fontWeight:900, fontSize:14 }}>{Number(tieLost.theirs).toFixed(2)}</span>
                          <span style={{ color:'#8a909c' }}>rəqib</span>
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize:10, color:'#8a909c', fontWeight:800, textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>
                      Bərabər ballı rəqiblər ({tieLost.rivals.length})
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {tieLost.rivals.map((r: any) => (
                        <div key={r.user.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', borderRadius:9, background:'#f6f8ff', border:'1px solid #e7eaf0' }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:700, color:'#5a6070', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.user.name}</div>
                            <div style={{ fontSize:10, color:'#4a5680' }}>Ümumi bal: {Number(r.user.score).toFixed(2)}</div>
                          </div>
                          <div style={{ textAlign:'right', flexShrink:0 }}>
                            <div style={{ fontSize:10, color:'#8a909c' }}>{tieLost!.subj}</div>
                            <div style={{ fontSize:15, fontWeight:900, color:'#52c41a', fontFamily:'monospace' }}>
                              {tieLost!.subj === UMUMI_KEY
                                ? (r.user.score || 0).toFixed(2)
                                : Number(r.user.subjects?.[tieLost!.subj] ?? 0).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : !couldEnter ? (
                  <div style={{ padding:'16px 18px', borderRadius:10, background:'#fff0f0', border:'1px solid #ff4d4f33' }}>
                    <div style={{ fontSize:13, fontWeight:800, color:'#cf1322', marginBottom:8 }}>× Balı çatmadı</div>
                    <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:13, color:'#ffb8b8', flexWrap:'wrap' }}>
                      Hədd balı: <b style={{ color:'#f5a623', fontSize:16 }}>{thr?.toFixed(2)}</b>
                      <span>·</span>
                      Onun balı: <b style={{ color:'#c9962a', fontSize:16 }}>{myScore.toFixed(2)}</b>
                    </div>
                  </div>
                ) : wasFull ? (
                  <div style={{ padding:'16px 18px', borderRadius:10, background:'#fff7e6', border:'1px solid #f5a62333' }}>
                    <div style={{ fontSize:13, fontWeight:800, color:'#f5a623', marginBottom:8 }}>⚠ Sırası gələnə qədər doldu</div>
                    <div style={{ fontSize:13, color:'#ffd591', lineHeight:1.6 }}>
                      Balı çatırdı (<b style={{ color:'#c9962a' }}>{myScore.toFixed(2)}</b> ≥ <b style={{ color:'#f5a623' }}>{thr?.toFixed(2)}</b>), amma onun sırası gələnə qədər <b>{placedCount}/{quota}</b> kvota artıq dolmuşdu.<br/>
                      Daha yüksək ballılar üstün gəldi.
                    </div>
                  </div>
                ) : thr === undefined ? (
                  <div style={{ padding:'16px 18px', borderRadius:10, background:'#ffffff', border:'1px solid #e7eaf0' }}>
                    <div style={{ fontSize:13, color:'#5a6070' }}>Bu ixtisasa heç kim yerləşməyib (boş qaldı).</div>
                  </div>
                ) : (
                  <div style={{ fontSize:13, color:'#aeb8d8' }}>Səbəb dəqiqləşdirilə bilmir.</div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ══ İxtisas detail modalı ══ */}
      {selSpecId && (
        <div onClick={() => setSelSpecId(null)} style={{ position:'fixed', inset:0, background:'#000b', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#ffffff', border:'1px solid #e7eaf0', borderRadius:18, width:440, maxWidth:'96vw', maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px #00000066' }}>
            {/* Başlıq */}
            <div style={{ background:'linear-gradient(135deg,#0d2a14,#1a4020)', padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:11, color:'#3a6040', fontWeight:700, marginBottom:4, textTransform:'uppercase', letterSpacing:1 }}>{specPathMap[selSpecId] || 'İxtisas'}</div>
                <div style={{ fontSize:16, fontWeight:900, color:'#52c41a' }}>{specNameMap[selSpecId] || selSpecId}</div>
                <div style={{ fontSize:12, color:'#3a6040', marginTop:3 }}>
                  Kvota: <span style={{ color:'#52c41a', fontWeight:700 }}>{specModalStudents.length}/{specModalQuota}</span>
                  {specModalStudents.length >= specModalQuota && specModalQuota > 0 && <span style={{ marginLeft:8, color:'#52c41a', fontWeight:800 }}>● DOLU</span>}
                </div>
              </div>
              <button onClick={() => setSelSpecId(null)} style={{ width:34, height:34, borderRadius:9, border:'1px solid #2a5030', background:'transparent', color:'#3a6040', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
            {/* Dolma barı */}
            <div style={{ padding:'10px 22px', background:'#f6ffed', borderBottom:'1px solid #cdeccd', flexShrink:0 }}>
              <div style={{ height:8, borderRadius:5, background:'#f6ffed', overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:5, background:'linear-gradient(90deg,#52c41a,#237804)', width:`${specModalQuota > 0 ? Math.min(100,(specModalStudents.length/specModalQuota)*100) : 0}%`, transition:'width .3s', boxShadow:'0 0 8px #52c41a55' }} />
              </div>
            </div>

            {/* ── Mənbə bölgüsü (mülki / lisey) ── */}
            {(() => {
              const hasSpecSrc = specModalStudents.some((r: any) => r.user.source)
              if (!hasSpecSrc || specModalStudents.length === 0) return null
              const mulki = specModalStudents.filter((r: any) => r.user.source === 'mülki').length
              const lisey = specModalStudents.filter((r: any) => r.user.source === 'lisey').length
              const diger = specModalStudents.length - mulki - lisey
              const tot   = specModalStudents.length
              const pct   = (n: number) => Math.round(n / tot * 100)
              return (
                <div style={{ padding:'12px 22px', background:'#fffdf5', borderBottom:'1px solid #e7eaf0', flexShrink:0 }}>
                  <div style={{ fontSize:9, color:'#9a7b1e', fontWeight:800, textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Mənbəyə görə bölgü</div>
                  {/* Stacked bar */}
                  <div style={{ display:'flex', height:10, borderRadius:5, overflow:'hidden', background:'#f0f2f8', marginBottom:8 }}>
                    {mulki > 0 && <div style={{ width:`${pct(mulki)}%`, background:'#c9962a' }} />}
                    {lisey > 0 && <div style={{ width:`${pct(lisey)}%`, background:'#a04fff' }} />}
                    {diger > 0 && <div style={{ width:`${pct(diger)}%`, background:'#5a6080' }} />}
                  </div>
                  <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
                    {mulki > 0 && (
                      <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                        <span style={{ width:10, height:10, borderRadius:3, background:'#c9962a' }} />
                        <span style={{ color:'#8a909c' }}>Mülki:</span>
                        <b style={{ color:'#c9962a' }}>{mulki}</b>
                        <span style={{ color:'#4a5680' }}>({pct(mulki)}%)</span>
                      </span>
                    )}
                    {lisey > 0 && (
                      <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                        <span style={{ width:10, height:10, borderRadius:3, background:'#a04fff' }} />
                        <span style={{ color:'#8a909c' }}>Lisey:</span>
                        <b style={{ color:'#a04fff' }}>{lisey}</b>
                        <span style={{ color:'#4a5680' }}>({pct(lisey)}%)</span>
                      </span>
                    )}
                    {diger > 0 && (
                      <span style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
                        <span style={{ width:10, height:10, borderRadius:3, background:'#5a6080' }} />
                        <span style={{ color:'#8a909c' }}>Digər:</span>
                        <b style={{ color:'#8a909c' }}>{diger}</b>
                        <span style={{ color:'#4a5680' }}>({pct(diger)}%)</span>
                      </span>
                    )}
                  </div>
                </div>
              )
            })()}

            {/* Kursant siyahısı */}
            <div style={{ flex:1, overflowY:'auto', padding:'14px 22px' }}>
              <div style={{ fontSize:11, color:'#8a909c', fontWeight:700, marginBottom:10, textTransform:'uppercase', letterSpacing:1 }}>
                Yerləşdirilən kursantlar ({specModalStudents.length})
              </div>
              {specModalStudents.length === 0 && (
                <div style={{ color:'#8a909c', fontSize:13, textAlign:'center', padding:20 }}>
                  Hələ heç bir kursant yerləşdirilməyib
                </div>
              )}
              {specModalStudents.map((r: any, idx: number) => (
                <div key={r.user.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:10, marginBottom:5, background:'#f6ffed', border:'1px solid #cdeccd' }}>
                  <span style={{ width:26, height:26, borderRadius:7, flexShrink:0, fontSize:11, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center', background:'#cdeccd', color:'#52c41a' }}>{idx + 1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#c0d8c0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.user.name}</div>
                    <div style={{ fontSize:10, color:'#3a5040', fontFamily:'monospace' }}>{r.user.fin || '—'}</div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:900, color:'#c9962a' }}>{Number(r.user.score).toFixed(2)}</div>
                    <div style={{ fontSize:10, color:'#3a5040' }}>{r.assignment?.choiceNum || '—'}-ci seçim</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Başlamadan əvvəl ── */}
      {!simStarted && (() => {
        const leaves = getLeavesWithPath(tree?.nodes || [])
        const totalQuota = leaves.reduce((s: number, {leaf}: any) => s + (leaf.quota || 0), 0)

        return (
          <>
          <SimControls {...simControlsProps} />

          {/* Hazırlıq Paneli */}
          <div style={{ display:'grid', gridTemplateColumns: prezMode ? '1fr 1fr 1fr' : '1fr 1fr', gap:14, marginBottom:14 }}>
            {/* Ümumi statistika */}
            {[
              { icon:'👥', label:'Kursant', val: allStudentRows.length, color:'#c9962a', bg:'#fbf1d6' },
              { icon:'🎓', label:'İxtisas',  val: leaves.length,          color:'#b8860b', bg:'#fbf1d6' },
              { icon:'📊', label:'Kvota',    val: totalQuota,             color:'#c9962a', bg:'#fbf1d6' },
              { icon:'📋', label:'Seçim',    val: (sels as any[]).length, color:'#b8860b', bg:'#fbf1d6' },
            ].map(s => (
              <div key={s.label} style={{ background:s.bg, borderRadius:12, padding:'16px 18px', display:'flex', alignItems:'center', gap:12, border:`1.5px solid ${s.color}22` }}>
                <div style={{ fontSize:28 }}>{s.icon}</div>
                <div>
                  <div style={{ fontSize:24, fontWeight:900, color:s.color }}>{s.val}</div>
                  <div style={{ fontSize:12, color:'#8892b0', fontWeight:600 }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background:'#f0f4ff', border:'1.5px dashed #c5d0ff', borderRadius:14, padding:'20px 24px', textAlign:'center' }}>
            <div style={{ fontSize:36, marginBottom:10 }}>{animEnabled ? '✨' : '⚡'}</div>
            <div style={{ fontWeight:700, fontSize:15, color:'var(--text)', marginBottom:6 }}>Simulyasiyaya hazır</div>
            <div style={{ fontSize:13, color:'var(--muted)' }}>
              {allStudentRows.length} kursant · {leaves.length} ixtisas · {totalQuota} kvota
            </div>
          </div>
          </>
        )
      })()}

      {/* ── Başladıqdan sonra: tam ekran ── */}
      {simStarted && (
        <div className={animEnabled ? 'anim-enabled' : ''} style={{ position:'fixed', inset:0, zIndex:500, background:'#eef1f5', display:'flex', flexDirection:'column', animation: animEnabled ? 'simCardIn .3s ease' : 'none' }}>

          {/* ── Final animasiyası (tamamlandı) ── */}
          {showFinish && (
            <div style={{ position:'absolute', inset:0, zIndex:600, pointerEvents:'none', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
              {/* Konfeti */}
              {animEnabled && Array.from({ length: 40 }).map((_, i) => {
                const colors = ['#c9962a','#52c41a','#f5a623','#a04fff','#ff6b6b','#00d4aa','#ffd700']
                const left = (i * 2.5 + (i % 5) * 3) % 100
                const delay = (i % 10) * 0.12
                const dur = 2.2 + (i % 5) * 0.3
                return (
                  <span key={i} style={{ position:'absolute', top:0, left:`${left}%`, width: i%3===0?10:7, height: i%3===0?10:7, borderRadius: i%2===0?'50%':2, background: colors[i % colors.length], animation:`confettiFall ${dur}s ease-in ${delay}s forwards` }} />
                )
              })}
              {/* Mərkəz banner */}
              <div style={{ textAlign:'center', animation: animEnabled ? 'finishPop .5s ease' : 'none' }}>
                <div style={{ fontSize:64, marginBottom:12 }}>🎉</div>
                <div style={{ fontSize:32, fontWeight:900, color:'#2b2f3a', textShadow:'0 4px 20px #e0a92e55', marginBottom:8 }}>Simulyasiya Tamamlandı!</div>
                <div style={{ fontSize:16, color:'#9a7b1e', fontWeight:700 }}>
                  {visPlaced} / {totalCount} kursant yerləşdirildi ({placedPct}%)
                </div>
              </div>
            </div>
          )}

          {/* ── Üst panel ── */}
          <div style={{ padding:'12px 24px', background:'#ffffff', borderBottom:'1px solid #e7eaf0', flexShrink:0, display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ flex:1 }}>
              <SimControls {...simControlsProps} />
            </div>
            {/* Prezentasiya modu sayğacları */}
            {prezMode && (
              <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                {[
                  { label:'Yerləşdi',  val: visPlaced,   color:'#52c41a', bg:'#0d2a0d' },
                  { label:'Gözləyir', val: visUnplaced, color:'#f5a623', bg:'#2a1a00' },
                  { label:'Cəmi',     val: allStudentRows.length, color:'#c9962a', bg:'#0d1640' },
                ].map(s => (
                  <div key={s.label} style={{ textAlign:'center', padding:'5px 16px', borderRadius:9, background:s.bg, border:`1px solid ${s.color}44` }}>
                    <div className="counter-val" style={{ fontSize:22, fontWeight:900, color:s.color, fontFamily:'monospace', lineHeight:1 }}>{s.val}</div>
                    <div style={{ fontSize:9, color:`${s.color}88`, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, marginTop:2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={onRestart} title="Çıxış" style={{ flexShrink:0, width:36, height:36, borderRadius:9, border:'1.5px solid #e7eaf0', background:'transparent', color:'#8a909c', fontSize:17, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color='#ff4d4f'; (e.currentTarget as HTMLElement).style.borderColor='#ff4d4f' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color='#5a6080'; (e.currentTarget as HTMLElement).style.borderColor='#3a4060' }}
            >✕</button>
          </div>

          {/* ── Canlı Nağıletmə Lenti (yalnız proses gedərkən) ── */}
          {simStarted && !simFinished && stageInfo && (
            <div style={{ display:'flex', alignItems:'center', gap:0, background:'#eef1f5', borderBottom:'1px solid #e7eaf0', flexShrink:0, overflow:'hidden' }}>
              {/* Mərhələ */}
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'9px 18px', background:`${stageInfo.color}18`, borderRight:`1px solid ${stageInfo.color}33`, flexShrink:0 }}>
                <span style={{ fontSize:15 }}>{stageInfo.icon}</span>
                <span style={{ fontSize:12, fontWeight:800, color:stageInfo.color, whiteSpace:'nowrap' }}>{stageInfo.text}</span>
              </div>
              {/* Cari hadisə */}
              <div style={{ flex:1, padding:'9px 18px', minWidth:0, display:'flex', alignItems:'center', gap:8 }}>
                {eventText ? (
                  <div key={lastRow?.user?.id + '-' + simStep} style={{ display:'flex', alignItems:'center', gap:8, minWidth:0, animation: animEnabled ? 'slideInLeft .3s ease' : 'none' }}>
                    <span style={{ fontSize:14, flexShrink:0 }}>{eventText.placed ? (eventText.cn===1?'🏆':eventText.cn===2?'🥈':'🥉') : '⏳'}</span>
                    <span style={{ fontSize:13, color:'#5a6070', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                      <b style={{ color:'#2b2f3a' }}>{eventText.name}</b>
                      <span style={{ color:'#9a7b1e', margin:'0 5px', fontFamily:'monospace' }}>{eventText.score}</span>
                      {eventText.placed
                        ? <>→ <b style={{ color: eventText.cn===1?'#52c41a':eventText.cn===2?'#0d9488':'#f5a623' }}>{eventText.spec}</b> <span style={{ color:'#8a909c' }}>({eventText.ordinal} seçim)</span></>
                        : <span style={{ color:'#cf1322' }}>→ yer tapmadı</span>}
                    </span>
                  </div>
                ) : (
                  <span style={{ fontSize:12, color:'#3a4860' }}>Yerləşdirmə davam edir...</span>
                )}
              </div>
            </div>
          )}

          {/* ── İki sütun ── */}
          <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

            {/* ══ SOL: Kursant siyahısı ══ */}
            <div style={{ flex:'0 0 58%', display:'flex', flexDirection:'column', borderRight:'1.5px solid #e7eaf0', overflow:'hidden' }}>

              {/* ══ Canlı Statistika Paneli ══ */}
              <div style={{ padding:'14px 18px', borderBottom:'1px solid #e7eaf0', flexShrink:0 }}>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:8 }}>
                  {[
                    { label:'Yerləşdi', val:`${visPlaced}`, sub:`/${totalCount}`, color:'#52c41a', icon:'✅' },
                    { label:'Gözləyir', val:`${visUnplaced}`, sub:'', color:'#f5a623', icon:'⏳' },
                    { label:'Faiz',     val:`${placedPct}`, sub:'%', color:'#c9962a', icon:'📊' },
                    { label:'Orta seçim', val: avgChoice ? avgChoice.toFixed(2) : '—', sub:'', color:'#a04fff', icon:'🎯' },
                    { label:'1-ci seçim', val:`${choice1}`, sub: visPlaced ? `${Math.round(choice1/visPlaced*100)}%` : '', color:'#00d4aa', icon:'🏆' },
                  ].map(s => (
                    <div key={s.label} style={{ background:'#f0f2f8', borderRadius:10, padding:'9px 10px', border:'1px solid #e7eaf0' }}>
                      <div style={{ fontSize:9, color:'#8a909c', marginBottom:3, display:'flex', alignItems:'center', gap:3 }}>
                        <span style={{ fontSize:10 }}>{s.icon}</span>{s.label}
                      </div>
                      <div className={animEnabled ? 'counter-val' : ''} key={`${s.label}-${s.val}`} style={{ fontSize:18, fontWeight:900, color:s.color, lineHeight:1 }}>
                        {s.val}<span style={{ fontSize:11, color:'#3a4860', fontWeight:600 }}>{s.sub}</span>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Tərəqqi zolağı */}
                <div style={{ height:6, borderRadius:4, background:'#f0f2f8', overflow:'hidden', marginTop:10 }}>
                  <div className="progress-bar" style={{ height:'100%', borderRadius:4, width:`${stepPct}%`, background:'linear-gradient(90deg,#c9962a,#52c41a)', transition: animEnabled ? 'width .45s ease' : 'none' }} />
                </div>
              </div>

              {/* Axtarış */}
              <div style={{ padding:'10px 18px', borderBottom:'1px solid #e7eaf0', flexShrink:0, position:'relative' }}>
                <span style={{ position:'absolute', left:30, top:'50%', transform:'translateY(-50%)', fontSize:13, color:'#3a4860' }}>🔍</span>
                <input value={simSearch} onChange={e => setSimSearch(e.target.value)}
                  placeholder="Kursant adı və ya FİN ilə axtar..."
                  style={{ width:'100%', padding:'8px 32px 8px 34px', borderRadius:9, border:'1.5px solid #e7eaf0', background:'#f6f8ff', color:'#2b2f3a', fontSize:12, outline:'none', boxSizing:'border-box' }}
                  onFocus={e => e.currentTarget.style.borderColor = '#c9962a'}
                  onBlur={e => e.currentTarget.style.borderColor = '#2a3060'} />
                {simSearch && (
                  <button onClick={() => setSimSearch('')} style={{ position:'absolute', right:28, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'#8a909c', fontSize:14, cursor:'pointer', padding:0 }}>✕</button>
                )}
              </div>

              {/* Cədvəl başlığı */}
              <div style={{ display:'grid', gridTemplateColumns:'40px 1fr 88px 130px 70px', background:'#f0f2f8', borderBottom:'1px solid #e7eaf0', flexShrink:0 }}>
                {['#','Kursant','Bal','Status','Seçim №'].map((h, i) => (
                  <div key={h} style={{ padding:'8px 10px', fontSize:10, fontWeight:700, color:'#3a4860', textTransform:'uppercase', textAlign: (i===0||i===2||i===4) ? 'center' : 'left' }}>{h}</div>
                ))}
              </div>

              {/* Cədvəl sətirləri */}
              <div style={{ flex:1, overflowY:'auto' }}>
                {visibleRows.length === 0 && (
                  <div style={{ textAlign:'center', padding:40, color:'#2a3060', fontSize:13 }}>
                    ⚡ Kursantlar burada görünəcək
                  </div>
                )}
                {(() => {
                  const q = simSearch.trim().toLowerCase()
                  const filtered = q
                    ? visibleRows.filter((r: any) => (r.user.name || '').toLowerCase().includes(q) || (r.user.fin || '').toLowerCase().includes(q))
                    : visibleRows
                  if (q && filtered.length === 0) {
                    return <div style={{ textAlign:'center', padding:40, color:'#3a4860', fontSize:13 }}>🔍 "{simSearch}" üzrə nəticə tapılmadı</div>
                  }
                  return [...filtered].reverse().map((r: any) => {
                  const i       = visibleRows.indexOf(r)
                  const isLast  = !q && i === visibleRows.length - 1 && !simFinished
                  return (
                    <div key={r.user.id} onClick={() => setSelStudent(r)} style={{ display:'grid', gridTemplateColumns:'40px 1fr 88px 130px 70px', alignItems:'center', borderBottom:'1px solid #141c38', background: isLast ? '#1b2650' : 'transparent', animation: isLast && animEnabled ? 'studentLand .5s cubic-bezier(.34,1.56,.64,1), simFlash .7s ease' : 'none', transition:'background .3s', cursor:'pointer', position:'relative', zIndex: isLast?2:1 }}
                      onMouseEnter={e => { if (!isLast) (e.currentTarget as HTMLElement).style.background = '#f3f4f8' }}
                      onMouseLeave={e => { if (!isLast) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      <div style={{ padding:'9px 10px', textAlign:'center', color:'#2a3860', fontWeight:700, fontSize:12 }}>{i + 1}</div>
                      <div style={{ padding:'9px 10px', display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
                        <div style={{ width:28, height:28, borderRadius:8, flexShrink:0, fontSize:13, background: r.assignment ? '#0d2a14' : '#1e1528', display:'flex', alignItems:'center', justifyContent:'center', animation: isLast && animEnabled && r.assignment ? 'badgePop .5s ease' : 'none' }}>
                          {r.assignment ? '✅' : '👤'}
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontWeight:700, fontSize:12, color:'#2b2f3a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.user.name}</div>
                          <div style={{ fontSize:10, color:'#2a3860', fontFamily:'monospace' }}>{r.user.fin || '—'}</div>
                        </div>
                      </div>
                      <div style={{ padding:'9px 10px', textAlign:'center' }}>
                        <span style={{ padding:'2px 10px', borderRadius:14, background:'#fffdf5', color:'#c9962a', fontWeight:800, fontSize:12 }}>
                          {Number(r.user.score).toFixed(2)}
                        </span>
                      </div>
                      <div style={{ padding:'9px 10px' }}>
                        {r.assignment
                          ? <span style={{ padding:'2px 8px', borderRadius:6, background:'#f0fff4', color:'#52c41a', fontWeight:700, fontSize:11 }}>✅ Yerləşdirilib</span>
                          : <span style={{ padding:'2px 8px', borderRadius:6, background:'#fff7e6', color:'#f5a623', fontWeight:700, fontSize:11 }}>⏳ Gözləyir</span>}
                      </div>
                      <div style={{ padding:'9px 10px', textAlign:'center', fontWeight:800, fontSize:13, color: r.assignment ? '#c9962a' : '#2a3060' }}>
                        {r.assignment?.choiceNum || '—'}
                      </div>
                    </div>
                  )
                  })
                })()}
              </div>
            </div>

            {/* ══ SAĞ: Tablı panel (Heatmap / Qruplar / Feed) ══ */}
            <div style={{ flex:'0 0 42%', display:'flex', flexDirection:'column', background:'#f0f2f8', overflow:'hidden' }}>

              {/* Tab seçici */}
              <div style={{ display:'flex', gap:2, padding:'10px 12px 0', flexShrink:0, borderBottom:'1px solid #e7eaf0' }}>
                {([
                  { key:'heat',   label:'📊 İxtisaslar üzrə Bölgü' },
                  { key:'groups', label:'👥 Qruplar' },
                  // Canlı Lent yalnız proses gedərkən
                  ...(!simFinished ? [{ key:'feed', label:'📡 Canlı Lent' }] : []),
                ] as { key:'heat'|'groups'|'feed'; label:string }[]).map(t => (
                  <button key={t.key} onClick={() => setRightTab(t.key)}
                    style={{ flex:1, padding:'9px 8px', border:'none', cursor:'pointer', fontWeight:700, fontSize:11,
                      background: rightTab===t.key ? '#1a2040' : 'transparent',
                      color: rightTab===t.key ? '#c0ccff' : '#5a6080',
                      borderBottom: rightTab===t.key ? '2px solid #c9962a' : '2px solid transparent',
                      borderRadius:'8px 8px 0 0', marginBottom:-1, transition:'all .15s' }}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{ flex:1, overflowY:'auto', padding:'14px 16px' }}>

                {/* ─── TAB 1: İstilik Xəritəsi ─── */}
                {rightTab === 'heat' && groups.map(g => (
                  <div key={g.id} style={{ marginBottom:16 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:g.color, marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>{g.name}</div>
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8 }}>
                      {g.subs.flatMap(sub => sub.leaves).map(leaf => {
                        const filled = fillMap[leaf.id] || 0
                        const pct    = leaf.quota > 0 ? filled / leaf.quota : 0
                        const isFull = filled >= leaf.quota && leaf.quota > 0
                        const isActive = lastPlacedSpec === leaf.id
                        const hc = heatColor(pct, isFull)
                        return (
                          <div key={leaf.id} onClick={() => filled > 0 && setSelSpecId(leaf.id)}
                            className={`heat-card ${isFull && animEnabled ? 'heat-full' : ''}`}
                            style={{ padding:'10px 12px', borderRadius:10, background: hc.bg, border:`1.5px solid ${isActive ? '#fff' : hc.border}`,
                              cursor: filled > 0 ? 'pointer' : 'default', position:'relative', overflow:'hidden',
                              transform: isActive && animEnabled ? 'scale(1.03)' : 'scale(1)',
                              transition: animEnabled ? 'all .35s' : 'none',
                              boxShadow: isActive ? '0 0 16px #ffffff44' : 'none' }}>
                            {isActive && animEnabled && !simFinished && (
                              <span style={{ position:'absolute', top:6, right:8, fontSize:13, fontWeight:900, color:'#fff', animation:'badgePop .5s ease' }}>+1</span>
                            )}
                            <div style={{ fontSize:11, fontWeight:700, color: hc.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', marginBottom:6 }}>
                              {leaf.name}
                            </div>
                            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                              <span style={{ fontSize:18, fontWeight:900, color: hc.text }}>
                                {filled}<span style={{ fontSize:11, opacity:.7 }}>/{leaf.quota}</span>
                              </span>
                              <span style={{ fontSize:11, fontWeight:800, color: hc.text, opacity:.85 }}>
                                {isFull ? 'DOLU' : `${Math.round(pct*100)}%`}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {/* ─── TAB 2: Qrup Progressi ─── */}
                {rightTab === 'groups' && (
                  <>
                    {/* Mənbə bölgüsü */}
                    {hasSrc && (
                      <div style={{ marginBottom:18 }}>
                        <div style={{ fontSize:11, fontWeight:800, color:'#8892b0', marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>Mənbəyə görə</div>
                        {Object.entries(srcStats).map(([src, st]) => {
                          const pct = st.total ? Math.round(st.placed/st.total*100) : 0
                          const col = src==='mülki' ? '#0d9488' : src==='lisey' ? '#a04fff' : '#8892b0'
                          return (
                            <div key={src} style={{ marginBottom:10 }}>
                              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                                <span style={{ fontSize:12, fontWeight:700, color:col, textTransform:'capitalize' }}>{src}</span>
                                <span style={{ fontSize:11, color:'#8892b0', fontWeight:700 }}>{st.placed}/{st.total} · {pct}%</span>
                              </div>
                              <div style={{ height:8, borderRadius:5, background:'#f0f2f8', overflow:'hidden' }}>
                                <div className="progress-bar" style={{ height:'100%', borderRadius:5, width:`${pct}%`, background:`linear-gradient(90deg,${col},${col}aa)`, transition: animEnabled ? 'width .5s ease' : 'none' }} />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Qrup bölgüsü — yalnız real qrup təyin olunubsa */}
                    {hasRealGroups && (
                      <>
                        <div style={{ fontSize:11, fontWeight:800, color:'#8892b0', marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>Qrupa görə</div>
                        {grpKeys.map(g => {
                          const st = grpStats[g]
                          const pct = st.total ? Math.round(st.placed/st.total*100) : 0
                          return (
                            <div key={g} style={{ marginBottom:10 }}>
                              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                                <span style={{ fontSize:12, fontWeight:700, color:'#5a6070' }}>Qrup {g}</span>
                                <span style={{ fontSize:11, color:'#8892b0', fontWeight:700 }}>{st.placed}/{st.total} · {pct}%</span>
                              </div>
                              <div style={{ height:8, borderRadius:5, background:'#f0f2f8', overflow:'hidden' }}>
                                <div className="progress-bar" style={{ height:'100%', borderRadius:5, width:`${pct}%`, background: pct===100 ? 'linear-gradient(90deg,#52c41a,#237804)' : 'linear-gradient(90deg,#c9962a,#b8860b)', transition: animEnabled ? 'width .5s ease' : 'none' }} />
                              </div>
                            </div>
                          )
                        })}
                      </>
                    )}

                    {/* Seçim sırası bölgüsü */}
                    {visPlaced > 0 && (
                      <div style={{ marginTop:18 }}>
                        <div style={{ fontSize:11, fontWeight:800, color:'#8892b0', marginBottom:8, textTransform:'uppercase', letterSpacing:.5 }}>Seçim sırası</div>
                        <div style={{ display:'flex', gap:6 }}>
                          {[
                            { label:'1-ci', val:choice1, color:'#52c41a' },
                            { label:'2-ci', val:choice2, color:'#c9962a' },
                            { label:'3+',   val:choice3p, color:'#f5a623' },
                          ].map(c => (
                            <div key={c.label} style={{ flex:1, textAlign:'center', padding:'10px', borderRadius:9, background:'#ffffff', border:`1px solid ${c.color}33` }}>
                              <div style={{ fontSize:18, fontWeight:900, color:c.color }}>{c.val}</div>
                              <div style={{ fontSize:10, color:'#8a909c', fontWeight:700 }}>{c.label} seçim</div>
                              <div style={{ fontSize:9, color:'#3a4860' }}>{visPlaced ? Math.round(c.val/visPlaced*100) : 0}%</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* ─── TAB 3: Canlı Lent ─── */}
                {rightTab === 'feed' && (
                  <>
                    {feedRows.length === 0 && (
                      <div style={{ textAlign:'center', padding:40, color:'#2a3060', fontSize:13 }}>📡 Yerləşdirmələr burada görünəcək</div>
                    )}
                    {feedRows.map((r: any, idx: number) => {
                      const a = r.assignment
                      const medal = a ? (a.choiceNum===1 ? '🏆' : a.choiceNum===2 ? '🥈' : '🥉') : '❌'
                      const col   = a ? (a.choiceNum===1 ? '#52c41a' : a.choiceNum===2 ? '#c9962a' : '#f5a623') : '#ff4d4f'
                      return (
                        <div key={r.user.id} onClick={() => setSelStudent(r)}
                          style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 11px', borderRadius:9, marginBottom:6,
                            background:'#ffffff', border:`1px solid ${col}33`, cursor:'pointer',
                            animation: idx===0 && animEnabled && !simFinished ? 'slideInLeft .3s ease' : 'none' }}>
                          <span style={{ fontSize:16, flexShrink:0 }}>{medal}</span>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:12, fontWeight:700, color:'#2b2f3a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.user.name}</div>
                            <div style={{ fontSize:10, color: col, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                              {a ? `${specNameMap[a.specId] || '—'} · ${a.choiceNum}-ci seçim` : 'Yerləşdirilmədi'}
                            </div>
                          </div>
                          <span style={{ fontSize:13, fontWeight:900, color:'#c9962a', flexShrink:0 }}>{Number(r.user.score).toFixed(2)}</span>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>

              {/* Alt: cəmi + tətbiq düyməsi */}
              <div style={{ borderTop:'1px solid #e7eaf0', padding:'12px 16px', flexShrink:0, background:'#eef1f5' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:11, color:'#8a909c', fontWeight:700 }}>Cəmi yerləşdirildi</span>
                  <span style={{ fontSize:16, fontWeight:900, color: visPlaced === totalCount ? '#52c41a' : '#c9962a' }}>
                    {visPlaced}/{totalCount}
                  </span>
                </div>
                <div style={{ height:6, borderRadius:4, background:'#f0f2f8', overflow:'hidden', marginTop:6 }}>
                  <div className="progress-bar" style={{ height:'100%', borderRadius:4, background:'linear-gradient(90deg,#c9962a,#52c41a)', width:`${totalCount > 0 ? (visPlaced/totalCount)*100 : 0}%`, transition: animEnabled ? 'width .45s ease' : 'none' }} />
                </div>
                {simFinished && (
                  <div style={{ marginTop:12 }}>
                    <button onClick={() => setShowExec(true)} style={{ width:'100%', padding:'11px', borderRadius:10, border:'1.5px solid #c9962a', background:'#f0f2f8', color:'#9a7b1e', fontWeight:800, fontSize:13, cursor:'pointer' }}>
                      📊 Hesabatı Aç
                    </button>
                  </div>
                )}
              </div>
            </div>

          </div>

          {/* ══ RƏSMİ HESABAT SƏNƏDİ ══ */}
          {showExec && (() => {
            const placed = execData.placedRows.length
            const unplaced = execData.unplacedRows.length
            const now = new Date()
            const dateStr = `${now.getDate().toString().padStart(2,'0')}.${(now.getMonth()+1).toString().padStart(2,'0')}.${now.getFullYear()}`
            const docNo = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`
            const c1 = execData.cd[1] || 0
            const c2 = execData.cd[2] || 0
            const c3 = execData.cd[3] || 0
            const c4p = placed - c1 - c2 - c3
            const pctOf = (n: number) => placed ? Math.round(n/placed*100) : 0
            const cell: React.CSSProperties = { padding:'8px 12px', fontSize:12, color:'#1a1a2e', border:'1px solid #c8cee0' }
            const th: React.CSSProperties = { padding:'9px 12px', fontSize:11, fontWeight:800, color:'#1a1a2e', border:'1px solid #c8cee0', background:'#eef1f8', textAlign:'left', textTransform:'uppercase', letterSpacing:.3 }
            const sectTitle: React.CSSProperties = { fontSize:13, fontWeight:800, color:'#1a1a2e', margin:'22px 0 10px', paddingBottom:6, borderBottom:'2px solid #1a1f3c', letterSpacing:.3 }
            return (
            <div onClick={() => setShowExec(false)} id="report-overlay" style={{ position:'fixed', inset:0, background:'#000d', zIndex:1400, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:24, overflowY:'auto' }}>
              <div id="official-report" onClick={e => e.stopPropagation()} style={{ background:'#fff', width:820, maxWidth:'97vw', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 90px #000a', fontFamily:"'Times New Roman', Georgia, serif" }}>

                {/* ── Rəsmi sənəd başlığı ── */}
                <div style={{ padding:'28px 40px 20px', borderBottom:'3px double #1a1f3c', textAlign:'center', position:'relative' }}>
                  <button onClick={() => setShowExec(false)} className="no-print" style={{ position:'absolute', top:16, right:16, width:32, height:32, borderRadius:8, border:'1px solid #c8cee0', background:'#f4f6fb', color:'#8a909c', fontSize:16, cursor:'pointer' }}>✕</button>
                  <div style={{ fontSize:13, fontWeight:700, color:'#1a1a2e', letterSpacing:.5, marginBottom:4 }}>MİLLİ MÜDAFİƏ NAZİRLİYİ</div>
                  <div style={{ fontSize:15, fontWeight:800, color:'#1a1a2e', marginBottom:14 }}>{instLabel || 'Hərbi Təhsil Müəssisəsi'}</div>
                  <div style={{ fontSize:19, fontWeight:900, color:'#1a1a2e', letterSpacing:1, marginBottom:6 }}>İXTİSAS YERLƏŞDİRMƏ PROTOKOLU</div>
                  <div style={{ fontSize:12, color:'#444', fontStyle:'italic' }}>{selName || 'Seçim sessiyası'}</div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:16, fontSize:11, color:'#333' }}>
                    <span>Sənəd №: <b>{docNo}</b></span>
                    <span>Tarix: <b>{dateStr}</b></span>
                  </div>
                </div>

                <div style={{ padding:'10px 40px 30px' }}>
                  {/* Giriş mətni */}
                  <p style={{ fontSize:12.5, color:'#1a1a2e', lineHeight:1.7, margin:'16px 0' }}>
                    Bu protokol <b>{instLabel}</b> üzrə <b>{selName}</b> çərçivəsində aparılmış ixtisas yerləşdirmə prosesinin nəticələrini əks etdirir.
                    Yerləşdirmə kursantların imtahan balları və ixtisas seçim sıralaması əsasında, ədalətli rəqabət prinsipi ilə həyata keçirilmişdir.
                  </p>

                  {/* 1. Ümumi göstəricilər */}
                  <div style={sectTitle}>1. ÜMUMİ GÖSTƏRİCİLƏR</div>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <tbody>
                      <tr><td style={{ ...cell, fontWeight:700, width:'60%', background:'#fafbfd' }}>Cəmi kursant sayı</td><td style={{ ...cell, textAlign:'right', fontWeight:800 }}>{totalCount}</td></tr>
                      <tr><td style={{ ...cell, fontWeight:700, background:'#fafbfd' }}>Yerləşdirilən kursant sayı</td><td style={{ ...cell, textAlign:'right', fontWeight:800 }}>{placed} ({totalCount?Math.round(placed/totalCount*100):0}%)</td></tr>
                      <tr><td style={{ ...cell, fontWeight:700, background:'#fafbfd' }}>Yerləşdirilməyən kursant sayı</td><td style={{ ...cell, textAlign:'right', fontWeight:800 }}>{unplaced} ({totalCount?Math.round(unplaced/totalCount*100):0}%)</td></tr>
                      <tr><td style={{ ...cell, fontWeight:700, background:'#fafbfd' }}>Ümumi kvota / istifadə olunan</td><td style={{ ...cell, textAlign:'right', fontWeight:800 }}>{execData.totalQuota} / {placed}</td></tr>
                      <tr><td style={{ ...cell, fontWeight:700, background:'#fafbfd' }}>İxtisas sayı</td><td style={{ ...cell, textAlign:'right', fontWeight:800 }}>{execData.specRows.length}</td></tr>
                    </tbody>
                  </table>

                  {/* 2. Seçim sırası üzrə təhlil */}
                  <div style={sectTitle}>2. SEÇİM SIRASI ÜZRƏ TƏHLİL</div>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr><th style={th}>Seçim sırası</th><th style={{ ...th, textAlign:'center' }}>Kursant sayı</th><th style={{ ...th, textAlign:'center' }}>Faiz</th></tr></thead>
                    <tbody>
                      {[
                        { label:'1-ci seçiminə yerləşdirilən', val:c1 },
                        { label:'2-ci seçiminə yerləşdirilən', val:c2 },
                        { label:'3-cü seçiminə yerləşdirilən', val:c3 },
                        { label:'4-cü və sonrakı seçiminə yerləşdirilən', val:c4p },
                      ].filter(r => r.val > 0).map(r => (
                        <tr key={r.label}><td style={cell}>{r.label}</td><td style={{ ...cell, textAlign:'center', fontWeight:700 }}>{r.val}</td><td style={{ ...cell, textAlign:'center' }}>{pctOf(r.val)}%</td></tr>
                      ))}
                      <tr><td style={{ ...cell, fontWeight:800, background:'#eef1f8' }}>CƏMİ</td><td style={{ ...cell, textAlign:'center', fontWeight:800, background:'#eef1f8' }}>{placed}</td><td style={{ ...cell, textAlign:'center', fontWeight:800, background:'#eef1f8' }}>100%</td></tr>
                    </tbody>
                  </table>

                  {/* 3. İxtisaslar üzrə bölgü */}
                  <div style={sectTitle}>3. İXTİSASLAR ÜZRƏ BÖLGÜ</div>
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr>
                      <th style={{ ...th, width:32, textAlign:'center' }}>№</th>
                      <th style={th}>İxtisasın adı</th>
                      <th style={{ ...th, textAlign:'center' }}>Kvota</th>
                      <th style={{ ...th, textAlign:'center' }}>Dolu</th>
                      <th style={{ ...th, textAlign:'center' }}>Boş</th>
                      <th style={{ ...th, textAlign:'center' }}>Hədd balı</th>
                    </tr></thead>
                    <tbody>
                      {[...execData.specRows].sort((a,b)=>b.filled-a.filled).map((r, i) => (
                        <tr key={r.id}>
                          <td style={{ ...cell, textAlign:'center', color:'#666' }}>{i+1}</td>
                          <td style={cell}>{r.name}</td>
                          <td style={{ ...cell, textAlign:'center' }}>{r.quota}</td>
                          <td style={{ ...cell, textAlign:'center', fontWeight:700 }}>{r.filled}</td>
                          <td style={{ ...cell, textAlign:'center', color: r.empty>0?'#b3001b':'#1a1a2e' }}>{r.empty || '—'}</td>
                          <td style={{ ...cell, textAlign:'center' }}>{r.filled>0 ? r.threshold.toFixed(2) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 4. Qruplar üzrə bölgü */}
                  <div style={sectTitle}>4. QRUPLAR ÜZRƏ BÖLGÜ</div>
                  {execData.hasSrc && (
                    <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:14 }}>
                      <thead><tr><th style={th}>Mənbə</th><th style={{ ...th, textAlign:'center' }}>Cəmi</th><th style={{ ...th, textAlign:'center' }}>Yerləşdi</th><th style={{ ...th, textAlign:'center' }}>Faiz</th></tr></thead>
                      <tbody>
                        {Object.entries(execData.srcBreak).filter(([k]) => k!=='digər').map(([src, st]: any) => (
                          <tr key={src}><td style={{ ...cell, textTransform:'capitalize', fontWeight:700 }}>{src}</td><td style={{ ...cell, textAlign:'center' }}>{st.total}</td><td style={{ ...cell, textAlign:'center', fontWeight:700 }}>{st.placed}</td><td style={{ ...cell, textAlign:'center' }}>{st.total?Math.round(st.placed/st.total*100):0}%</td></tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <table style={{ width:'100%', borderCollapse:'collapse' }}>
                    <thead><tr><th style={th}>Qrup</th><th style={{ ...th, textAlign:'center' }}>Cəmi</th><th style={{ ...th, textAlign:'center' }}>Yerləşdi</th><th style={{ ...th, textAlign:'center' }}>Faiz</th></tr></thead>
                    <tbody>
                      {Object.entries(execData.grpBreak).sort((a,b) => { if(a[0]==='*')return 1; if(b[0]==='*')return -1; const na=Number(a[0]),nb=Number(b[0]); return isNaN(na)||isNaN(nb)?a[0].localeCompare(b[0]):na-nb }).map(([g, st]: any) => (
                        <tr key={g}><td style={{ ...cell, fontWeight:700 }}>Qrup {g}</td><td style={{ ...cell, textAlign:'center' }}>{st.total}</td><td style={{ ...cell, textAlign:'center', fontWeight:700 }}>{st.placed}</td><td style={{ ...cell, textAlign:'center' }}>{st.total?Math.round(st.placed/st.total*100):0}%</td></tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 5. Nəticə və təkliflər */}
                  <div style={sectTitle}>5. NƏTİCƏ VƏ TƏKLİFLƏR</div>
                  <ol style={{ margin:'0 0 0 18px', padding:0 }}>
                    {execData.recs.map((rec, i) => (
                      <li key={i} style={{ fontSize:12.5, color:'#1a1a2e', lineHeight:1.7, marginBottom:7 }}>{rec.text}</li>
                    ))}
                  </ol>

                  {/* 6. Təsdiq hissəsi */}
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:48, paddingTop:10 }}>
                    <div style={{ textAlign:'center', width:'40%' }}>
                      <div style={{ borderTop:'1px solid #1a1a2e', paddingTop:6, fontSize:11, color:'#333' }}>
                        <b>HAZIRLADI</b><br/>
                        <span style={{ fontSize:10, color:'#666' }}>(vəzifə, ad, soyad, imza)</span>
                      </div>
                    </div>
                    <div style={{ textAlign:'center', width:'40%' }}>
                      <div style={{ borderTop:'1px solid #1a1a2e', paddingTop:6, fontSize:11, color:'#333' }}>
                        <b>TƏSDİQ EDİRƏM</b><br/>
                        <span style={{ fontSize:10, color:'#666' }}>(vəzifə, ad, soyad, imza)</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ marginTop:30, textAlign:'center', fontSize:10, color:'#888', borderTop:'1px solid #e0e4f0', paddingTop:10 }}>
                    Bu sənəd avtomatik yaradılmış simulyasiya nəticəsidir · {dateStr} · MMU İxtisas Sistemi
                  </div>

                  {/* Çap düyməsi */}
                  <div className="no-print" style={{ display:'flex', gap:10, justifyContent:'center', marginTop:24 }}>
                    <button onClick={() => window.print()} style={{ padding:'11px 28px', borderRadius:8, border:'none', background:'#f0f2f8', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'system-ui' }}>
                      🖨️ Çap et / PDF
                    </button>
                    <button onClick={() => setShowExec(false)} style={{ padding:'11px 24px', borderRadius:8, border:'1.5px solid #c8cee0', background:'#fff', color:'#8a909c', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:'system-ui' }}>
                      Bağla
                    </button>
                  </div>
                </div>
              </div>
            </div>
            )
          })()}

        </div>
      )}
    </>
  )
}

// ── Paket üsulu simulyasiya görünüşü ──────────────────────────────────────────
function PacketSimAnimation({ packets, animSteps, sels, simStep, simStarted, simFinished,
  simRunning, simSpeed, simTotal,
  onStart, onPause, onResume, onSkip, onSpeedCycle, onRestart }: any) {

  const [selStudent,   setSelStudent]   = useState<any>(null)
  const [selSpecKey,   setSelSpecKey]   = useState<{ specId: string; pIdx: number } | null>(null)
  const [selSimPacket, setSelSimPacket] = useState<any>(null)   // tamamlandı modal

  // ── Cari aktiv ixtisası tap (modal üçün) ─────────────────────────────────
  let activeSpec: { pIdx: number; sIdx: number } | null = null
  if (simStarted && animSteps.length) {
    const limit = Math.min(simStep, animSteps.length - 1)
    let lastOpen: any = null
    for (let i = 0; i <= limit; i++) {
      const s = animSteps[i]
      if (s.type === 'open-spec') lastOpen = s
      if (s.type === 'spec-done' && lastOpen && s.pIdx === lastOpen.pIdx && s.sIdx === lastOpen.sIdx) lastOpen = null
    }
    if (lastOpen) activeSpec = { pIdx: lastOpen.pIdx, sIdx: lastOpen.sIdx }
  }

  // ── Fon kartları üçün ümumi vəziyyət ─────────────────────────────────────
  const displayState: Record<number, any> = {}
  if (simStarted && animSteps.length) {
    const limit = Math.min(simStep, animSteps.length - 1)
    for (let i = 0; i <= limit; i++) {
      const s = animSteps[i]
      if (!s || s.pIdx === undefined) continue
      const { type, pIdx, sIdx } = s
      if (!displayState[pIdx]) displayState[pIdx] = { open: false, done: false, specs: {} }
      const pk = displayState[pIdx]
      if (sIdx !== undefined && !pk.specs[sIdx])
        pk.specs[sIdx] = { open: false, done: false, competitors: [], noCompetitors: false }
      const sp = sIdx !== undefined ? pk.specs[sIdx] : null
      if      (type === 'open-packet')         pk.open = true
      else if (type === 'packet-done')         pk.done = true
      else if (type === 'open-spec'    && sp)  sp.open = true
      else if (type === 'spec-done'    && sp)  sp.done = true
      else if (type === 'no-competitors' && sp) sp.noCompetitors = true
      else if (type === 'competitor'   && sp)  sp.competitors.push({ student: s.student, isWinner: s.isWinner })
    }
  }

  // ── İxtisas və kursant xəritələri ────────────────────────────────────────
  const specNameMap: Record<string, string> = {}
  const specPathMap: Record<string, string> = {}
  const specPacketQuota: Record<string, Record<number, number>> = {}   // specId → pIdx → quota
  for (let pi = 0; pi < (packets as any[]).length; pi++) {
    const p = (packets as any[])[pi]
    for (const spec of p.specs || []) {
      specNameMap[spec.id] = spec.name
      specPathMap[spec.id] = spec.path?.slice(0, -1).map((n: any) => n.name).join(' → ') || ''
      if (!specPacketQuota[spec.id]) specPacketQuota[spec.id] = {}
      specPacketQuota[spec.id][pi] = spec.quota
    }
  }

  // Cari vəziyyətə əsasən: hansı kursant hansı ixtisasa düşüb (pIdx + specId)
  const studentAssignMap: Record<string, { specId: string; pIdx: number }> = {}
  const specStudentsMap:  Record<string, Record<number, any[]>> = {}   // specId → pIdx → student[]
  for (let pi = 0; pi < (packets as any[]).length; pi++) {
    const p   = (packets as any[])[pi]
    const pkD = displayState[pi]
    if (!pkD) continue
    for (const [sIdxStr, spDisp] of Object.entries(pkD.specs || {}) as any[]) {
      const sIdx = parseInt(sIdxStr)
      const spec = p.specs?.[sIdx]
      if (!spec) continue
      if (!specStudentsMap[spec.id]) specStudentsMap[spec.id] = {}
      if (!specStudentsMap[spec.id][pi]) specStudentsMap[spec.id][pi] = []
      for (const c of (spDisp as any).competitors || []) {
        if (c.isWinner) {
          specStudentsMap[spec.id][pi].push(c.student)
          studentAssignMap[c.student.id] = { specId: spec.id, pIdx: pi }
        }
      }
    }
  }

  // Seçilmiş kursantın ranking-i
  const studentRanking: string[] = selStudent
    ? (sels as any[]).find((s: any) => s.userId === selStudent.id)?.ranking || []
    : []
  const studentPlacedSpec = selStudent ? studentAssignMap[selStudent.id] : null

  // Seçilmiş ixtisasın kursantları
  const selSpecStudents: any[] = selSpecKey
    ? (specStudentsMap[selSpecKey.specId]?.[selSpecKey.pIdx] || [])
    : []
  const selSpecQuota: number = selSpecKey
    ? (specPacketQuota[selSpecKey.specId]?.[selSpecKey.pIdx] || 0)
    : 0

  // ── Modal məzmunu ─────────────────────────────────────────────────────────
  let modalData: any = null
  if (activeSpec) {
    const { pIdx, sIdx } = activeSpec
    const p    = (packets as any[])[pIdx]
    const spec = p?.specs?.[sIdx]
    if (p && spec) {
      const col         = PACK_COLORS[pIdx % PACK_COLORS.length]
      const competitors: any[] = []
      let noCompetitors = false
      const limit = Math.min(simStep, animSteps.length - 1)
      for (let i = 0; i <= limit; i++) {
        const s = animSteps[i]
        if (s.type === 'competitor'    && s.pIdx === pIdx && s.sIdx === sIdx)
          competitors.push({ student: s.student, isWinner: s.isWinner })
        if (s.type === 'no-competitors' && s.pIdx === pIdx && s.sIdx === sIdx)
          noCompetitors = true
      }
      const filled = competitors.filter((c: any) => c.isWinner).length
      const pct    = spec.quota > 0 ? Math.round((filled / spec.quota) * 100) : 0
      const winnerScores = competitors.filter((c: any) => c.isWinner).map((c: any) => Number(c.student.score))
      const threshold = winnerScores.length ? Math.min(...winnerScores) : null   // keçid balı (ən aşağı qəbul olan)
      modalData = {
        col, pIdx, sIdx,
        packetNum:  p.num,
        specId:     spec.id,
        specName:   spec.name,
        specPath:   spec.path?.slice(0, -1).map((n: any) => n.name).join(' → '),
        totalSpecs: p.specs.length,
        quota:      spec.quota,
        filled, pct, threshold,
        isFull:        filled >= spec.quota,
        competitors, noCompetitors,
      }
    }
  }

  // ── Cari aktiv paketin indeksi (mərkəz sütun üçün) ───────────────────────
  let currentPIdx: number | null = null
  if (simStarted && animSteps.length) {
    const limit = Math.min(simStep, animSteps.length - 1)
    for (let i = 0; i <= limit; i++) {
      if (animSteps[i]?.type === 'open-packet') currentPIdx = animSteps[i].pIdx
    }
  }

  return (
    <>
      <style>{SIM_STYLES}</style>

      {/* ══ Kursant detail modalı ══ */}
      {selStudent && (
        <div onClick={() => setSelStudent(null)} style={{ position:'fixed', inset:0, background:'#000b', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#ffffff', border:'1px solid #e7eaf0', borderRadius:18, width:480, maxWidth:'96vw', maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px #00000066' }}>
            {/* Başlıq */}
            <div style={{ background:'linear-gradient(135deg,#b8860b,#e0a92e)', padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:11, color:'#5a7080', fontWeight:700, marginBottom:4, textTransform:'uppercase', letterSpacing:1 }}>Kursant detayı</div>
                <div style={{ fontSize:16, fontWeight:900, color:'#fff' }}>{selStudent.name}</div>
                <div style={{ fontSize:12, color:'#5a7080', marginTop:3 }}>
                  FİN: {selStudent.fin || '—'} · Bal: <span style={{ color:'#c9962a', fontWeight:700 }}>{Number(selStudent.score).toFixed(2)}</span>
                </div>
              </div>
              <button onClick={() => setSelStudent(null)} style={{ width:34, height:34, borderRadius:9, border:'1px solid #3a4860', background:'transparent', color:'#8a909c', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
            {/* Nəticə */}
            {studentPlacedSpec ? (
              <div style={{ padding:'10px 22px', background:'#f6ffed', borderBottom:'1px solid #cdeccd', flexShrink:0, display:'flex', alignItems:'center', gap:10 }}>
                <span style={{ fontSize:13 }}>✅</span>
                <div>
                  <span style={{ fontSize:11, color:'#52c41a', fontWeight:700 }}>Yerləşdirildi: </span>
                  <span style={{ fontSize:13, color:'#52c41a', fontWeight:800 }}>{specNameMap[studentPlacedSpec.specId] || '—'}</span>
                  {' '}<span style={{ fontSize:10, color:'#3a6040' }}>(Paket {studentPlacedSpec.pIdx + 1})</span>
                </div>
              </div>
            ) : (
              <div style={{ padding:'10px 22px', background:'#fff0f0', borderBottom:'1px solid #ffd6d6', flexShrink:0 }}>
                <span style={{ fontSize:12, color:'#cf1322', fontWeight:700 }}>❌ Heç bir ixtisasa yerləşdirilməyib</span>
              </div>
            )}
            {/* Sıralama */}
            <div style={{ flex:1, overflowY:'auto', padding:'14px 22px' }}>
              <div style={{ fontSize:11, color:'#8a909c', fontWeight:700, marginBottom:10, textTransform:'uppercase', letterSpacing:1 }}>İxtisas Sıralaması ({studentRanking.length})</div>
              {studentRanking.length === 0 && (
                <div style={{ color:'#3a4060', fontSize:13, textAlign:'center', padding:20 }}>Seçim məlumatı yoxdur</div>
              )}
              {studentRanking.map((specId: string, idx: number) => {
                const isPlaced = specId === studentPlacedSpec?.specId
                return (
                  <div key={specId} style={{ display:'flex', alignItems:'center', gap:10, padding:'7px 10px', borderRadius:9, marginBottom:4, background: isPlaced ? '#0d2a14' : '#0f1530', border:`1px solid ${isPlaced ? '#52c41a44' : '#e7eaf0'}` }}>
                    <span style={{ width:26, height:26, borderRadius:7, flexShrink:0, fontSize:12, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center', background: isPlaced ? '#52c41a' : '#1a2040', color: isPlaced ? '#fff' : '#3a4860' }}>{idx + 1}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight: isPlaced ? 800 : 500, color: isPlaced ? '#52c41a' : '#8892b0', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {specNameMap[specId] || specId}
                        {isPlaced && <span style={{ marginLeft:8, fontSize:10, color:'#52c41a' }}>← YERLƏŞDİRİLDİ</span>}
                      </div>
                      {specPathMap[specId] && (
                        <div style={{ fontSize:10, color:'#e7eaf0', marginTop:1 }}>{specPathMap[specId]}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ══ İxtisas detail modalı ══ */}
      {selSpecKey && (
        <div onClick={() => setSelSpecKey(null)} style={{ position:'fixed', inset:0, background:'#000b', zIndex:1100, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:'#ffffff', border:'1px solid #e7eaf0', borderRadius:18, width:440, maxWidth:'96vw', maxHeight:'88vh', display:'flex', flexDirection:'column', overflow:'hidden', boxShadow:'0 32px 80px #00000066' }}>
            {/* Başlıq */}
            <div style={{ background:'linear-gradient(135deg,#0d2a14,#1a4020)', padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
              <div>
                <div style={{ fontSize:11, color:'#3a6040', fontWeight:700, marginBottom:4, textTransform:'uppercase', letterSpacing:1 }}>
                  {specPathMap[selSpecKey.specId] || 'İxtisas'} · Paket {selSpecKey.pIdx + 1}
                </div>
                <div style={{ fontSize:16, fontWeight:900, color:'#52c41a' }}>{specNameMap[selSpecKey.specId] || selSpecKey.specId}</div>
                <div style={{ fontSize:12, color:'#3a6040', marginTop:3 }}>
                  Kvota: <span style={{ color:'#52c41a', fontWeight:700 }}>{selSpecStudents.length}/{selSpecQuota}</span>
                  {selSpecStudents.length >= selSpecQuota && selSpecQuota > 0 && <span style={{ marginLeft:8, color:'#52c41a', fontWeight:800 }}>● DOLU</span>}
                </div>
              </div>
              <button onClick={() => setSelSpecKey(null)} style={{ width:34, height:34, borderRadius:9, border:'1px solid #2a5030', background:'transparent', color:'#3a6040', fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
            {/* Dolma barı */}
            <div style={{ padding:'10px 22px', background:'#f6ffed', borderBottom:'1px solid #cdeccd', flexShrink:0 }}>
              <div style={{ height:8, borderRadius:5, background:'#f6ffed', overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:5, background:'linear-gradient(90deg,#52c41a,#237804)', width:`${selSpecQuota > 0 ? Math.min(100,(selSpecStudents.length/selSpecQuota)*100) : 0}%`, transition:'width .3s', boxShadow:'0 0 8px #52c41a55' }} />
              </div>
            </div>
            {/* Kursant siyahısı */}
            <div style={{ flex:1, overflowY:'auto', padding:'14px 22px' }}>
              <div style={{ fontSize:11, color:'#8a909c', fontWeight:700, marginBottom:10, textTransform:'uppercase', letterSpacing:1 }}>
                Yerləşdirilən kursantlar ({selSpecStudents.length})
              </div>
              {selSpecStudents.length === 0 && (
                <div style={{ color:'#8a909c', fontSize:13, textAlign:'center', padding:20 }}>
                  Hələ heç bir kursant yerləşdirilməyib
                </div>
              )}
              {selSpecStudents.map((u: any, idx: number) => (
                <div key={u.id} style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 12px', borderRadius:10, marginBottom:5, background:'#f6ffed', border:'1px solid #cdeccd' }}>
                  <span style={{ width:26, height:26, borderRadius:7, flexShrink:0, fontSize:11, fontWeight:900, display:'flex', alignItems:'center', justifyContent:'center', background:'#cdeccd', color:'#52c41a' }}>{idx + 1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#2b2f3a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.name}</div>
                    <div style={{ fontSize:10, color:'#5a6070', fontFamily:'monospace' }}>{u.fin || '—'}</div>
                  </div>
                  <div style={{ textAlign:'right', flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:900, color:'#c9962a' }}>{Number(u.score).toFixed(2)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ══ Paket xülasə modalı (simFinished, klik ilə açılır) ══ */}
      {selSimPacket && (() => {
        const { p, pIdx, pkDisp, col } = selSimPacket
        // Hər ixtisas üçün yerləşdirilmiş kursantlar
        const specRows = (p.specs || []).map((spec: any, sIdx: number) => {
          const spDisp = pkDisp.specs?.[sIdx]
          const winners: any[] = (spDisp?.competitors || []).filter((c: any) => c.isWinner).map((c: any) => c.student)
          return { spec, sIdx, winners, filled: winners.length, isFull: winners.length >= spec.quota }
        })
        const totalPlaced = specRows.reduce((s: number, r: any) => s + r.filled, 0)
        return (
          <div onClick={() => setSelSimPacket(null)} style={{ position: 'fixed', inset: 0, background: '#000c', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 22, width: 680, maxWidth: '96vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: `0 32px 80px ${col.shadow}` }}>

              {/* Başlıq */}
              <div style={{ background: col.bg, padding: '22px 28px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#ffffff66', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 5 }}>Paket {p.num} · Yerləşdirmə nəticəsi</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#fff', marginBottom: 4 }}>
                      👥 {p.count} kursant &nbsp;·&nbsp; 🎓 {(p.specs || []).length} ixtisas
                    </div>
                    <div style={{ fontSize: 13, color: '#ffffff88' }}>
                      Bal: {p.minScore.toFixed(1)} – {p.maxScore.toFixed(1)} &nbsp;·&nbsp;
                      Yerləşdirilib: <span style={{ color: '#52c41a', fontWeight: 800 }}>{totalPlaced}</span> / {p.count}
                    </div>
                  </div>
                  <button onClick={() => setSelSimPacket(null)} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: '#ffffff22', color: '#fff', fontSize: 18, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
                </div>
              </div>

              {/* İxtisas + kursant siyahısı */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {specRows.map(({ spec, sIdx, winners, filled, isFull }: any) => (
                  <div key={sIdx} style={{ borderBottom: '1.5px solid #f0f2fa' }}>
                    {/* İxtisas başlığı */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px', background: isFull ? '#f6ffed' : '#fafbff' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: isFull ? 'linear-gradient(135deg,#52c41a,#237804)' : col.light, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: isFull ? '#fff' : col.text, fontWeight: 900 }}>
                        {sIdx + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: isFull ? '#237804' : '#1a1f3c', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {spec.name}
                          {isFull && <span style={{ marginLeft: 8, fontSize: 10, color: '#52c41a', fontWeight: 800 }}>● DOLU</span>}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {spec.path?.slice(0, -1).map((n: any) => n.name).join(' → ')}
                        </div>
                      </div>
                      {/* Kvota barı */}
                      <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 90 }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: isFull ? '#52c41a' : col.text, lineHeight: 1 }}>
                          {filled}<span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>/{spec.quota}</span>
                        </div>
                        <div style={{ height: 5, borderRadius: 4, background: '#fbf1d6', overflow: 'hidden', marginTop: 4, width: 80 }}>
                          <div style={{ height: '100%', borderRadius: 4, width: `${spec.quota > 0 ? Math.min(100, (filled / spec.quota) * 100) : 0}%`, background: isFull ? '#52c41a' : col.text, transition: 'width .3s' }} />
                        </div>
                      </div>
                    </div>
                    {/* Yerləşdirilmiş kursantlar */}
                    {winners.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '8px 24px 12px 72px', background: '#fff' }}>
                        {winners.map((u: any, wi: number) => (
                          <div key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: col.light, border: `1px solid ${col.text}33` }}>
                            <span style={{ width: 18, height: 18, borderRadius: 5, background: col.bg, color: '#fff', fontSize: 9, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{wi + 1}</span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: col.text }}>{u.name}</span>
                            <span style={{ fontSize: 11, color: col.text, opacity: 0.7, fontWeight: 600 }}>{Number(u.score).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {winners.length === 0 && (
                      <div style={{ padding: '6px 24px 10px 72px', background: '#fff' }}>
                        <span style={{ fontSize: 11, color: '#ccc' }}>— kursant yerləşdirilməyib</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {/* !simStarted vəziyyəti artıq paket kartlarının üstündə göstərilir */}

      {/* ── Başladıqdan sonra: tam ekran (3 sütun) ── */}
      {simStarted && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 500, background: '#eef1f5', display: 'flex', flexDirection: 'column', animation: 'simCardIn .3s ease' }}>

          {/* ── Üst panel ── */}
          <div style={{ padding: '12px 20px', background: '#ffffff', borderBottom: '1px solid #232845', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <SimControls
                simStep={simStep} simTotal={simTotal}
                simStarted={simStarted} simFinished={simFinished}
                simRunning={simRunning} simSpeed={simSpeed}
                onStart={onStart} onPause={onPause} onResume={onResume}
                onSkip={onSkip} onSpeedCycle={onSpeedCycle} onRestart={onRestart}
              />
            </div>
            <button onClick={onRestart} title="Çıxış" style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 9, border: '1.5px solid #e7eaf0', background: 'transparent', color: '#8a909c', fontSize: 17, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color .15s, border-color .15s' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff4d4f'; (e.currentTarget as HTMLElement).style.borderColor = '#ff4d4f' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#5a6080'; (e.currentTarget as HTMLElement).style.borderColor = '#e7eaf0' }}
            >✕</button>
          </div>

          {/* ── 3 SÜTUN ── */}
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '250px 1fr 270px', overflow: 'hidden' }}>

            {/* SOL: İxtisas strukturu */}
            <div style={{ overflowY: 'auto', borderRight: '1px solid #e7eaf0', padding: '12px 10px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#3a4060', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10, paddingLeft: 4 }}>📚 İxtisaslar</div>
              {(packets as any[]).map((p: any, pIdx: number) => {
                const col    = PACK_COLORS[pIdx % PACK_COLORS.length]
                const pkDisp = displayState[pIdx]
                if (!pkDisp?.open) return null
                return (
                  <div key={pIdx} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: col.text, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5, paddingLeft: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: col.text }} />
                      Paket {p.num}
                    </div>
                    {(p.specs || []).map((spec: any, sIdx: number) => {
                      const spDisp = pkDisp.specs?.[sIdx]
                      const isAct  = activeSpec?.pIdx === pIdx && activeSpec?.sIdx === sIdx
                      const isDone = spDisp?.done
                      const filled = (spDisp?.competitors || []).filter((c: any) => c.isWinner).length
                      const isFull = filled >= spec.quota
                      const pct    = spec.quota > 0 ? Math.round((filled / spec.quota) * 100) : 0
                      const clickableSpec = isDone && filled > 0
                      return (
                        <div key={sIdx} onClick={() => clickableSpec && setSelSpecKey({ specId: spec.id, pIdx })} style={{ marginBottom: 4, borderRadius: 8, padding: '7px 9px', background: isAct ? col.light : isDone ? (isFull ? '#0d2a0d' : '#141830') : '#141830', border: `1px solid ${isAct ? col.text + '66' : isDone && isFull ? '#52c41a44' : '#e7eaf0'}`, transition: 'all .25s', cursor: clickableSpec ? 'pointer' : 'default' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                            <span style={{ fontSize: 11, flexShrink: 0 }}>{isDone ? (isFull ? '✅' : '🔵') : isAct ? '⚡' : '⏳'}</span>
                            <span style={{ flex: 1, fontSize: 11, fontWeight: isAct || isDone ? 700 : 400, color: isAct ? col.text : isDone && isFull ? '#52c41a' : isDone ? '#8892b0' : '#3a4060', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{spec.name}</span>
                            <span style={{ fontSize: 10, fontWeight: 800, flexShrink: 0, color: isFull ? '#52c41a' : isDone ? col.text : '#3a4060' }}>{filled}/{spec.quota}</span>
                          </div>
                          <div style={{ height: 3, borderRadius: 3, background: '#e7eaf0', overflow: 'hidden' }}>
                            <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: isFull ? '#52c41a' : col.text, transition: 'width .28s ease' }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* ORTA: Aktiv ixtisas varsa rəqib paneli, yoxsa paket kartları */}
            <div style={{ overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* ── Aktiv ixtisas rəqib paneli (inline) ── */}
              {modalData && (
                <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: `0 8px 32px ${modalData.col.shadow}`, animation: 'simCardIn .25s ease', flexShrink: 0 }}>
                  <div style={{ background: modalData.col.bg, padding: '14px 18px', flexShrink: 0 }}>
                    <div style={{ fontSize: 10, color: '#ffffff66', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 }}>
                      Paket {modalData.packetNum} · İxtisas {modalData.sIdx + 1} / {modalData.totalSpecs}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: '#fff' }}>{modalData.specName}</div>
                    {modalData.specPath && <div style={{ fontSize: 11, color: '#ffffff77', marginTop: 3 }}>{modalData.specPath}</div>}
                  </div>
                  <div style={{ padding: '10px 18px', borderBottom: '1.5px solid #f0f2fa', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    <div style={{ flexShrink: 0 }}>
                      <span style={{ fontSize: 28, fontWeight: 900, color: modalData.isFull ? '#52c41a' : modalData.col.text, transition: 'color .3s' }}>{modalData.filled}</span>
                      <span style={{ fontSize: 13, color: 'var(--muted)', marginLeft: 5 }}>/ {modalData.quota} yer</span>
                    </div>
                    <div style={{ flex: 1, height: 10, borderRadius: 10, background: '#f0f2fa', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 10, width: `${modalData.pct}%`, background: modalData.isFull ? 'linear-gradient(90deg,#52c41a,#237804)' : modalData.col.bg, transition: 'width .28s ease', boxShadow: modalData.pct > 0 ? `0 0 10px ${modalData.col.text}55` : 'none' }} />
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 900, color: modalData.isFull ? '#52c41a' : modalData.col.text, flexShrink: 0 }}>{modalData.pct}%</span>
                  </div>
                  <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {modalData.noCompetitors && <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>ℹ️ Bu ixtisası seçən kursant yoxdur</div>}
                    {modalData.competitors.map((c: any, ci: number) => {
                      const isLast = ci === modalData.competitors.length - 1
                      return (
                        <div key={c.student.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', background: c.isWinner ? '#f6ffed' : ci % 2 === 0 ? '#fff' : '#fafbff', borderBottom: '1px solid #f0f2fa', animation: isLast ? 'simRowIn .25s ease' : 'none' }}>
                          <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, fontSize: 16, background: c.isWinner ? 'linear-gradient(135deg,#52c41a,#237804)' : '#f0f2fa', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: c.isWinner ? '0 2px 8px #52c41a44' : 'none' }}>
                            {c.isWinner ? '🏆' : '❌'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13, color: c.isWinner ? '#237804' : 'var(--muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.student.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>{c.student.fin || '—'}</div>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <span style={{ padding: '3px 12px', borderRadius: 14, fontWeight: 900, fontSize: 13, background: c.isWinner ? '#d9f7be' : '#f0f2fa', color: c.isWinner ? '#237804' : 'var(--muted)' }}>{Number(c.student.score).toFixed(2)}</span>
                            <span style={{ fontSize: 12, fontWeight: 800, color: c.isWinner ? '#52c41a' : '#ff4d4f', minWidth: 38, textAlign: 'right' }}>{c.isWinner ? 'Qəbul' : 'Ret'}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* ── Paket kartları ── */}
              {(packets as any[]).map((p: any, pIdx: number) => {
                const pkDisp = displayState[pIdx]
                if (!pkDisp?.open) return null
                // Bitməyibsə yalnız cari aktiv paketi göstər
                if (!simFinished && currentPIdx !== null && pIdx !== currentPIdx) return null
                const col = PACK_COLORS[pIdx % PACK_COLORS.length]

                // ── TAMAMLANDI: xülasə kartı (klik ilə modal açılır) ──────────
                if (simFinished) {
                  const winnerIds = new Set<string>()
                  let placedCount = 0
                  for (const spDisp of Object.values(pkDisp.specs || {}) as any[]) {
                    for (const c of (spDisp as any).competitors || []) {
                      if (c.isWinner) { winnerIds.add(c.student.id); placedCount++ }
                    }
                  }
                  return (
                    <div key={pIdx} onClick={() => setSelSimPacket({ p, pIdx, pkDisp, col })}
                      style={{ borderRadius: 16, overflow: 'hidden', boxShadow: `0 8px 24px ${col.shadow}`, cursor: 'pointer', animation: `simCardIn .35s ease ${pIdx * 0.07}s both`, transition: 'transform .18s' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-4px) scale(1.02)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0) scale(1)' }}
                    >
                      {/* Gradient başlıq */}
                      <div style={{ background: col.bg, padding: '18px 22px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff99', textTransform: 'uppercase', letterSpacing: 1 }}>Paket {p.num}</span>
                          <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 700, background: '#52c41a', color: '#fff' }}>✅ Tamamlandı</span>
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 900, color: '#fff' }}>
                          {p.count}
                          <span style={{ fontSize: 13, fontWeight: 500, marginLeft: 6, opacity: 0.8 }}>kursant</span>
                        </div>
                        <div style={{ fontSize: 13, color: '#ffffff99', marginTop: 4 }}>
                          🎓 {(p.specs || []).length} ixtisas · 📊 {p.totalQuota} kvota
                        </div>
                      </div>
                      {/* Gövdə */}
                      <div style={{ background: col.light, padding: '14px 22px', borderTop: `2px solid ${col.text}22` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div>
                            <div style={{ fontSize: 11, color: col.text, fontWeight: 600, marginBottom: 2 }}>Bal aralığı</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: col.text }}>
                              {p.minScore.toFixed(1)} – {p.maxScore.toFixed(1)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 11, color: col.text, fontWeight: 600, marginBottom: 2 }}>Yerləşdirilib</div>
                            <div style={{ fontSize: 20, fontWeight: 900, color: '#52c41a' }}>{winnerIds.size}<span style={{ fontSize: 12, color: col.text, fontWeight: 500, marginLeft: 4 }}>/ {p.count}</span></div>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: col.text, opacity: 0.8, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>👁</span> Ətraflı bax
                        </div>
                      </div>
                    </div>
                  )
                }

                // ── PROSES: animasiyalı kart ──────────────────────────────────
                const winnerIds2 = new Set<string>()
                const loserIds2  = new Set<string>()
                for (const spDisp of Object.values(pkDisp.specs || {}) as any[]) {
                  for (const c of (spDisp as any).competitors || []) {
                    if (c.isWinner) { winnerIds2.add(c.student.id); loserIds2.delete(c.student.id) }
                    else if (!winnerIds2.has(c.student.id)) loserIds2.add(c.student.id)
                  }
                }
                return (
                  <div key={pIdx} style={{ borderRadius: 12, overflow: 'hidden', boxShadow: `0 4px 16px ${col.shadow}`, animation: 'simCardIn .4s ease' }}>
                    <div style={{ background: col.bg, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 10, color: '#ffffff66', fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Paket {p.num}</div>
                        <div style={{ fontSize: 14, fontWeight: 900, color: '#fff', marginTop: 1 }}>👥 {p.count} kursant · 🎓 {(p.specs || []).length} ixtisas</div>
                      </div>
                      <div style={{ fontSize: 11, padding: '4px 10px', borderRadius: 20, fontWeight: 700, background: pkDisp.done ? '#52c41a' : '#ffffff22', color: '#fff' }}>
                        {pkDisp.done ? '✅ Tamamlandı' : '⚡ Davam edir...'}
                      </div>
                    </div>
                    <div style={{ background: '#fff', padding: '8px 12px', borderBottom: '1px solid #f0f2fa' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 5 }}>👥 Kursantlar</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 90, overflowY: 'auto' }}>
                        {(p.students || []).map((u: any) => {
                          const isWinner = winnerIds2.has(u.id)
                          const isLoser  = loserIds2.has(u.id)
                          return (
                            <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 600, background: isWinner ? '#f6ffed' : isLoser ? '#fff0f0' : col.light, color: isWinner ? '#237804' : isLoser ? '#cf1322' : col.text, border: `1px solid ${isWinner ? '#b7eb8f' : isLoser ? '#ffccc7' : col.text + '33'}`, transition: 'all .25s' }}>
                              {isWinner ? '✅' : isLoser ? '❌' : '⏳'} {u.name}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{ background: '#fff', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {(p.specs || []).map((spec: any, sIdx: number) => {
                        const spDisp = pkDisp.specs[sIdx]
                        const isAct  = activeSpec?.pIdx === pIdx && activeSpec?.sIdx === sIdx
                        const isDone = spDisp?.done
                        const filled = (spDisp?.competitors || []).filter((c: any) => c.isWinner).length
                        const isFull = filled >= spec.quota
                        return (
                          <div key={sIdx} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 7, background: isAct ? col.light : isDone ? (isFull ? '#f6ffed' : '#f8f9fd') : '#f8f9fd', border: `1.5px solid ${isAct ? col.text + '66' : isDone && isFull ? '#52c41a33' : 'transparent'}`, transition: 'all .25s' }}>
                            <span style={{ fontSize: 12, flexShrink: 0 }}>{isDone ? (isFull ? '✅' : '🔵') : isAct ? '⚡' : '⏳'}</span>
                            <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isAct || isDone ? 700 : 400, color: isAct ? col.text : isDone && isFull ? '#237804' : 'var(--muted)' }}>{spec.name}</span>
                            {isDone && <span style={{ fontSize: 11, fontWeight: 800, flexShrink: 0, color: isFull ? '#52c41a' : col.text }}>{filled}/{spec.quota}</span>}
                            {isAct && <span style={{ fontSize: 10, fontWeight: 700, color: col.text, animation: 'simPulse 1s infinite', flexShrink: 0 }}>Davam...</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* SAĞ: Tələbə siyahısı */}
            {(() => {
              const allStu: Array<{ u: any; col: any; pNum: number; status: string }> = []
              for (let pi = 0; pi < (packets as any[]).length; pi++) {
                const p   = (packets as any[])[pi]
                const col = PACK_COLORS[pi % PACK_COLORS.length]
                const pkD = displayState[pi]
                const winIds = new Set<string>()
                const loseIds = new Set<string>()
                if (pkD) {
                  for (const sd of Object.values(pkD.specs || {}) as any[]) {
                    for (const c of sd.competitors || []) {
                      if (c.isWinner) { winIds.add(c.student.id); loseIds.delete(c.student.id) }
                      else if (!winIds.has(c.student.id)) loseIds.add(c.student.id)
                    }
                  }
                }
                for (const u of p.students || []) {
                  allStu.push({ u, col, pNum: p.num, status: winIds.has(u.id) ? 'winner' : loseIds.has(u.id) ? 'loser' : 'pending' })
                }
              }
              allStu.sort((a, b) => (b.u.score || 0) - (a.u.score || 0))
              const wins  = allStu.filter(s => s.status === 'winner').length
              const loses = allStu.filter(s => s.status === 'loser').length
              return (
                <div style={{ borderLeft: '1px solid #e7eaf0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                  <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #e7eaf0', flexShrink: 0, background: '#ffffff' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#3a4060', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>👥 Tələbələr ({allStu.length})</div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <span style={{ flex: 1, textAlign: 'center', padding: '3px 0', borderRadius: 6, background: '#f6ffed', color: '#52c41a', fontSize: 11, fontWeight: 800 }}>✅ {wins}</span>
                      <span style={{ flex: 1, textAlign: 'center', padding: '3px 0', borderRadius: 6, background: '#fff0f0', color: '#ff4d4f', fontSize: 11, fontWeight: 800 }}>❌ {loses}</span>
                      <span style={{ flex: 1, textAlign: 'center', padding: '3px 0', borderRadius: 6, background: '#f0f2f8', color: '#8a909c', fontSize: 11, fontWeight: 800 }}>⏳ {allStu.length - wins - loses}</span>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {allStu.map(({ u, col, pNum, status }) => (
                      <div key={u.id} onClick={() => setSelStudent(u)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', borderBottom: '1px solid #1a2040', background: status === 'winner' ? '#0a1a0a' : status === 'loser' ? '#1a0a0a' : 'transparent', transition: 'background .3s', cursor: 'pointer' }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = status === 'winner' ? '#112211' : status === 'loser' ? '#221111' : '#141830' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = status === 'winner' ? '#0a1a0a' : status === 'loser' ? '#1a0a0a' : 'transparent' }}
                      >
                        <span style={{ fontSize: 12, flexShrink: 0 }}>{status === 'winner' ? '🏆' : status === 'loser' ? '❌' : '⏳'}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: status !== 'pending' ? 700 : 400, color: status === 'winner' ? '#52c41a' : status === 'loser' ? '#ff4d4f' : '#3a4060', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.name}</div>
                          <div style={{ display: 'flex', gap: 5, marginTop: 1 }}>
                            <span style={{ fontSize: 9, color: col.text, fontWeight: 700, background: col.light, padding: '1px 5px', borderRadius: 4 }}>P{pNum}</span>
                            <span style={{ fontSize: 10, color: '#3a4060' }}>{Number(u.score).toFixed(1)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      )}
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
      {/* ════ YERLƏŞDİRMƏ HESABATI ════ */}
      {placement && (() => {
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
              <div className="card-sub">{mode === 'sim' ? 'Simulyasiya nəticəsi · Bazaya yazılmayıb' : 'Bölüşdürmə nəticəsi'}</div>
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

      {/* ════ İXTİSAS KVOTA DOLULLUĞU ════ */}
      {specStats.length > 0 && (
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
              <span>#</span>
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
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">{mode === 'sim' ? '👁 Simulyasiya Nəticəsi' : '📋 Bölüşdürmə Nəticəsi'}</div>
            <div className="card-sub">{mode === 'sim' ? 'Yalnız önizləmə — bazaya yazılmayıb' : saved ? '✅ Nəticələr bazaya yazıldı' : 'Nəticəni yoxlayın, sonra "Bazaya Yaz" düyməsinə basın'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'distribute' && !saved && (
              <button onClick={onSave} style={{ padding: '10px 22px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#52c41a,#237804)', color: '#fff', fontWeight: 800, fontSize: 13, boxShadow: '0 4px 16px #52c41a44' }}>
                💾 Bazaya Yaz
              </button>
            )}
            {saved && <span style={{ background: '#f0fff4', border: '1.5px solid #52c41a66', borderRadius: 10, padding: '8px 18px', fontSize: 13, color: '#237804', fontWeight: 800 }}>✅ Bazaya yazıldı</span>}
            <button onClick={onExport} style={{ padding: '9px 16px', borderRadius: 10, border: 'none', background: '#1d6f42', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>📥 Excel</button>
          </div>
        </div>

        <div className="search-row">
          <input className="search-input" placeholder="🔍  Ad və ya FİN..." value={nameQ} onChange={e => setNameQ(e.target.value)} />
          <select className="filter-select" value={statusFlt} onChange={e => setStatusFlt(e.target.value)}>
            <option value="all">Bütün statuslar</option>
            <option value="placed">Yerləşdirilib</option>
            <option value="unplaced">Yerləşdirilməyib</option>
          </select>
          <input className="search-input" style={{ width: 110 }} placeholder="Min. bal" type="number" value={scoreMin} onChange={e => setScoreMin(e.target.value)} />
          <input className="search-input" style={{ width: 110 }} placeholder="Maks. bal" type="number" value={scoreMax} onChange={e => setScoreMax(e.target.value)} />
        </div>

        <div className="card-body" style={{ overflowX: 'auto' }}>
          <table style={{ minWidth: 820 }}>
            <thead>
              <tr>
                <th style={{ width: 44 }}>#</th>
                <th>KURSANT</th>
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

        <div className="pagination">
          <span className="page-info">{studentRows.length} nəticə · {placedCount} yerləşdirilib · {unplacedCount} yerləşdirilməyib</span>
        </div>
      </div>
    </>
  )
}
