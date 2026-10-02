// ── Kvotanın mülki/lisey bölgüsü — "seçə bilənlər" hovuzuna görə ─────────────
//
// Əvvəllər bölgü müəssisənin ümumi mülki/lisey nisbətindən (məs. 47%/53%)
// hesablanırdı. Bu yanlışdır: struktura qoyulan məhdudiyyətlər səbəbindən bir
// ixtisası müəyyən qrupların təhsilalanları ümumiyyətlə seçə bilmir, ona ayrılan
// yerlər isə boş qalır və digər qrupdan namizədlər kənarda qalır.
//
// Doğru qayda: hovuz kökdən yarpağa qədər BÜTÜN səviyyələrin məhdudiyyətləri ilə
// süzülür (qrup — hər səviyyədə, cins — yarpaqda, əvvəlcədən təyin edilmiş budaq —
// varsa), nisbət isə həmin hovuzdan çıxarılır. Filtrlər təhsilalanın öz ekranındakı
// məntiqin eynisidir — bax: pages/student/SelectionPage.tsx

export interface PoolCounts {
  total: number
  mülki: number
  lisey: number
  /** mənbəsi yazılmamış təhsilalanlar */
  other: number
}

export interface QuotaSplit {
  mülki: number
  lisey: number
  /** namizəd çatmadığı üçün heç kimlə dolmayacaq yer sayı */
  unfilled: number
}

/** Bir təhsilalan bu yarpağı seçə bilərmi? `path` kökdən yarpağa qədər node-lar. */
/** Hovuz hesablamalarının ümumi parametrləri. */
export interface PoolOpts {
  /** Seçimdə əvvəlcədən təyin edilmiş səviyyə (varsa). */
  preAssignLevel?: number | null
}

/** Dəyərin normallaşdırılmış forması (böyük/kiçik hərf və boşluq fərqi silinir). */
const normCol = (v: any) => String(v ?? '').trim().toLowerCase()

/**
 * Node filtrlərində istifadə olunan KANONİK sütun açarları. Açar insana görünən
 * sütun adı deyil (ad dəyişə bilər, dilə bağlıdır) — sabit identifikatordur:
 *   group | source | gender | year | lv0, lv1, ...   (lvN = strukturun N-ci səviyyəsi)
 * Səviyyə sütunlarının insana görünən adı strukturun levelNames sahəsindən
 * götürülür; hesablama tərəfinə isə ad lazım deyil, ona görə burada indeks kifayətdir.
 */
export function studentColValue(u: any, key: string): string {
  // ex:<ad> — Excel-dən gələn sərbəst MƏTN sütunu (ExtraFields, məs. "dil").
  // Açar böyük/kiçik hərf fərqinə baxılmadan tapılır — Excel başlığı dəyişə bilər.
  const mx = /^ex:(.+)$/i.exec(String(key ?? '').trim())
  if (mx) {
    const want = normCol(mx[1])
    const ef = u?.extraFields || {}
    for (const k of Object.keys(ef)) if (normCol(k) === want) return String(ef[k] ?? '').trim()
    return ''
  }
  const c = normCol(key)
  if (c === 'group')  return String(u?.group  ?? '').trim()
  if (c === 'source') return String(u?.source ?? '').trim()
  if (c === 'gender') return String(u?.gender ?? '').trim()
  if (c === 'year')   return String(u?.year   ?? '').trim()
  const m = /^lv(\d+)$/.exec(c)
  if (m) return String(u?.branchByLevel?.[Number(m[1])] ?? '').trim()
  return ''
}

export function canChoose(
  user: any,
  path: any[],
  opts?: PoolOpts,
): boolean {
  const leaf = path[path.length - 1]
  if (!leaf) return false

  // 1) Qrup — hər səviyyədə. Təhsilalanın qrupu boşdursa filtr tətbiq olunmur.
  const group = String(user?.group ?? '').trim()
  if (group) {
    for (const n of path) {
      const g: string[] | undefined = n?.groups
      if (g && g.length > 0 && !g.includes(group)) return false
    }
  }

  // 1b) Əlavə sütun filtrləri — yoldakı hər node üçün {sütun: dəyərlər}.
  // Təhsilalanın həmin sütunu boşdursa (məs. qoşun növü sütunu olmayan
  // təhsilalan qrupu) məhdudiyyət tətbiq edilmir.
  for (const n of path) {
    const f = n?.filters as Record<string, string[]> | undefined
    if (!f) continue
    for (const col of Object.keys(f)) {
      const vals = f[col]
      if (!vals || vals.length === 0) continue
      const v = studentColValue(user, col)
      if (!v) continue
      if (!vals.some(x => normCol(x) === normCol(v))) return false
    }
  }

  // 2) Əvvəlcədən təyin edilmiş budaq — həmin dərinlikdəki node adı uyğun gəlməlidir
  const lv = opts?.preAssignLevel
  if (lv != null) {
    const branch = String(user?.branchByLevel?.[lv] ?? '').trim()
    if (branch) {
      const node = path[lv]
      if (!node) return false
      if (String(node.name ?? '').trim().toLowerCase() !== branch.toLowerCase()) return false
    }
  }

  // 3) Cins — yarpaqda
  const gender = String(user?.gender ?? '').trim().toLowerCase()
  if (gender === 'qadın' && leaf.allowFemale === false) return false
  if (gender === 'kişi'  && leaf.allowMale   === false) return false

  return true
}

/** Yarpağı seçə bilən təhsilalanların mənbə üzrə sayı. */
export function poolCounts(
  users: any[],
  path: any[],
  opts?: PoolOpts,
): PoolCounts {
  let mülki = 0, lisey = 0, other = 0
  for (const u of users) {
    if (!canChoose(u, path, opts)) continue
    if (u.source === 'mülki') mülki++
    else if (u.source === 'lisey') lisey++
    else other++
  }
  return { total: mülki + lisey + other, mülki, lisey, other }
}

/**
 * Kvotanı hovuzun nisbətinə görə böl.
 * Mənbəsi yazılmamışlar nisbətə daxil edilmir, amma tutum hesabında sayılır —
 * onlar hər iki mərhələdən sonrakı "qalıq" mərhələsində yerləşdirilir.
 * Pay namizəd sayından çox ola bilməz: artıq yer digər qrupa keçir, ora da
 * sığmırsa `unfilled` kimi qaytarılır (kvota hovuzdan böyükdürsə baş verir).
 */
export function splitQuota(quota: number, pool: PoolCounts): QuotaSplit {
  const q = Math.max(0, Math.round(quota) || 0)
  if (q === 0) return { mülki: 0, lisey: 0, unfilled: 0 }

  const base = pool.mülki + pool.lisey
  if (base === 0) return { mülki: 0, lisey: 0, unfilled: pool.other >= q ? 0 : q - pool.other }

  let m = Math.round(q * pool.mülki / base)
  let l = q - m

  // Namizəd sayı ilə məhdudlaşdır
  if (m > pool.mülki) { l += m - pool.mülki; m = pool.mülki }
  if (l > pool.lisey) { m += l - pool.lisey; l = pool.lisey }
  if (m > pool.mülki) m = pool.mülki

  const unfilled = Math.max(0, q - m - l - pool.other)
  return { mülki: m, lisey: l, unfilled }
}

/** Manual bölgü üçün xəbərdarlıq rəqəmləri. */
export interface ManualCheck {
  /** namizəd çatmadığı üçün boş qalacaq yerlər */
  emptyMülki: number
  emptyLisey: number
  /** yer çatmadığı üçün bu ixtisasa düşə bilməyəcək namizədlər */
  leftMülki: number
  leftLisey: number
}

export function checkManual(mülkiQ: number, liseyQ: number, pool: PoolCounts): ManualCheck {
  return {
    emptyMülki: Math.max(0, mülkiQ - pool.mülki),
    emptyLisey: Math.max(0, liseyQ - pool.lisey),
    leftMülki:  Math.max(0, pool.mülki - mülkiQ),
    leftLisey:  Math.max(0, pool.lisey - liseyQ),
  }
}

// ── Struktur üzrə mənbə balansı ──────────────────────────────────────────────
//
// Bir ixtisasda kvotanı manual dəyişəndə həmin qrupun yerləri azalır. Bu, tək
// başına problem deyil — həmin yerləri EYNİ NAMİZƏD HOVUZUNA malik başqa bir
// ixtisasda geri qaytarmaq olar. Aşağıdakılar məhz bunu ölçür: hovuzu tam eyni
// olan ixtisaslar bir qrup sayılır, avtomatik bölgü ilə cari bölgünün fərqi isə
// həmin qrup üzrə "çatışmazlıq / artıqlıq" kimi göstərilir. Fərq sıfırlananda
// xəbərdarlıq itir.

export interface LeafRef { leaf: any; path: any[] }

export interface QuotaOverride {
  leafId: string
  mode: 'auto' | 'manual'
  mülki?: number
  lisey?: number
}

