// ── Rəng palitrası ────────────────────────────────────────────────────────
// Proqramın əsas rəngləri buradan götürülür. İki palitra var:
//   • navy — «Navy + polad» (açıq və tünd rejim)
//   • old  — köhnə qızılı rənglər («Köhnə» rejimi)
// Palitra səhifə açılarkən bir dəfə seçilir (theme.ts-in yadda saxladığı
// rejimə görə); rejim dəyişəndə səhifə yenilənir ki, hər yer yeni rəngi alsın.
const NAVY = {
  navy:   '#36659c', // əsas vurğu (əvvəl #1f3f6b → #2a5283 — açıq rejimdə çox tünd idi)
  navyDk: '#264a78', // tünd mətn (əvvəl #152c4d → #1d3a63)
  steel:  '#4a6f8f', // qradiyentin ikinci rəngi
  ink:    '#3b5a7d', // ikinci dərəcəli mətn
  sky:    '#86a3bd',
  line:   '#c9d4e2', // açıq çərçivə
  line2:  '#d5dde8',
  line3:  '#dfe6ef',
  tint3:  '#e6ecf4',
  tint:   '#eef2f7', // açıq fon
  tint2:  '#f6f8fb', // çox açıq fon
  slate:  '#6b7f95',
  seqTo:  '#e8edf4', // ardıcıl bar şkalasının açıq ucu
}
type Palette = typeof NAVY
const OLD: Palette = {
  navy:   '#c9962a',
  navyDk: '#b8860b',
  steel:  '#e0a92e',
  ink:    '#9a7b1e',
  sky:    '#e0c878',
  line:   '#ecd9a0',
  line2:  '#efe1bd',
  line3:  '#f3e3b8',
  tint3:  '#fbeec4',
  tint:   '#fbf1d6',
  tint2:  '#fffdf5',
  slate:  '#a08a4a',
  seqTo:  '#f6ecd2',
}

export const PALETTE_KEY = 'mmu_theme'
function readOld(): boolean {
  try { return localStorage.getItem(PALETTE_KEY) === 'old' } catch { return false }
}
export const IS_OLD_PALETTE = readOld()

// Açıq rejim (İSP dizayn sistemi, claude.ai design) — yalnız bu rejimdə tətbiq olunan
// üslublar L(açıq, digər) ilə seçilir. Rejim yaddaşda yoxdursa açıq sayılır.
function readLight(): boolean {
  try { const m = localStorage.getItem(PALETTE_KEY); return !m || m === 'light' } catch { return true }
}
export const IS_LIGHT_MODE = readLight()
export function L<T>(light: T, other: T): T { return IS_LIGHT_MODE ? light : other }

/** İSP dizayn sisteminin açıq rejim tokenləri */
export const DS = {
  surface: '#f3f4f1',       // səhifə fonu
  raised: '#fbfbf9',        // kartlar, sidebar
  sunken: '#e9ece7',        // bar izi, mini-kartlar, passiv tablar
  line: '#dcdfd8',          // kart sərhədləri
  ink: '#1d2830',           // əsas mətn, rəqəmlər
  muted: '#525f68',         // altyazılar, faizlər
  primary: '#1d5a8c',       // aktiv tab, əsas düymə
  primarySoft: '#e2ebf3',   // aktiv menyu fonu
  data1: '#2a6db3',         // göy — tək seriyalı barlar
  data2: '#bd6418',         // narıncı
  data3: '#1f8a6e',         // yaşılımtıl — Mülki
  data4: '#9a5aa8',         // bənövşəyi
  success: '#24734a',       // Yerləşdi
  warning: '#9a5d08',       // Seçim etdi, yerləşdirilmədi
  neutral: '#7a858b',       // Seçim etmədi
  shadow: '0 1px 2px #1d28300d',
}
export const P: Palette = IS_OLD_PALETTE ? OLD : NAVY

/** '#rrggbb' → [r, g, b] */
export function hexRgb(h: string): number[] {
  const s = h.replace('#', '')
  return [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16))
}

/** Köhnə rejimdə bu yerdə palitranın ümumi rəngi yox, əvvəlki dəqiq rəng işlənirdi. */
export function O(navy: string, old: string): string { return IS_OLD_PALETTE ? old : navy }
