// Yerləşdirmə mühərriki (sadə və paket üsulu). Distribution.tsx-dən ayrıca modula
// çıxarılıb ki, balans simulyasiyası (quota-sim.ts) eyni kodu işlətsin.
import { poolCounts, autoSplit, globalSourceSplitCached } from './quota-pool'
import { UMUMI_KEY, critValue, isSumCrit } from './tiebreak'

// ── Tiebreaker: təhsilalanı sıralamaq üçün bal massivi ──────────────────────────
export function getTiebreakerSubjects(specId: string, userGroup: string | null, pathMap: Record<string, any[]>): string[] {
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

export function studentSortScore(user: any, tiebreakers: string[]): number[] {
  // Meyar tək sütun da ola bilər, bir neçə sütunun cəmi də — critValue hər ikisini bilir
  const primary = user.score || 0
  return [primary, ...tiebreakers.map(crit => critValue(user, crit))]
}

export function compareStudents(a: any, b: any, tiebreakers: string[]): number {
  const sa = studentSortScore(a, tiebreakers)
  const sb = studentSortScore(b, tiebreakers)
  for (let i = 0; i < Math.max(sa.length, sb.length); i++) {
    const diff = (sb[i] ?? -1) - (sa[i] ?? -1)
    if (diff !== 0) return diff
  }
  return 0
}

// ── Yarpaqları əcdad zənciri ilə topla ────────────────────────────────────────
export function getLeavesWithPath(nodes: any[], anc: any[] = []): Array<{ leaf: any; path: any[] }> {
  const res: Array<{ leaf: any; path: any[] }> = []
  for (const n of nodes) {
    if (!n.children?.length) res.push({ leaf: n, path: [...anc, n] })
    else res.push(...getLeavesWithPath(n.children, [...anc, n]))
  }
  return res
}

// ── Cinsə görə məhdudiyyət köməkçiləri (leaf node-da allowFemale/allowMale/maxFemale/maxMale) ──
export function genderAllowed(leaf: any, gender: any): boolean {
  if (!leaf) return true
  if (gender === 'qadın' && leaf.allowFemale === false) return false
  if (gender === 'kişi'  && leaf.allowMale   === false) return false
  return true
}
export function genderCapReached(leaf: any, gender: any, femCount: number, malCount: number): boolean {
  if (!leaf) return false
  if (gender === 'qadın' && leaf.maxFemale != null && femCount >= leaf.maxFemale) return true
  if (gender === 'kişi'  && leaf.maxMale   != null && malCount >= leaf.maxMale)   return true
  return false
}

// ── Yenidən-tarazlama (balı qoruyan): boş yer + yerləşməyən eyni anda qalmasın ──
// Greedy nəticəsi saxlanılır (bal ədaləti), üstündən cins-qapılı MAX-AXIN (max-flow)
// tətbiq olunur. Greedy yerləşdirmələri başlanğıc axın kimi qoyulur; yalnız yerləşməyənlər
// üçün artırıcı yollar axtarılır. Beləcə kvotanı aşmadan, cins məhdudiyyətlərini pozmadan
// mümkün olan maksimum təhsilalan yerləşir və boş yer kənarda qalanla yanaşı qalmır.
// ── Boş yerlərin doldurulması — bal sırasını qoruyan min-cost max-flow ───────
//
// Əvvəl burada adi max-flow vardı: o, YALNIZ "ən çoxu neçə nəfər yerləşir"
// sualına cavab verirdi və eyni sayda yerləşmə verən variantlar arasından
// təsadüfi birini seçirdi. Nəticədə aşağı ballı namizəd yerləşib, yüksək ballı
// kənarda qala bilirdi (real hal: 250.1 bal yerləşdi, 271.9 bal qaldı — hər
// ikisi eyni ixtisası seçmişdi və heç bir məhdudiyyət mane olmurdu).
//
// İndi eyni şəbəkə üzərində qiymət (cost) var və "successive shortest paths"
// üsulu işləyir: əvvəlcə maksimum say təmin edilir, sonra həmin say daxilində
// ən ucuz variant seçilir. Qiymət leksikoqrafikdir:
//   1) kimin yerləşməsi — yüksək ballı yerləşməsə cərimə çox böyükdür (A əmsalı),
//   2) kimin harada yerləşməsi — aşağı seçimə düşmək bahadır və yüksək ballı
//      birini aşağı seçimə salmaq daha bahadır (c * (N − sıra)).
// Nəticə birmənalıdır: eyni giriş həmişə eyni cavabı verir.
//
// ƏSAS QAYDA: bal sırası ilə artıq yer almış təhsilalan BU MƏRHƏLƏDƏ HEÇ VAXT
// daha pis seçimə keçirilmir — ona yalnız <= mövcud seçiminə kənar qoyulur.
// Səbəb: bal sırası ilə paylamada bir yeri tutan adam, həmin yeri istəyən hər
// yerləşməmiş adamdan mütləq yüksək baldadır (yoxsa yeri o alardı). Deməli, yer
// açmaq üçün kimisə aşağı salmaq həmişə daha aşağı ballının xeyrinə olardı.
// Ölçdüm: bu məhdudiyyət olmadan 51 nəfər öz yerini daha aşağı ballıya verirdi
// (məs. 408.4 ballı 1-ci seçimini itirib, yerini 300.7 ballı alırdı).
export function rebalanceUnplaced(opts: {
  users: any[]; subs: any[];
  leafById: Record<string, any>;
  quotas: Record<string, number>;
  pathMap: Record<string, any[]>;
  placed: Record<string, number>;
  femP: Record<string, number>;
  malP: Record<string, number>;
  assignments: Record<string, { specId: string; choiceNum: number }>;
  /**
   * Paketin bütün iştirakçıları. `users` yalnız bir alt-dəstə olduqda (məs. mənbə
   * bölgüsü sərt icra olunanda ayrıca mülki, ayrıca lisey) lazımdır: dəstədən
   * kənar yerləşdirmələr toxunulmaz qalmalı, tutduqları yerlər və cins limitləri
   * isə tutumdan çıxılmalıdır.
   */
  allUsers?: any[];
}) {
  const { users, subs, leafById, quotas, placed, femP, malP, assignments } = opts
  const allUsers = opts.allUsers ?? users
  const specs = Object.keys(quotas)

  // ── Dəstədən kənar yerləşdirmələr: toxunulmur, tutumda isə nəzərə alınır ──
  const inScope = new Set(users.map((u: any) => u.id))
  const outFem: Record<string, number> = {}
  const outMal: Record<string, number> = {}
  const mine: Record<string, number> = {}
  for (const u of allUsers) {
    const a = assignments[u.id]
    if (!a) continue
    if (inScope.has(u.id)) { mine[a.specId] = (mine[a.specId] || 0) + 1; continue }
    if (u.gender === 'qadın') outFem[a.specId] = (outFem[a.specId] || 0) + 1
    else if (u.gender === 'kişi') outMal[a.specId] = (outMal[a.specId] || 0) + 1
  }

  const hasEmpty = specs.some(sid => (quotas[sid] || 0) - (mine[sid] || 0) > 0)
  const hasUnplaced = users.some(u => !assignments[u.id])
  if (!hasEmpty || !hasUnplaced) return  // boş yer və ya yerləşməyən yoxdursa, iş yoxdur

  const subByUser: Record<string, string[]> = {}
  for (const s of subs as any[]) if (s?.userId) subByUser[s.userId] = s.ranking || []
  const rankingOf = (uid: string): string[] => subByUser[uid] || []

  // ── Bal sırası: 0 = ən yüksək ballı ──────────────────────────────────────
  const ordered = [...users].sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
  const rankOf: Record<string, number> = {}
  ordered.forEach((u: any, i: number) => { rankOf[u.id] = i })
  const N = users.length || 1
  let maxChoices = 1
  for (const u of users) maxChoices = Math.max(maxChoices, rankingOf(u.id).length)
  // Seçim qiymətinin mümkün maksimumundan böyük əmsal — bal şərti həmişə üstün olsun
  const A = N * maxChoices * N + 1

  // ── Şəbəkə: S → təhsilalan → (cins qapısı) → ixtisas → T ─────────────────
  let n = 2; const S = 0, T = 1
  const uNode: Record<string, number> = {}, fg: Record<string, number> = {}, mg: Record<string, number> = {}, sp: Record<string, number> = {}
  for (const u of users) uNode[u.id] = n++
  for (const sid of specs) { fg[sid] = n++; mg[sid] = n++; sp[sid] = n++ }

  const eTo: number[] = [], eCap: number[] = [], eCost: number[] = []
  const graph: number[][] = Array.from({ length: n }, () => [])
  const addEdge = (a: number, b: number, cap: number, cost: number) => {
    graph[a].push(eTo.length); eTo.push(b); eCap.push(cap);  eCost.push(cost)
    graph[b].push(eTo.length); eTo.push(a); eCap.push(0);    eCost.push(-cost)
  }

  for (const u of users) addEdge(S, uNode[u.id], 1, rankOf[u.id] * A)
  for (const sid of specs) {
    const leaf = leafById[sid], q = quotas[sid] || 0
    // Cins limiti bütün ixtisas üzrədir — dəstədən kənar yerləşənlər onu artıq yeyib
    const freeF = leaf?.maxFemale != null ? Math.max(0, leaf.maxFemale - (outFem[sid] || 0)) : q
    const freeM = leaf?.maxMale   != null ? Math.max(0, leaf.maxMale   - (outMal[sid] || 0)) : q
    const maxF = (leaf?.allowFemale === false) ? 0 : Math.min(freeF, q)
    const maxM = (leaf?.allowMale   === false) ? 0 : Math.min(freeM, q)
    addEdge(fg[sid], sp[sid], maxF, 0)
    addEdge(mg[sid], sp[sid], maxM, 0)
    addEdge(sp[sid], T, q, 0)
  }
  // cinsi yazılmayanlar birbaşa ixtisas node-una (yalnız ümumi kvota ilə məhdudlaşır)
  const gateOf = (g: any, sid: string) => g === 'qadın' ? fg[sid] : g === 'kişi' ? mg[sid] : sp[sid]
  // Hansı kənarın hansı seçimə aid olduğunu yadda saxlayırıq — nəticəni oxumaq üçün
  const choiceEdges: Record<string, { edge: number; sid: string; choice: number }[]> = {}
  for (const u of users) {
    const rk = rankingOf(u.id)
    // Artıq yerləşibsə, yalnız hazırkı seçimi və ondan YAXŞI olanlar açıqdır
    const cur = assignments[u.id]
    const curIdx = cur ? rk.indexOf(cur.specId) : -1
    const maxC = curIdx >= 0 ? curIdx : rk.length - 1
    const list: { edge: number; sid: string; choice: number }[] = []
    for (let c = 0; c <= maxC && c < rk.length; c++) {
      const sid = rk[c]
      if (quotas[sid] === undefined) continue
      // aşağı seçim bahadır; yüksək ballını aşağı seçimə salmaq daha bahadır
      list.push({ edge: eTo.length, sid, choice: c })
      addEdge(uNode[u.id], gateOf(u.gender, sid), 1, c * (N - rankOf[u.id]))
    }
    choiceEdges[u.id] = list
  }

  // ── Successive shortest paths (SPFA ilə) ────────────────────────────────
  const INF = Number.MAX_SAFE_INTEGER
  for (;;) {
    const dist = new Array(n).fill(INF)
    const inq  = new Array(n).fill(false)
    const pe   = new Array(n).fill(-1)
    dist[S] = 0
    const queue: number[] = [S]; inq[S] = true
    while (queue.length) {
      const v = queue.shift()!; inq[v] = false
      for (const id of graph[v]) {
        if (eCap[id] <= 0) continue
        const w = eTo[id], nd = dist[v] + eCost[id]
        if (nd < dist[w]) {
          dist[w] = nd; pe[w] = id
          if (!inq[w]) { inq[w] = true; queue.push(w) }
        }
      }
    }
    if (dist[T] === INF) break          // artıq yol yoxdur → maksimum say alındı
    for (let v = T; v !== S; ) { const id = pe[v]; eCap[id]--; eCap[id ^ 1]++; v = eTo[id ^ 1] }
  }

  // ── Nəticəni oxu ────────────────────────────────────────────────────────
  // Yalnız DƏSTƏNİN yerləşdirmələri yenidən qurulur; kənardakılar olduğu kimi qalır.
  for (const u of users) delete assignments[u.id]
  for (const u of users) {
    for (const ce of (choiceEdges[u.id] || [])) {
      if (eCap[ce.edge] !== 0) continue     // bu kənardan axın getməyib
      assignments[u.id] = { specId: ce.sid, choiceNum: ce.choice + 1 }
      break
    }
  }
  // Saylar bütün iştirakçılar üzrə yenidən hesablanır ki, kənardakılar itməsin
  for (const sid of specs) { placed[sid] = 0; femP[sid] = 0; malP[sid] = 0 }
  for (const u of allUsers) {
    const a = assignments[u.id]
    if (!a) continue
    placed[a.specId] = (placed[a.specId] || 0) + 1
    if (u.gender === 'qadın') femP[a.specId] = (femP[a.specId] || 0) + 1
    else if (u.gender === 'kişi') malP[a.specId] = (malP[a.specId] || 0) + 1
  }
}

// ── Paket-daxili yerləşdirmə (hər paket müstəqil işləyir) ────────────────────
export function runPacketPlacement(
  packetStudents: any[],
  allSubs: any[],
  packetSpecs: Array<{ id: string; quota: number; mülkiQuota?: number; liseyQuota?: number; path: any[] }>,
  sourceProportional = false
) {
  // Seçimə görə sürətli axtarış (əvvəl hər dəfə siyahı başdan-başa gəzilirdi)
  const subIdx = new Map<string, any>()
  for (const x of allSubs as any[]) if (x?.userId && !subIdx.has(x.userId)) subIdx.set(x.userId, x)
  const subOf = (id: string) => subIdx.get(id)
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
      const aSub = subOf(a.id)
      const bSub = subOf(b.id)
      const aSid = aSub?.ranking?.find((sid: string) => availQuota[sid] !== undefined) || ''
      const bSid = bSub?.ranking?.find((sid: string) => availQuota[sid] !== undefined) || ''
      const aTb  = getTiebreakerSubjects(aSid, a.group, pathMap)
      const bTb  = getTiebreakerSubjects(bSid, b.group, pathMap)
      const tb   = aTb.length >= bTb.length ? aTb : bTb
      return compareStudents(a, b, tb)
    })
    for (const user of sorted) {
      if (assignments[user.id]) continue
      const sub = subOf(user.id)
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

    // Mərhələ 1: Mülki təhsilalanlar mülki slotlar üçün
    tryPlace(mülki, mülkiQ)
    // Mərhələ 2: Lisey təhsilalanlar lisey slotlar üçün
    tryPlace(lisey, liseyQ)

    // Mərhələ 3: SƏRT rejim — mənbə slotları qarışmır. Mülki slotu yalnız mülki,
    // lisey slotu yalnız lisey doldura bilər; 1-2-ci mərhələ həmin namizədləri
    // onsuz da tükəndirdiyi üçün burada yalnız MƏNBƏSİZ təhsilalanlar qalır.
    // Onlar heç bir mənbəyə aid olmadığından qalan slotların hamısına yazıla bilər.
    for (const spec of packetSpecs) {
      deficitQ[spec.id] = mülkiQ[spec.id] + liseyQ[spec.id]  // qalan slotlar
    }
    const otherUnplaced = other.filter((u: any) => !assignments[u.id])
    if (otherUnplaced.length) tryPlace(otherUnplaced, deficitQ)

    // Tarazlama da mənbə üzrə AYRICA aparılır — əks halda ümumi kvota üzərindən
    // işləyib mənbə bölgüsünü pozardı (mülki namizədi lisey slotuna keçirərdi).
    const mülkiCap: Record<string, number> = {}
    const liseyCap: Record<string, number> = {}
    for (const spec of packetSpecs) {
      mülkiCap[spec.id] = spec.mülkiQuota ?? 0
      liseyCap[spec.id] = spec.liseyQuota ?? 0
    }
    rebalanceUnplaced({ users: mülki, subs: allSubs, leafById, quotas: mülkiCap, pathMap, placed, femP, malP, assignments, allUsers: packetStudents })
    rebalanceUnplaced({ users: lisey, subs: allSubs, leafById, quotas: liseyCap, pathMap, placed, femP, malP, assignments, allUsers: packetStudents })
    if (other.length) {
      // Mənbəsizlər üçün tutum: mənbəli təhsilalanların tutduğundan sonra qalan yerlər.
      // (Ümumi `placed`-dan çıxmaq olmaz — ora mənbəsizlərin öz yerləri də daxildir
      //  və tutum iki dəfə azalardı.)
      const usedBySourced: Record<string, number> = {}
      for (const u of [...mülki, ...lisey]) {
        const a = assignments[u.id]
        if (a) usedBySourced[a.specId] = (usedBySourced[a.specId] || 0) + 1
      }
      const freeCap: Record<string, number> = {}
      for (const spec of packetSpecs) freeCap[spec.id] = Math.max(0, spec.quota - (usedBySourced[spec.id] || 0))
      rebalanceUnplaced({ users: other, subs: allSubs, leafById, quotas: freeCap, pathMap, placed, femP, malP, assignments, allUsers: packetStudents })
    }
    return { assignments, placed, pathMap }

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
export function runPlacement(
  users: any[], subs: any[], tree: any,
  sourceProportional = false,
  // Mənbə nisbəti müəssisənin BÜTÜN təhsilalanlarından hesablanır (yalnız seçim
  // göndərənlərdən deyil), ona görə tam siyahı ayrıca ötürülür.
  allInstUsers?: any[],
  preAssignLevel?: number | null,
) {
  // Seçimə görə sürətli axtarış (əvvəl hər dəfə siyahı başdan-başa gəzilirdi)
  const subIdx = new Map<string, any>()
  for (const x of subs as any[]) if (x?.userId && !subIdx.has(x.userId)) subIdx.set(x.userId, x)
  const subOf = (id: string) => subIdx.get(id)
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
    // Hər təhsilalan üçün birinci əlçatan ixtisasın tiebreaker-ına görə sırala
    const sorted = [...students].sort((a, b) => {
      const aSub = subOf(a.id)
      const bSub = subOf(b.id)
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
      const sub = subOf(user.id)
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
    // ── Mülki / lisey nisbəti HƏR İXTİSAS ÜÇÜN AYRICA hesablanır: müəssisənin ümumi
    //    nisbəti deyil, həmin ixtisası seçə bilənlərin nisbəti. Əks halda qrup/cins
    //    məhdudiyyəti olan ixtisaslarda yerlər onları seçə bilməyən qrupa ayrılır və
    //    boş qalır (bax: src/quota-pool.ts).
    const poolUsers = allInstUsers?.length ? allInstUsers : users
    const gTable = globalSourceSplitCached(poolUsers, tree?.nodes || [], { preAssignLevel })

    const mülkiQ: Record<string, number>  = {}
    const liseyQ: Record<string, number>  = {}
    const deficitQ: Record<string, number> = {}
    for (const { leaf, path } of leavesWithPath) {
      const sid = leaf.id
      const q   = leaf.quota || 0
      if (leaf.quotaMode === 'manual' && leaf.mülkiQuota != null && leaf.liseyQuota != null) {
        // Node üçün manual kvota təyin edilib
        mülkiQ[sid]  = leaf.mülkiQuota
        liseyQ[sid]  = leaf.liseyQuota
      } else {
        // Avtomatik: qlobal ehtiyac bölgüsü (captive qruplar qorunur)
        const sp = autoSplit(leaf, poolCounts(poolUsers, path, { preAssignLevel }), gTable)
        mülkiQ[sid]  = sp.mülki
        liseyQ[sid]  = sp.lisey
      }
      deficitQ[sid] = 0
    }

    // tryPlace mülkiQ/liseyQ dəyərlərini azaldır — tarazlama üçün ilkin tutum saxlanılır
    const mülkiQ0 = { ...mülkiQ }
    const liseyQ0 = { ...liseyQ }

    const mülki = users.filter((u: any) => u.source === 'mülki')
    const lisey = users.filter((u: any) => u.source === 'lisey')
    const other = users.filter((u: any) => !u.source)

    // Mərhələ 1: mülki
    tryPlace(mülki, mülkiQ)
    // Mərhələ 2: lisey
    tryPlace(lisey, liseyQ)
    // Mərhələ 3: SƏRT rejim — mənbə slotları qarışmır (bax: runPacketPlacement).
    // 1-2-ci mərhələ mənbəli namizədləri tükəndirib; yalnız mənbəsizlər qalır.
    for (const sid of Object.keys(quotas)) deficitQ[sid] = mülkiQ[sid] + liseyQ[sid]
    const otherUnplaced = other.filter((u: any) => !assignments[u.id])
    if (otherUnplaced.length) tryPlace(otherUnplaced, deficitQ)

    // Tarazlama mənbə üzrə ayrıca — ümumi kvota üzərindən işləsə, bölgünü pozardı
    rebalanceUnplaced({ users: mülki, subs, leafById, quotas: mülkiQ0, pathMap, placed, femP, malP, assignments, allUsers: users })
    rebalanceUnplaced({ users: lisey, subs, leafById, quotas: liseyQ0, pathMap, placed, femP, malP, assignments, allUsers: users })
    if (other.length) {
      const usedBySourced: Record<string, number> = {}
      for (const u of [...mülki, ...lisey]) {
        const a = assignments[u.id]
        if (a) usedBySourced[a.specId] = (usedBySourced[a.specId] || 0) + 1
      }
      const freeCap: Record<string, number> = {}
      for (const sid of Object.keys(quotas)) freeCap[sid] = Math.max(0, (quotas[sid] || 0) - (usedBySourced[sid] || 0))
      rebalanceUnplaced({ users: other, subs, leafById, quotas: freeCap, pathMap, placed, femP, malP, assignments, allUsers: users })
    }
    return { assignments, placed, quotas, pathMap }

  } else {
    // ── Adi yerləşdirmə
    const availQuota = { ...quotas }
    tryPlace(users, availQuota)
  }

  // Boş yer + yerləşməyən eyni anda qalmasın deyə balı qoruyan yenidən-tarazlama
  rebalanceUnplaced({ users, subs, leafById, quotas, pathMap, placed, femP, malP, assignments })

  return { assignments, placed, quotas, pathMap }
}