/** Ağacdan bütün yarpaqları yolları ilə birlikdə çıxarır. */
export function leavesWithPath(nodes: any[], anc: any[] = []): LeafRef[] {
  const out: LeafRef[] = []
  for (const n of nodes || []) {
    if (!n?.children?.length) out.push({ leaf: n, path: [...anc, n] })
    else out.push(...leavesWithPath(n.children, [...anc, n]))
  }
  return out
}

/** Yarpağı seçə bilənlərin id-lərindən qurulan imza — hovuzu tam eyni olanlar üst-üstə düşür. */
export function poolSignature(users: any[], path: any[], opts?: PoolOpts): string {
  const ids: string[] = []
  for (const u of users) if (canChoose(u, path, opts)) ids.push(String(u.id))
  ids.sort()
  return ids.join('|')
}

/**
 * Avtomatik bölgü: qlobal cədvəl verilibsə ondan (doğru qayda), yoxsa köhnə
 * yerli nisbətdən (yalnız cədvəl hesablana bilməyəndə ehtiyat variant).
 */
export function autoSplit(leaf: any, pool: PoolCounts, table?: Record<string, SourceSplit>): QuotaSplit {
  const q = leaf?.quota || 0
  const g = table?.[leaf?.id]
  if (g) return { mülki: g.mülki, lisey: g.lisey, unfilled: Math.max(0, q - g.mülki - g.lisey) }
  return splitQuota(q, pool)
}

/** Yarpağın qüvvədə olan bölgüsü: manual təyin edilibsə o, yoxsa avtomatik. */
export function effectiveSplit(
  leaf: any, pool: PoolCounts, override?: QuotaOverride, table?: Record<string, SourceSplit>,
): QuotaSplit {
  const q = leaf?.quota || 0
  if (override && override.leafId === leaf?.id) {
    if (override.mode === 'manual') {
      const m = Math.max(0, Math.min(override.mülki ?? 0, q))
      return { mülki: m, lisey: Math.max(0, Math.min(override.lisey ?? q - m, q - m)), unfilled: 0 }
    }
    return autoSplit(leaf, pool, table)
  }
  if (leaf?.quotaMode === 'manual' && leaf?.mülkiQuota != null && leaf?.liseyQuota != null) {
    return { mülki: leaf.mülkiQuota, lisey: leaf.liseyQuota, unfilled: 0 }
  }
  return autoSplit(leaf, pool, table)
}

export interface PeerRow {
  id: string
  name: string
  pathLabel: string
  quota: number
  autoMülki: number
  autoLisey: number
  effMülki: number
  effLisey: number
  isTarget: boolean
  isManual: boolean
}

export interface BalanceInfo {
  /** hovuzu eyni olan ixtisaslar */
  peers: PeerRow[]
  autoMülki: number
  autoLisey: number
  effMülki: number
  effLisey: number
  /** cari − avtomatik: mənfi = həmin qrupun yeri azalıb */
  diffMülki: number
  diffLisey: number
  /**
   * Yuvarlaqlaşdırılmamış modelə görə sapma. Xəbərdarlıq qərarı BUNUNLA və
   * BALANCE_TOLERANCE ilə verilməlidir — `diffMülki` ayrı-ayrı yuvarlaqlaşdırılmış
   * dəyərlərin cəmidir və qrup sərhədində 1 yerlik yalan sapma göstərir.
   */
  driftMülki: number
  driftLisey: number
  pool: PoolCounts
}

/**
 * `targetPath` ilə eyni namizəd hovuzuna malik bütün yarpaqları toplayır və
 * avtomatik bölgü ilə cari (override daxil) bölgünü müqayisə edir.
 */
export function balanceForLeaf(
  users: any[],
  allLeaves: LeafRef[],
  targetPath: any[],
  override?: QuotaOverride,
  opts?: PoolOpts,
  table?: Record<string, SourceSplit>,
): BalanceInfo {
  const targetLeaf = targetPath[targetPath.length - 1]
  const sig = poolSignature(users, targetPath, opts)
  const pool = poolCounts(users, targetPath, opts)

  const peers: PeerRow[] = []
  let autoM = 0, autoL = 0, effM = 0, effL = 0, rawM = 0, rawL = 0

  for (const { leaf, path } of allLeaves) {
    if (poolSignature(users, path, opts) !== sig) continue
    const auto = autoSplit(leaf, pool, table)
    const eff  = effectiveSplit(leaf, pool, override, table)
    autoM += auto.mülki; autoL += auto.lisey
    effM  += eff.mülki;  effL  += eff.lisey
    const t = table?.[leaf.id]
    rawM += (t && t.mülkiRaw != null) ? t.mülkiRaw : auto.mülki
    rawL += (t && t.liseyRaw != null) ? t.liseyRaw : auto.lisey
    peers.push({
      id: leaf.id,
      name: leaf.name,
      pathLabel: path.slice(0, -1).map((n: any) => n.name).join(' → '),
      quota: leaf.quota || 0,
      autoMülki: auto.mülki, autoLisey: auto.lisey,
      effMülki: eff.mülki,   effLisey: eff.lisey,
      isTarget: leaf.id === targetLeaf?.id,
      isManual: override && override.leafId === leaf.id
        ? override.mode === 'manual'
        : leaf.quotaMode === 'manual' && leaf.mülkiQuota != null,
    })
  }

  return {
    peers, pool,
    autoMülki: autoM, autoLisey: autoL,
    effMülki: effM,   effLisey: effL,
    diffMülki: effM - autoM,
    diffLisey: effL - autoL,
    driftMülki: effM - rawM,
    driftLisey: effL - rawL,
  }
}

// ── Cins məhdudiyyəti modalı üçün namizəd sayı ───────────────────────────────
// Yarpağın öz cins bayraqları NƏZƏRƏ ALINMIR (onları elə burada təyin edirik),
// amma qrup və budaq məhdudiyyətləri tətbiq olunur — yəni "bu ixtisasa namizəd
// ola bilən" real qadın/kişi sayı çıxır.
export function genderPool(
  users: any[],
  path: any[],
  opts?: PoolOpts,
): { qadın: number; kişi: number; total: number } {
  const chain = path.slice(0, -1)          // yarpaq istisna → cins filtri işləmir
  const leafOnlyGroups = path[path.length - 1]
  let f = 0, m = 0, total = 0
  for (const u of users) {
    // qrup/budaq filtri üçün yarpağın özünün qrupları da nəzərə alınmalıdır,
    // ona görə yarpağı cinssiz bir node kimi zəncirə qaytarırıq
    const fakeLeaf = { ...leafOnlyGroups, allowFemale: undefined, allowMale: undefined }
    if (!canChoose(u, [...chain, fakeLeaf], opts)) continue
    total++
    const g = String(u?.gender ?? '').trim().toLowerCase()
    if (g === 'qadın') f++
    else if (g === 'kişi') m++
  }
  return { qadın: f, kişi: m, total }
}

// ── Bütün struktur üzrə balans hesabatı ──────────────────────────────────────
// Hovuzu eyni olan yarpaqlar bir qrupa yığılır; hər qrup üçün avtomatik bölgü ilə
// cari bölgünün fərqi hesablanır. Fərq varsa manual kvotalar bir-birini
// kompensasiya etmir — yəni bir qrupun yerləri itir.

export interface BalanceGroup {
  key: string
  pool: PoolCounts
  leaves: PeerRow[]
  autoMülki: number
  autoLisey: number
  effMülki: number
  effLisey: number
  diffMülki: number
  diffLisey: number
  /** yuvarlaqlaşdırılmamış modelə görə sapma — xəbərdarlıq qərarı bununla verilir */
  driftMülki: number
  driftLisey: number
}

/**
 * Balans xəbərdarlığının toleransı (yer sayı).
 *
 * Model kəsr paylar hesablayır, ekranda isə tam ədəd göstərilməlidir. Ona görə
 * hər qrupun sərhədində ±0.5-ə qədər yuvarlaqlaşdırma xətası qaçılmazdır və
 * qonşu qruplarda bu xətalar bir-birini tamamlayır. 1 yerlik buraxılış məhz bu
 * artefaktı udur; ondan böyük sapma real kompensasiya olunmamış dəyişiklikdir.
 */
export const BALANCE_TOLERANCE = 1

export interface BalanceReport {
  groups: BalanceGroup[]
  /** balansı pozulmuş qruplar */
  broken: BalanceGroup[]
  ok: boolean
  /** ümumi itki: mənbə üzrə kənarda qalan yer sayı */
  lostMülki: number
  lostLisey: number
}

