// ── Bərabər bal prioriteti: meyarların hesablanması ──────────────────────────
// Prioritet siyahısındakı hər element bir "meyar"dır. Meyar ya tək sütundur
// ("Riyaziyyat", "Ümumi imtahan nəticəsi"), ya da bir neçə sütunun CƏMİdir —
// cəm " + " ayırıcısı ilə tək sətirdə saxlanılır:
//     "Ümumi imtahan nəticəsi + Semestr balı"
// Beləliklə baza sxemi (List<string>) dəyişmir və köhnə prioritetlər olduğu
// kimi işləməyə davam edir.

export const UMUMI_KEY = 'Ümumi imtahan nəticəsi'
export const SUM_SEP = ' + '

/** Meyar bir neçə sütunun cəmidirmi? */
export const isSumCrit = (crit: string) => String(crit).includes(SUM_SEP)

/** Meyarın tərkib sütunları */
export const critParts = (crit: string) =>
  String(crit).split(SUM_SEP).map(s => s.trim()).filter(Boolean)

/** Bir sütunun dəyəri — yoxdursa null */
export function partValue(user: any, part: string): number | null {
  if (part === UMUMI_KEY) {
    const v = user?.score
    return v == null || isNaN(Number(v)) ? null : Number(v)
  }
  const v = user?.subjects?.[part]
  return v == null || isNaN(Number(v)) ? null : Number(v)
}

/**
 * Meyarın dəyəri. Cəm meyarda mövcud sütunlar toplanır, olmayan sütun 0 sayılır.
 * Heç bir sütun yoxdursa -1 qayıdır — belə təhsilalan həmin meyar üzrə ən sonda olur.
 */
export function critValue(user: any, crit: string): number {
  let sum = 0, found = false
  for (const p of critParts(crit)) {
    const v = partValue(user, p)
    if (v != null) { sum += v; found = true }
  }
  return found ? sum : -1
}

/** Meyarın qısa görünən adı (cəm üçün Σ ilə) */
export const critLabel = (crit: string) => (isSumCrit(crit) ? 'Σ ' : '') + crit
