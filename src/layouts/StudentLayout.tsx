import { Outlet } from 'react-router-dom'

export default function StudentLayout() {
  return (
    <div className="student-shell">
      {/* ── Content ── */}
      <main className="student-body">
        <Outlet />
      </main>
    </div>
  )
}