export function balanceReport(
  users: any[],
  nodes: any[],
  opts?: PoolOpts,
): BalanceReport {
  const all = leavesWithPath(nodes || [])
  const table = globalSourceSplitCached(users, nodes, opts)
  const bySig = new Map<string, BalanceGroup>()

  for (const { leaf, path } of all) {
    const key = poolSignature(users, path, opts)
    let g = bySig.get(key)
    if (!g) {
      g = {
        key, pool: poolCounts(users, path, opts), leaves: [],
        autoMülki: 0, autoLisey: 0, effMülki: 0, effLisey: 0, diffMülki: 0, diffLisey: 0,
        driftMülki: 0, driftLisey: 0,
      }
      bySig.set(key, g)
    }
    const auto = autoSplit(leaf, g.pool, table)
    const eff  = effectiveSplit(leaf, g.pool, undefined, table)
    g.autoMülki += auto.mülki; g.autoLisey += auto.lisey
    g.effMülki  += eff.mülki;  g.effLisey  += eff.lisey
    // Sapma kəsr dəyərlər üzərində yığılır — cədvəldə yoxdursa yuvarlaq dəyər götürülür
    const t = table?.[leaf.id]
    g.driftMülki += (t && t.mülkiRaw != null) ? t.mülkiRaw : auto.mülki
    g.driftLisey += (t && t.liseyRaw != null) ? t.liseyRaw : auto.lisey
    g.leaves.push({
      id: leaf.id, name: leaf.name,
      pathLabel: path.slice(0, -1).map((n: any) => n.name).join(' → '),
      quota: leaf.quota || 0,
      autoMülki: auto.mülki, autoLisey: auto.lisey,
      effMülki: eff.mülki,   effLisey: eff.lisey,
      isTarget: false,
      isManual: leaf.quotaMode === 'manual' && leaf.mülkiQuota != null,
    })
  }

  const groups = [...bySig.values()]
  for (const g of groups) {
    g.diffMülki = g.effMülki - g.autoMülki
    g.diffLisey = g.effLisey - g.autoLisey
    // Qərar üçün sapma XAM (yuvarlaqlaşdırılmamış) modelə görə ölçülür
    g.driftMülki = g.effMülki - g.driftMülki
    g.driftLisey = g.effLisey - g.driftLisey
  }
  // 1e-9 — üzən nöqtə toplamasının qalığı tolerans sərhədini keçirməsin
  const over = (v: number) => Math.abs(v) > BALANCE_TOLERANCE + 1e-9
  const broken = groups.filter(g => over(g.driftMülki) || over(g.driftLisey))
  return {
    groups, broken,
    ok: broken.length === 0,
    lostMülki: broken.reduce((s, g) => s + Math.max(0, Math.round(-g.driftMülki)), 0),
    lostLisey: broken.reduce((s, g) => s + Math.max(0, Math.round(-g.driftLisey)), 0),
  }
}

// ── Kvota rəqəmlərinin strukturla uyğunluğu ──────────────────────────────────
//
// Balansdan fərqli bir problem: kvotalar özləri elə paylanıb ki, bəzi namizədlərin
// çata bildiyi ixtisaslarda yetərincə yer yoxdur, artıq qalan yerlər isə onların
// girə bilmədiyi ixtisaslardadır. Nəticədə yer boş qalır, namizəd isə kənarda.
//
// Bunu dəqiq hesablamaq üçün məsələ maksimum axına (max-flow) çevrilir:
//   mənbə → seqment (tutum: namizəd sayı) → ixtisas (yalnız seçə bilirsə) → axın (tutum: kvota)
// Maksimum axın = ən yaxşı halda yerləşə bilənlərin sayı. Qalanı struktur
// səbəbindən yerləşə bilməyənlərdir — heç bir alqoritm bunu düzəldə bilməz,
// yalnız kvota rəqəmlərini dəyişməklə həll olunur.

export interface FeasibilitySegment {
  group: string
  gender: string
  source: string
  branch: string
  count: number
  placed: number
  /** ən yaxşı halda bu seqmentdən neçə nəfər kənarda qalır */
  minUnplaced: number
  /** ən pis halda neçə nəfər kənarda qalır */
  maxUnplaced: number
}

export interface FeasibilityLeaf {
  id: string
  name: string
  pathLabel: string
  quota: number
  filled: number
  free: number
}

export interface FeasibilityReport {
  ok: boolean
  students: number
  totalQuota: number
  /** ən yaxşı halda yerləşə bilənlər */
  placeable: number
  /** heç bir halda yerləşə bilməyənlər */
  deficit: number
  /** heç kimlə dolmayacaq yerlər */
  unfillable: number
  segments: FeasibilitySegment[]
  emptyLeaves: FeasibilityLeaf[]
  /** yer çatmayan tərəf (min-kəsim): bu namizədlərin çata bildiyi yerlər onlardan azdır */
  tightSegments: FeasibilitySegment[]
  tightLeaves: FeasibilityLeaf[]
  tightCandidates: number
  tightCapacity: number
  /** artıq yeri olan tərəf: yalnız qalan namizədlərə açıq ixtisaslar */
  surplusSegments: FeasibilitySegment[]
  surplusLeaves: FeasibilityLeaf[]
  surplusCandidates: number
  surplusCapacity: number
}

/**
 * Strukturda FAKTİKİ istifadə olunan filtr sütunlarının açarları.
 * Seqment açarı bunları ehtiva etməlidir: seqmentin uyğun ixtisasları bir nümunə
 * təhsilalana görə hesablanır, ona görə filtrin ayırd edə bildiyi hər əlamət
 * açarda olmasa fərqli namizədlər yanlış olaraq eyni seqmentə düşür.
 */
function usedFilterKeys(all: LeafRef[]): string[] {
  const keys = new Set<string>()
  for (const { path } of all) {
    for (const n of path) {
      const f = (n as any)?.filters as Record<string, string[]> | undefined
      if (!f) continue
      for (const k of Object.keys(f)) if (f[k]?.length) keys.add(k)
    }
  }
  return [...keys].sort()
}

// ── Kövrək (məcburi) bölgü riski ─────────────────────────────────────────────
//
// feasibility() "ümumiyyətlə mükəmməl bölgü mövcuddurmu?" sualına cavab verir və
// max-flow modelinə əsaslanır. Amma real yerləşdirmə max-flow deyil — bal və
// seçim sırası ilə gedir. Ona görə elə hallar var ki, model "qaydasındadır"
// desə də, nəticə pozulur:
//
//   Məhdudiyyəti olan bir budaqda yerlər var, onları yalnız müəyyən namizədlər
//   doldura bilir, VƏ həmin namizədlər eyni zamanda budaqdan KƏNAR ixtisasları
//   da seçə bilir. Onlardan biri kənara getsə — budaqda bir yer boş qalır və
//   yalnız bu budağa girə bilməyən bir namizəd kənarda qalır.
//
// Bu vəziyyət yalnız ehtiyat namizəd olmayanda təhlükəlidir: namizəd sayı
// yerlərdən çoxdursa, gedənin yeri qalanlarla dolur.
export interface FragileRisk {
  /** məhdudiyyətli budağın adı və kökdən yolu */
  nodeName: string
  pathLabel: string
  /** budaqdakı ümumi yer */
  capacity: number
  /** bu yerləri doldura bilən namizəd sayı */
  candidates: number
  /** onlardan neçəsi budaqdan kənara da gedə bilir */
  leakers: number
  /** kənarda onlara açıq olan yer sayı — qaça biləcəklərin sayı bundan çox ola bilməz */
  leakCapacity: number
  /** sızmanın getdiyi ixtisasların yolu (ən çox yer verənlərdən başlayaraq) */
  leakTargets: { label: string; quota: number }[]
  /** ən pis halda boş qalacaq yer = kənarda qalacaq namizəd */
  riskSeats: number
}

/**
 * Məcburi bölgüyə söykənən — yəni kövrək — budaqları tapır.
 * Boş siyahı = belə risk yoxdur.
 */
export function fragileRisks(users: any[], nodes: any[], opts?: PoolOpts): FragileRisk[] {
  const all = leavesWithPath(nodes || [])
  if (!all.length) return []
  const out: FragileRisk[] = []

  // Məhdudiyyəti olan hər node üçün öz alt ağacını yoxlayırıq.
  const visit = (node: any, anc: any[]) => {
    const hasRestriction =
      (node?.groups?.length ?? 0) > 0 ||
      Object.values((node?.filters ?? {}) as Record<string, string[]>).some(v => v?.length)

    if (hasRestriction) {
      const inside: number[] = []
      all.forEach(({ path }, j) => { if (path.includes(node)) inside.push(j) })
      const capacity = inside.reduce((a, j) => a + Math.max(0, all[j].leaf.quota || 0), 0)
      if (capacity > 0) {
        const insideSet = new Set(inside)
        let candidates = 0, leakers = 0
        // Kənarda sızanlara açıq olan yarpaqlar — yer sayı sızmanın tavanıdır
        const outReach = new Set<number>()
        for (const u of users || []) {
          const canIn  = inside.some(j => canChoose(u, all[j].path, opts))
          if (!canIn) continue
          candidates++
          let canOut = false
          all.forEach(({ path }, j) => {
            if (insideSet.has(j)) return
            if (!canChoose(u, path, opts)) return
            canOut = true
            outReach.add(j)
          })
          if (canOut) leakers++
        }
        const leakCapacity = [...outReach].reduce((a, j) => a + Math.max(0, all[j].leaf.quota || 0), 0)
        const leakTargets = [...outReach]
          .map(j => ({
            label: [...all[j].path].map((n: any) => n?.name).filter(Boolean).join(' → '),
            quota: Math.max(0, all[j].leaf.quota || 0),
          }))
          .sort((a, b) => b.quota - a.quota)
        // Ehtiyat namizəd: gedənlərin yerini doldura biləcək artıq namizəd sayı.
        // Ehtiyat varsa risk yoxdur — kənara gedənin yerini qalanlar doldurur.
        // Risk yalnız ehtiyat SIFIR olanda yaranır: onda hər gedən bir boş yer
        // və bir kənarda qalan namizəd deməkdir.
        const slack = candidates - capacity
        // Sızma üç hədlə məhdudlanır: kənara gedə bilənlərin sayı, budağın öz
        // yer sayı, VƏ kənarda onlara açıq olan yer sayı — hamısı dolsa belə
        // ondan çox adam qaça bilməz.
        const riskSeats = slack > 0 ? 0 : Math.min(leakers, capacity, leakCapacity)
        if (riskSeats > 0) {
          out.push({
            nodeName: String(node?.name ?? ''),
            pathLabel: anc.map((n: any) => n?.name).filter(Boolean).join(' → '),
            capacity, candidates, leakers, leakCapacity, leakTargets, riskSeats,
          })
        }
      }
    }
    for (const c of node?.children || []) visit(c, [...anc, node])
  }
  for (const r of nodes || []) visit(r, [])

  return out.sort((a, b) => b.riskSeats - a.riskSeats)
}

