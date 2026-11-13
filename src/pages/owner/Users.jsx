import { KeyRound, Pencil, Plus, Shield } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Select from '../../components/Select'
import { PageEnter } from '../../components/motion/PageMotion'
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
import { staff as staffAccounts } from '../../lib/data/index.js'
import { useDialog } from '../../context/DialogContext'
import { loginBaseFromName } from '../../../shared/account-credentials.js'
import { translate as tr } from '../../i18n/runtime'

export default function OwnerUsers() {
  const { refresh } = useData()
  const { alert } = useDialog()
  const { t } = useLanguage()
  const [staffUsers, setStaffUsers] = useState([])
  const [autoUsername, setAutoUsername] = useState(true)
  const receptionUsers = useMemo(() => staffUsers, [staffUsers])
  const [selectedId, setSelectedId] = useState(null)
  const [receptionOpen, setReceptionOpen] = useState(false)
  const [receptionForm, setReceptionForm] = useState({ name: '', phone: '', role: 'reception', username: '', password: '' })
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const selected = receptionUsers.find((user) => user.id === selectedId) ?? null

  useEffect(() => {
    let active = true
    staffAccounts.list().then((rows) => {
      if (active) setStaffUsers(rows)
    }).catch((loadError) => {
      if (active) setError(loadError.message || 'Xodimlarni yuklab bo‘lmadi.')
    })
    return () => { active = false }
  }, [])

  const reloadStaff = async () => {
    setStaffUsers(await staffAccounts.list())
    await refresh()
  }

  const resetAdminPassword = async () => {
    if (!selected) return
    setEditingId(selected.id)
    setAutoUsername(false)
    setReceptionForm({ name: selected.name, phone: selected.phone || '', role: selected.role, username: selected.username, password: '' })
    setError('')
    setReceptionOpen(true)
  }

  const submitAdmin = async (e) => {
    e.preventDefault()
    const username = receptionForm.username.trim()
    const password = receptionForm.password
    if (!autoUsername && staffUsers.some((u) => u.username.toLowerCase() === username.toLowerCase() && u.id !== editingId)) {
      setError(t('owner.users.usernameTaken'))
      return
    }
    if ((!editingId || password) && password.length < 12) {
      setError(tr('Xodim paroli kamida 12 belgidan iborat bo‘lishi kerak.'))
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await staffAccounts.update(editingId, {
          name: receptionForm.name.trim(),
          phone: receptionForm.phone.trim(),
          username,
          role: receptionForm.role,
          ...(password ? { password } : {}),
        })
      } else {
        await staffAccounts.create({
          name: receptionForm.name.trim(),
          phone: receptionForm.phone.trim(),
          role: receptionForm.role,
          username,
          auto_username: autoUsername,
          password,
        })
      }
      await reloadStaff()
      setReceptionForm({ name: '', phone: '', role: 'reception', username: '', password: '' })
      setEditingId(null)
      setAutoUsername(true)
      setError('')
      setReceptionOpen(false)
    } catch (err) {
      setError(err.message || 'Xodim akkauntini saqlab bo‘lmadi.')
      setReceptionForm((prev) => ({ ...prev, password: '' }))
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
          <div className="master-detail-head-main">
            <h2>{selected.name}</h2>
            <p>@{selected.username}</p>
          </div>
          <StatusBadge tone={selected.is_active ? 'success' : 'danger'}>{selected.is_active ? tr('Faol') : tr('Nofaol')}</StatusBadge>
        </div>
        <div className="detail-meta-grid">
          <div className="detail-meta-item"><span>{t('common.login')}</span><strong>{selected.username}</strong></div>
          <div className="detail-meta-item"><span>{t('owner.users.role')}</span><strong>{selected.role === 'teacher' ? tr('O‘qituvchi') : tr('Qabulxona')}</strong></div>
          <div className="detail-meta-item"><span>{tr('Telefon')}</span><strong>{selected.phone || '—'}</strong></div>
        </div>
        <div className="detail-actions">
        <GlowButton
          className="btn-outline btn-sm"
          onClick={() => {
            setEditingId(selected.id)
            setReceptionForm({
              name: selected.name,
              phone: selected.phone || '',
              role: selected.role,
              username: selected.username,
              password: '',
            })
            setReceptionOpen(true)
          }}
        >
          <Pencil size={14} /> {tr('Tahrirlash')}
        </GlowButton>
        <GlowButton
        className="btn-outline btn-sm"
        onClick={resetAdminPassword}
        >
        <KeyRound size={14} /> {tr('Parolni tiklash')}
        </GlowButton>
        <GlowButton
          className="btn-danger btn-sm detail-actions-end"
          onClick={async () => {
            try {
              await staffAccounts.update(selected.id, { is_active: !selected.is_active })
              await reloadStaff()
            } catch (err) {
              await alert({ message: err.message || 'Akkaunt holatini o‘zgartirib bo‘lmadi.', tone: 'danger' })
            }
          }}
        >
          {selected.is_active ? tr('Akkauntni faolsizlantirish') : tr('Akkauntni faollashtirish')}
        </GlowButton>
        </div>
      </>
    )
  }

  return (
    <PageEnter>
      <PageHeader
        title={tr('Xodimlar')}
        subtitle={tr('Qabulxona va o‘qituvchi akkauntlarini boshqarish')}
        actions={
          <GlowButton
            className="btn-primary"
            onClick={() => {
              setError('')
              setEditingId(null)
              setAutoUsername(true)
              setReceptionForm({ name: '', phone: '', role: 'reception', username: '', password: '' })
              setReceptionOpen(true)
            }}
          >
          <Plus size={16} /> {tr('Xodim qo‘shish')}
          </GlowButton>
        }
      />

      <div className="stat-grid">
        <StatCard label={tr('Xodim akkauntlari')} value={receptionUsers.length} icon={Shield} tone="success" />
      </div>

      {receptionUsers.length > 0 ? (
        <MasterDetail
          list={(
            <>
              {receptionUsers.map((receptionUser) => (
                <MasterListItem
                  key={receptionUser.id}
                  active={selectedId === receptionUser.id}
                  avatar={<Avatar name={receptionUser.name} size="sm" />}
                  title={receptionUser.name}
                  subtitle={`@${receptionUser.username}`}
                  badge={<StatusBadge tone={receptionUser.is_active ? 'success' : 'danger'}>{receptionUser.is_active ? tr('Faol') : tr('Nofaol')}</StatusBadge>}
                  onClick={() => setSelectedId(receptionUser.id)}
                />
              ))}
            </>
          )}
          detail={renderDetail()}
        />
      ) : (
            <div className="master-detail-empty">{tr('Xodim akkauntlari yo‘q.')}</div>
      )}

      <Modal
        open={receptionOpen}
        title={editingId ? tr('Xodim ma’lumotlarini tahrirlash') : tr('Xodim akkaunti')}
        onClose={() => {
          setReceptionOpen(false)
          setEditingId(null)
          setAutoUsername(true)
        }}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => { setReceptionOpen(false); setEditingId(null); setAutoUsername(true) }}>{t('common.cancel')}</button>
            <button type="submit" form="reception-form" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        )}
      >
        {error ? <div className="alert alert-error">{error}</div> : null}
        <form id="reception-form" onSubmit={submitAdmin} className="entity-form">
          <div className="field">
            <label>{t('common.name')}</label>
            <input className="input" value={receptionForm.name} onChange={(e) => setReceptionForm((current) => ({ ...current, name: e.target.value, username: autoUsername ? loginBaseFromName(e.target.value) : current.username }))} required />
          </div>
          <div className="field">
            <label>{tr('Telefon')}</label>
            <input className="input" type="tel" value={receptionForm.phone} onChange={(e) => setReceptionForm({ ...receptionForm, phone: e.target.value })} />
          </div>
          <div className="field">
            <label>{tr('Rol')}</label>
            <Select
              aria-label={tr('Rol')}
              value={receptionForm.role}
              onChange={(e) => setReceptionForm({ ...receptionForm, role: e.target.value })}
              options={[
                { value: 'reception', label: tr('Qabulxona') },
                { value: 'teacher', label: tr('O‘qituvchi') },
              ]}
            />
          </div>
          <div className="field">
            <label>{t('common.login')}</label>
            <input className="input" value={receptionForm.username} onChange={(e) => { setAutoUsername(false); setReceptionForm({ ...receptionForm, username: e.target.value }) }} required />
            <small>Ism.familiya — lotin harflarida; band bo‘lsa avtomatik raqam qo‘shiladi.</small>
          </div>
          <div className="field">
            <label>{editingId ? tr('Yangi parol (ixtiyoriy)') : `${t('common.password')} (kamida 12 belgi)`}</label>
            <input
              type="password"
              className="input"
              value={receptionForm.password}
              onChange={(e) => setReceptionForm({ ...receptionForm, password: e.target.value })}
              autoComplete="new-password"
              required={!editingId}
              minLength={editingId && !receptionForm.password ? undefined : 12}
            />
          </div>
        </form>
      </Modal>
    </PageEnter>
  )
}
