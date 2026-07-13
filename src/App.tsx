import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { initClientIp } from './api/clientIp'
import AdminLogin    from './pages/admin/Login'

import AdminLayout   from './layouts/AdminLayout'
import Dashboard     from './pages/admin/Dashboard'
import Selections    from './pages/admin/Selections'
import SelectionNew  from './pages/admin/SelectionNew'
import SelectionDetail from './pages/admin/SelectionDetail'
import Specialties   from './pages/admin/Specialties'
import Users         from './pages/admin/Users'
import Results       from './pages/admin/Results'
import Admins        from './pages/admin/Admins'
import Distribution  from './pages/admin/Distribution'
import Redistribute  from './pages/admin/Redistribute'
import Archive       from './pages/admin/Archive'
import Logs          from './pages/admin/Logs'

import StudentLayout    from './layouts/StudentLayout'
import Landing          from './pages/student/Landing'
import SelectionPage    from './pages/student/SelectionPage'
import ResultPage       from './pages/student/ResultPage'

import OperatorLayout    from './layouts/OperatorLayout'
import OperatorDashboard from './pages/operator/Dashboard'
import OperatorLogin     from './pages/operator/Login'
import { getAdminSession } from './api/auth'

function AdminGuard({ children }: { children: React.ReactNode }) {
  const session = getAdminSession()
  if (!session) return <Navigate to="/admin/login" replace />
  return <>{children}</>
}

export default function App() {
  // Real müştəri IP-sini hostdakı ip-helper-dən bir dəfə al (loglar üçün);
  // xidmət işləmirsə səssiz keçilir
  React.useEffect(() => { initClientIp() }, [])
  return (
    <Routes>
      {/* ── Kök: birbaşa idarəetmə login (admin/super/operator) ── */}
      <Route path="/" element={<AdminLogin />} />

      {/* ── Admin login ── */}
      <Route path="/admin/login" element={<AdminLogin />} />

      {/* ── Admin panel ── */}
      <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
        <Route index                      element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard"           element={<Dashboard />} />
        <Route path="selections"          element={<Selections />} />
        <Route path="selections/new"      element={<SelectionNew />} />
        <Route path="selections/:id"      element={<SelectionDetail />} />
        <Route path="specialties"         element={<Specialties />} />
        <Route path="users"               element={<Users />} />
        <Route path="results"             element={<Results />} />
        <Route path="admins"              element={<Admins />} />
        <Route path="distribution"        element={<Distribution />} />
        <Route path="redistribute"        element={<Redistribute />} />
        <Route path="archive"             element={<Archive />} />
        <Route path="logs"                element={<Logs />} />
      </Route>

      {/* ── Operator panel ── */}
      <Route path="/operator/login" element={<OperatorLogin />} />
      <Route path="/operator" element={<OperatorLayout />}>
        <Route index            element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<OperatorDashboard />} />
      </Route>

      {/* ── Student panel ── */}
      <Route path="/student" element={<StudentLayout />}>
        <Route index                      element={<Landing />} />
        <Route path=":selId"              element={<SelectionPage />} />
        <Route path="results"             element={<ResultPage />} />
      </Route>

      {/* ── Fallback ── */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