// ── Qrup balansı (qrup × cins × mənbə birlikdə) ─────────────────────────────
// Hər ixtisası kimin seçə biləcəyi bütün məhdudiyyətlərlə birlikdə təyin olunur
// (qrup, cins, filtrlər, əvvəlcədən təyin — canChoose) və yer sayı mənbə üzrə
// (effectiveSplit — manual və ya avtomatik). Eyni adam dəstəsinə açıq ixtisaslar
// bir "sinif" təşkil edir. Sinfin yerlərini YALNIZ həmin dəstə doldura bilər;
// dəstənin adamları başqa (daha geniş açıq) ixtisaslara gedərsə, bu yerlər boş
// qalır və dəstədən kənarda olanlar yersiz qalır. Nümunələr:
//   • Hərbi həkim — yalnız 3-cü qrup;
//   • pilot, Tankçı — yalnız 1-ci/4-cü qrupun KİŞİLƏRİ (qrup + cins birlikdə).
// Hər hansı məhdudiyyət dəyişəndə siniflər yenidən qurulur — nəticə dinamikdir.
export interface GroupBalanceRow {
  source: 'mülki' | 'lisey'
  /** dəstənin insan dilində adı: "qrup 1, 4 · kişi" */
  label: string
  /** dəstədəki namizəd sayı */
  count: number
  /** yalnız bu dəstəyə açıq yerlər (iç-içə dar siniflər də daxil) */
  seats: number
  /** həmin ixtisaslar */
  leaves: { id: string; name: string; seats: number }[]
  /** dəstədən daha geniş açıq ixtisaslara da gedə bilənlər */
  leavers: number
  /** yalnız bu yerlərə girə bilən dəstə üzvü sayı yerlərdən çoxdur — mütləq yersiz */
  short: number
  /** yer dəstənin özündən çoxdur — mütləq boş */
  over: number
  /** ən pis halda boş qala bilən yer = dəstədən kənarda yersiz qala bilən adam */
  risk: number
}

export function groupBalance(users: any[], nodes: any[], opts?: PoolOpts): GroupBalanceRow[] {
  const all = leavesWithPath(nodes || [])
  if (!all.length) return []
  const table = globalSourceSplitCached(users, nodes, opts)
  const eff = all.map(({ leaf, path }) => effectiveSplit(leaf, poolCounts(users, path, opts), undefined, table))
  const gOf = (u: any) => String(u?.group ?? '').trim()
  const sexOf = (u: any) => String(u?.gender ?? '').trim().toLowerCase()
  const out: GroupBalanceRow[] = []
  for (const src of ['mülki', 'lisey'] as const) {
    const pool = (users || []).filter(u => u.source === src)
    if (!pool.length) continue
    const seats = eff.map(e => Math.max(0, src === 'mülki' ? e.mülki : e.lisey))
    // hər ixtisası seçə bilənlərin indeksləri
    const elig: Set<number>[] = all.map(({ path }) => {
      const st = new Set<number>(); pool.forEach((u, i) => { if (canChoose(u, path, opts)) st.add(i) }); return st
    })
    const key = (st: Set<number>) => [...st].sort((x, y) => x - y).join(',')
    const seen = new Set<string>()
    all.forEach((_, j) => {
      const K = elig[j]
      if (!seats[j] || K.size === 0 || K.size === pool.length) return   // hamıya açıqdırsa sinif deyil
      const k = key(K); if (seen.has(k)) return; seen.add(k)
      // Sinfə düşən ixtisaslar: seçə bilənləri tamamilə K daxilində olanlar
      const inside: number[] = []
      all.forEach((__, t) => { if (seats[t] && elig[t].size && [...elig[t]].every(i => K.has(i))) inside.push(t) })
      const need = inside.reduce((acc, t) => acc + seats[t], 0)
      const insideSet = new Set(inside)
      let leavers = 0, stayers = 0
      const outReach = new Set<number>()
      K.forEach(i => {
        let out = false
        all.forEach((__, t) => { if (!insideSet.has(t) && seats[t] && elig[t].has(i)) { out = true; outReach.add(t) } })
        if (out) leavers++; else stayers++
      })
      const outSeats = [...outReach].reduce((acc, t) => acc + seats[t], 0)
      const outsiders = pool.length - K.size
      const short = Math.max(0, stayers - need)
      const over = Math.max(0, need - K.size)
      // Qalanlar (yalnız içəri girə bilənlər) onsuz da içəri düşür; gedə bilənlər
      // kənardakı yer sayı qədər gedə bilər; yersiz qala bilən — dəstədən kənardakılar.
      const risk = Math.max(0, Math.min(need - over - stayers, leavers, outSeats, outsiders))
      // Ad: qrup(lar) + cins — yalnız dəstəni ayıran əlamətlər
      const mem = [...K].map(i => pool[i])
      const grp = [...new Set(mem.map(gOf))].filter(Boolean).sort()
      const allGrp = [...new Set(pool.map(gOf))].filter(Boolean)
      const sex = [...new Set(mem.map(sexOf))].filter(Boolean)
      const allSex = [...new Set(pool.map(sexOf))].filter(Boolean)
      const parts: string[] = []
      if (grp.length && grp.length < allGrp.length) parts.push('qrup ' + grp.join(', '))
      if (sex.length === 1 && allSex.length > 1) parts.push(sex[0])
      out.push({
        source: src, label: parts.join(' · ') || 'məhdud dəstə', count: K.size, seats: need,
        leaves: inside.map(t => ({ id: all[t].leaf.id, name: all[t].leaf.name, seats: seats[t] })),
        leavers, short, over, risk,
      })
    })
  }
  // İç-içə siniflərin eyni yerləri iki dəfə saymaması üçün yalnız ən təhlükəlilər önə
  return out.sort((x, y) => (y.short + y.over + y.risk) - (x.short + x.over + x.risk))
}

// ── Qrup blokları ────────────────────────────────────────────────────────────
//
// Qayda: bir mənbə daxilində iki ixtisası seçə bilənlərin dəstəsi ya TAM EYNİ,
// ya da TAM AYRI olmalıdır. Onda hər dəstə müstəqil "blok" olur və balans dəqiq
// hesablanır (nəfər − yer). Dəstələr qismən kəsişirsə (məs. "qrup 1, 2" və
// "yalnız qrup 2"), ortaq adamlar genişə gedib darı boş qoya bilər — bu,
// "kəsişmə" kimi göstərilir və nəticə yalnız simulyasiya ilə təxmin edilir.
export interface BlockLeaf { id: string; name: string; seats: number }
export interface GroupBlock {
  source: 'mülki' | 'lisey'
  label: string
  count: number
  seats: number
  leaves: BlockLeaf[]
  /** yer çatmayan nəfər */
  short: number
  /** mütləq boş qalan yer */
  over: number
}
export interface BlockConflict {
  source: 'mülki' | 'lisey'
  /** qrup: qrup dəstələri fərqlidir; cins: qruplar eynidir, fərq yalnız kişi/qadın məhdudiyyətindədir */
  kind: 'qrup' | 'cins'
  a: { label: string; leaves: BlockLeaf[] }
  b: { label: string; leaves: BlockLeaf[] }
  /** hər ikisinə gedə bilən nəfər */
  shared: number
}
export interface GroupBlockReport {
  ok: boolean
  blocks: GroupBlock[]
  conflicts: BlockConflict[]
  /** heç bir ixtisasa açıq olmayan namizədlər (mənbə üzrə) */
  noPlace: { mülki: number; lisey: number }
  /** lisey namizədi olmayan, amma lisey yeri olan ixtisaslar */
  liseyNoCand: BlockLeaf[]
  /** kəsişmə yoxdursa: dəqiq kənarda qalacaq nəfər */
  exactOut: number
}

