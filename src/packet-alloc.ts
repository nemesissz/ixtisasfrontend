// Paket üsulu: ixtisas kvotalarının paketlərə bölgüsü (bax: Distribution.tsx)
import { poolCounts, autoSplit, globalSourceSplitCached, canChoose } from './quota-pool'
import { runPacketPlacement } from './placement'

export interface PacketSpec {
  id: string; name: string; path: any[]; quota: number; origQuota: number; mülkiQuota?: number; liseyQuota?: number
  /**
   * Paketə düşən cins limiti. İxtisasın maxFemale/maxMale limiti BÜTÜN ixtisas
   * üzrədir — əvvəl hər paket onu ayrıca tətbiq edirdi və paketlərin cəmi limiti
   * keçə bilirdi. İndi limit paketlərə bölünür (undefined → ixtisasın öz limiti).
   */
  maxFemale?: number | null; maxMale?: number | null
}

/** n elementi P hissəyə böl — fərq ən çox 1, artıq olanlar yuxarı paketlərə. */
const evenSizes = (n: number, P: number) => Array.from({ length: P }, (_, i) => Math.floor(n / P) + (i < n % P ? 1 : 0))

/**
 * Təhsilalanları paketlərə böl. Proporsional rejimdə hər mənbə AYRICA bölünür:
 * mülkilər öz bal sırası ilə P hissəyə, liseylər öz bal sırası ilə P hissəyə,
 * sonra i-ci hissələr birləşib i-ci paketi əmələ gətirir. Beləliklə 1-ci paket
 * hər mənbənin ən yüksək ballılarıdır — mənbələrin bal şkalası fərqli olsa belə
 * (məs. mülkilər 250+, liseylər 220-dən aşağı) paketlər yalnız bir mənbədən
 * ibarət olmur. Proporsional rejim söndürülübsə — ümumi bal sırası ilə.
 */
export function splitPacketStudents(users: any[], P: number, bySource: boolean, cmp?: (a: any, b: any) => number): any[][] {
  // Bərabər ballılar paket sərhədində prioritet meyarları ilə ayrılır (cmp verilibsə)
  const bySc = cmp ?? ((a: any, b: any) => (b.score || 0) - (a.score || 0))
  const groups = bySource
    ? [users.filter(u => u.source === 'mülki'), users.filter(u => u.source === 'lisey'), users.filter(u => u.source !== 'mülki' && u.source !== 'lisey')]
    : [users]
  const out: any[][] = Array.from({ length: P }, () => [])
  for (const g of groups) {
    const sorted = [...g].sort(bySc)
    let c = 0
    evenSizes(sorted.length, P).forEach((n, i) => { out[i].push(...sorted.slice(c, c + n)); c += n })
  }
  return out.map(p => p.sort(bySc))
}

// ── İzah (izahlı simulyasiya üçün) ─────────────────────────────────────────────
/** Bir ixtisasın bir mənbə payının bir paketə düşən hissəsi */
export interface PacketAllocRow {
  /** paketdə bu ixtisasa namizəd ola bilənlər (göndərənlərdə: seçim siyahısında olanlar) */
  elig: number
  /** onlardan seçim göndərənlər */
  eligSub: number
  /** ədalətli pay = yer × elig ÷ (bütün paketlərdə elig) */
  target: number
  /** bölgünün verdiyi yer (yoxlamadan əvvəl, doldurula bilən) */
  flow: number
  /** heç bir paketdə doldurula bilməyən, bu paketə yazılan yer */
  overflow: number
  /** yekun yer (yoxlamadan sonra) */
  given: number
}
export interface PacketAllocBucket { src: string; slots: number; rows: PacketAllocRow[] }
/** Yoxlama zamanı edilən dəyişmə: `specId`-in bir yeri `from` → `to`, `otherSpecId`-in bir yeri `to` → `from` */
export interface PacketAllocMove {
  src: string; specId: string; otherSpecId?: string; from: number; to: number
  student: { name: string; score: number }
}
/** Cins limitinin bir vahidi paketlər arasında keçirildi (`from` null → ehtiyatdan) */
export interface PacketAllocCapMove {
  specId: string; gender: 'F' | 'M'; from: number | null; to: number
  student: { name: string; score: number }
  /** `from` paketində limitdən kənarda qalan (daha aşağı ballı) — növbəti seçiminə keçdi */
  displaced?: { name: string; score: number; specId: string | null }
}
/** Cins limitini tutan `holder` daha üstün seçdiyi ixtisasa keçirildi ki, `student` yerləşsin:
 *  `upSpecId`-in 1 yeri n → m, `emptySpecId`-in boş yeri m → n; m ≠ to olduqda limit m → to */
