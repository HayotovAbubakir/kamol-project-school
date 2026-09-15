import { Navigate, Route, Routes } from 'react-router-dom'
import AuthGuard from './components/AuthGuard'
import AppShell from './components/AppShell'
import { AuthProvider } from './context/AuthContext'
import { DataProvider } from './context/DataContext'
import { NotificationProvider } from './context/NotificationContext'
import Login from './pages/Login'
import AdminGroups from './pages/admin/Groups'
import AdminStudents from './pages/admin/Students'
import AdminTeachers from './pages/admin/Teachers'
import OwnerAccountSettings from './pages/owner/AccountSettings'
import OwnerDashboard from './pages/owner/Dashboard'
import OwnerDebtors from './pages/owner/Debtors'
import OwnerFinance from './pages/owner/Finance'
import OwnerNotifications from './pages/owner/Notifications'
import OwnerPaid from './pages/owner/Paid'
import OwnerRoles from './pages/owner/Roles'
import OwnerSchedule from './pages/owner/Schedule'
import OwnerUsers from './pages/owner/Users'
import TodayAbsent from './pages/owner/TodayAbsent'
import AppearanceSettings from './pages/settings/Appearance'
import TeacherDashboard from './pages/teacher/Dashboard'
import TeacherGroups from './pages/teacher/Groups'
import TeacherAttendance from './pages/teacher/Attendance'
import TeacherSchedule from './pages/teacher/Schedule'

export default function App() {
  return (
    <AuthProvider>
      <DataProvider>
        <NotificationProvider>
        <Routes>
          <Route path="/login" element={<Login />} />

          <Route element={<AuthGuard allowedRoles={['owner']} />}>
            <Route path="/owner" element={<AppShell role="owner" />}>
              <Route index element={<OwnerDashboard />} />
              <Route path="groups" element={<AdminGroups />} />
              <Route path="teachers" element={<AdminTeachers />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="schedule" element={<OwnerSchedule />} />
              <Route path="finance" element={<OwnerFinance />} />
              <Route path="finance/paid" element={<OwnerPaid />} />
              <Route path="finance/debtors" element={<OwnerDebtors />} />
              <Route path="attendance/absent-today" element={<TodayAbsent />} />
              <Route path="notifications" element={<OwnerNotifications />} />
              <Route path="settings/appearance" element={<Navigate to="/owner/settings/fon" replace />} />
              <Route path="settings/fon" element={<AppearanceSettings />} />
              <Route path="settings/account" element={<OwnerAccountSettings />} />
              <Route path="settings/staff" element={<OwnerUsers />} />
              <Route path="settings/roles" element={<OwnerRoles />} />
              <Route path="users" element={<Navigate to="/owner/settings/staff" replace />} />
              <Route path="expenses" element={<Navigate to="/owner/finance" replace />} />
              <Route path="admins" element={<Navigate to="/owner/settings/staff" replace />} />
            </Route>
          </Route>

          <Route element={<AuthGuard allowedRoles={['admin']} />}>
            <Route path="/admin" element={<AppShell role="admin" />}>
              <Route index element={<OwnerDashboard />} />
              <Route path="groups" element={<AdminGroups />} />
              <Route path="teachers" element={<AdminTeachers />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="schedule" element={<OwnerSchedule />} />
              <Route path="finance" element={<OwnerFinance />} />
              <Route path="finance/paid" element={<OwnerPaid />} />
              <Route path="finance/debtors" element={<OwnerDebtors />} />
              <Route path="attendance/absent-today" element={<TodayAbsent />} />
              <Route path="notifications" element={<OwnerNotifications />} />
              <Route path="settings/appearance" element={<Navigate to="/admin/settings/fon" replace />} />
              <Route path="settings/fon" element={<AppearanceSettings />} />
              <Route path="settings/staff" element={<OwnerUsers />} />
              <Route path="settings/roles" element={<OwnerRoles />} />
              <Route path="payments" element={<Navigate to="/admin/finance/debtors" replace />} />
              <Route path="attendance" element={<Navigate to="/admin" replace />} />
              <Route path="expenses" element={<Navigate to="/admin/finance" replace />} />
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
        </NotificationProvider>
      </DataProvider>
    </AuthProvider>
  )
}
