import { Eye, EyeOff, KeyRound, Pencil, Plus, Trash2, UserCog } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import PhoneInput from '../../components/PhoneInput'
import { PageEnter } from '../../components/motion/PageMotion'
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
import { useAuth } from '../../context/AuthContext'
import { formatPhone, joinPersonName, splitPersonName } from '../../lib/utils'
import { isCompletePhone, isEmptyPhone, phoneFieldState } from '../../lib/phone'
import { matchesSearch, teacherSearchFields } from '../../lib/search'
import { groupsForTeacher } from '../../lib/store'
import { MIN_PASSWORD_LENGTH } from '../../lib/cloudflare'
import { staff as staffAccounts } from '../../lib/data/index.js'
import { loginBaseFromName } from '../../../shared/account-credentials.js'
import { translate as tr } from '../../i18n/runtime'

const emptyForm = () => ({ firstName: '', lastName: '', phone: '', username: '', password: '', autoUsername: true })

export default function AdminTeachers() {
  const { data, deleteTeacher } = useData()
  const { user } = useAuth()
  const canManageStaff = user?.role === 'owner'
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
      autoUsername: false,
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
      if (editingId) {
        const linked = linkedLogins.find((item) => item.teacherId === editingId)
        if (linked) {
          await staffAccounts.update(linked.id, {
            ...payload,
            username: username || linked.username,
            role: 'teacher',
            ...(password ? { password } : {}),
          })
        } else {
          if (password.length < MIN_PASSWORD_LENGTH) throw new Error(t('domain.error.passwordTooShort'))
          await staffAccounts.create({
            ...payload,
            username,
            auto_username: form.autoUsername,
            password,
            role: 'teacher',
            teacher_id: editingId,
            monthly_salary: data.teachers.find((teacher) => teacher.id === editingId)?.monthlySalary || 0,
          })
        }
      } else {
        if (password.length < MIN_PASSWORD_LENGTH) throw new Error(t('domain.error.passwordTooShort'))
        await staffAccounts.create({
          ...payload,
          username,
          auto_username: form.autoUsername,
          password,
          role: 'teacher',
        })
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
          {canManageStaff && <button
            type="button"
            className="btn-icon-danger master-detail-delete"
            onClick={() => remove(selected)}
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={15} />
          </button>}
        </div>

        <div className="detail-meta-grid detail-meta-grid-2">
          <div className="detail-meta-item"><span>{t('admin.label.groups')}</span><strong>{groups.length}</strong></div>
          {canManageStaff && <div className="detail-meta-item"><span>{t('common.login')}</span><strong>{login ? `@${login.username}` : t('admin.teacher.loginUnassigned')}</strong></div>}
        </div>

        {canManageStaff && <div className="page-header-actions" style={{ marginBottom: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(selected)}>
            <Pencil size={14} /> {t('common.edit')}
          </button>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => openEdit(selected)}
            disabled={!login}
          >
            <KeyRound size={14} /> {tr('Parolni tiklash')}
          </button>
        </div>}

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
        actions={canManageStaff ? (
          <GlowButton className="btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t('admin.action.addTeacher')}
          </GlowButton>
        ) : null}
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

      {canManageStaff && <Modal
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
                <input className="input" value={form.firstName} onChange={(e) => setForm((current) => ({ ...current, firstName: e.target.value, username: current.autoUsername ? loginBaseFromName(joinPersonName(e.target.value, current.lastName)) : current.username }))} required />
              </div>
              <div className="field">
                <label>{t('common.lastName')}</label>
                <input className="input" value={form.lastName} onChange={(e) => setForm((current) => ({ ...current, lastName: e.target.value, username: current.autoUsername ? loginBaseFromName(joinPersonName(current.firstName, e.target.value)) : current.username }))} required />
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
                onChange={(e) => setForm({ ...form, username: e.target.value, autoUsername: false })}
              />
              <small>Ism.familiya — lotin harflarida; band bo‘lsa avtomatik raqam qo‘shiladi.</small>
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
      </Modal>}
    </PageEnter>
  )
}
