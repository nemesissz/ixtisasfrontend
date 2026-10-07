// ── Backend API "Database" ─────────────────────────────────────────────────
// Əvvəllər bu fayl localStorage üzərində sinxron oxu/yazma edirdi. İndi bütün
// data ASP.NET Core + MySQL backend-dən gəlir — hər metod asenxrondur (Promise
// qaytarır), amma ixrac olunan adlar və obyekt şəkilləri (mümkün qədər) eynidir
// ki, çağıran kod tərəfində yalnız `await` əlavə etmək kifayət etsin.
import { useState, useEffect, useRef, useCallback } from 'react'
import { http, ApiError } from './api/http'
import { currentActorName } from './api/auth'

async function getOrNull<T>(path: string): Promise<T | null> {
  try { return await http.get<T>(path) }
  catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e }
}

// ── Tree node helpers (recursive, saf funksiyalar — API-dən asılı deyil) ────
function walkNodes(nodes: any[], fn: (n: any) => void) {
  for (const n of nodes) { fn(n); if (n.children?.length) walkNodes(n.children, fn) }
}

function getLeaves(nodes: any[]): any[] {
  const leaves: any[] = []
  walkNodes(nodes, n => { if (!n.children?.length) leaves.push(n) })
  return leaves
}

export function buildNameMap(tree: any): Record<string, string> {
  const map: Record<string, string> = {}
  if (!tree) return map
  walkNodes(tree.nodes || [], n => { map[n.id] = n.name })
  return map
}

// ── Şəkil (shape) adapterləri ─────────────────────────────────────────────
// Backend FK sahələri "xId" adlanır (institutionId), amma frontend tarixən
// institution FK-sını sadəcə "institution" kimi oxuyur/yazır — burada map olunur.

// Backend vaxtları UTC saxlayır, amma ISO sətri "Z" şəkilçisi OLMADAN göndərir
// (məs. "2026-07-10T09:51:50.583"). JS bunu lokal vaxt kimi oxuyub 4 saat (Bakı UTC+4)
// geri göstərirdi. Timezone məlumatı yoxdursa "Z" əlavə edib düzgün UTC kimi oxuyuruq.
function utc(ts: any): any {
  if (typeof ts !== 'string' || !ts) return ts
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(ts) ? ts : ts + 'Z'
}
function mapInstitution(a: any) {
  return { id: a.id, label: a.label, icon: a.icon, year: a.year }
}
function mapCohort(a: any) {
  return {
    id: a.id, institution: a.institutionId, label: a.label, icon: a.icon, year: a.year,
    sortOrder: a.sortOrder ?? 0, isArchived: !!a.isArchived,
    archivedAt: utc(a.archivedAt), createdAt: utc(a.createdAt),
  }
}
function mapTree(a: any) {
  return {
    id: a.id, name: a.name, institution: a.institutionId,
    // Bu struktur hansı təhsilalan qrupu üçündür (null = bütün müəssisə)
    cohort: a.cohortId ?? null,
    levelNames: a.levelNames || [], icon: a.icon, year: a.year,
    sourceProportional: !!a.sourceProportional, createdAt: utc(a.createdAt),
    isArchived: !!a.isArchived, archivedAt: utc(a.archivedAt),
    nodes: a.nodes || [],
  }
}
function mapSelection(a: any) {
  return {
    id: a.id, name: a.name, institution: a.institutionId, treeId: a.treeId,
    studentCount: a.studentCount, choiceCount: a.choiceCount,
    tiebreaker: a.tiebreaker || [], viewMode: a.viewMode,
    sourceProportional: !!a.sourceProportional, preAssignLevel: a.preAssignLevel ?? null,
    status: a.status, createdAt: utc(a.createdAt), publishedAt: utc(a.publishedAt),
    closedAt: utc(a.closedAt), archivedAt: utc(a.archivedAt),
  }
}
function mapStudent(a: any) {
  return {
    id: a.id, institution: a.institutionId, name: a.name, parentName: a.parentName,
    workNumber: a.workNumber, fin: a.fin, score: a.score, group: a.group,
    cohort: a.cohortId ?? null,
    source: a.source, gender: a.gender, packet: a.packet, status: a.status,
    printStatus: a.printStatus, year: a.year,
    placedSpecialty: a.placedSpecialty, placedSpecialtyId: a.placedSpecialtyId,
    placedSelectionId: a.placedSelectionId, choiceNum: a.choiceNum,
    subjects: a.subjects || {}, branchByLevel: a.branchByLevel || {},
    // Sərbəst mətn sütunları (məs. {"dil":"ingilis"})
    extraFields: a.extraFields || {},
  }
}
function mapAdmin(a: any) {
  return {
    id: a.id, name: a.name, email: a.email, username: a.username,
    role: a.role, status: a.status, lastLogin: utc(a.lastLogin), permissions: a.permissions ?? undefined,
    institutions: a.institutions ?? undefined,
  }
}
function mapSubmission(a: any) {
  return {
    id: a.id, userId: a.userId, userName: a.userName, selectionId: a.selectionId,
    ranking: a.ranking || [], createdAt: utc(a.createdAt), updatedAt: utc(a.updatedAt),
  }
}