export function groupBlocks(users: any[], nodes: any[], opts?: PoolOpts): GroupBlockReport {
  const all = leavesWithPath(nodes || [])
  const table = all.length ? globalSourceSplitCached(users, nodes, opts) : {}
  const eff = all.map(({ leaf, path }) => effectiveSplit(leaf, poolCounts(users, path, opts), undefined, table))
  const gOf = (u: any) => String(u?.group ?? '').trim()
  const sexOf = (u: any) => String(u?.gender ?? '').trim().toLowerCase()
  const rep: GroupBlockReport = { ok: true, blocks: [], conflicts: [], noPlace: { mülki: 0, lisey: 0 }, liseyNoCand: [], exactOut: 0 }
  for (const src of ['mülki', 'lisey'] as const) {
    const pool = (users || []).filter(u => u.source === src)
    const seats = eff.map(e => Math.max(0, src === 'mülki' ? e.mülki : e.lisey))
    // Bloklar YALNIZ qrup (+ budaq/filtr) üzrə qurulur — yarpağın cins bayrağı
    // nəzərə alınmır. Səbəb: «qrup II» ilə «qrup II · yalnız kişi» kəsişməsi əsl
    // problem deyil; cins balansı pozulanda onsuz da ayrıca yoxlama xəbərdarlıq edir.
    const elig = all.map(({ path }) => {
      const chain = path.slice(0, -1)
      const lf = path[path.length - 1]
      const genderless = [...chain, { ...lf, allowFemale: undefined, allowMale: undefined }]
      const st = new Set<number>(); pool.forEach((u, i) => { if (canChoose(u, genderless, opts)) st.add(i) }); return st
    })
    if (src === 'lisey') all.forEach(({ leaf }, j) => {
      if (seats[j] > 0 && elig[j].size === 0) rep.liseyNoCand.push({ id: leaf.id, name: leaf.name, seats: seats[j] })
    })
    if (!pool.length) continue
    // Fərqli dəstələr (yalnız bu mənbədə yeri olan ixtisaslar)
    const sets = new Map<string, { K: Set<number>; idx: number[] }>()
    all.forEach((_, j) => {
      if (!seats[j] || !elig[j].size) return
      const k = [...elig[j]].sort((x, y) => x - y).join(',')
      const s = sets.get(k); if (s) s.idx.push(j); else sets.set(k, { K: elig[j], idx: [j] })
    })
    const label = (K: Set<number>) => {
      const mem = [...K].map(i => pool[i])
      const grp = [...new Set(mem.map(gOf))].filter(Boolean).sort()
      const allGrp = [...new Set(pool.map(gOf))].filter(Boolean)
      const sex = [...new Set(mem.map(sexOf))].filter(Boolean)
      const allSex = [...new Set(pool.map(sexOf))].filter(Boolean)
      const parts: string[] = []
      if (grp.length && grp.length < allGrp.length) parts.push('qrup ' + grp.join(', '))
      else if (K.size === pool.length) parts.push('hamı')
      if (sex.length === 1 && allSex.length > 1) parts.push(sex[0])
      return parts.join(' · ') || 'məhdud dəstə'
    }
    const lv = (idx: number[]) => idx.map(j => ({ id: all[j].leaf.id, name: all[j].leaf.name, seats: seats[j] }))
    const list = [...sets.values()]
    for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      let shared = 0
      list[x].K.forEach(i => { if (list[y].K.has(i)) shared++ })
      if (shared > 0) rep.conflicts.push({
        source: src, shared, kind: 'qrup',
        a: { label: label(list[x].K), leaves: lv(list[x].idx) },
        b: { label: label(list[y].K), leaves: lv(list[y].idx) },
      })
    }
    const reach = new Set<number>(); list.forEach(s => s.K.forEach(i => reach.add(i)))
    rep.noPlace[src] = pool.length - reach.size
    for (const s of list) {
      const need = s.idx.reduce((a, j) => a + seats[j], 0)
      rep.blocks.push({
        source: src, label: label(s.K), count: s.K.size, seats: need, leaves: lv(s.idx),
        short: Math.max(0, s.K.size - need), over: Math.max(0, need - s.K.size),
      })
    }
  }
  rep.exactOut = rep.noPlace.mülki + rep.noPlace.lisey + rep.blocks.reduce((a, b) => a + b.short, 0)
  rep.ok = !rep.conflicts.length && !rep.liseyNoCand.length && rep.exactOut === 0 && !rep.blocks.some(b => b.over > 0)
  return rep
}

export function feasibility(
  users: any[],
  nodes: any[],
  opts?: PoolOpts,
): FeasibilityReport {
  const all = leavesWithPath(nodes || [])
  const lv = opts?.preAssignLevel
  // Strukturdakı filtr sütunları da seqmenti ayırır — bax: usedFilterKeys
  const fKeys = usedFilterKeys(all)

  // Eyni məhdudiyyət profilinə düşən təhsilalanlar bir seqmentdir
  const segMap = new Map<string, { s: FeasibilitySegment; rep: any }>()
  for (const u of users) {
    const branch = lv != null ? String(u?.branchByLevel?.[lv] ?? '').trim() : ''
    const fVals = fKeys.map(k => studentColValue(u, k))
    const key = [
      String(u?.group ?? '').trim(),
      String(u?.gender ?? '').trim(),
      String(u?.source ?? '').trim(),
      branch,
      ...fVals,
    ].join('\u0001')
    let e = segMap.get(key)
    if (!e) {
      e = {
        s: {
          group: String(u?.group ?? '').trim(), gender: String(u?.gender ?? '').trim(),
          source: String(u?.source ?? '').trim(),
          // Hesabatda seqmentin adı: budaq göstərilməyibsə filtr dəyərləri
          // (məs. "QQ") yazılır ki, seqmentlər bir-birindən seçilsin.
          branch: branch || fVals.filter(Boolean).join(' · '),
          count: 0, placed: 0, minUnplaced: 0, maxUnplaced: 0,
        },
        rep: u,
      }
      segMap.set(key, e)
    }
    e.s.count++
  }

  const segs = [...segMap.values()]
  const S = 0
  const segOff = 1
  const leafOff = segOff + segs.length
  const T = leafOff + all.length
  const N = T + 1

  // Uyğunluq matrisi: seqment i həmin yarpağı seçə bilirmi
  const canUse: boolean[][] = segs.map(e => all.map(({ path }) => canChoose(e.rep, path, opts)))

  /** Verilmiş seqment dəsti üçün maksimum axını hesablayır (Edmonds–Karp). */
  function runFlow(active: boolean[]): { flow: number; cap: number[][] } {
    const cap: number[][] = Array.from({ length: N }, () => new Array(N).fill(0))
    segs.forEach((e, i) => { cap[S][segOff + i] = active[i] ? e.s.count : 0 })
    all.forEach(({ leaf }, j) => { cap[leafOff + j][T] = Math.max(0, leaf.quota || 0) })
    segs.forEach((_, i) => {
      all.forEach((_l, j) => {
        if (canUse[i][j]) cap[segOff + i][leafOff + j] = Number.MAX_SAFE_INTEGER
      })
    })

    let flow = 0
    for (;;) {
      const par = new Array(N).fill(-1)
      par[S] = S
      const q = [S]
      for (let h = 0; h < q.length && par[T] < 0; h++) {
        const u = q[h]
        for (let v = 0; v < N; v++) if (par[v] < 0 && cap[u][v] > 0) { par[v] = u; q.push(v) }
      }
      if (par[T] < 0) break
      let f = Number.MAX_SAFE_INTEGER
      for (let v = T; v !== S; v = par[v]) f = Math.min(f, cap[par[v]][v])
      for (let v = T; v !== S; v = par[v]) { cap[par[v]][v] -= f; cap[v][par[v]] += f }
      flow += f
    }
    return { flow, cap }
  }

  const allActive = segs.map(() => true)
  const { flow, cap } = runFlow(allActive)

  segs.forEach((e, i) => { e.s.placed = cap[segOff + i][S] })

  // Hər seqment üçün kənarda qalma aralığı. Ümumi çatışmazlığın kimin üzərinə
  // düşəcəyi tək bir rəqəmlə deyilə bilməz — seqmentlər eyni yerlər uğrunda
  // rəqabət aparır. Ona görə iki hədd hesablanır:
  //   ən pis hal  = digərləri özündən əvvəl yerləşsə, ona nə qalır
  //   ən yaxşı hal = ona üstünlük verilsə, nə qədəri yerləşə bilər
  segs.forEach((e, i) => {
    const without = segs.map((_, k) => k !== i)
    const flowWithout = runFlow(without).flow
    const minPlaced = Math.max(0, flow - flowWithout)          // ən pis hal
    const only = segs.map((_, k) => k === i)
    const alone = runFlow(only).flow
    const maxPlaced = Math.min(e.s.count, alone)               // ən yaxşı hal
    e.s.maxUnplaced = Math.max(0, e.s.count - minPlaced)
    e.s.minUnplaced = Math.max(0, e.s.count - maxPlaced)
  })

  const leafRows: FeasibilityLeaf[] = all.map(({ leaf, path }, j) => {
    const quota = Math.max(0, leaf.quota || 0)
    const filled = cap[T][leafOff + j]
    return {
      id: leaf.id, name: leaf.name,
      pathLabel: path.slice(0, -1).map((n: any) => n.name).join(' → '),
      quota, filled, free: quota - filled,
    }
  })

  // Min-kəsim: qalıq şəbəkədə mənbədən çatılan tərəf darboğazdır
  const seen = new Array(N).fill(false)
  seen[S] = true
  const q2 = [S]
  for (let h = 0; h < q2.length; h++) {
    const u = q2[h]
    for (let v = 0; v < N; v++) if (!seen[v] && cap[u][v] > 0) { seen[v] = true; q2.push(v) }
  }
  const tightSegments = segs.filter((_, i) => seen[segOff + i]).map(e => e.s)
  const tightLeaves = leafRows.filter((_, j) => seen[leafOff + j])
  // Kəsimin qarşı tərəfi: artıq yer məhz burada qalır. Hansı ixtisasda qalacağı
  // yerləşdirmənin gedişindən asılıdır — bir neçə eyni dərəcədə düzgün nəticə var.
  const surplusSegments = segs.filter((_, i) => !seen[segOff + i]).map(e => e.s)
  const surplusLeaves = leafRows.filter((_, j) => !seen[leafOff + j])

  const students = users.length
  const totalQuota = leafRows.reduce((a, l) => a + l.quota, 0)
  const deficit = students - flow

  return {
    ok: deficit === 0,
    students, totalQuota, placeable: flow, deficit,
    unfillable: totalQuota - flow,
    segments: segs.map(e => e.s),
    emptyLeaves: leafRows.filter(l => l.free > 0),
    tightSegments, tightLeaves,
    tightCandidates: tightSegments.reduce((a, s) => a + s.count, 0),
    tightCapacity: tightLeaves.reduce((a, l) => a + l.quota, 0),
    surplusSegments, surplusLeaves,
    surplusCandidates: surplusSegments.reduce((a, s) => a + s.count, 0),
    surplusCapacity: surplusLeaves.reduce((a, l) => a + l.quota, 0),
  }
}

