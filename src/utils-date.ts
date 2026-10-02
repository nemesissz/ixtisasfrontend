// Tarix formatı — 01.09.2026
//
// QEYD: toLocaleDateString('az-AZ', { month: 'long' }) brauzerdə "2026 M09 01"
// verir, çünki az-AZ üçün ay adları yoxdur və ICU fallback işə düşür.
// Ona görə format əl ilə qurulur.
export function formatDate(value: Date | string | number | null | undefined, sep = '.'): string {
  if (value == null || value === '') return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (isNaN(d.getTime())) return '—'
  return [
    String(d.getDate()).padStart(2, '0'),
    String(d.getMonth() + 1).padStart(2, '0'),
    d.getFullYear(),
  ].join(sep)
}

export const today = (sep = '.') => formatDate(new Date(), sep)
