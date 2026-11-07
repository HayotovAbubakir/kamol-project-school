import { Navigate, Outlet } from 'react-router-dom'
import AppLoader from './AppLoader'
import LiveBackground from './atmosphere/LiveBackground'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useLanguage } from '../context/LanguageContext'
import { canAccessPage } from '../../shared/role-permissions.js'
import { useLocation } from 'react-router-dom'

function routePermission(pathname) {
  const section = pathname.split('/').filter(Boolean)
  if (!section.length) return 'owner'
  if (section[0] === 'owner') return 'owner'
  if (section[0] === 'reception') {
    if (section.includes('finance')) return 'finance'
    if (section.includes('settings') && section.includes('staff')) return 'staff'
    if (section.includes('settings') && section.includes('roles')) return 'roles'
    return section[1] || 'reception'
  }
  if (section[0] === 'teacher') return section[1] || 'teacher'
  return 'website'
}

export default function AuthGuard({ allowedRoles }) {
  const { user, ready, configError } = useAuth()
  const { loading, error, initialized } = useData()
  const { t } = useLanguage()
  const { pathname } = useLocation()

  if (!ready) {
    return <AppLoader />
  }

  if (configError) {
    return <Navigate to="/login" replace />
  }

  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={['owner', 'reception', 'teacher'].includes(user.role) ? `/${user.role}` : '/login'} replace />
  }
  if (!canAccessPage(user.role, routePermission(pathname))) {
    return <Navigate to={['owner', 'reception', 'teacher'].includes(user.role) ? `/${user.role}` : '/login'} replace />
  }

  if (!initialized) {
    return <AppLoader />
  }

  if (error && !loading) {
    return (
      <div className="login-page">
        <LiveBackground />
        <div className="login-card-neon" style={{ maxWidth: 480, minHeight: 'auto' }}>
          <div className="login-card-form">
            <h1 className="login-title">{t('shared.errorTitle')}</h1>
            <div className="login-error">{error}</div>
          </div>
        </div>
      </div>
    )
  }

  return <Outlet />
}
