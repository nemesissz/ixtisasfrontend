// Balans simulyasiyası: struktur real seçimlərlə neçə nəfəri kənarda qoya bilər?
//
// Struktur yoxlaması (sourceBalance) yalnız "adamları düzgün paylamaq MÜMKÜNDÜRMÜ"
// sualına cavab verir. Real yerləşdirmə isə bal sırası ilə gedir və yer almış adamı
// daha pis seçimə keçirmir; qrup/cins/mənbə məhdudiyyətləri kəsişəndə bəzi yerləri
// yalnız müəyyən dəstə doldura bilir və o dəstə başqa ixtisaslara yerləşərsə, yer
// boş qalır. Bunu əvvəlcədən bilmək üçün sadə üsul bir neçə dəfə təsadüfi
// seçimlərlə işlədilir: hər kəs strukturda ona AÇIQ OLAN bütün ixtisasları seçir
// (avtomatik doldurma kimi), yalnız sıra təsadüfidir.
import { canChoose, leavesWithPath, type PoolOpts } from './quota-pool'
import { runPlacement } from './placement'
import { useEffect, useState } from 'react'

export interface SimResult {
  runs: number
  /** kənarda qalanların sayı: ən az / adətən (median) / ən çox */
  min: number
  median: number
  max: number
  /** hər ixtisasda orta hesabla boş qalan yer (yalnız > 0 olanlar, çoxdan aza) */
  emptyLeaves: { id: string; name: string; pathLabel: string; avgEmpty: number }[]
  ms: number
}

/** Təkrarlanan nəticə üçün sadə toxumlu təsadüfi generator */
function rng(seed: number) {
  let x = seed % 2147483647 || 1
  return () => (x = (x * 16807) % 2147483647) / 2147483647
}

/**
 * Simulyasiyanı addım-addım işlədən obyekt: hər `step()` bir sınaq edir.
 * Böyük müəssisədə (500+ nəfər) bir sınaq ~100 ms çəkir — addımlara bölünəndə
 * ekran donmur.
 */
export function createBalanceSim(users: any[], tree: any, opts?: PoolOpts & { runs?: number; seed?: number }) {
  const nodes = tree?.nodes || []
  const all = leavesWithPath(nodes)
  const runs = opts?.runs ?? 50
  const rand = rng(opts?.seed ?? 12345)
  const sp = !!tree?.sourceProportional
  const pre = opts?.preAssignLevel ?? null
  const t0 = Date.now()
  // Hər adamın seçə biləcəyi ixtisaslar (qrup, cins, filtr, əvvəlcədən təyin)
  const elig = (users || []).map(u => all.filter(({ path }) => canChoose(u, path, { preAssignLevel: pre })).map(({ leaf }) => leaf.id))
  const out: number[] = []
  const empty: Record<string, number> = {}
  const empty0 = !all.length || !(users || []).length
  return {
    done: () => empty0 || out.length >= runs,
    step() {
      if (this.done()) return
      const subs = users.map((u, i) => {
        const a = [...elig[i]]
        for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); [a[j], a[k]] = [a[k], a[j]] }
        return { userId: u.id, ranking: a }
      })
      const res = runPlacement(users, subs, tree, sp, users, pre)
      out.push(users.length - Object.keys(res.assignments).length)
      const used: Record<string, number> = {}
      for (const a of Object.values(res.assignments) as any[]) used[a.specId] = (used[a.specId] || 0) + 1
      for (const { leaf } of all) {
        const e = (leaf.quota || 0) - (used[leaf.id] || 0)
        if (e > 0) empty[leaf.id] = (empty[leaf.id] || 0) + e
      }
    },
    progress: () => (empty0 ? 1 : out.length / runs),
    result(): SimResult | null {
      if (empty0 || !out.length) return null
      const o = [...out].sort((a, b) => a - b)
      const n = o.length
      const emptyLeaves = all
        .filter(({ leaf }) => (empty[leaf.id] || 0) / n >= 0.1)
        .map(({ leaf, path }) => ({
          id: leaf.id, name: leaf.name,
          pathLabel: path.slice(0, -1).map((x: any) => x?.name).filter(Boolean).join(' → '),
          avgEmpty: (empty[leaf.id] || 0) / n,
        }))
        .sort((a, b) => b.avgEmpty - a.avgEmpty)
      return { runs: n, min: o[0], median: o[Math.floor(n / 2)], max: o[n - 1], emptyLeaves, ms: Date.now() - t0 }
    },
  }
}

/** Sinxron variant (testlər üçün) */
export function simulateBalance(users: any[], tree: any, opts?: PoolOpts & { runs?: number; seed?: number }): SimResult | null {
  const sim = createBalanceSim(users, tree, opts)
  while (!sim.done()) sim.step()
  return sim.result()
}

// ── React: nəticə yaddaşda saxlanılır (eyni struktur + eyni təhsilalanlar) ──
const cache = new Map<string, SimResult | null>()
const running = new Map<string, Array<(r: SimResult | null) => void>>()

/** Struktur və ya təhsilalanlarda nəyin dəyişdiyini tutan açar */
export function simKey(users: any[], tree: any, pre: number | null): string {
  const strip = (n: any): any => [n.id, n.quota, n.groups, n.filters, n.allowFemale, n.allowMale, n.maxFemale, n.maxMale,
    n.quotaMode, n.mülkiQuota, n.liseyQuota, (n.children || []).map(strip)]
  const u = (users || []).map(x => [x.id, x.score, x.source, x.group, x.gender, x.branchByLevel]).join('|')
  return JSON.stringify([tree?.id, !!tree?.sourceProportional, pre, (tree?.nodes || []).map(strip)]) + u
}

/** Addım-addım işə salır; eyni açarla paralel çağırışlar bir hesablamanı gözləyir */
export function runBalanceSim(key: string, users: any[], tree: any, pre: number | null, cb: (r: SimResult | null) => void) {
  if (cache.has(key)) { cb(cache.get(key)!); return }
  const waiters = running.get(key)
  if (waiters) { waiters.push(cb); return }
  running.set(key, [cb])
  // Böyük müəssisədə sınaq sayı azaldılır ki, gözləmə uzanmasın
  const runs = users.length > 400 ? 20 : 50
  const sim = createBalanceSim(users, tree, { preAssignLevel: pre, runs })
  const tick = () => {
    const until = Date.now() + 40
    while (!sim.done() && Date.now() < until) sim.step()
    if (!sim.done()) { setTimeout(tick, 0); return }
    const r = sim.result()
    if (cache.size > 50) cache.clear()
    cache.set(key, r)
    for (const w of running.get(key) || []) w(r)
    running.delete(key)
  }
  setTimeout(tick, 0)
}

/** Balans simulyasiyasının nəticəsi — hesablanana qədər null */
export function useBalanceSim(users: any[], tree: any, pre: number | null = null): SimResult | null | undefined {
  const key = tree && (users || []).length ? simKey(users, tree, pre) : ''
  const [res, setRes] = useState<{ key: string; r: SimResult | null } | null>(null)
  useEffect(() => {
    if (!key) return
    let alive = true
    runBalanceSim(key, users, tree, pre, r => { if (alive) setRes({ key, r }) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!key) return null
  return res && res.key === key ? res.r : undefined   // undefined = hələ hesablanır
}
