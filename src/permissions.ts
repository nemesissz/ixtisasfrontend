// ── İcazə (permission) sistemi ────────────────────────────────────────────────
// Superadmin → həmişə bütün icazələr. Digər hesablar → seçilmiş icazələr.
import { getAdminSession } from './api/auth'

export interface PermDef { code: string; label: string }
export interface PermGroup { group: string; icon: string; perms: PermDef[] }

export const PERM_GROUPS: PermGroup[] = [
  {
    group: 'Statistika', icon: '📊', perms: [
      { code: 'stats.view', label: 'Statistikaya baxış' },
    ],
  },
  {
    group: 'Təhsilalanlar', icon: '👥', perms: [
      { code: 'users.view',   label: 'Siyahıya baxış' },
      { code: 'users.edit',   label: 'Təhsilalan redaktəsi' },
      { code: 'users.import', label: 'Excel idxal' },
      { code: 'users.export', label: 'Excel export' },
      { code: 'users.print',  label: 'Çap əməliyyatı' },
      { code: 'users.delete', label: 'Silmə / sıfırlama' },
    ],
  },
  {
    group: 'Müəssisə / İxtisaslar', icon: '🏛️', perms: [
      { code: 'tree.view',   label: 'Bölməyə baxış' },
      { code: 'inst.create', label: 'Müəssisə yaratma' },
      { code: 'inst.edit',   label: 'Müəssisə redaktəsi' },
      { code: 'inst.delete', label: 'Müəssisə silmə' },
      { code: 'tree.edit',   label: 'İxtisas strukturu redaktəsi' },
      { code: 'tree.delete', label: 'Struktur silmə / arxiv' },
    ],
  },
  {
    group: 'Seçimlər', icon: '🗳', perms: [
      { code: 'sel.view',    label: 'Bölməyə baxış' },
      { code: 'sel.create',  label: 'Seçim yaratma' },
      { code: 'sel.publish', label: 'Aktivləşdirmə / bağlama' },
      { code: 'sel.edit',    label: 'Parametr redaktəsi' },
      { code: 'sel.delete',  label: 'Seçim silmə' },
    ],
  },
  {
    group: 'Yerləşdirmə', icon: '⚖️', perms: [
      { code: 'dist.view',     label: 'Baxış / simulyasiya' },
      { code: 'dist.run',      label: 'Bazaya yazma' },
      { code: 'dist.rollback', label: 'Rollback (geri qaytarma)' },
      { code: 'dist.partial',  label: 'Qismən yenidən yerləşdirmə' },
    ],
  },
  {
    group: 'Nəticələr', icon: '📋', perms: [
      { code: 'results.view',   label: 'Nəticələrə baxış' },
      { code: 'results.export', label: 'Excel ixrac' },
    ],
  },
  {
    group: 'Sistem', icon: '🔐', perms: [
      { code: 'archive.view',    label: 'Arxivə baxış' },
      { code: 'archive.restore', label: 'Arxivdən bərpa' },
      { code: 'logs.view',       label: 'Loglara baxış' },
      { code: 'admins.manage',   label: 'Adminlərin idarəsi' },
    ],
  },
]

export const ALL_PERMS: string[] = PERM_GROUPS.flatMap(g => g.perms.map(p => p.code))

// Hər route üçün tələb olunan icazə (sidebar + route guard)
export const PATH_PERM: Record<string, string> = {
  '/admin/dashboard':    'stats.view',
  '/admin/users':        'users.view',
  '/admin/specialties':  'tree.view',
  '/admin/selections':   'sel.view',
  '/admin/distribution': 'dist.view',
  '/admin/redistribute': 'dist.partial',
  '/admin/results':      'results.view',
  '/admin/archive':      'archive.view',
  '/admin/logs':         'logs.view',
  '/admin/admins':       'admins.manage',
}

// Cari admin sessiyasını oxu
export function currentSession(): any {
  return getAdminSession()
}
// Cari istifadəçi bu əməliyyatı edə bilərmi?
export function can(code: string): boolean {
  return hasPerm(currentSession(), code)
}

export function hasPerm(session: any, code: string): boolean {
  if (!session) return false
  if (session.role === 'superadmin') return true
  return Array.isArray(session.permissions) && session.permissions.includes(code)
}

// Pathname üçün icazə yoxlaması ("/admin/selections/abc" → sel.view)
export function pathAllowed(session: any, pathname: string): boolean {
  if (!session) return false
  if (session.role === 'superadmin') return true
  const entry = Object.entries(PATH_PERM).find(([p]) => pathname === p || pathname.startsWith(p + '/'))
  if (!entry) return true   // xəritədə olmayan səhifələr sərbəst
  return hasPerm(session, entry[1])
}
