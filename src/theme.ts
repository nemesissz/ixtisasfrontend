import { http } from './api/http'

// ── Görünüş rejimi (açıq / tünd / sistem) ─────────────────────────────────
// Rejimi yalnız superadmin «Parametrlər» səhifəsindən dəyişir; dəyər backend-də
// saxlanır və bütün istifadəçilərə (admin və təhsilalan) tətbiq olunur.
// Səhifə açılarkən «yanıb-sönmə» olmasın deyə son məlum dəyər localStorage-də
// də saxlanır və ilk olaraq o tətbiq edilir.
export type ThemeMode = 'light' | 'dark' | 'system'
const KEY = 'mmu_theme'
const MODES: ThemeMode[] = ['light', 'dark', 'system']

let current: ThemeMode = 'light'
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

function isMode(v: unknown): v is ThemeMode { return MODES.includes(v as ThemeMode) }

export function applyTheme(mode: ThemeMode) {
  current = mode
  const dark = mode === 'dark' || (mode === 'system' && !!mq?.matches)
  if (dark) document.documentElement.setAttribute('data-theme', 'dark')
  else document.documentElement.removeAttribute('data-theme')
  try { localStorage.setItem(KEY, mode) } catch { /* yaddaş əlçatmazdır */ }
}

export function getThemeMode(): ThemeMode { return current }

export async function fetchTheme(): Promise<ThemeMode> {
  try {
    const r = await http.get<{ theme: string }>('/api/systemsettings/theme')
    return isMode(r?.theme) ? r.theme : 'light'
  } catch { return current }
}

export async function saveTheme(mode: ThemeMode) {
  await http.put('/api/systemsettings/theme', { theme: mode })
  applyTheme(mode)
}

/** Proqram açılarkən bir dəfə çağırılır. */
export function initTheme() {
  let cached: unknown = null
  try { cached = localStorage.getItem(KEY) } catch { /* yaddaş əlçatmazdır */ }
  applyTheme(isMode(cached) ? cached : 'light')
  mq?.addEventListener?.('change', () => { if (current === 'system') applyTheme('system') })
  fetchTheme().then(applyTheme)
}
