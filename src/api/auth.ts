// Admin/tələbə sessiyalarının tək yeri — əvvəllər 9+ fayldə səpələnmiş
// sessionStorage oxu/yazma buraya toplanıb.
const KEYS = {
  admin:    'admin_session',
  student:  'mmu_student',
} as const

export interface AdminSession {
  token: string
  id: string
  name: string
  email?: string | null
  username: string
  role: string
  permissions?: string[] | null
  // Müəssisə əhatəsi: boş/yoxdursa = bütün müəssisələr; doludursa yalnız bunlar
  institutions?: string[] | null
}

export interface StudentSession {
  token: string
  id: string
  institution: string
  name: string
  [key: string]: any
}

function read<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') } catch { return null }
}

export function getAdminSession(): AdminSession | null { return read<AdminSession>(KEYS.admin) }
export function setAdminSession(session: AdminSession) { sessionStorage.setItem(KEYS.admin, JSON.stringify(session)) }
export function clearAdminSession() { sessionStorage.removeItem(KEYS.admin) }

export function getStudentSession(): StudentSession | null { return read<StudentSession>(KEYS.student) }
export function setStudentSession(session: StudentSession) { sessionStorage.setItem(KEYS.student, JSON.stringify(session)) }
export function clearStudentSession() { sessionStorage.removeItem(KEYS.student) }

// Cari route-a görə uyğun JWT-ni seçir (admin/student sessiyaları eyni tab-da
// paralel mövcud ola bilər — path prioriteti verir, yoxdursa növbə ilə yoxlayır)
export function getToken(): string | null {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  if (path.startsWith('/admin'))   return getAdminSession()?.token ?? fallbackToken()
  if (path.startsWith('/student')) return getStudentSession()?.token ?? fallbackToken()
  return fallbackToken()
}

function fallbackToken(): string | null {
  return getAdminSession()?.token ?? getStudentSession()?.token ?? null
}

// addLog üçün cari sessiyadakı şəxsin adı
export function currentActorName(): string {
  return getAdminSession()?.name || getStudentSession()?.name || 'Sistem'
}
