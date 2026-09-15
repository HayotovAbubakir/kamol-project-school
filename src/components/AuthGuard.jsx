import { Navigate, Outlet } from 'react-router-dom'
import AppLoader from './AppLoader'
import LiveBackground from './atmosphere/LiveBackground'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useLanguage } from '../context/LanguageContext'

export default function AuthGuard({ allowedRoles }) {
  const { user, ready, configError } = useAuth()
  const { loading, error, initialized } = useData()
  const { t } = useLanguage()

  if (!ready) {
    return <AppLoader />
  }

  if (configError) {
    return <Navigate to="/login" replace />
  }

  if (!user) return <Navigate to="/login" replace />
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to={`/${user.role}`} replace />
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