// ── Selections ────────────────────────────────────────────────────────────
export const selectionDb = {
  getAll: async () => (await http.get<any[]>('/api/selections')).map(mapSelection),
  get: async (id: string) => {
    const r = await getOrNull<any>(`/api/selections/${id}`)
    return r ? mapSelection(r) : null
  },
  getArchived: async () => (await http.get<any[]>('/api/selections/archived')).map(mapSelection),
  create: async (data: any) => {
    const created = await http.post<any>('/api/selections', {
      name: data.name, institutionId: data.institution, treeId: data.treeId,
      studentCount: data.studentCount, choiceCount: data.choiceCount,
      tiebreaker: data.tiebreaker || [], viewMode: data.viewMode || 'list',
      sourceProportional: !!data.sourceProportional, preAssignLevel: data.preAssignLevel ?? null,
    })
    return mapSelection(created)
  },
  update: async (id: string, data: any) => {
    const current = await http.get<any>(`/api/selections/${id}`)
    const merged = { ...current, ...toBackendSelectionPatch(data) }
    await http.put(`/api/selections/${id}`, {
      name: merged.name, studentCount: merged.studentCount, choiceCount: merged.choiceCount,
      tiebreaker: merged.tiebreaker || [], viewMode: merged.viewMode,
      sourceProportional: !!merged.sourceProportional, preAssignLevel: merged.preAssignLevel ?? null,
    })
    return selectionDb.get(id)
  },
  delete: async (id: string) => { await http.delete(`/api/selections/${id}`) },
  publish: async (id: string) => { await http.post(`/api/selections/${id}/publish`) },
  // Yayımdan əvvəl: iştirakçılardan eyni FİN-li qeydi başqa yayımdakı seçimdə olanlar
  finConflicts: async (id: string) => http.get<Array<{
    fin: string; name: string; otherStatus: string; otherInstitution: string;
    otherCohort: string | null; otherSelectionName: string
  }>>(`/api/selections/${id}/fin-conflicts`),
  close:   async (id: string) => { await http.post(`/api/selections/${id}/close`) },
  archive: async (id: string) => { await http.post(`/api/selections/${id}/archive`) },
  restore: async (id: string) => { await http.post(`/api/selections/${id}/restore`) },
}

// data ola bilər frontend şəklində (institution) və ya artıq backend şəklində (institutionId) — hər ikisini dəstəklə
function toBackendSelectionPatch(data: any) {
  const { institution, ...rest } = data
  return rest
}

