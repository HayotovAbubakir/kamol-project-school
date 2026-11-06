import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, UserCog } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import PhoneInput from '../../components/PhoneInput'
import { PageEnter } from '../../components/motion/PageMotion'
import TemporaryCredentialsModal from '../../components/TemporaryCredentialsModal'
import {
  Avatar,
  GlowButton,
  ListSearch,
  MasterDetail,
  MasterListItem,
  Modal,
  PageHeader,
  StatCard,
  StatusBadge,
} from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useDialog } from '../../context/DialogContext'
import { useLanguage } from '../../context/LanguageContext'
import { formatPhone, joinPersonName, splitPersonName } from '../../lib/utils'
import { isCompletePhone, isEmptyPhone, phoneFieldState } from '../../lib/phone'
import { matchesSearch, teacherSearchFields } from '../../lib/search'
import { groupsForTeacher } from '../../lib/store'
import { MIN_PASSWORD_LENGTH } from '../../lib/cloudflare'
import { resetUserCredentials } from '../../lib/api'

const emptyForm = () => ({ firstName: '', lastName: '', phone: '', username: '', password: '' })

export default function AdminTeachers() {
  const { data, addTeacher, updateTeacher, deleteTeacher } = useData()
  const { confirm, alert } = useDialog()
  const { t } = useLanguage()
  const [selectedId, setSelectedId] = useState(null)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [hasLinkedLogin, setHasLinkedLogin] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [search, setSearch] = useState('')
  const [temporaryCredentials, setTemporaryCredentials] = useState(null)
  const [resettingPassword, setResettingPassword] = useState(false)

  const linkedLogins = data.users.filter((u) => u.role === 'teacher')

  const filteredTeachers = useMemo(
    () => data.teachers.filter((teacher) => matchesSearch(search, teacherSearchFields(teacher, data.users))),
    [data.teachers, data.users, search],
  )

  useEffect(() => {
    if (!search.trim()) return
    if (!filteredTeachers.length) return
    if (!filteredTeachers.some((teacher) => teacher.id === selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(filteredTeachers[0].id)
    }
  }, [search, filteredTeachers, selectedId])

  const selected = data.teachers.find((t) => t.id === selectedId) ?? filteredTeachers[0] ?? null

  const openCreate = () => {
    setEditingId(null)
    setError('')
    setHasLinkedLogin(false)
    setShowPassword(false)
    setForm(emptyForm())
    setOpen(true)
  }

  const openEdit = (teacher) => {
    setEditingId(teacher.id)
    setError('')
    setShowPassword(false)
    const { firstName, lastName } = splitPersonName(teacher.name)
    const login = linkedLogins.find((u) => u.teacherId === teacher.id)
    setHasLinkedLogin(Boolean(login))
    setForm({
      firstName,
      lastName,
      phone: teacher.phone || '',
      username: login?.username || '',
      password: '',
    })
    setOpen(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    if (!firstName || !lastName) {
      setError(t('domain.error.teacherNameRequired'))
      return
    }
    if (isEmptyPhone(form.phone)) {
      setError(t('domain.error.phoneRequired'))
      return
    }
    if (!isCompletePhone(form.phone)) {
      setError(t('domain.error.phoneIncomplete'))
      return
    }

    const username = form.username.trim()
    const password = form.password
    if ((username && !password && !hasLinkedLogin) || (!username && password && !hasLinkedLogin)) {
      setError(t('domain.error.credentialsRequired'))
      return
    }
    if (password && password.length < MIN_PASSWORD_LENGTH) {
      setError(t('domain.error.passwordTooShort'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: joinPersonName(firstName, lastName),
        phone: form.phone,
      }
      if (username) payload.username = username
      if (password) payload.password = password

      if (editingId) {
        await updateTeacher(editingId, payload)
      } else {
        const created = await addTeacher(payload)
        if (created?.id) setSelectedId(created.id)
        if (created?.loginError) {
          setForm(emptyForm())
          setOpen(false)
          setEditingId(null)
          await alert({ message: created.loginError })
          return
        }
      }
      setForm(emptyForm())
      setOpen(false)
      setEditingId(null)
      setHasLinkedLogin(false)
    } catch (err) {
      setError(err.message || t('admin.error.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (teacher) => {
    const ok = await confirm({
      message: t('admin.confirm.delete', { name: teacher.name }),
      confirmLabel: t('dialog.yesDelete'),
      tone: 'danger',
      delaySeconds: 5,
    })
    if (!ok) return
    try {
      await deleteTeacher(teacher.id)
      setSelectedId(null)
    } catch (err) {
      await alert({ message: err.message || t('admin.error.deleteFailed'), tone: 'danger' })
    }
  }

  const resetTeacherPassword = async (user) => {
    if (!user || resettingPassword) return
    setResettingPassword(true)
    try {
      setTemporaryCredentials(await resetUserCredentials(user))
    } catch (err) {
      await alert({ message: err.message || 'Vaqtinchalik parolni o‘rnatib bo‘lmadi.', tone: 'danger' })
    } finally {
      setResettingPassword(false)
    }
  }

  const renderDetail = () => {
    if (!selected) {
      return <div className="master-detail-empty">{t('admin.teacher.select')}</div>
    }

    const groups = groupsForTeacher(data.groups, selected.id)
    const login = linkedLogins.find((u) => u.teacherId === selected.id)

    return (
      <>
        <div className="master-detail-head">
          <Avatar name={selected.name} />
          <div className="master-detail-head-main">
            <h2>{selected.name}</h2>
            <p>{selected.phone ? formatPhone(selected.phone) : t('admin.student.phoneMissing')}</p>
          </div>
          <StatusBadge tone="success">{t('admin.teacher.countGroups', { count: groups.length })}</StatusBadge>
          <button
            type="button"
            className="btn-icon-danger master-detail-delete"
            onClick={() => remove(selected)}
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={15} />
          </button>
        </div>

        <div className="detail-meta-grid detail-meta-grid-2">
          <div className="detail-meta-item"><span>{t('admin.label.groups')}</span><strong>{groups.length}</strong></div>
          <div className="detail-meta-item"><span>{t('common.login')}</span><strong>{login ? `@${login.username}` : t('admin.teacher.loginUnassigned')}</strong></div>
        </div>

        <div className="page-header-actions" style={{ marginBottom: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(selected)}>
            <Pencil size={14} /> {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => resetTeacherPassword(login)}
            disabled={!login || resettingPassword}
          >
            <KeyRound size={14} /> {resettingPassword ? 'Tayyorlanmoqda…' : 'Vaqtinchalik parol'}
          </button>
        </div>

        <div className="card">
          <div className="card-header"><strong>{t('admin.label.groups')}</strong></div>
          {groups.length === 0 ? (
            <div className="master-detail-empty" style={{ minHeight: 80, padding: 16 }}>{t('admin.group.noGroupsAssigned')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id}>
                      <td>{g.name}</td>
                      <td>{t('admin.student.count', { count: g.studentIds.length })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <GlowButton className="btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t('admin.action.addTeacher')}
          </GlowButton>
        }
      />

      <div className="stat-grid stat-grid-2">
        <StatCard label={t('admin.label.teachers')} value={data.teachers.length} icon={UserCog} tone="info" />
        <StatCard label={t('admin.label.groups')} value={data.groups.length} icon={UserCog} tone="default" />
      </div>

      {data.teachers.length > 0 && (
        <MasterDetail
          list={(
            <>
              <ListSearch
                value={search}
                onChange={setSearch}
                placeholder={t('admin.search.teachers')}
              />
              {filteredTeachers.length === 0 ? (
                <div className="master-list-empty">{t('common.searchNoResults')}</div>
              ) : (
                filteredTeachers.map((teacher) => {
                  const groups = groupsForTeacher(data.groups, teacher.id)
                  const active = (selectedId ?? filteredTeachers[0]?.id) === teacher.id
                  return (
                    <MasterListItem
                      key={teacher.id}
                      active={active}
                      avatar={<Avatar name={teacher.name} size="sm" />}
                      title={teacher.name}
                      subtitle={teacher.phone ? formatPhone(teacher.phone) : t('admin.student.noPhone')}
                      badge={<StatusBadge tone="success">{t('admin.teacher.countGroups', { count: groups.length })}</StatusBadge>}
                      onClick={() => setSelectedId(teacher.id)}
                    />
                  )
                })
              )}
            </>
          )}
          detail={renderDetail()}
        />
      )}

      <Modal
        open={open}
        title={editingId ? t('admin.modal.editTeacher') : t('admin.modal.newTeacher')}
        onClose={() => setOpen(false)}
        size="lg"
        actions={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="teacher-form" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="teacher-form" onSubmit={submit} className="entity-form">
          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.form.personal')}</strong>
            </header>
            <div className="form-grid-2">
              <div className="field">
                <label>{t('common.name')}</label>
                <input className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
              </div>
              <div className="field">
                <label>{t('common.lastName')}</label>
                <input className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
              </div>
            </div>
            <div className="field">
              <label>{t('common.phone')}</label>
              <PhoneInput
                value={form.phone}
                onChange={(phone) => setForm({ ...form, phone })}
                invalid={phoneFieldState(form.phone) === 'incomplete' || (Boolean(error) && isEmptyPhone(form.phone))}
              />
            </div>
          </section>
          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.form.account')}</strong>
            </header>
            <div className="field">
              <label>{t('common.login')}</label>
              <input
                className="input"
                value={form.username}
                autoComplete="off"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div className="field">
              <label>{t('common.password')}</label>
              <div className="login-pass-row">
                <input
                  type={showPassword ? 'text' : 'password'}
                  className="input"
                  value={form.password}
                  autoComplete="new-password"
                  minLength={hasLinkedLogin ? undefined : MIN_PASSWORD_LENGTH}
                  placeholder={hasLinkedLogin ? t('admin.teacher.newPasswordOptional') : ''}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
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
          </section>
        </form>
      </Modal>
      <TemporaryCredentialsModal
        credentials={temporaryCredentials}
        onClose={() => setTemporaryCredentials(null)}
        subject="O‘qituvchi"
      />
    </PageEnter>
  )
}
