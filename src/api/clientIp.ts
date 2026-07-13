// Müştərinin real IP-si — hostda işləyən ip-helper (:5180) xidmətindən.
// Docker Desktop (Windows) kənar bağlantıların mənbə IP-sini itirdiyi üçün
// brauzer öz IP-sini Docker-dən KƏNARDA duran bu xidmətdən öyrənir və
// loglara əlavə olunmaq üçün backend-ə ötürür.
// Xidmət işləmirsə (məs. Linux serverdə lazım deyil) — səssiz keçilir,
// backend IP-ni özü tapır.

const KEY = 'client_real_ip'

export function getClientIp(): string | undefined {
  return sessionStorage.getItem(KEY) || undefined
}

let fetching = false

export function initClientIp(): void {
  if (fetching || sessionStorage.getItem(KEY)) return
  fetching = true
  const url = `http://${window.location.hostname}:5180/ip`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 1500)   // helper yoxdursa gözlətmə
  fetch(url, { signal: ctrl.signal })
    .then(r => r.json())
    .then(d => { if (d?.ip) sessionStorage.setItem(KEY, String(d.ip)) })
    .catch(() => { /* helper işləmir — normal haldır */ })
    .finally(() => { clearTimeout(t); fetching = false })
}
