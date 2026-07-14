// Backend API-yə fetch əsaslı nazik sarğı — token-i avtomatik əlavə edir, JSON encode/decode edir.
import { getToken, clearAdminSession, clearStudentSession } from './auth'

// VITE_API_URL:
//   - təyin olunmayıb (dev rejimi)  → http://localhost:5199
//   - boş string "" (Docker build)  → nisbi ünvan: eyni mənşə, nginx /api-ni backend-ə ötürür.
//     Beləliklə tətbiq istənilən IP/hostname üzərindən işləyir.
const _env = (import.meta as any).env?.VITE_API_URL
const BASE_URL: string = _env !== undefined ? _env : 'http://localhost:5199'

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
