import { useState, useCallback } from 'react'

// Admin paneldə son seçilmiş müəssisə — səhifələr arası keçiddə yadda qalır.
// sessionStorage-dədir və logout-da (clearAdminSession) silinir.
const KEY = 'mmu_active_inst'

export function readActiveInst(): string {
  try { return sessionStorage.getItem(KEY) || '' } catch { return '' }
}
export function writeActiveInst(id: string) {
  try { if (id) sessionStorage.setItem(KEY, id); else sessionStorage.removeItem(KEY) } catch { /* yox */ }
}
export function clearActiveInst() { writeActiveInst('') }

// useState<string>('') əvəzinə: ilkin dəyər son seçilmiş müəssisədir, dəyişiklik yadda saxlanır.
// list verilibsə və saxlanmış id orada yoxdursa (məs. müəssisə silinib) — '' qaytarır,
// səhifənin öz "birinciyə keç" məntiqi işə düşür.
export function useActiveInst(list?: Array<{ id: string }> | null): [string, (id: string) => void] {
  const [id, setId] = useState<string>(readActiveInst)
  const set = useCallback((v: string) => { writeActiveInst(v); setId(v) }, [])
  const valid = !id || !list || !list.length || list.some(x => x.id === id) ? id : ''
  return [valid, set]
}
