import { useNavigate } from 'react-router-dom'
import { selectionDb, submissionDb, treeDb, buildNameMap } from '../../db'

export default function ResultPage() {
  const navigate = useNavigate()
  const stored   = sessionStorage.getItem('mmu_student')
  const student  = stored ? JSON.parse(stored) : null

  if (!student) {
    navigate('/student', { replace: true })
    return null
  }

  const selections  = selectionDb.getAll().filter((s: any) => s.status !== 'draft')
  const submissions = submissionDb.getAll().filter((s: any) => s.userId === student.id)

  const instLabel = student.institution === 'kollec' ? '🎓 Hərbi Kollec'
                  : student.institution === 'ahm'    ? '🏛️ AHM'
                  : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* Başlıq */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>Nəticələrim</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Göndərdiyiniz seçimlərin siyahısı</div>
        </div>
        <button onClick={() => navigate('/student')}
          style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: 13 }}>
          ← Geri
        </button>
      </div>

      {/* Şəxsi məlumat + yerləşdirmə kartı */}
      <div className="card" style={{ padding: '18px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: student.placedSpecialty || student.institution ? 16 : 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fbf1d6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>👤</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{student.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              FİN: <span style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{student.fin}</span>
              {' · '}İş №: {student.workNumber}
              {' · '}Bal: <span style={{ fontWeight: 700, color: 'var(--blue)' }}>{Number(student.score).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Müəssisə */}
        {instLabel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Müəssisə</div>
            <span style={{
              display: 'inline-block', padding: '6px 16px', borderRadius: 10,
              background: student.institution === 'kollec' ? '#fbf1d6' : '#fbf1d6',
              color:      student.institution === 'kollec' ? '#c9962a'  : '#b8860b',
              fontWeight: 800, fontSize: 14, width: 'fit-content',
            }}>{instLabel}</span>

            {/* Yerləşdiyi ixtisas (admin simulyasiya edib saxlayıbsa) */}
            {student.placedSpecialty && (
              <>
                <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600, marginTop: 6 }}>Yerləşdiyi ixtisas</div>
                <div style={{ background: '#f6fff4', border: '1.5px solid #52c41a', borderRadius: 10, padding: '12px 16px' }}>
                  <div style={{ fontWeight: 800, fontSize: 14, color: '#237804' }}>✅ Yerləşdirilib</div>
                  <div style={{ fontSize: 13, color: 'var(--text)', marginTop: 4, fontWeight: 600 }}>
                    {student.placedSpecialty}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {!instLabel && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 2 }}>
            <div style={{ background: '#fffbe6', border: '1.5px solid #ffe58f', borderRadius: 10, padding: '12px 16px', fontSize: 13, color: '#7a5f00' }}>
              ⏳ Müəssisəyə hələ təyin edilməmisiniz. Admin tərəfindən yerləşdirmə tamamlandıqdan sonra burada görünəcək.
            </div>
          </div>
        )}
      </div>

      {/* Göndərilmiş seçimlər */}
      {submissions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <div className="empty-title">Hələ seçim göndərməmisiniz</div>
          <div className="empty-sub">Aktiv seçimə daxil olub ixtisaslarınızı sıralayın</div>
        </div>
      ) : (
        submissions.map((sub: any) => {
          const sel     = selections.find((s: any) => s.id === sub.selectionId)
          const tree    = sel ? treeDb.get(sel.treeId) : null
          const nameMap = tree ? buildNameMap(tree) : {}

          return (
            <div key={sub.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{sel?.name || sub.selectionId}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Göndərildi: {new Date(sub.createdAt || sub.updatedAt).toLocaleString('az-AZ')}
                  </div>
                </div>
                <span className="badge badge-green">✅ Göndərildi</span>
              </div>

              <div style={{ padding: '0 0 12px 0' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, width: 44 }}>№</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>İXTİSAS</th>
                      <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', fontWeight: 700, width: 100 }}>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sub.ranking as string[]).slice(0, 10).map((specId: string, idx: number) => {
                      const isPlaced = student.placedSpecialty && student.placedSpecialty === specId
                      return (
                        <tr key={specId} style={{ borderTop: '1px solid #f0f0f0', background: isPlaced ? '#f6fff4' : undefined }}>
                          <td style={{ padding: '9px 16px', fontWeight: 800, color: idx < 3 ? 'var(--blue)' : 'var(--muted)', fontSize: 13 }}>
                            {idx + 1}
                          </td>
                          <td style={{ padding: '9px 16px', fontSize: 13, fontWeight: isPlaced ? 800 : (idx < 3 ? 700 : 400), color: isPlaced ? '#237804' : 'var(--text)' }}>
                            {nameMap[specId] || specId}
                          </td>
                          <td style={{ padding: '9px 16px' }}>
                            {isPlaced && <span className="badge badge-green" style={{ fontSize: 10 }}>✅ Yerləşdirilib</span>}
                          </td>
                        </tr>
                      )
                    })}
                    {sub.ranking.length > 10 && (
                      <tr>
                        <td colSpan={3} style={{ padding: '8px 16px', fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>
                          + {sub.ranking.length - 10} daha ixtisas
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