export interface PacketAllocChainMove {
  src: string; gender: 'F' | 'M'; specId: string; upSpecId: string; emptySpecId: string | null
  /** u-nun paketinə j-nin boş yeri bu paketdən gəldi */
  jFrom: number | null
  holder: { name: string; score: number }; m: number; n: number; to: number
  student: { name: string; score: number }
}
export interface PacketAllocExplain {
  sourceProportional: boolean
  /** ixtisas → cins limitinin paketlər üzrə bölgüsü (yalnız limiti olan ixtisaslar) */
  genderCaps: Record<string, { F?: { total: number; caps: number[] }; M?: { total: number; caps: number[] } }>
  capMoves: PacketAllocCapMove[]
  chainMoves: PacketAllocChainMove[]
  bySpec: Record<string, { quota: number; buckets: PacketAllocBucket[] }>
  /** mənbə → paket üzrə tutum: seçim göndərənlər və göndərməyənlər */
  cap: Record<string, { sub: number; ns: number }[]>
  moves: PacketAllocMove[]
  /** yoxlama vaxt limitinə çatıb dayandı */
  repairTimedOut: boolean
}
export interface PacketAllocResult { specs: PacketSpec[][]; explain: PacketAllocExplain }

// ── Minimum qiymətli maksimum axın (SPFA ilə) ─────────────────────────────────
class CostFlow {
  to: number[] = []; cap: number[] = []; cost: number[] = []; g: number[][] = []
  node() { this.g.push([]); return this.g.length - 1 }
  edge(a: number, b: number, cap: number, cost: number) {
    const id = this.to.length
    this.g[a].push(id); this.to.push(b); this.cap.push(cap); this.cost.push(cost)
    this.g[b].push(id + 1); this.to.push(a); this.cap.push(0); this.cost.push(-cost)
    return id
  }
  flowOn(id: number) { return this.cap[id ^ 1] }
  run(S: number, T: number) {
    const n = this.g.length
    for (;;) {
      const dist = new Array(n).fill(Infinity), pe = new Array(n).fill(-1), inq = new Array(n).fill(false)
      const q: number[] = [S]; dist[S] = 0; inq[S] = true
      for (let h = 0; h < q.length; h++) {
        const v = q[h]; inq[v] = false
        for (const id of this.g[v]) {
          if (this.cap[id] <= 0) continue
          const w = this.to[id], nd = dist[v] + this.cost[id]
          if (nd < dist[w]) { dist[w] = nd; pe[w] = id; if (!inq[w]) { inq[w] = true; q.push(w) } }
        }
      }
      if (dist[T] === Infinity) return
      let f = Infinity
      for (let v = T; v !== S; v = this.to[pe[v] ^ 1]) f = Math.min(f, this.cap[pe[v]])
      for (let v = T; v !== S; v = this.to[pe[v] ^ 1]) { this.cap[pe[v]] -= f; this.cap[pe[v] ^ 1] += f }
    }
  }
}

const OVER = 1e11      // yer heç bir paketdə doldurula bilmir — ən son çarə
const NS_COST = 1e8    // yer yalnız seçim göndərməyən birinə düşür
const GENDERS = ['F', 'M', 'U'] as const
const gKey = (u: any) => { const g = String(u?.gender ?? '').trim().toLowerCase(); return g === 'qadın' ? 'F' : g === 'kişi' ? 'M' : 'U' }

/**
 * İxtisas yerlərinin paketlərə bölgüsü.
 *
 * Əvvəl yerlər ixtisas-ixtisas, yer-yer "acgöz" paylanırdı: sonrakı ixtisas üçün
 * uyğun paketdə tutum qalmayanda yer onu seçə bilən heç kimi olmayan paketə
 * düşürdü — orada boş qalırdı, başqa paketdə isə adam yersiz qalırdı (HEHİ-2026:
 * sadə bölgüdə hamı yerləşirdi, paketdə 2 nəfər kənarda, 2 yer boş).
 *
 * İndi:
 *  1) Bütün paketlər BİRLİKDƏ hesablanır (min-qiymətli axın). Hər yer yalnız onu
 *     doldura bilən təhsilalanı olan paketə gedə bilər; məhdudiyyətlər (qrup,
 *     filtr, cins, budaq, mənbə, cins limiti) şəbəkədə yol kimi qurulur — pozula
 *     bilməz. Mümkün olan hər halda hər yerin öz namizədi olur.
 *  2) Bu şərt daxilində paylar ədalətli paya (namizəd sayına mütənasib) ən yaxın
 *     seçilir.
 *  3) Real yerləşdirmə (bal sırası + tarazlama) hər paket üçün yoxlanılır. Paketdə
 *     həm boş yer, həm yersiz təhsilalan qalırsa, iki paket arasında bir-bir yer
 *     dəyişməsi sınanır və yalnız yersiz qalanların sayını azaldırsa qəbul olunur.
 *  4) Hər qərarın izahı qaytarılır (izahlı simulyasiyada göstərilir).
 */
