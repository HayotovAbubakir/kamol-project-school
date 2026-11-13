import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import AppShell from './components/AppShell'
import PasswordResetGate from './components/PasswordResetGate'
import { AuthProvider } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { NotificationProvider } from './context/NotificationContext'

const Login = lazy(() => import('./pages/Login'))
const AdminGroups = lazy(() => import('./pages/admin/Groups'))
const AdminStudents = lazy(() => import('./pages/admin/Students'))
const AdminTeachers = lazy(() => import('./pages/admin/Teachers'))
const AdminAttendance = lazy(() => import('./pages/admin/Attendance'))
const OwnerAccountSettings = lazy(() => import('./pages/owner/AccountSettings'))
const OwnerDashboard = lazy(() => import('./pages/owner/Dashboard'))
const OwnerDebtors = lazy(() => import('./pages/owner/Debtors'))
const OwnerFinance = lazy(() => import('./pages/owner/Finance'))
const OwnerNotifications = lazy(() => import('./pages/owner/Notifications'))
const OwnerPaid = lazy(() => import('./pages/owner/Paid'))
const OwnerSchedule = lazy(() => import('./pages/owner/Schedule'))
const OwnerUsers = lazy(() => import('./pages/owner/Users'))
const Questions = lazy(() => import('./pages/Questions'))
const TodayAbsent = lazy(() => import('./pages/owner/TodayAbsent'))
const AppearanceSettings = lazy(() => import('./pages/settings/Appearance'))
const TeacherDashboard = lazy(() => import('./pages/teacher/Dashboard'))
const TeacherGroups = lazy(() => import('./pages/teacher/Groups'))
const TeacherAttendance = lazy(() => import('./pages/teacher/Attendance'))
const TeacherSchedule = lazy(() => import('./pages/teacher/Schedule'))

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <NotificationProvider>
        <PasswordResetGate />
        <Suspense fallback={(
          <div className="app-loader" role="status" aria-live="polite">
            <div className="app-loader-spinner" aria-hidden="true" />
            <p className="app-loader-label">Yuklanmoqda…</p>
          </div>
        )}>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<AuthGuard allowedRoles={['owner']} />}>
            <Route path="/owner" element={<AppShell role="owner" />}>
              <Route index element={<OwnerDashboard />} />
              <Route path="groups" element={<AdminGroups />} />
              <Route path="teachers" element={<AdminTeachers />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="schedule" element={<OwnerSchedule />} />
              <Route path="attendance" element={<AdminAttendance />} />
              <Route path="attendance/absent-today" element={<TodayAbsent />} />
              <Route path="payments/debtors" element={<OwnerDebtors />} />
              <Route path="finance" element={<OwnerFinance />} />
              <Route path="finance/paid" element={<OwnerPaid />} />
              <Route path="finance/debtors" element={<OwnerDebtors />} />
              <Route path="notifications" element={<OwnerNotifications />} />
              <Route path="questions" element={<Questions />} />
              <Route path="settings/appearance" element={<Navigate to="/owner/settings/fon" replace />} />
              <Route path="settings/fon" element={<AppearanceSettings />} />
              <Route path="settings/account" element={<OwnerAccountSettings />} />
              <Route path="settings/staff" element={<OwnerUsers />} />
              <Route path="settings/roles" element={<Navigate to="/owner" replace />} />
              <Route path="users" element={<Navigate to="/owner/settings/staff" replace />} />
              <Route path="expenses" element={<Navigate to="/owner/finance" replace />} />
              <Route path="admins" element={<Navigate to="/owner/settings/staff" replace />} />
            </Route>
          </Route>

          <Route element={<AuthGuard allowedRoles={['reception']} />}>
            <Route path="/reception" element={<AppShell role="reception" />}>
              <Route index element={<OwnerDashboard />} />
              <Route path="groups" element={<AdminGroups />} />
              <Route path="teachers" element={<AdminTeachers />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="schedule" element={<OwnerSchedule />} />
              <Route path="settings/appearance" element={<Navigate to="/reception/settings/fon" replace />} />
              <Route path="settings/fon" element={<AppearanceSettings />} />
              <Route path="attendance" element={<AdminAttendance />} />
              <Route path="attendance/absent-today" element={<TodayAbsent />} />
              <Route path="payments" element={<Navigate to="/reception/payments/debtors" replace />} />
              <Route path="payments/debtors" element={<OwnerDebtors />} />
              <Route path="questions" element={<Questions />} />
              <Route path="finance/*" element={<Navigate to="/reception" replace />} />
              <Route path="settings/staff/*" element={<Navigate to="/reception" replace />} />
              <Route path="settings/roles/*" element={<Navigate to="/reception" replace />} />
              <Route path="notifications" element={<Navigate to="/reception" replace />} />
            </Route>
          </Route>

          <Route element={<AuthGuard allowedRoles={['teacher']} />}>
            <Route path="/teacher" element={<AppShell role="teacher" />}>
              <Route index element={<TeacherDashboard />} />
              <Route path="groups" element={<TeacherGroups />} />
              <Route path="attendance" element={<TeacherAttendance />} />
              <Route path="schedule" element={<TeacherSchedule />} />
              <Route path="settings/appearance" element={<Navigate to="/teacher/settings/fon" replace />} />
              <Route path="settings/fon" element={<AppearanceSettings />} />
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </Suspense>
        </NotificationProvider>
      </DataProvider>
    </AuthProvider>
  )
}
