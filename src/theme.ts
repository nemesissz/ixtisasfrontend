import { http } from './api/http'
import { IS_OLD_PALETTE, PALETTE_KEY } from './palette'

// ── Görünüş rejimi (açıq / tünd / köhnə) ──────────────────────────────────
// Rejimi yalnız superadmin «Parametrlər» səhifəsindən dəyişir; dəyər backend-də
// saxlanır və bütün istifadəçilərə (admin və təhsilalan) tətbiq olunur.
// Səhifə açılarkən «yanıb-sönmə» olmasın deyə son məlum dəyər localStorage-də
// də saxlanır və ilk olaraq o tətbiq edilir.
//   light — Navy + polad, ağ fon
//   dark  — Navy + polad, tünd fon
//   old   — köhnə qızılı rənglər, ağ fon
export type ThemeMode = 'light' | 'dark' | 'old'
const KEY = PALETTE_KEY
const MODES: ThemeMode[] = ['light', 'dark', 'old']

let current: ThemeMode = 'light'

function isMode(v: unknown): v is ThemeMode { return MODES.includes(v as ThemeMode) }

export function applyTheme(mode: ThemeMode) {
  current = mode
  const root = document.documentElement
  if (mode === 'dark') root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
  if (mode === 'old') root.setAttribute('data-palette', 'old')
  else root.removeAttribute('data-palette')
  let stored = false
  try { localStorage.setItem(KEY, mode); stored = localStorage.getItem(KEY) === mode } catch { /* yaddaş əlçatmazdır */ }
  // Komponentlərdəki rənglər (palette.ts) səhifə açılarkən seçilir — palitra
  // dəyişibsə səhifə yenilənir ki, hər yer yeni rəngi alsın. Yaddaş işləmirsə
  // yenilənmə sonsuz dövrəyə düşməsin deyə edilmir.
  if (stored && (mode === 'old') !== IS_OLD_PALETTE) window.location.reload()
}

export function getThemeMode(): ThemeMode { return current }

export async function fetchTheme(): Promise<ThemeMode> {
  try {
    const r = await http.get<{ theme: string }>('/api/systemsettings/theme')
    return isMode(r?.theme) ? r.theme : 'light'
  } catch { return current }
}

/** Yalnız backend-ə yazır; tətbiq etmək üçün sonra applyTheme çağırılır. */
export async function saveTheme(mode: ThemeMode) {
  await http.put('/api/systemsettings/theme', { theme: mode })
}

/** Proqram açılarkən bir dəfə çağırılır. */
export function initTheme() {
  let cached: unknown = null
  try { cached = localStorage.getItem(KEY) } catch { /* yaddaş əlçatmazdır */ }
  applyTheme(isMode(cached) ? cached : 'light')
  fetchTheme().then(applyTheme)
}