// ── Specialty Trees ───────────────────────────────────────────────────────
export const treeDb = {
  getAll: async () => (await http.get<any[]>('/api/specialtytrees')).map(mapTree),
  get: async (id: string) => {
    const r = await getOrNull<any>(`/api/specialtytrees/${id}`)
    return r ? mapTree(r) : null
  },
  create: async (data: any) => {
    const created = await http.post<any>('/api/specialtytrees', {
      name: data.name, institutionId: data.institution, cohortId: data.cohort ?? null, levelNames: data.levelNames || [],
      icon: data.icon ?? null, year: data.year ?? null, sourceProportional: !!data.sourceProportional,
    })
    return mapTree(created)
  },
  update: async (id: string, data: any) => {
    const current = await http.get<any>(`/api/specialtytrees/${id}`)
    const merged = { ...current, ...data }
    await http.put(`/api/specialtytrees/${id}`, {
      name: merged.name, levelNames: merged.levelNames || [],
      icon: merged.icon ?? null, year: merged.year ?? null,
      sourceProportional: !!merged.sourceProportional,
      // data frontend şəklindədir (cohort), current backend şəklində (cohortId).
      // 'cohort' acıq verilibsə — null olsa belə — o qalib gəlir.
      cohortId: ('cohort' in data ? data.cohort : current.cohortId) ?? null,
    })
    if (data.nodes) {
      await http.put(`/api/specialtytrees/${id}/nodes`, data.nodes)
    }
    return treeDb.get(id)
  },
  delete: async (id: string) => { await http.delete(`/api/specialtytrees/${id}`) },
  // Arxivləmə silmə deyil: struktur bazada qalır, sadəcə gizlədilir. Ona bağlı
  // seçimlər toxunulmaz qalır, bərpa ediləndə nəticələr də geri qayıdır.
  getArchived: async () => (await http.get<any[]>('/api/specialtytrees?archived=true')).map(mapTree),
  archive: async (id: string) => { await http.post(`/api/specialtytrees/${id}/archive`) },
  restore: async (id: string) => { await http.post(`/api/specialtytrees/${id}/restore`) },
  countSpecialties: (tree: any) => getLeaves(tree.nodes || []).length,
  totalQuota:       (tree: any) => getLeaves(tree.nodes || []).reduce((s: number, n: any) => s + (n.quota || 0), 0),
}

// ── Users (Students) ──────────────────────────────────────────────────────
export const userDb = {
  getAll: async () => (await http.get<any[]>('/api/students')).map(mapStudent),
  get: async (id: string) => {
    const r = await getOrNull<any>(`/api/students/${id}`)
    return r ? mapStudent(r) : null
  },
  create: async (data: any) => {
    const created = await http.post<any>('/api/students', toStudentDto(data))
    return mapStudent(created)
  },
  // Excel idxal / arxivdən bərpa: bir sorğuda çoxlu tam qeyd yaradır
  bulkCreate: async (items: any[]) => {
    const res = await http.post<{ count: number }>('/api/students/bulk-create', items.map(toStudentDto))
    return res
  },
  update: async (id: string, data: any) => {
    const current = await http.get<any>(`/api/students/${id}`)
    const merged = { ...current, institution: current.institutionId, ...data }
    await http.put(`/api/students/${id}`, {
      name: merged.name, parentName: merged.parentName, workNumber: merged.workNumber,
      fin: merged.fin, score: merged.score, group: merged.group, source: merged.source,
      // Qrup göndərilməsə backend onu null edirdi — hər redaktədə təhsilalan qrupsuz qalırdı
      cohortId: ('cohort' in data ? data.cohort : current.cohortId) ?? null,
      gender: merged.gender, year: merged.year, packet: merged.packet,
      status: merged.status, printStatus: merged.printStatus,
      placedSpecialty: merged.placedSpecialty, placedSpecialtyId: merged.placedSpecialtyId,
      placedSelectionId: merged.placedSelectionId, choiceNum: merged.choiceNum,
      subjects: merged.subjects || {}, branchByLevel: merged.branchByLevel || {},
      extraFields: merged.extraFields || {},
    })
  },
  // Distribution/Redistribute: N tələbənin yerləşdirmə sahələrini bir sorğuda yeniləyir
  bulkUpdate: async (patches: Array<{ id: string; placedSpecialty?: string | null; placedSpecialtyId?: string | null; placedSelectionId?: string | null; choiceNum?: number | null; status?: string }>, method?: 'simple' | 'packet' | 'reset') => {
    // method verilibsə backend uyğun icazəni yoxlayır:
    // simple → dist.simple · packet → dist.packet · reset → results.reset
    await http.post(`/api/students/bulk-update${method ? `?method=${method}` : ''}`, patches)
  },
  deleteMany: async (ids: string[]) => { await http.post('/api/students/delete-many', ids) },
  // Seçilmiş təhsilalanlar üzrə toplu çap statusu / seçimin sıfırlanması ("Seçim etmədi")
  // Backend köhnədirsə (endpoint yoxdur → 404/405) eyni iş mövcud endpoint-lərlə,
  // təhsilalan-təhsilalan görülür — nəticə eynidir, sadəcə daha yavaşdır.
  bulkStatus: async (ids: string[], data: { printStatus?: 'printed' | 'not_printed'; resetSelection?: boolean }) => {
    try {
      return await http.post<{ count: number }>('/api/students/bulk-status', { ids, ...data })
    } catch (e: any) {
      if (e?.status !== 404 && e?.status !== 405) throw e
    }
    const subs = data.resetSelection ? await submissionDb.getAll() : []
    for (const id of ids) {
      if (data.resetSelection) {
        for (const s of subs.filter((x: any) => x.userId === id)) await submissionDb.deleteByUser(id, s.selectionId)
      }
      await userDb.update(id, {
        ...(data.printStatus ? { printStatus: data.printStatus } : {}),
        ...(data.resetSelection ? { status: 'pending', placedSpecialty: null, placedSpecialtyId: null, placedSelectionId: null, choiceNum: null } : {}),
      })
    }
    return { count: ids.length }
  },
  delete: async (id: string) => { await http.delete(`/api/students/${id}`) },
}