export function allocatePacketSpecs(
  leaves: Array<{ leaf: any; path: any[] }>, allInstUsers: any[], pkUsers: any[][],
  tree: any, preAssignLevel: number | null, subs: any[] = [],
): PacketAllocResult {
  const P = pkUsers.length
  const spActive = !!(tree?.sourceProportional)
  const explain: PacketAllocExplain = { sourceProportional: spActive, genderCaps: {}, capMoves: [], chainMoves: [], bySpec: {}, cap: {}, moves: [], repairTimedOut: false }
  const specs: PacketSpec[][] = Array.from({ length: P }, () => [])
  if (leaves.length === 0 || P === 0) return { specs, explain }

  const opts = { preAssignLevel: preAssignLevel ?? null }
  const srcOf = (u: any) => spActive ? (u.source === 'mülki' ? 'mülki' : u.source === 'lisey' ? 'lisey' : 'other') : 'all'
  const sources = spActive ? ['mülki', 'lisey', 'other'] : ['all']
  const J = leaves.length

  // ── İxtisas üzrə mənbə yerləri — sadə üsulla eyni qayda ──
  const gt = spActive ? globalSourceSplitCached(allInstUsers, tree?.nodes || [], opts) : null
  const slots: Record<string, number>[] = leaves.map(({ leaf, path }) => {
    const q = leaf.quota || 0
    if (!spActive) return { all: q }
    let m: number, l: number
    if (leaf.quotaMode === 'manual' && leaf.mülkiQuota != null && leaf.liseyQuota != null) {
      m = leaf.mülkiQuota; l = leaf.liseyQuota
    } else {
      const sp = autoSplit(leaf, poolCounts(allInstUsers, path, opts), gt!)
      m = sp.mülki; l = sp.lisey
    }
    return { mülki: m, lisey: l, other: Math.max(0, q - m - l) }
  })

  // ── Hər təhsilalanın doldura biləcəyi ixtisaslar ──
  // Seçim göndərənlər: seçim siyahısında olan VƏ seçə bildiyi ixtisaslar (yerləşdirmə
  // yalnız siyahıdan yer verir). Göndərməyənlər: seçə bildikləri — onlar yalnız
  // ehtiyat kimi sayılır (NS_COST), yer əvvəlcə göndərənlərə uyğunlaşdırılır.
  const rankOf = new Map<string, string[]>()
  for (const s of subs) if (s?.userId && Array.isArray(s.ranking) && s.ranking.length && !rankOf.has(s.userId)) rankOf.set(s.userId, s.ranking)
  const info = new Map<string, { set: number[]; sub: boolean; g: string }>()
  for (const us of pkUsers) for (const u of us) {
    const el: number[] = []
    for (let j = 0; j < J; j++) if (canChoose(u, leaves[j].path, opts)) el.push(j)
    const rk = rankOf.get(u.id)
    const set = rk ? (() => { const rs = new Set(rk); return el.filter(j => rs.has(leaves[j].leaf.id)) })() : el
    info.set(u.id, { set, sub: !!rk, g: gKey(u) })
  }

  // ── Cins limitləri (bütün ixtisas üzrə, mənbələr arasında ortaq) ──
  const capOf = (leaf: any, g: 'F' | 'M') => {
    const v = g === 'F' ? leaf?.maxFemale : leaf?.maxMale
    return v != null ? Number(v) : null
  }
  const femRem = leaves.map(({ leaf }) => capOf(leaf, 'F'))
  const malRem = leaves.map(({ leaf }) => capOf(leaf, 'M'))

  // A[src][j][i] — j ixtisasının i paketindəki src yerləri
  const A: Record<string, number[][]> = {}
  const Fbase = leaves.map(() => Array(P).fill(0)), Mbase = leaves.map(() => Array(P).fill(0))
  for (const { leaf } of leaves) explain.bySpec[leaf.id] = { quota: leaf.quota || 0, buckets: [] }

  for (const src of sources) {
    const users = pkUsers.map(us => us.filter(u => srcOf(u) === src))
    explain.cap[src] = users.map(us => ({ sub: us.filter(u => info.get(u.id)!.sub).length, ns: us.filter(u => !info.get(u.id)!.sub).length }))
    const e = leaves.map(() => Array(P).fill(0)), eSub = leaves.map(() => Array(P).fill(0))
    const eG: Record<string, number[][]> = { F: leaves.map(() => Array(P).fill(0)), M: leaves.map(() => Array(P).fill(0)), U: leaves.map(() => Array(P).fill(0)) }
    // Eyni ixtisas dəstəsini dolduran eyni cinsli təhsilalanlar bir sinifdə
    const classes = users.map(us => {
      const m = new Map<string, { g: string; sub: boolean; set: Set<number>; n: number }>()
      for (const u of us) {
        const inf = info.get(u.id)!
        const k = `${inf.g}|${inf.sub ? 1 : 0}|${inf.set.join(',')}`
        const c = m.get(k); if (c) c.n++; else m.set(k, { g: inf.g, sub: inf.sub, set: new Set(inf.set), n: 1 })
      }
      return [...m.values()]
    })
    users.forEach((us, i) => {
      for (const u of us) {
        const inf = info.get(u.id)!
        for (const j of inf.set) { e[j][i]++; eG[inf.g][j][i]++; if (inf.sub) eSub[j][i]++ }
      }
    })
    const target = leaves.map((_, j) => {
      const tot = e[j].reduce((a, b) => a + b, 0), s = slots[j][src] || 0
      return e[j].map(x => tot > 0 ? s * x / tot : 0)
    })

    // ── Şəbəkə: S → ixtisas → cins qapısı → (ixtisas, cins, paket) → sinif → T ──
    const f = new CostFlow()
    const S = f.node(), T = f.node()
    const clsNode = classes.map(cs => cs.map(c => { const v = f.node(); f.edge(v, T, c.n, c.sub ? 0 : NS_COST); return v }))
    const overEdge: number[] = [], yc: { j: number; i: number; g: string; id: number }[] = []
    for (let j = 0; j < J; j++) {
      const s = slots[j][src] || 0
      if (s <= 0) { overEdge.push(-1); continue }
      const jn = f.node()
      f.edge(S, jn, s, 0)
      overEdge.push(f.edge(jn, T, s, OVER))
      for (const g of GENDERS) {
        const rem = g === 'F' ? femRem[j] : g === 'M' ? malRem[j] : null
        const gc = rem == null ? s : Math.max(0, Math.min(s, rem))
        if (gc <= 0) continue
        const gn = f.node()
        // Limitli cins üçün kiçik cərimə: alternativ varsa limiti sonrakı mənbəyə saxla
        f.edge(jn, gn, gc, rem == null ? 0 : 1)
        for (let i = 0; i < P; i++) {
          const cnt = eG[g][j][i]
          if (cnt <= 0) continue
          // Ədalətli paya yaxınlıq: qabarıq (artan) qiymətli hissələr
          const tg = e[j][i] > 0 ? target[j][i] * cnt / e[j][i] : 0
          const tf = Math.floor(tg), fr = tg - tf
          let lim = Math.min(s, cnt)
          const yn = f.node()
          const seg = (c: number, cost: number) => { const x = Math.min(c, lim); if (x > 0) { f.edge(gn, yn, x, cost); lim -= x } }
          seg(tf, -100); seg(1, Math.round(100 * (1 - 2 * fr))); seg(2, 300); seg(lim, 1000)
          classes[i].forEach((c, k) => { if (c.g === g && c.set.has(j)) yc.push({ j, i, g, id: f.edge(yn, clsNode[i][k], Infinity, 0) }) })
        }
      }
    }
    f.run(S, T)

    const flowA = leaves.map(() => Array(P).fill(0))
    for (const x of yc) {
      const v = f.flowOn(x.id)
      if (!v) continue
      flowA[x.j][x.i] += v
      if (x.g === 'F') Fbase[x.j][x.i] += v
      else if (x.g === 'M') Mbase[x.j][x.i] += v
    }
    // Növbəti mənbə üçün qalan cins limiti
    for (let j = 0; j < J; j++) {
      const fs = yc.filter(x => x.j === j && x.g !== 'U')
      if (femRem[j] != null) femRem[j] = femRem[j]! - fs.filter(x => x.g === 'F').reduce((a, x) => a + f.flowOn(x.id), 0)
      if (malRem[j] != null) malRem[j] = malRem[j]! - fs.filter(x => x.g === 'M').reduce((a, x) => a + f.flowOn(x.id), 0)
    }
    // Heç bir paketdə doldurula bilməyən yerlər — ədalətli paydan ən çox geridə qalan paketə
    const Asrc = flowA.map(r => [...r])
    const over = leaves.map(() => Array(P).fill(0))
    for (let j = 0; j < J; j++) {
      const o = overEdge[j] >= 0 ? f.flowOn(overEdge[j]) : 0
      for (let k = 0; k < o; k++) {
        let best = 0
        for (let i = 1; i < P; i++) if (target[j][i] - Asrc[j][i] > target[j][best] - Asrc[j][best]) best = i
        Asrc[j][best]++; over[j][best]++
      }
    }
    A[src] = Asrc
    for (let j = 0; j < J; j++) {
      if ((slots[j][src] || 0) <= 0) continue
      explain.bySpec[leaves[j].leaf.id].buckets.push({
        src, slots: slots[j][src] || 0,
        rows: Array.from({ length: P }, (_, i) => ({ elig: e[j][i], eligSub: eSub[j][i], target: target[j][i], flow: flowA[j][i], overflow: over[j][i], given: Asrc[j][i] })),
      })
    }
  }

  // ── Paketlərin cins limiti ──
  // Hər paketə əvvəlcə bölgünün həmin cinsdən istifadə etdiyi yer qədər limit düşür.
  // Qalan ehtiyat paketlərə həmin cinsdən olan namizəd sayına mütənasib bölünür
  // (əvvəl yuxarı paketlərə verilirdi — aşağı paketdə namizəd qadın limit 0 olduğu
  // üçün yersiz qalır, yer isə boş qalırdı). Paylanmayan hissə ehtiyatda qalır və
  // yoxlama zamanı ehtiyacı olan paketə verilir.
  const capArr: Record<'F' | 'M', (number[] | null)[]> = { F: [], M: [] }
  const capPool: Record<'F' | 'M', number[]> = { F: [], M: [] }
  for (const g of ['F', 'M'] as const) for (let j = 0; j < J; j++) {
    const C = capOf(leaves[j].leaf, g)
    if (C == null) { capArr[g].push(null); capPool[g].push(0); continue }
    const base = (g === 'F' ? Fbase[j] : Mbase[j]).map(b => b)
    const demand = Array.from({ length: P }, (_, i) =>
      Math.max(0, pkUsers[i].filter(u => { const inf = info.get(u.id)!; return inf.g === g && inf.set.includes(j) }).length - base[i]))
    let slack = Math.max(0, C - base.reduce((a, b) => a + b, 0))
    const dTot = demand.reduce((a, b) => a + b, 0)
    if (slack > 0 && dTot > 0) {
      const give = Math.min(slack, dTot)
      const raw = demand.map(d => give * d / dTot), fl = raw.map(Math.floor)
      let rest = give - fl.reduce((a, b) => a + b, 0)
      raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0 && fl[i] < demand[i]) { fl[i]++; rest-- } })
      fl.forEach((x, i) => { base[i] += x }); slack -= fl.reduce((a, b) => a + b, 0)
    }
    capArr[g].push(base); capPool[g].push(slack)
  }
  const buildSpecs = (i: number): PacketSpec[] => {
    const out: PacketSpec[] = []
    for (let j = 0; j < J; j++) {
      const { leaf, path } = leaves[j]
      const byS: Record<string, number> = {}
      for (const s of sources) byS[s] = A[s][j][i]
      const q = sources.reduce((a, s) => a + byS[s], 0)
      if (q <= 0) continue
      const fc = capArr.F[j], mc = capArr.M[j]
      out.push({
        id: leaf.id, name: leaf.name, path, quota: q, origQuota: leaf.quota || 0,
        ...(spActive ? { mülkiQuota: byS.mülki, liseyQuota: byS.lisey } : {}),
        ...(fc ? { maxFemale: fc[i] } : {}), ...(mc ? { maxMale: mc[i] } : {}),
      })
    }
    return out
  }

  // ── Real yerləşdirmə ilə yoxlama və yer dəyişmələri ──
  if (rankOf.size > 0) {
    const leafIdx = new Map(leaves.map((l, j) => [l.leaf.id, j]))
    const sim = (i: number) => {
      const sp = buildSpecs(i)
      const r = runPacketPlacement(pkUsers[i], subs, sp, spActive)
      const unplaced = pkUsers[i].filter(u => rankOf.has(u.id) && !r.assignments[u.id])
        .sort((a, b) => (b.score || 0) - (a.score || 0))
      // ixtisas → mənbə üzrə boş yer
      const empty = (src: string, j: number) => {
        const spec = sp.find(x => x.id === leaves[j].leaf.id)
        if (!spec) return 0
        let tot = 0, mine = 0
        for (const u of pkUsers[i]) {
          if (r.assignments[u.id]?.specId !== spec.id) continue
          tot++; if (srcOf(u) === src) mine++
        }
        const free = spec.quota - tot
        if (!spActive || src === 'other') return Math.max(0, free)
        return Math.max(0, Math.min(free, A[src][j][i] - mine))
      }
      // i paketində j ixtisasına yerləşən g cinsli
      const gPlaced = (j: number, g: string) => pkUsers[i].filter(u => r.assignments[u.id]?.specId === leaves[j].leaf.id && gKey(u) === g).length
      return { unplaced, empty, gPlaced, r }
    }
    const res = Array.from({ length: P }, (_, i) => sim(i))
    // i paketində j ixtisasına g cinsli üçün limit doludursa bir vahid gətirir
    // (ehtiyatdan, əvvəlcə `pref`, sonra onu işlətməyən digər paketlərdən).
    // Qaytarır: geri alma funksiyası və mənbə; null → limit tapılmadı.
    type Grab = { undo: () => void; from?: number | null }
    const NOOP: Grab = { undo: () => {} }
    const grabCap = (i: number, j: number, g: string, pref: number | null): Grab | null => {
      if (g !== 'F' && g !== 'M') return NOOP
      const caps = capArr[g][j]
      if (!caps || res[i].gPlaced(j, g) < caps[i]) return NOOP
      if (capPool[g][j] > 0) {
        caps[i]++; capPool[g][j]--
        return { undo: () => { caps[i]--; capPool[g][j]++ }, from: null }
      }
      const ks = Array.from({ length: P }, (_, k) => k).filter(k => k !== i && caps[k] > res[k].gPlaced(j, g))
        .sort((a, b) => (b === pref ? 1 : 0) - (a === pref ? 1 : 0) || (caps[b] - res[b].gPlaced(j, g)) - (caps[a] - res[a].gPlaced(j, g)))
      if (!ks.length) return null
      const k = ks[0]
      caps[i]++; caps[k]--
      return { undo: () => { caps[i]--; caps[k]++ }, from: k }
    }
    const logCap = (gr: Grab, j: number, g: string, i: number, u: any) => {
      if (gr.from !== undefined) explain.capMoves.push({ specId: leaves[j].leaf.id, gender: g as 'F' | 'M', from: gr.from, to: i, student: { name: u.name, score: u.score || 0 } })
    }
    const deadline = Date.now() + 3000
    let guard = 0
    // Əvvəl hamı üçün paketlərin yer sayını saxlayan dəyişmələr (1–2), yalnız sonra 3
    outer: while (guard++ < 100) {
      for (const phase of [0, 1, 2]) for (let i = 0; i < P; i++) {
        for (const u of res[i].unplaced) {
          const src = srcOf(u)
          const g = gKey(u)
          const wants = (rankOf.get(u.id) || []).map(id => leafIdx.get(id)).filter((j): j is number => j != null && info.get(u.id)!.set.includes(j))
          const others = Array.from({ length: P }, (_, k) => k).filter(k => k !== i).sort((a, b) => Math.abs(a - i) - Math.abs(b - i))
          // 1) Cins limiti: seçdiyi ixtisasda öz paketində boş yer var, amma paketin bu
          //    cins limiti dolub → limitin bir vahidi ehtiyatdan və ya digər paketdən gəlir
          if (phase === 0 && (g === 'F' || g === 'M')) for (const j of wants) {
            const caps = capArr[g][j]
            if (!caps || res[i].empty(src, j) <= 0 || res[i].gPlaced(j, g) < caps[i]) continue
            const donors: (number | null)[] = capPool[g][j] > 0 ? [null] : []
            for (const k of others) if (caps[k] > res[k].gPlaced(j, g)) donors.push(k)
            for (const k of donors) {
              if (Date.now() > deadline) { explain.repairTimedOut = true; break outer }
              caps[i]++; if (k == null) capPool[g][j]--; else caps[k]--
              const ri = sim(i)
              const rk = ri.unplaced.length < res[i].unplaced.length && k != null ? sim(k) : null
              if (ri.unplaced.length < res[i].unplaced.length && (k == null || ri.unplaced.length + rk!.unplaced.length < res[i].unplaced.length + res[k].unplaced.length)) {
                res[i] = ri; if (k != null) res[k] = rk!
                explain.capMoves.push({ specId: leaves[j].leaf.id, gender: g, from: k, to: i, student: { name: u.name, score: u.score || 0 } })
                continue outer
              }
              caps[i]--; if (k == null) capPool[g][j]++; else caps[k]++
            }
          }
          const ws = new Set(wants)
          // 2) Öz paketində boş yer var, amma seçdiyi ixtisaslarda yox → yerlər dəyişdirilir.
          //    Əvvəl təhsilalanın öz seçimləri, sonra qalan ixtisaslar (zəncirvari sıxışdırma
          //    ilə də yer aça bilər — məs. paketdəki başqa biri o ixtisasa keçib yer boşaldır)
          const empties = leaves.map((_, j) => j).filter(j => res[i].empty(src, j) > 0)
          const cands = [...wants, ...leaves.map((_, j) => j).filter(j => !ws.has(j))]
          if (phase === 0 && empties.length) for (const t of cands) for (const k of others) {
            if (A[src][t][k] <= 0) continue
            for (const ej of empties) {
              if (ej === t) continue
              if (Date.now() > deadline) { explain.repairTimedOut = true; break outer }
              A[src][ej][i]--; A[src][ej][k]++; A[src][t][k]--; A[src][t][i]++
              const gr = ws.has(t) ? grabCap(i, t, g, k) : NOOP
              if (gr) {
                // əvvəl yalnız bu paket — yaxşılaşmırsa digərini hesablamağa dəyməz
                const ri = sim(i)
                const rk = ri.unplaced.length < res[i].unplaced.length ? sim(k) : null
                if (rk && ri.unplaced.length + rk.unplaced.length < res[i].unplaced.length + res[k].unplaced.length) {
                  res[i] = ri; res[k] = rk
                  if (gr.from != null && gr.from !== k) res[gr.from] = sim(gr.from)
                  logCap(gr, t, g, i, u)
                  explain.moves.push({ src, specId: leaves[ej].leaf.id, otherSpecId: leaves[t].leaf.id, from: i, to: k, student: { name: u.name, score: u.score || 0 } })
                  continue outer
                }
                gr.undo()
              }
              A[src][ej][i]++; A[src][ej][k]--; A[src][t][k]++; A[src][t][i]--
            }
          }
          // 3) Seçdiyi ixtisasın yeri başqa paketdə boş qalır → həmin yer bu paketə keçir
          //    (lazım olsa cins limitinin bir vahidi ilə birlikdə). Bu paketlərin yer sayını
          //    dəyişdiyi üçün yer dəyişməsindən sonra sınanır.
          if (phase === 1) for (const j of wants) {
            if (res[i].empty(src, j) > 0) continue
            for (const k of others) {
              if (res[k].empty(src, j) <= 0) continue
              if (Date.now() > deadline) { explain.repairTimedOut = true; break outer }
              A[src][j][k]--; A[src][j][i]++
              const gr = grabCap(i, j, g, k)
              if (gr) {
                const ri = sim(i)
                const rk = ri.unplaced.length < res[i].unplaced.length ? sim(k) : null
                if (rk && ri.unplaced.length + rk.unplaced.length < res[i].unplaced.length + res[k].unplaced.length) {
                  res[i] = ri; res[k] = rk
                  if (gr.from != null && gr.from !== k) res[gr.from] = sim(gr.from)
                  logCap(gr, j, g, i, u)
                  explain.moves.push({ src, specId: leaves[j].leaf.id, from: k, to: i, student: { name: u.name, score: u.score || 0 } })
                  continue outer
                }
                gr.undo()
              }
              A[src][j][k]++; A[src][j][i]--
            }
          }
          // 4a) Limiti aşağı paketdə daha aşağı ballı eyni cinsli tutur — sadə bölgüdə limit
          //     ona yox, daha yüksək ballıya düşərdi. Limitin 1 vahidi aşağı paketdən gəlir,
          //     orada limitdən kənarda qalan öz növbəti seçiminə keçir (yersiz qalsa, qəbul olunmur).
          if (phase === 2 && (g === 'F' || g === 'M')) for (const j of wants) {
            const caps = capArr[g][j]
            if (!caps || res[i].gPlaced(j, g) < caps[i]) continue
            const jid = leaves[j].leaf.id
            for (let k = i + 1; k < P; k++) {
              if (caps[k] <= 0) continue
              const hold = pkUsers[k].filter(y => res[k].r.assignments[y.id]?.specId === jid && gKey(y) === g)
              if (hold.some(y => (y.score || 0) >= (u.score || 0))) continue
              // u-ya j-də yer: öz paketində boş yer, başqa paketin boş yeri və ya k-nın yeri
              let seatFrom: number | null = null
              if (res[i].empty(src, j) <= 0) {
                seatFrom = [k, ...others].find(x => x !== i && res[x].empty(src, j) > 0) ?? (A[src][j][k] > 0 ? k : null)
                if (seatFrom == null) continue
              }
              if (Date.now() > deadline) { explain.repairTimedOut = true; break outer }
              caps[k]--; caps[i]++
              if (seatFrom != null) { A[src][j][seatFrom]--; A[src][j][i]++ }
              const inv = [...new Set([i, k, ...(seatFrom != null ? [seatFrom] : [])])]
              const nr = inv.map(x => sim(x))
              if (nr.reduce((a, x) => a + x.unplaced.length, 0) < inv.reduce((a, x) => a + res[x].unplaced.length, 0)) {
                const nk = nr[inv.indexOf(k)]
                const moved = hold.find(y => nk.r.assignments[y.id]?.specId !== jid)
                inv.forEach((x, q) => { res[x] = nr[q] })
                explain.capMoves.push({ specId: jid, gender: g, from: k, to: i, student: { name: u.name, score: u.score || 0 },
                  ...(moved ? { displaced: { name: moved.name, score: moved.score || 0, specId: nk.r.assignments[moved.id]?.specId ?? null } } : {}) })
                if (seatFrom != null) explain.moves.push({ src, specId: jid, from: seatFrom, to: i, student: { name: u.name, score: u.score || 0 } })
                continue outer
              }
              if (seatFrom != null) { A[src][j][seatFrom]++; A[src][j][i]-- }
              caps[k]++; caps[i]--
            }
          }
          // 4) Cins limitini başqası tutur: j-yə yerləşən eyni cinsli y öz siyahısında daha
          //    yuxarıda olan t ixtisasına keçə bilsə limit boşalır. y-nin paketinə (m) t-nin
          //    1 yeri n paketindən gəlir, əvəzində m-in boş yeri n-ə keçir; m ≠ i olduqda
          //    limitin 1 vahidi m-dən i-yə keçirilir.
          if (phase === 2 && (g === 'F' || g === 'M')) for (const j of wants) {
            const caps = capArr[g][j]
            if (!caps || res[i].gPlaced(j, g) < caps[i]) continue
            for (const m of [i, ...others]) {
              const ys = pkUsers[m].filter(y => res[m].r.assignments[y.id]?.specId === leaves[j].leaf.id && gKey(y) === g)
              for (const y of ys) {
                const ysrc = srcOf(y)
                const rk = (rankOf.get(y.id) || []).map(id => leafIdx.get(id))
                const ups = rk.slice(0, Math.max(0, rk.indexOf(j))).filter((t): t is number => t != null && info.get(y.id)!.set.includes(t))
                for (const t of ups) for (let n = 0; n < P; n++) {
                  if (n === m || A[ysrc][t][n] <= 0) continue
                  if (m !== i && caps[m] <= 0) continue
                  // Əvəz: m-in boş yeri n-ə (u-nun paketinə gedirsə j üstünlüklü) və ya
                  // əvəzsiz (n-in boş yeri varsa itkini o udur)
                  const pj = n === i && ysrc === src
                  const e = leaves.map((_, x) => x).filter(x => x !== t && res[m].empty(ysrc, x) > 0)
                    .sort((a, b) => (pj && b === j ? 1 : 0) - (pj && a === j ? 1 : 0))[0]
                  const comps: (number | null)[] = []
                  if (e != null) comps.push(e)
                  if (leaves.some((_, x) => res[n].empty(ysrc, x) > 0)) comps.push(null)
                  for (const c of comps) {
                    if (Date.now() > deadline) { explain.repairTimedOut = true; break outer }
                    // u-nun paketində j-də boş yer yoxdursa, boş j yeri başqa paketdən gəlir
                    const needJ = res[i].empty(src, j) <= 0 && !(pj && c === j)
                    const jk = needJ ? [n, ...others].find(k => k !== i && res[k].empty(src, j) > 0) : undefined
                    A[ysrc][t][n]--; A[ysrc][t][m]++
                    if (c != null) { A[ysrc][c][m]--; A[ysrc][c][n]++ }
                    if (jk != null) { A[src][j][jk]--; A[src][j][i]++ }
                    if (m !== i) { caps[m]--; caps[i]++ }
                    const inv = [...new Set([i, m, n, ...(jk != null ? [jk] : [])])]
                    const nr = inv.map(x => sim(x))
                    if (nr.reduce((a, x) => a + x.unplaced.length, 0) < inv.reduce((a, x) => a + res[x].unplaced.length, 0)) {
                      inv.forEach((x, q) => { res[x] = nr[q] })
                      explain.chainMoves.push({ src: ysrc, gender: g, specId: leaves[j].leaf.id, upSpecId: leaves[t].leaf.id, emptySpecId: c == null ? null : leaves[c].leaf.id,
                        jFrom: jk ?? null, holder: { name: y.name, score: y.score || 0 }, m, n, to: i, student: { name: u.name, score: u.score || 0 } })
                      continue outer
                    }
                    if (m !== i) { caps[m]++; caps[i]-- }
                    if (jk != null) { A[src][j][jk]++; A[src][j][i]-- }
                    if (c != null) { A[ysrc][c][m]++; A[ysrc][c][n]-- }
                    A[ysrc][t][n]++; A[ysrc][t][m]--
                  }
                }
              }
            }
          }
        }
      }
      break
    }
    // Yekun yerlər izaha yazılır
    for (let j = 0; j < J; j++) for (const b of explain.bySpec[leaves[j].leaf.id].buckets)
      b.rows.forEach((r, i) => { r.given = A[b.src][j][i] })
  }

  for (let j = 0; j < J; j++) for (const g of ['F', 'M'] as const) {
    const caps = capArr[g][j]
    if (!caps) continue
    const e = explain.genderCaps[leaves[j].leaf.id] ||= {}
    e[g] = { total: capOf(leaves[j].leaf, g)!, caps: [...caps] }
  }
  for (let i = 0; i < P; i++) specs[i] = buildSpecs(i)
  return { specs, explain }
}
