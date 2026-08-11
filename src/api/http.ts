// Backend API-yə fetch əsaslı nazik sarğı — token-i avtomatik əlavə edir, JSON encode/decode edir.
import { getToken, clearAdminSession, clearStudentSession } from './auth'

// VITE_API_URL:
//   - konkret ünvan verilib        → həmin ünvan işlənir
//   - verilməyib/boş + dev rejimi  → http://localhost:5199 (lokal backend)
//   - verilməyib/boş + prod build  → nisbi ünvan: eyni mənşə, nginx /api-ni backend-ə
//     ötürür. Beləliklə tətbiq istənilən IP/hostname üzərindən işləyir.
//
// ⚠ Boş dəyər üzərindən şərt qurmaq olmaz: Vite boş env dəyişənini "təyin olunmayıb"
//   kimi qəbul edir, ona görə `VITE_API_URL=""` ötürmək nisbi ünvan vermir.
//   Buna görə istehsal build-i üçün nisbi ünvan DEFAULT davranışdır.
const _env = (import.meta as any).env?.VITE_API_URL
const _isDev = (import.meta as any).env?.DEV === true
const BASE_URL: string = _env ? _env : (_isDev ? 'http://localhost:5199' : '')

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 401) {
      // Token yoxdur/köhnədir/vaxtı bitib — köhnə sessiyanı təmizlə və uyğun giriş
      // səhifəsinə qaytar (əks halda istifadəçi "asılı" qalmış boş səhifədə qalır)
      redirectToLoginAfterAuthFailure()
    }
    if (res.status === 429) {
      // Rate-limit (çox sayda cəhd) — xam "429" əvəzinə istifadəçinin başa düşəcəyi mesaj
      throw new ApiError(429, 'Çox sayda cəhd edildi. Zəhmət olmasa bir dəqiqə gözləyib yenidən cəhd edin.')
    }
    throw new ApiError(res.status, text || `${method} ${path} -> ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

function redirectToLoginAfterAuthFailure() {
  if (typeof window === 'undefined') return
  const path = window.location.pathname
  if (path.startsWith('/admin')) {
    clearAdminSession()
    if (path !== '/admin/login') window.location.href = '/admin/login'
  } else if (path.startsWith('/student')) {
    clearStudentSession()
    if (path !== '/student') window.location.href = '/student'
  }
}

export const http = {
  get:    <T>(path: string) => request<T>('GET', path),
  post:   <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put:    <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  delete: <T>(path: string) => request<T>('DELETE', path),
}