function toStudentDto(data: any) {
  return {
    id: data.id ?? null,
    institutionId: data.institution ?? data.institutionId,
    name: data.name, parentName: data.parentName ?? null, workNumber: data.workNumber ?? null,
    fin: data.fin ?? null, score: data.score ?? null, group: data.group ?? null,
    cohortId: data.cohort ?? data.cohortId ?? null,
    source: data.source ?? null, gender: data.gender ?? null, year: data.year ?? null,
    packet: data.packet ?? null, status: data.status ?? 'pending', printStatus: data.printStatus ?? 'not_printed',
    subjects: data.subjects || {}, branchByLevel: data.branchByLevel || {},
    extraFields: data.extraFields || {},
    // Arxivdən bərpada yerləşdirmə nəticəsi də göndərilir (adi idxalda null olur)
    placedSpecialty: data.placedSpecialty ?? null,
    placedSpecialtyId: data.placedSpecialtyId ?? null,
    placedSelectionId: data.placedSelectionId ?? null,
    choiceNum: data.choiceNum ?? null,
  }
}

// ── Xüsusi rollar ──────────────────────────────────────────────────────────
// (Köhnə localStorage seed/self-healing bloklar (default superadmin, BHK, HƏHİ-300,
// NHK, source normalizasiyası, junk-müəssisə təmizliyi) buradan çıxarılıb — data indi
// real MySQL-də yaşayır. Superadmin backend Program.cs-də, BHK isə BhkImporter ilə
// bir dəfəlik seed olunub. Digərləri lazım olsa backend tərəfdə bir dəfəlik
// migrasiya/skript kimi tətbiq edilməlidir, hər səhifə yüklənməsində yox.)
export const customRoleDb = {
  getAll: async (): Promise<string[]> => { try { return await http.get<string[]>('/api/customroles') } catch { return [] } },
  add: async (name: string): Promise<string> => http.post<string>('/api/customroles', name.trim()),
  remove: async (name: string) => { await http.delete(`/api/customroles/${encodeURIComponent(name)}`) },
}

