// Azərbaycan dilində sıra saylarının şəkilçisi: 1-ci, 3-cü, 6-cı, 9-cu, 10-cu, 40-cı, 100-cü ...
// Şəkilçi ədədin SON sözünün sait ahənginə görə seçilir (on → -cu, qırx → -cı, yüz → -cü).
const ONES = ['', 'ci', 'ci', 'cü', 'cü', 'ci', 'cı', 'ci', 'ci', 'cu']        // bir, iki, üç, dörd, beş, altı, yeddi, səkkiz, doqquz
const TENS = ['', 'cu', 'ci', 'cu', 'cı', 'ci', 'cı', 'ci', 'ci', 'cı']        // on, iyirmi, otuz, qırx, əlli, altmış, yetmiş, səksən, doxsan

export function ordSuffix(n: number): string {
  n = Math.abs(Math.trunc(Number(n) || 0))
  if (n === 0) return 'cı'                       // sıfırıncı
  if (n % 10) return ONES[n % 10]
  if (n % 100) return TENS[(n % 100) / 10]
  if (n % 1000) return 'cü'                      // yüz
  if (n % 1000000) return 'ci'                   // min
  return 'cu'                                    // milyon
}

/** 3 → "3-cü" */
export const ord = (n: number) => `${n}-${ordSuffix(n)}`
