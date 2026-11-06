import { KeyRound, Plus, Shield, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageEnter } from '../../components/motion/PageMotion'
import TemporaryCredentialsModal from '../../components/TemporaryCredentialsModal'
import {
  Avatar,
  GlowButton,
  MasterDetail,
  MasterListItem,
  Modal,
  PageHeader,
  StatCard,
  StatusBadge,
} from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { MIN_PASSWORD_LENGTH } from '../../lib/cloudflare'
import { resetUserCredentials } from '../../lib/api'
import { useDialog } from '../../context/DialogContext'

export default function OwnerUsers() {
  const { data, addAdminUser, removeAdminUser } = useData()
  const { alert } = useDialog()
  const { t } = useLanguage()
  const admins = useMemo(() => data.users.filter((u) => u.role === 'admin'), [data.users])
  const [selectedId, setSelectedId] = useState(null)
  const [adminOpen, setAdminOpen] = useState(false)
  const [adminForm, setAdminForm] = useState({ name: '', username: '', password: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [resettingPassword, setResettingPassword] = useState(false)
  const [temporaryCredentials, setTemporaryCredentials] = useState(null)

  const selected = admins.find((a) => a.id === selectedId) ?? null

  const resetAdminPassword = async () => {
    if (!selected || resettingPassword) return
    setResettingPassword(true)
    try {
      setTemporaryCredentials(await resetUserCredentials(selected))
    } catch (resetError) {
      await alert({ message: resetError.message || 'Vaqtinchalik parolni o‘rnatib bo‘lmadi.', tone: 'danger' })
    } finally {
      setResettingPassword(false)
    }
  }

  const submitAdmin = async (e) => {
    e.preventDefault()
    const username = adminForm.username.trim()
    const password = adminForm.password
    if (data.users.some((u) => u.username === username)) {
      setError(t('owner.users.usernameTaken'))
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('domain.error.passwordTooShort'))
      return
    }
    setSaving(true)
    try {
      await addAdminUser({ name: adminForm.name.trim(), username, password })
      setAdminForm({ name: '', username: '', password: '' })
      setError('')
      setAdminOpen(false)
    } catch (err) {
      setError(err.message || t('owner.users.adminFailed'))
      setAdminForm((prev) => ({ ...prev, password: '' }))
    } finally {
      setSaving(false)
    }
  }

  const renderDetail = () => {
    if (!selected) {
      return <div className="master-detail-empty">{t('owner.users.select')}</div>
    }

    return (
      <>
        <div className="master-detail-head">
          <Avatar name={selected.name} />
          <div>
            <h2>{selected.name}</h2>
            <p>@{selected.username}</p>
          </div>
          <StatusBadge tone="success">{t('role.admin')}</StatusBadge>
        </div>
        <div className="detail-meta-grid">
          <div className="detail-meta-item"><span>{t('common.login')}</span><strong>{selected.username}</strong></div>
          <div className="detail-meta-item"><span>{t('owner.users.role')}</span><strong>{t('role.admin')}</strong></div>
        </div>
        <GlowButton
          className="btn-outline btn-sm"
          onClick={resetAdminPassword}
          disabled={resettingPassword}
        >
          <KeyRound size={14} /> {resettingPassword ? 'Tayyorlanmoqda…' : 'Vaqtinchalik parol'}
        </GlowButton>
        <GlowButton
          className="btn-danger btn-sm"
          onClick={async () => {
            await removeAdminUser(selected.id)
            setSelectedId(null)
          }}
        >
          <Trash2 size={14} /> {t('common.delete')}
        </GlowButton>
      </>
    )
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <GlowButton
            className="btn-primary"
            onClick={() => {
              setError('')
              setAdminOpen(true)
            }}
          >
            <Plus size={16} /> {t('owner.users.newAdmin')}
          </GlowButton>
        }
      />

      <div className="stat-grid">
        <StatCard label={t('owner.users.admins')} value={admins.length} icon={Shield} tone="success" />
      </div>

      {admins.length > 0 ? (
        <MasterDetail
          list={(
            <>
              {admins.map((admin) => (
                <MasterListItem
                  key={admin.id}
                  active={selectedId === admin.id}
                  avatar={<Avatar name={admin.name} size="sm" />}
                  title={admin.name}
                  subtitle={`@${admin.username}`}
                  badge={<StatusBadge tone="success">{t('role.admin')}</StatusBadge>}
                  onClick={() => setSelectedId(admin.id)}
                />
              ))}
            </>
          )}
          detail={renderDetail()}
        />
      ) : (
            <div className="master-detail-empty">{t('owner.users.noAdmin')}</div>
      )}

      <Modal
        open={adminOpen}
        title={t('owner.users.newAdmin')}
        onClose={() => setAdminOpen(false)}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => setAdminOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="admin-form" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        )}
      >
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form id="admin-form" onSubmit={submitAdmin} className="entity-form">
          <div className="field">
            <label>{t('common.name')}</label>
            <input className="input" value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} required />
          </div>
          <div className="field">
            <label>{t('common.login')}</label>
            <input className="input" value={adminForm.username} onChange={(e) => setAdminForm({ ...adminForm, username: e.target.value })} required />
          </div>
          <div className="field">
            <label>{t('common.password')}</label>
            <input
              type="password"
              className="input"
              value={adminForm.password}
              onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              autoComplete="new-password"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>
        </form>
      </Modal>
      <TemporaryCredentialsModal
        credentials={temporaryCredentials}
        onClose={() => setTemporaryCredentials(null)}
        subject="Admin"
      />
    </PageEnter>
  )
}