// ── Admins ────────────────────────────────────────────────────────────────
export const adminDb = {
  getAll: async () => (await http.get<any[]>('/api/admins')).map(mapAdmin),
  create: async (data: any) => {
    const created = await http.post<any>('/api/admins', {
      name: data.name, email: data.email ?? null, username: data.username,
      password: data.password, role: data.role, permissions: data.permissions ?? null,
      institutions: data.institutions ?? null,
    })
    return mapAdmin(created)
  },
  update: async (id: string, data: any) => {
    const list = await http.get<any[]>('/api/admins')
    const current = list.find(a => a.id === id)
    const merged = { ...current, ...data }
    await http.put(`/api/admins/${id}`, {
      name: merged.name, email: merged.email ?? null,
      password: data.password || null, role: merged.role, status: merged.status,
      permissions: merged.permissions ?? null, institutions: merged.institutions ?? null,
    })
  },
  delete: async (id: string) => { await http.delete(`/api/admins/${id}`) },
  loginAdmin: async (username: string, password: string) => {
    try { return await http.post<any>('/api/admins/login', { username, password }) }
    catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e }
  },
}

// ── Auth (tələbə girişi) ────────────────────────────────────────────────────
// Server bütün müəssisələr üzrə axtarır (tələbə hələ auth olmadığı üçün
// tam tələbə siyahısını client-side çəkmək mümkün deyil)
export const authDb = {
  studentLogin: async (field1Value: string, field2Value: string) => {
    try {
      const res = await http.post<{ token: string; student: any; selectionId?: string | null }>('/api/auth/student-login', { field1Value, field2Value })
      // selectionId: bu qeydin (müəssisə + qrup) aid olduğu yayımdakı seçim
      return { token: res.token, ...mapStudent(res.student), selectionId: res.selectionId ?? null }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null
      throw e
    }
  },
}

// ── Submissions ───────────────────────────────────────────────────────────
export const submissionDb = {
  getAll: async () => (await http.get<any[]>('/api/submissions')).map(mapSubmission),
  getByUser: async (userId: string, selId: string) => {
    const r = await getOrNull<any>(`/api/submissions/by-user?userId=${encodeURIComponent(userId)}&selectionId=${encodeURIComponent(selId)}`)
    return r ? mapSubmission(r) : null
  },
  getBySelection: async (selId: string) =>
    (await http.get<any[]>(`/api/submissions/by-selection/${selId}`)).map(mapSubmission),
  save: async (data: any) => {
    const saved = await http.post<any>('/api/submissions', {
      userId: data.userId, userName: data.userName ?? null, selectionId: data.selectionId, ranking: data.ranking || [],
    })
    return mapSubmission(saved)
  },
  deleteByUser: async (userId: string, selId: string) => {
    await http.delete(`/api/submissions/by-user?userId=${encodeURIComponent(userId)}&selectionId=${encodeURIComponent(selId)}`)
  },
}

// ── Institutions ──────────────────────────────────────────────────────────
export const institutionDb = {
  getAll: async () => (await http.get<any[]>('/api/institutions')).map(mapInstitution),
  create: async (label: string, icon: string) => {
    const created = await http.post<any>('/api/institutions', { label, icon, year: null })
    return mapInstitution(created)
  },
  update: async (id: string, data: { label: string; icon: string; year?: string }) => {
    await http.put(`/api/institutions/${id}`, { label: data.label, icon: data.icon, year: data.year ?? null })
  },
  delete: async (id: string) => { await http.delete(`/api/institutions/${id}`) },
  // Müəssisənin bütün tələbələrinin yerləşdirmə/statusunu sıfırlayır (yeni seçim dövrü üçün)
  resetStudents: async (id: string) => http.post<{ count: number }>(`/api/institutions/${id}/reset-students`),
}

// Seçimin iştirakçıları — backend-dəki SelectionsController.ParticipantsAsync
// məntiqinin eynisi. Qrup seçimin öz parametri deyil, seçdiyi STRUKTURDAN gəlir:
// struktur qrupsuzdursa müəssisənin bütün təhsilalanları iştirak edir.
export function selectionParticipants(sel: any, tree: any, users: any[]): any[] {
  const inInst = (users || []).filter((u: any) => u.institution === sel?.institution)
  const cid = tree?.cohort || null
  return cid ? inInst.filter((u: any) => u.cohort === cid) : inInst
}

