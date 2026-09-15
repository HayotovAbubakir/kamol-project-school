import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import GlassPane from '../../components/GlassPane'
import { PageEnter } from '../../components/motion/PageMotion'
import { useAuth } from '../../context/AuthContext'
import { useLanguage } from '../../context/LanguageContext'
import { updateOwnCredentials } from '../../lib/api'
import { MIN_PASSWORD_LENGTH, normalizeUsername } from '../../lib/supabase'

export default function OwnerAccountSettings() {
  const { user, setUser } = useAuth()
  const { t } = useLanguage()
  const [username, setUsername] = useState(user?.username || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setUsername(user?.username || '')
  }, [user?.username])

  if (user?.role !== 'owner') {
    return <Navigate to="/owner" replace />
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    const nextLogin = normalizeUsername(username)
    if (!nextLogin || nextLogin.length < 2) {
      setError(t('domain.error.loginInvalid'))
      return
    }

    const wantsPassword = Boolean(password || confirm)
    if (wantsPassword) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(t('domain.error.passwordTooShort'))
        return
      }
      if (password !== confirm) {
        setError(t('owner.account.passwordMismatch'))
        return
      }
    }

    const loginChanged = nextLogin !== String(user.username || '').toLowerCase()
    if (!loginChanged && !wantsPassword) {
      setError(t('owner.account.nothingToSave'))
      return
    }

    setSaving(true)
    try {
      const updated = await updateOwnCredentials({
        username: nextLogin,
        password: wantsPassword ? password : '',
      })
      if (typeof setUser === 'function') {
        setUser((prev) => (prev ? { ...prev, username: updated.username } : prev))
      }
      setPassword('')
      setConfirm('')
      setSuccess(t('owner.account.saved'))
    } catch (err) {
      setError(err.message || t('owner.account.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageEnter>
      <GlassPane className="card wallpaper-card" radius={22}>
        <section className="appearance-section">
          <h2 className="appearance-title appearance-title-with-icon">
            <KeyRound size={18} />
            {t('owner.account.title')}
          </h2>
          <p className="appearance-hint">{t('owner.account.hint')}</p>

          {error ? <div className="alert alert-error">{error}</div> : null}
          {success ? <div className="alert alert-success">{success}</div> : null}

          <form className="entity-form account-credentials-form" onSubmit={submit}>
            <div className="field">
              <label htmlFor="owner-login">{t('common.login')}</label>
              <input
                id="owner-login"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </div>

            <div className="field">
              <label htmlFor="owner-password">{t('owner.account.newPassword')}</label>
              <div className="login-pass-row">
                <input
                  id="owner-password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder={t('owner.account.passwordOptional')}
                />
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? t('login.hidePassword') : t('login.showPassword')}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="owner-password-confirm">{t('owner.account.confirmPassword')}</label>
              <input
                id="owner-password-confirm"
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                placeholder={t('owner.account.passwordOptional')}
              />
            </div>

            <div className="page-header-actions" style={{ marginTop: 4 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        </section>
      </GlassPane>
    </PageEnter>
  )
}
