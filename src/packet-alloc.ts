// Paket üsulu: ixtisas kvotalarının paketlərə bölgüsü (bax: Distribution.tsx)
import { poolCounts, autoSplit, globalSourceSplitCached, canChoose } from './quota-pool'

export interface PacketSpec { id: string; name: string; path: any[]; quota: number; origQuota: number; mülkiQuota?: number; liseyQuota?: number }

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
export function splitPacketStudents(users: any[], P: number, bySource: boolean): any[][] {
  const bySc = (a: any, b: any) => (b.score || 0) - (a.score || 0)
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

export function allocatePacketSpecs(
  leaves: Array<{ leaf: any; path: any[] }>, allInstUsers: any[], pkUsers: any[][],
  tree: any, preAssignLevel: number | null,
): PacketSpec[][] {
  const P = pkUsers.length
  const sel = { preAssignLevel }
  const perPacketSpecs: PacketSpec[][] =
    Array.from({ length: P }, () => [])

  if (leaves.length > 0) {
    const spActive = !!(tree?.sourceProportional)
    const opts = { preAssignLevel: sel?.preAssignLevel ?? null }
    const srcOf = (u: any) => spActive ? (u.source === 'mülki' ? 'mülki' : u.source === 'lisey' ? 'lisey' : 'other') : 'all'
    const sources = spActive ? ['mülki', 'lisey', 'other'] : ['all']

    // İxtisas üzrə mənbə yerləri — sadə üsulla eyni qayda
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

    // alloc[src][j][i] — j ixtisasının i paketindəki src yerləri
    const alloc: Record<string, number[][]> = {}
    for (const src of sources) {
      const cap = pkUsers.map(us => us.filter(u => srcOf(u) === src).length)   // paketin boş tutumu
      // elig[j][i] — i paketində j ixtisasını seçə bilən src təhsilalanları
      const elig = leaves.map(({ path }) => pkUsers.map(us => us.filter(u => srcOf(u) === src && canChoose(u, path, opts)).length))
      const A = leaves.map(() => Array(P).fill(0))
      // Paketin tələbələri eyni ixtisas dəstəsini seçə bilənlərə görə siniflərə bölünür
      // (qrup × cins × filtr). Yer yalnız o paketə verilir ki, paketin bütün yerləri
      // hələ də onun tələbələrinə paylana bilsin — yoxsa məs. qadın yeri qadını
      // olmayan paketə düşür, orada boş qalır, başqa paketdə isə qadın yersiz qalır.
      const cls = pkUsers.map(us => {
        const m = new Map<string, { leaves: Set<number>; n: number }>()
        for (const u of us) {
          if (srcOf(u) !== src) continue
          const e = leaves.map((l, j) => canChoose(u, l.path, opts) ? j : -1).filter(j => j >= 0)
          const k = e.join(',')
          const c = m.get(k); if (c) c.n++; else m.set(k, { leaves: new Set(e), n: 1 })
        }
        return [...m.values()]
      })
      const fits = (i: number, add: number) => {
        // Yerlər (ixtisas üzrə) → siniflər maksimal axın; hamısı yerləşirsə true
        const need = leaves.map((_, j) => A[j][i] + (j === add ? 1 : 0))
        const cs = cls[i], left = cs.map(c => c.n)
        const flow = leaves.map(() => cs.map(() => 0))
        const tot = need.reduce((a, b) => a + b, 0)
        let got = 0
        const aug = (j: number, seenJ: Set<number>): boolean => {
          if (seenJ.has(j)) return false; seenJ.add(j)
          for (let c = 0; c < cs.length; c++) {
            if (!cs[c].leaves.has(j)) continue
            if (left[c] > 0) { left[c]--; flow[j][c]++; return true }
            // c sinfindən başqa ixtisasın yerini sıxışdır
            for (let j2 = 0; j2 < leaves.length; j2++) {
              if (flow[j2][c] > 0 && aug(j2, seenJ)) { flow[j2][c]--; flow[j][c]++; return true }
            }
          }
          return false
        }
        for (let j = 0; j < leaves.length; j++) for (let k = 0; k < need[j]; k++) { if (aug(j, new Set())) got++; else return false }
        return got === tot
      }
      // Az paketdə seçilə bilən ixtisaslar əvvəl paylanır — yeri başqasına tutulmasın
      const order = leaves.map((_, j) => j).sort((x, y) =>
        elig[x].filter(e => e > 0).length - elig[y].filter(e => e > 0).length)
      for (const j of order) {
        const eTot = elig[j].reduce((s, e) => s + e, 0)
        for (let k = 0; k < (slots[j][src] || 0); k++) {
          // Üstünlük: tutumu olan + uyğun namizədi olan paket; payına görə ən çox "borclu" olan
          let best = -1, bestKey = -Infinity
          for (let i = 0; i < P; i++) {
            const hasCap = cap[i] > 0 ? 1 : 0
            const hasElig = elig[j][i] > A[j][i] ? (fits(i, j) ? 2 : 1) : 0
            const want = eTot > 0 ? (k + 1) * elig[j][i] / eTot - A[j][i] : cap[i]
            const key = hasCap * 8 + hasElig * 2 + want / (1e6)
            if (key > bestKey) { bestKey = key; best = i }
          }
          A[j][best]++; cap[best]--
        }
      }
      alloc[src] = A
    }

    for (let j = 0; j < leaves.length; j++) {
      const { leaf, path } = leaves[j]
      for (let i = 0; i < P; i++) {
        const byS: Record<string, number> = {}
        for (const src of sources) byS[src] = alloc[src][j][i]
        const q = sources.reduce((s, src) => s + byS[src], 0)
        if (q <= 0) continue
        perPacketSpecs[i].push({
          id: leaf.id, name: leaf.name, path,
          quota: q, origQuota: leaf.quota || 0,
          ...(spActive ? { mülkiQuota: byS.mülki, liseyQuota: byS.lisey } : {}),
        })
      }
    }
  }

  return perPacketSpecs
}