// ── Təhsilalan qrupları (axınlar) ─────────────────────────────────────────
// Qrup yalnız təhsilalanı əhatələyir; struktur və seçim qrupa bağlanmır.
export const cohortDb = {
  getAll: async (institutionId?: string) =>
    (await http.get<any[]>(`/api/cohorts${institutionId ? `?institutionId=${encodeURIComponent(institutionId)}` : ''}`)).map(mapCohort),
  create: async (data: { institution: string; label: string; icon?: string; year?: string; sortOrder?: number }) =>
    mapCohort(await http.post<any>('/api/cohorts', {
      institutionId: data.institution, label: data.label,
      icon: data.icon ?? null, year: data.year ?? null, sortOrder: data.sortOrder ?? null,
    })),
  update: async (id: string, data: { institution?: string; label: string; icon?: string; year?: string; sortOrder?: number }) => {
    await http.put(`/api/cohorts/${id}`, {
      institutionId: data.institution ?? '', label: data.label,
      icon: data.icon ?? null, year: data.year ?? null, sortOrder: data.sortOrder ?? null,
    })
  },
  archive: async (id: string, value = true) => { await http.post(`/api/cohorts/${id}/archive?value=${value}`) },
  delete: async (id: string) => { await http.delete(`/api/cohorts/${id}`) },
  // Təhsilalanları toplu şəkildə qrupa köçürür; cohortId 'none' → qrupdan çıxarır
  assign: async (cohortId: string, studentIds: string[]) =>
    http.post<{ count: number }>(`/api/cohorts/${cohortId}/assign`, studentIds),
}

// ── User Archives ─────────────────────────────────────────────────────────
export const userArchiveDb = {
  getAll: async () => {
    const raw = await http.get<Array<{ id: string; archivedAt: string; data: any }>>('/api/user-archives')
    return raw.map(a => ({ ...a.data, id: a.id, archivedAt: utc(a.archivedAt) }))
  },
  delete: async (id: string) => { await http.delete(`/api/user-archives/${id}`) },
  save: async (data: any) => http.post<{ id: string; archivedAt: string }>('/api/user-archives', data),
}

// ── Tree Archives ─────────────────────────────────────────────────────────
export const treeArchiveDb = {
  getAll: async () => {
    const raw = await http.get<Array<{ id: string; archivedAt: string; data: any }>>('/api/tree-archives')
    return raw.map(a => ({ ...a.data, id: a.id, archivedAt: utc(a.archivedAt) }))
  },
  delete: async (id: string) => { await http.delete(`/api/tree-archives/${id}`) },
  save: async (data: any) => http.post<{ id: string; archivedAt: string }>('/api/tree-archives', data),
}

// ── React hook: asenxron fetcher-i state-ə bağlayır ─────────────────────────
// Çağırış forması eyni qalıb: `const [data, refresh] = useLocalState(() => xDb.getAll())`
// — daxildə indi useEffect ilə asenxron yüklənir, `refresh()` Promise qaytarır.
// ── Real-time yenilənmə (polling) ─────────────────────────────────────────
// Bütün panellər arxa planda müəyyən intervalla backend-dən data-nı yenidən
// çəkir — istifadəçi əl ilə yeniləmədən dəyişikliklər (yeni tələbə, göndərilmiş
// seçim, yerləşdirmə və s.) avtomatik görünür.
// Backend-in FİN toqquşması cavabı (409, code: fin_conflict). Başqa xətalarda null.
export interface FinConflict { fin: string; name: string | null; row: number; existingName: string | null; inFile: boolean }
export function finConflictsOf(e: unknown): { message: string; conflicts: FinConflict[] } | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null
  try {
    const b = JSON.parse(e.message)
    return b?.code === 'fin_conflict' ? { message: b.message, conflicts: b.conflicts || [] } : null
  } catch { return null }
}

// FİN müqayisəsi üçün (backend FinRules.Norm ilə eyni)
export const normFin = (v: any) => String(v ?? '').trim().replace(/İ/g, 'I').replace(/ı/g, 'I').replace(/i/g, 'I').toUpperCase()