// ── Qlobal mənbə bölgüsü ─────────────────────────────────────────────────────
//
// Əvvəlki qayda hər ixtisasın mülki/lisey payını YALNIZ həmin ixtisası seçə
// bilənlərin baş sayı nisbətindən çıxarırdı. Bu, bir budağa bağlı ("captive")
// qrupları sıradan çıxarır: Menecment budağında 22 mülki (yalnız II qrupu, başqa
// yolu yoxdur) və 367 lisey var; 22:367 nisbəti mülkiyə 70 yerdən cəmi 4-ünü
// verirdi — 18 nəfər struktur səbəbindən yerləşə bilmirdi. Lisey isə həmin
// nisbəti başqa 10 budaqda da alırdı, halbuki onlar eyni 367 nəfərdir.
//
// Doğru qayda qlobaldır: hər qrupun ümumi payı öz namizəd sayı qədərdir və bu
// pay girə bildiyi bütün ixtisaslar arasında yerlərə mütənasib yayılır.
// İki addım:
//   1) hansı qrupun neçə nəfəri ümumiyyətlə yerləşə bilər (max-flow; çatışmazlıq
//      varsa max-min ədalətli, yəni faizlər bərabərləşdirilir),
//   2) həmin pay ixtisaslara mütənasib paylanır (iterativ uyğunlaşdırma).
// Nəticə: Menecment 22/48, III-ə bağlı budaqlarda lisey payı 0.

export interface SourceSplit {
  mülki: number
  lisey: number
  /**
   * Yuvarlaqlaşdırmadan ƏVVƏLKİ kəsr dəyərlər. Balans yoxlaması bunlarla aparılır:
   * hər ixtisası ayrıca yuvarlaqlaşdırıb toplamaq qrup cəmində 1 yerlik yalan
   * sapma yaradır (ölçülmüş nümunə: 10 ixtisaslıq qrupda xam cəm 85.404 → ayrı-ayrı
   * yuvarlaqlaşdırmadan sonra 86, qonşu qrupda 9.596 → 10; xəta tam bir-birini
   * tamamlayır). Kəsr dəyərlər saxlanılmasa, bu artefaktı ayırd etmək mümkün deyil.
   */
  mülkiRaw: number
  liseyRaw: number
}

interface Seg { key: string; source: string; count: number; elig: number[]; rep: any }

function buildSegments(users: any[], all: LeafRef[], opts?: PoolOpts): Seg[] {
  const lv = opts?.preAssignLevel
  const fKeys = usedFilterKeys(all)
  const map = new Map<string, Seg>()
  for (const u of users) {
    const branch = lv != null ? String(u?.branchByLevel?.[lv] ?? '').trim() : ''
    const key = [
      String(u?.group ?? '').trim(),
      String(u?.gender ?? '').trim(),
      String(u?.source ?? '').trim(),
      branch,
      ...fKeys.map(k => studentColValue(u, k)),
    ].join('\u0001')
    let s = map.get(key)
    if (!s) {
      s = { key, source: String(u?.source ?? '').trim(), count: 0, elig: [], rep: u }
      all.forEach(({ path }, j) => { if (canChoose(u, path, opts)) s!.elig.push(j) })
      map.set(key, s)
    }
    s.count++
  }
  return [...map.values()]
}

/** Seqment tutumları verilmiş halda maksimum axını hesablayır. */
function maxFlowWith(segs: Seg[], caps: number[], quotas: number[]): { total: number; perSeg: number[] } {
  const S = 0, T = 1, off = 2, offL = 2 + segs.length
  const n = offL + quotas.length
  const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  segs.forEach((s, i) => { cap[S][off + i] = caps[i] })
  quotas.forEach((q, j) => { cap[offL + j][T] = Math.max(0, q) })
  segs.forEach((s, i) => { for (const j of s.elig) cap[off + i][offL + j] = Number.MAX_SAFE_INTEGER })

  let total = 0
  for (;;) {
    const par = new Array(n).fill(-1); par[S] = S
    const q: number[] = [S]
    for (let h = 0; h < q.length && par[T] < 0; h++) {
      const v = q[h]
      for (let w = 0; w < n; w++) if (par[w] < 0 && cap[v][w] > 0) { par[w] = v; q.push(w) }
    }
    if (par[T] < 0) break
    let f = Number.MAX_SAFE_INTEGER
    for (let v = T; v !== S; v = par[v]) f = Math.min(f, cap[par[v]][v])
    for (let v = T; v !== S; v = par[v]) { cap[par[v]][v] -= f; cap[v][par[v]] += f }
    total += f
  }
  return { total, perSeg: segs.map((_, i) => cap[off + i][S]) }
}

