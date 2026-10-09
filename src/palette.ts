// ── Rəng palitrası ────────────────────────────────────────────────────────
// Proqramın əsas rəngləri buradan götürülür. İki palitra var:
//   • navy — «Navy + polad» (açıq və tünd rejim)
//   • old  — köhnə qızılı rənglər («Köhnə» rejimi)
// Palitra səhifə açılarkən bir dəfə seçilir (theme.ts-in yadda saxladığı
// rejimə görə); rejim dəyişəndə səhifə yenilənir ki, hər yer yeni rəngi alsın.
const NAVY = {
  navy:   '#1f3f6b', // əsas vurğu
  navyDk: '#152c4d', // tünd mətn
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
export const P: Palette = IS_OLD_PALETTE ? OLD : NAVY

/** '#rrggbb' → [r, g, b] */
export function hexRgb(h: string): number[] {
  const s = h.replace('#', '')
  return [0, 2, 4].map(i => parseInt(s.substr(i, 2), 16))
}