export const POLL_MS = 10000
let pollSuspend = 0
// Sürükləmə/aktiv əməliyyat zamanı yenilənməni müvəqqəti dayandırmaq üçün
export function suspendPolling() { pollSuspend++ }
export function resumePolling() { pollSuspend = Math.max(0, pollSuspend - 1) }
function pollActive(): boolean {
  if (pollSuspend > 0) return false
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  return true
}

export function useLocalState<T>(
  fetcher: () => Promise<T>,
  opts?: { poll?: boolean },
): [T | undefined, () => Promise<void>] {
  const [data, setData] = useState<T | undefined>(undefined)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    const result = await fetcherRef.current()
    setData(result)
  }, [])

  useEffect(() => {
    refresh()
    if (opts?.poll === false) return
    const id = setInterval(() => { if (pollActive()) refresh() }, POLL_MS)
    // Tab yenidən aktiv olanda dərhal təzələ
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [refresh])

  return [data, refresh]
}

// Öz yükləmə məntiqi olan səhifələr üçün (Logs, Results kimi) eyni polling qaydası
export function usePoll(fn: () => void, ms: number = POLL_MS) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const id = setInterval(() => { if (pollActive()) ref.current() }, ms)
    const onVisible = () => { if (document.visibilityState === 'visible') ref.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [ms])
}

// ── Logs ──────────────────────────────────────────────────────────────────
export type LogCategory = 'system' | 'selection' | 'distribution' | 'user' | 'admin'
export type LogType     = 'info' | 'success' | 'warning' | 'error'

export interface LogEntry {
  id:        string
  category:  LogCategory
  type:      LogType
  message:   string
  detail?:   string
  actor?:    string
  ip?:       string
  timestamp: string
}

export const logDb = {
  getAll: async (): Promise<LogEntry[]> =>
    (await http.get<LogEntry[]>('/api/logs')).map(l => ({ ...l, timestamp: utc(l.timestamp) })),
  add: async (entry: Omit<LogEntry, 'id' | 'timestamp'>): Promise<LogEntry> =>
    http.post<LogEntry>('/api/logs', entry),
  clear: async () => { await http.delete('/api/logs') },
}

export async function addLog(
  category: LogCategory,
  type:     LogType,
  message:  string,
  detail?:  string,
  actor?:   string
) {
  try {
    await logDb.add({ category, type, message, detail, actor: actor || currentActorName() })
  } catch {
    // log yazıla bilmirsə səssizcə keç — heç bir UI axınını pozmamalıdır
  }
}

// ── Seçimi sıfırla + avtomatik seçim ─────────────────────────────────────────
export interface AutoSeedResult {
  count: number      // yazılan sıralama sayı (created + updated)
  created: number
  updated: number
  kept: number       // təhsilalanın öz göndərdiyi — toxunulmayıb
  empty: number      // məhdudiyyətlərə görə uyğun ixtisas qalmayıb
  total: number
}

// onlyMissing=true → yalnız seçim etməyənlər doldurulur (Doldur düyməsi)
// onlyMissing=false → hamısı silinib yenidən yaradılır
export async function resetAndAutoSeedSubmissions(
  selectionId: string, onlyMissing = false,
): Promise<AutoSeedResult> {
  return http.post<AutoSeedResult>(
    `/api/selections/${selectionId}/reset-and-autoseed?onlyMissing=${onlyMissing}`)
}

// Sıfırla düyməsi: sıralamalar silinir, yenisi YARADILMIR
export async function clearSubmissions(
  selectionId: string,
): Promise<{ deleted: number; reverted: number }> {
  return http.post<{ deleted: number; reverted: number }>(
    `/api/selections/${selectionId}/reset-and-autoseed?seed=false`)
}

// ── Sistem Parametrləri ───────────────────────────────────────────────────
export interface LoginFieldConfig {
  column:   string   // 'fin' | 'workNumber' | 'name' | 'parentName' | ...
  label:    string   // ekranda göstərilən ad
  min:      number
  max:      number
  required: boolean
}

export interface InstLoginConfig {
  field1: LoginFieldConfig
  field2: LoginFieldConfig
}

