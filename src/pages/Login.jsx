import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import AppLoader from '../components/AppLoader'
import BrandLogo from '../components/BrandLogo'
import LiveBackground from '../components/atmosphere/LiveBackground'
import { useAuth } from '../context/AuthContext'
import { useLanguage } from '../context/LanguageContext'
import { getRoleHome } from '../lib/auth'
import { MIN_PASSWORD_LENGTH } from '../lib/supabase'

export default function Login() {
  const { user, login, ready, configError } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!ready) {
    return <AppLoader />
  }

  if (configError) {
    return (
      <div className="login-page">
        <LiveBackground />
        <div className="login-card">
          <BrandLogo className="login-logo" />
          <h1 className="login-title">{t('login.configurationTitle')}</h1>
          <div className="login-error">{configError}</div>
          <p className="login-help">{t('login.configurationHelp')}</p>
        </div>
      </div>
    )
  }

  if (user) return <Navigate to={getRoleHome(user.role)} replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const nextPassword = password
    setPassword('')
    setShowPassword(false)
    try {
      if (nextPassword.length < MIN_PASSWORD_LENGTH) {
        setError(t('domain.error.passwordTooShort'))
        return
      }
      const found = await login(username.trim(), nextPassword)
      navigate(getRoleHome(found.role))
    } catch {
      setError(t('login.error.invalidCredentials'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <LiveBackground />

      <div className="login-card">
        <BrandLogo className="login-logo" />
        <h1 className="login-title">{t('login.title')}</h1>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="username">{t('common.login')}</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">{t('common.password')}</label>
            <div className="login-pass-row">
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                minLength={MIN_PASSWORD_LENGTH}
              />
              <button
                type="button"
                className="login-eye"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn btn-primary login-submit" disabled={loading}>
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