export function globalSourceSplit(
  users: any[],
  nodes: any[],
  opts?: PoolOpts,
): Record<string, SourceSplit> {
  const all = leavesWithPath(nodes || [])
  const out: Record<string, SourceSplit> = {}
  if (!all.length) return out
  const quotas = all.map(({ leaf }) => Math.max(0, leaf.quota || 0))
  const segs = buildSegments(users || [], all, opts)
  if (!segs.length) return out

  // ── Addım 1: hər seqment neçə yer ala bilər ───────────────────────────────
  const demand = segs.map(s => s.count)
  const full = maxFlowWith(segs, demand, quotas)
  let supply: number[]
  if (full.total >= demand.reduce((a, b) => a + b, 0)) {
    supply = demand                                  // hamısı yerləşə bilir
  } else {
    // max-min ədalətli: ortaq faizi ikili axtarışla tap, qalığı bir-bir payla
    let lo = 0, hi = 1
    for (let it = 0; it < 30; it++) {
      const mid = (lo + hi) / 2
      const caps = demand.map(d => Math.floor(d * mid))
      const need = caps.reduce((a, b) => a + b, 0)
      if (maxFlowWith(segs, caps, quotas).total >= need) lo = mid; else hi = mid
    }
    supply = demand.map(d => Math.floor(d * lo))
    for (;;) {
      let grew = false
      for (let i = 0; i < segs.length; i++) {
        if (supply[i] >= demand[i]) continue
        const trial = supply.slice(); trial[i]++
        const need = trial.reduce((a, b) => a + b, 0)
        if (maxFlowWith(segs, trial, quotas).total >= need) { supply = trial; grew = true }
      }
      if (!grew) break
    }
  }

  // ── Addım 2: hər seqmentin payını ixtisaslara mütənasib yay ───────────────
  const alloc: number[][] = segs.map(() => new Array(all.length).fill(0))
  for (let it = 0; it < 200; it++) {
    segs.forEach((s, i) => {
      let tot = 0
      for (const j of s.elig) tot += alloc[i][j]
      if (tot <= 1e-12) {
        let capSum = 0
        for (const j of s.elig) capSum += quotas[j]
        if (capSum > 0) for (const j of s.elig) alloc[i][j] = supply[i] * quotas[j] / capSum
      } else {
        const f = supply[i] / tot
        for (const j of s.elig) alloc[i][j] *= f
      }
    })
    for (let j = 0; j < all.length; j++) {
      let tot = 0
      for (let i = 0; i < segs.length; i++) tot += alloc[i][j]
      if (tot > quotas[j] + 1e-12) {
        const f = quotas[j] / tot
        for (let i = 0; i < segs.length; i++) alloc[i][j] *= f
      }
    }
  }

  // ── Yarpaq üzrə yekun ─────────────────────────────────────────────────────
  //
  // Yuxarıdakı `alloc` "gözlənilən dolma"dır: namizədlər bir neçə ixtisas arasında
  // paylaşıldığı üçün cəmi kvotadan az çıxa bilər. Amma bu cədvəl KVOTANIN MƏNBƏLƏR
  // ARASINDA BÖLGÜSÜ kimi işlədilir — bunlar fərqli suallardır:
  //   "neçəsi real dolacaq?"  → gözləntidir, rəqabətdən asılıdır
  //   "10 yer necə bölünsün?" → hamısı bölünməlidir, yer havada qalmamalıdır
  // Qalıq paylanmasa, mənbəsi olmayan yer yaranır: hovuzda 151 mülki və 0 lisey
  // olduğu halda 10 yerlik ixtisas 9/0 görünür və 1 yer heç kimə yazılmır.
  // Ona görə qalıq namizədi olan mənbələrə hovuz ölçüsünə mütənasib paylanır.
  const poolM = new Array(all.length).fill(0)
  const poolL = new Array(all.length).fill(0)
  for (let i = 0; i < segs.length; i++) {
    for (const j of segs[i].elig) {
      if (segs[i].source === 'mülki') poolM[j] += segs[i].count
      else if (segs[i].source === 'lisey') poolL[j] += segs[i].count
    }
  }

  all.forEach(({ leaf }, j) => {
    let m = 0, l = 0
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].source === 'mülki') m += alloc[i][j]
      else if (segs[i].source === 'lisey') l += alloc[i][j]
    }
    const q = quotas[j]
    let mi = Math.max(0, Math.min(Math.round(m), q))
    let li = Math.max(0, Math.min(Math.round(l), q - mi))

    // Qalıq: namizədi olan mənbəyə ver, hovuz ölçüsünə görə payla.
    // Pay heç vaxt həmin mənbənin namizəd sayından çox ola bilməz.
    let rem = q - mi - li
    if (rem > 0) {
      const freeM = Math.max(0, poolM[j] - mi)
      const freeL = Math.max(0, poolL[j] - li)
      if (freeM > 0 && freeL > 0) {
        const addM = Math.min(freeM, Math.round(rem * freeM / (freeM + freeL)))
        mi += addM; rem -= addM
        const addL = Math.min(freeL, rem)
        li += addL; rem -= addL
        if (rem > 0) { const extra = Math.min(freeM - addM, rem); mi += extra; rem -= extra }
      } else if (freeM > 0) {
        const add = Math.min(freeM, rem); mi += add; rem -= add
      } else if (freeL > 0) {
        const add = Math.min(freeL, rem); li += add; rem -= add
      }
      // rem hələ də qalıbsa, doğrudan da namizəd çatmır — yer boş qalacaq
    }

    out[leaf.id] = { mülki: mi, lisey: li, mülkiRaw: m, liseyRaw: l }
  })
  return out
}

// Eyni ağac/istifadəçi dəsti üçün təkrar hesablamamaq üçün kiçik keş
let _gsCacheKey = ''
let _gsCache: Record<string, SourceSplit> = {}
export function globalSourceSplitCached(
  users: any[], nodes: any[], opts?: PoolOpts,
): Record<string, SourceSplit> {
  const leaves = leavesWithPath(nodes || [])
  const key = [
    users?.length ?? 0, leaves.length,
    leaves.reduce((a, x) => a + (x.leaf.quota || 0), 0),
    leaves.map(x => x.leaf.id).join('').length,
    opts?.preAssignLevel ?? 'n',
    // Qrup/filtr məhdudiyyətləri hovuzu dəyişir — açarda olmasa keş köhnə qalır.
    leaves.map(x => x.path
      .map((n: any) => (n?.groups ?? []).join('+') + JSON.stringify(n?.filters ?? ''))
      .join('>')).join(';'),
  ].join('|')
  if (key !== _gsCacheKey) {
    _gsCacheKey = key
    _gsCache = globalSourceSplit(users, nodes, opts)
  }
  return _gsCache
}

// ── Sərt mənbə rejimində real tarazlıq ───────────────────────────────────────
//
// Yerləşdirmənin 3-cü mərhələsi artıq mənbələri qarışdırmır: mülki slotu yalnız
// mülki, lisey slotu yalnız lisey doldura bilər. Ona görə balansın ölçüsü də
// dəyişir — modelin kəsr payına yaxınlıq yox, REAL icra olunabilirlik:
//   əskik slot  = yer tapa bilməyən namizəd
//   artıq slot  = heç kimlə dolmayacaq yer
// Hər mənbə üçün ayrıca maksimum axın hesablanır; strukturdakı qrup/cins/budaq
// məhdudiyyətləri avtomatik nəzərə alınır (segmentlər onsuz da onlarla qurulur).

export interface SourceSlotCheck {
  /** bu mənbədən namizəd sayı */
  candidates: number
  /** bu mənbəyə ayrılmış yer sayı */
  seats: number
  /** ən yaxşı halda yerləşə bilənlər */
  placeable: number
  /** yer tapa bilməyən namizəd — əskik slot */
  deficit: number
  /** heç kimlə dolmayacaq yer — artıq slot */
  unfillable: number
  /** cins üzrə ayrıntı — xəbərdarlıqda "neçə qadın / neçə kişi" demək üçün */
  femaleCandidates: number
  maleCandidates: number
  femalePlaced: number
  malePlaced: number
  /**
   * MƏCBURİ kənarda qalan qadın sayı: qadınlar tək başına (bütün yerlər onlara
   * açıq olsa belə) hamısı yerləşə bilmirsə fərq buradadır. Yəni bu itki hər bir
   * mümkün həlldə baş verir — cinsi adlandırmaq doğrudur.
   */
  femaleForced: number
  /** MƏCBURİ kənarda qalan kişi sayı — eyni məntiq. */
  maleForced: number
  /**
   * Cinsi təyin OLUNMAYAN kənarda qalanlar: yer sayı azdır, kimin qalacağını
   * struktur yox, bal sıralaması həll edir (qadın da ola bilər, kişi də).
   */
  unattributedOut: number
}

/** Cins limiti kvotanı bağlayan ixtisas. */
export interface GenderCapIssue {
  id: string
  name: string
  pathLabel: string
  quota: number
  maxFemale: number | null
  maxMale: number | null
  /** icazə verilən cəm tutum (qadağalar da nəzərə alınır) */
  capacity: number
  /** kvotanın tutumdan artıq qalan hissəsi — heç vaxt dolmayacaq yer */
  shortfall: number
}

/** Limiti tam dolan (darboğaz olan) cins qapısı. */
export interface GenderTight {
  id: string
  name: string
  pathLabel: string
  gender: 'qadın' | 'kişi'
  cap: number
  quota: number
}

export interface SourceBalanceReport {
  mülki: SourceSlotCheck
  lisey: SourceSlotCheck
  ok: boolean
  /** maxFemale + maxMale < kvota olan ixtisaslar — birbaşa konfiqurasiya səhvi */
  capIssues: GenderCapIssue[]
  /** limiti tam dolmuş cins qapıları — sərbəst yer qalıbsa səbəb budur */
  genderTight: GenderTight[]
}

/**
 * Cins limitlərini də nəzərə alan maksimum axın.
 *
 * S → seqment → (qadın/kişi qapısı) → ixtisas → T
 * Cinsi yazılmayanlar qapısız birbaşa ixtisasa gedir — yerləşdirmə mühərriki də
 * eyni cür işləyir (bax: Distribution.tsx → gateOf).
 *
 * ⚠ maxFemale/maxMale BÜTÜN ixtisas üzrədir, mənbə üzrə deyil. Yerlərin hamısı bir
 * mənbəyə aid olduqda (real quruluşda cins limiti qoyulan ixtisaslar belədir) nəticə
 * dəqiqdir. Yerlər iki mənbə arasında bölünübsə, hər mənbə limiti ayrıca görür və
 * yoxlama bir qədər NİKBİN olur — cins limiti ilə mənbə limiti bir-birini kəsən iki
 * ölçüdür, sadə axın şəbəkəsi ilə eyni anda dəqiq ifadə oluna bilmir.
 */