export const DEFAULT_FIELD1: LoginFieldConfig = { column: 'fin',        label: 'FİN Kodu',    min: 1, max: 20, required: true }
export const DEFAULT_FIELD2: LoginFieldConfig = { column: 'workNumber', label: 'İş Nömrəsi',  min: 1, max: 20, required: true }

export const DEFAULT_INST_CONFIG: InstLoginConfig = { field1: DEFAULT_FIELD1, field2: DEFAULT_FIELD2 }

export const systemSettingsDb = {
  getInstConfig: async (instId: string): Promise<InstLoginConfig> => {
    try { return await http.get<InstLoginConfig>(`/api/systemsettings/inst-config/${instId}`) }
    catch { return { field1: { ...DEFAULT_FIELD1 }, field2: { ...DEFAULT_FIELD2 } } }
  },
  setInstConfig: async (instId: string, cfg: InstLoginConfig) => {
    await http.put(`/api/systemsettings/inst-config/${instId}`, cfg)
  },
  getRedirectDelay: async (): Promise<number> => {
    try { return await http.get<number>('/api/systemsettings/redirect-delay') } catch { return 10 }
  },
  setRedirectDelay: async (sec: number) => {
    await http.put('/api/systemsettings/redirect-delay', Math.max(0, Math.round(sec)))
  },
  getPrioritySubjects: async (): Promise<string[]> => {
    try { return await http.get<string[]>('/api/systemsettings/priority-subjects') } catch { return [] }
  },
  setPrioritySubjects: async (subjects: string[]) => {
    await http.put('/api/systemsettings/priority-subjects', subjects)
  },
  // Təsdiqdən sonrakı elan — oxumaq hamıya açıq, yazmaq yalnız superadmin-ə
  getSubmitNotice: async (): Promise<string> => {
    try {
      const r = await http.get<{ text: string }>('/api/systemsettings/submit-notice')
      return String(r?.text ?? '')
    } catch { return '' }
  },
  setSubmitNotice: async (text: string) => {
    await http.put('/api/systemsettings/submit-notice', { text: text ?? '' })
  },
  reset: async () => { await http.post('/api/systemsettings/reset') },
}

// Bazanın bütövlük möhürü (SHA-256)
export interface IntegritySeal { hash: string; students: number; submissions: number; at: string; algorithm: string }
export const integrityDb = {
  seal: async (): Promise<IntegritySeal> => await http.get<IntegritySeal>('/api/integrity/seal'),
}

// Təhsilalan sahə sütunları
export const STUDENT_COLUMNS = [
  { key: 'fin',        label: 'FİN Kodu' },
  { key: 'workNumber', label: 'İş Nömrəsi' },
  { key: 'firstName',  label: 'Ad' },
  { key: 'lastName',   label: 'Soyad' },
  { key: 'parentName', label: 'Ata adı' },
  { key: 'group',      label: 'Qrup' },
]

// Təhsilalan sütununun dəyərini al — Ad/Soyad `name`-dən ayrılır (qeyddə yalnız tam ad saxlanılır)
export function studentColValue(u: any, key: string): string {
  if (key === 'firstName') return String(u?.name ?? '').trim().split(/\s+/)[0] || ''
  if (key === 'lastName')  return String(u?.name ?? '').trim().split(/\s+/).slice(1).join(' ')
  return String(u?.[key] ?? '')
}

// ── Canlı nəzarət (docs/PLAN-canli-nezaret.md) ──────────────────────────────
export interface MonitorConfig { enabled: boolean; heartbeatSec: number; offlineSec: number; abandonMin: number }
export const monitorDb = {
  live:      (sessionId?: number | null) => http.get<any>(`/api/monitor/live${sessionId ? `?sessionId=${sessionId}` : ''}`),
  getConfig: () => http.get<MonitorConfig>('/api/monitor/config'),
  setConfig: (c: MonitorConfig) => http.put('/api/monitor/config', c),
  session:   (id: number, op: 'pause' | 'resume' | 'end') => http.post(`/api/monitor/session/${id}/${op}`),
  deleteSession: (id: number) => http.delete(`/api/monitor/session/${id}`),
}