function maxFlowGendered(segs: Seg[], caps: number[], quotas: number[], leaves: LeafRef[]): {
  total: number
  /** hər ixtisasda qadın qapısından keçən say */
  femFlow: number[]
  /** hər ixtisasda kişi qapısından keçən say */
  malFlow: number[]
  femCap: number[]
  malCap: number[]
  /** hər ixtisasda doldurulan yer sayı */
  leafFlow: number[]
} {
  const L = quotas.length
  const S = 0, T = 1
  const segOff = 2
  const femOff = segOff + segs.length
  const malOff = femOff + L
  const leafOff = malOff + L
  const n = leafOff + L

  const cap: number[][] = Array.from({ length: n }, () => new Array(n).fill(0))
  const femCap = new Array<number>(L).fill(0)
  const malCap = new Array<number>(L).fill(0)
  segs.forEach((_s, i) => { cap[S][segOff + i] = caps[i] })
  for (let j = 0; j < L; j++) {
    const leaf = leaves[j]?.leaf
    const q = Math.max(0, quotas[j])
    const mf = leaf?.allowFemale === false ? 0 : (leaf?.maxFemale != null ? Math.min(leaf.maxFemale, q) : q)
    const mm = leaf?.allowMale   === false ? 0 : (leaf?.maxMale   != null ? Math.min(leaf.maxMale,   q) : q)
    cap[femOff + j][leafOff + j] = mf
    cap[malOff + j][leafOff + j] = mm
    femCap[j] = mf
    malCap[j] = mm
    cap[leafOff + j][T] = q
  }
  segs.forEach((s, i) => {
    const g = String(s.rep?.gender ?? '').trim().toLowerCase()
    for (const j of s.elig) {
      const to = g === 'qadın' ? femOff + j : g === 'kişi' ? malOff + j : leafOff + j
      cap[segOff + i][to] = Number.MAX_SAFE_INTEGER
    }
  })

  let total = 0
  for (;;) {
    const par = new Array(n).fill(-1)
    par[S] = S
    const q: number[] = [S]
    for (let h = 0; h < q.length && par[T] < 0; h++) {
      const v = q[h]
      for (let w = 0; w < n; w++) if (par[w] < 0 && cap[v][w] > 0) { par[w] = v; q.push(w) }
    }
    if (par[T] < 0) break
    let f = Number.MAX_SAFE_INTEGER
    for (let v = T; v !== S; v = par[v]) f = Math.min(f, cap[par[v]][v])
    for (let v = T; v !== S; v = par[v]) { cap[par[v]][v] -= f; cap[v][par[v]] += f }
    total += f
  }

  // Qalıq tutumdan istifadə olunmuş hissəni oxu
  const femFlow = femCap.map((c, j) => c - cap[femOff + j][leafOff + j])
  const malFlow = malCap.map((c, j) => c - cap[malOff + j][leafOff + j])
  const leafFlow = quotas.map((q, j) => Math.max(0, q) - cap[leafOff + j][T])
  return { total, femFlow, malFlow, femCap, malCap, leafFlow }
}

export function sourceBalance(
  users: any[],
  nodes: any[],
  opts?: PoolOpts,
  /** modalda redaktə olunan, hələ yadda saxlanılmamış dəyər */
  override?: QuotaOverride,
): SourceBalanceReport {
  const all = leavesWithPath(nodes || [])
  const table = globalSourceSplitCached(users, nodes, opts)
  const segs = buildSegments(users || [], all, opts)

  // Hər yarpağın QÜVVƏDƏ OLAN bölgüsü (manual varsa o, yoxsa avtomatik cədvəl)
  const effOf = all.map(({ leaf, path }) =>
    effectiveSplit(leaf, poolCounts(users, path, opts), override, table))

  const genderTight: GenderTight[] = []

  const check = (src: 'mülki' | 'lisey'): SourceSlotCheck => {
    const quotas = effOf.map(e => Math.max(0, src === 'mülki' ? e.mülki : e.lisey))
    const seats = quotas.reduce((a, b) => a + b, 0)
    const mySegs = segs.filter(s => s.source === src)
    const caps = mySegs.map(s => s.count)
    const candidates = caps.reduce((a, b) => a + b, 0)
    const genderOf = (g: 'qadın' | 'kişi') => mySegs
      .filter(s => String(s.rep?.gender ?? '').trim().toLowerCase() === g)
      .reduce((a, s) => a + s.count, 0)
    const fc = genderOf('qadın'), mc = genderOf('kişi')

    if (!mySegs.length) {
      return { candidates: 0, seats, placeable: 0, deficit: 0, unfillable: seats,
               femaleCandidates: 0, maleCandidates: 0, femalePlaced: 0, malePlaced: 0,
               femaleForced: 0, maleForced: 0, unattributedOut: 0 }
    }

    const r = maxFlowGendered(mySegs, caps, quotas, all)

    // Limiti tam dolan qapılar — sərbəst yer qalıbsa səbəbi göstərmək üçün
    all.forEach(({ leaf, path }, j) => {
      if (quotas[j] <= 0) return
      const label = path.slice(0, -1).map((n: any) => n.name).join(' → ')
      const bosYer = r.leafFlow[j] < quotas[j]   // yer qalıb, amma limit buraxmır
      if (!bosYer) return
      if (leaf?.maxFemale != null && r.femCap[j] > 0 && r.femFlow[j] >= r.femCap[j] && r.femCap[j] < quotas[j])
        genderTight.push({ id: leaf.id, name: leaf.name, pathLabel: label, gender: 'qadın', cap: r.femCap[j], quota: quotas[j] })
      if (leaf?.maxMale != null && r.malCap[j] > 0 && r.malFlow[j] >= r.malCap[j] && r.malCap[j] < quotas[j])
        genderTight.push({ id: leaf.id, name: leaf.name, pathLabel: label, gender: 'kişi', cap: r.malCap[j], quota: quotas[j] })
    })

    // ── Kənarda qalanın cinsi MƏCBURİDİRMİ? ─────────────────────────────────
    // Tək bir optimal həllin nəticəsi ("bu həlldə qadın qaldı") aldadıcıdır:
    // eyni qədər doğru başqa həlldə yerində kişi qala bilər. Ona görə cinsi
    // yalnız o halda adlandırırıq ki, həmin cins TƏK BAŞINA — bütün yerlər ona
    // açıq olsa belə — hamısı yerləşə bilmir. Bu, bütün həllər üçün keçərli
    // aşağı hədddir. Qalan itki cinsə bağlanmır; onu bal sıralaması həll edir.
    const aloneFlow = (g: 'qadın' | 'kişi') => {
      const sub = mySegs.filter(s => String(s.rep?.gender ?? '').trim().toLowerCase() === g)
      if (!sub.length) return 0
      return maxFlowGendered(sub, sub.map(s => s.count), quotas, all).total
    }
    const femaleForced = fc > 0 ? Math.max(0, fc - aloneFlow('qadın')) : 0
    const maleForced   = mc > 0 ? Math.max(0, mc - aloneFlow('kişi'))  : 0
    const deficit = candidates - r.total

    return {
      candidates, seats, placeable: r.total,
      deficit, unfillable: seats - r.total,
      femaleCandidates: fc, maleCandidates: mc,
      femalePlaced: r.femFlow.reduce((a, b) => a + b, 0),
      malePlaced: r.malFlow.reduce((a, b) => a + b, 0),
      femaleForced: Math.min(femaleForced, deficit),
      maleForced: Math.min(maleForced, deficit),
      unattributedOut: Math.max(0, deficit - femaleForced - maleForced),
    }
  }

  const m = check('mülki'), l = check('lisey')

  // Konfiqurasiya səhvi: icazə verilən cins tutumu kvotadan azdırsa, həmin
  // yerlər heç bir halda dolmayacaq — bunu ayrıca və birbaşa demək lazımdır.
  const capIssues: GenderCapIssue[] = []
  all.forEach(({ leaf, path }) => {
    const q = leaf?.quota || 0
    if (q <= 0) return
    if (leaf?.maxFemale == null && leaf?.maxMale == null
        && leaf?.allowFemale !== false && leaf?.allowMale !== false) return
    const mf = leaf?.allowFemale === false ? 0 : (leaf?.maxFemale != null ? Math.min(leaf.maxFemale, q) : q)
    const mm = leaf?.allowMale   === false ? 0 : (leaf?.maxMale   != null ? Math.min(leaf.maxMale,   q) : q)
    const capacity = Math.min(q, mf + mm)
    if (capacity >= q) return
    capIssues.push({
      id: leaf.id, name: leaf.name,
      pathLabel: path.slice(0, -1).map((n: any) => n.name).join(' → '),
      quota: q,
      maxFemale: leaf?.allowFemale === false ? 0 : (leaf?.maxFemale ?? null),
      maxMale:   leaf?.allowMale   === false ? 0 : (leaf?.maxMale   ?? null),
      capacity, shortfall: q - capacity,
    })
  })

  return {
    mülki: m, lisey: l,
    ok: m.deficit === 0 && m.unfillable === 0 && l.deficit === 0 && l.unfillable === 0,
    capIssues,
    // eyni ixtisas hər iki mənbədə darboğaz ola bilər — təkrarı at
    genderTight: genderTight.filter((g, i, a) =>
      a.findIndex(x => x.id === g.id && x.gender === g.gender) === i),
  }
}
