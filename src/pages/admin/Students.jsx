import { Banknote, Copy, GraduationCap, Pencil, Plus, Trash2, Wallet, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import PhoneInput from '../../components/PhoneInput'
import MoneyInput from '../../components/MoneyInput'
import Select from '../../components/Select'
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
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useDialog } from '../../context/DialogContext'
import { useLanguage } from '../../context/LanguageContext'
import { amountPaidForMonth, isStudentDebtor, remainingFee, studentPaidForMonth } from '../../lib/store'
import { parseParentPhones, formatPhoneDisplay, isCompletePhone, isEmptyPhone, phoneFieldState } from '../../lib/phone'
import { changeStudentPassword, revealStudentPassword, unlinkStudentTelegram } from '../../lib/api'
import { matchesSearch, studentSearchFields } from '../../lib/search'
import { telegram } from '../../lib/data'
import { currentMonthYear, formatMoney, formatPhone, joinPersonName, splitPersonName, todayISO } from '../../lib/utils'
import { loginBaseFromName } from '../../../shared/account-credentials.js'

const emptyForm = () => ({
  firstName: '',
  lastName: '',
  username: '',
  autoUsername: true,
  password: '',
  phone: '',
  fatherPhone: '',
  motherPhone: '',
  groupIds: [],
})

export default function AdminStudents() {
  const { data, addStudent, updateStudent, deleteStudent, addPayment, updatePayment, deletePayment } = useData()
  const { user } = useAuth()
  const { confirm, alert } = useDialog()
  const { t } = useLanguage()
  const [searchParams, setSearchParams] = useSearchParams()
  const { month, year } = currentMonthYear()
  const [selectedId, setSelectedId] = useState(() => searchParams.get('id') || null)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [editingPayment, setEditingPayment] = useState(null)
  const [inviteUrl, setInviteUrl] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [paying, setPaying] = useState(false)
  const [addGroupId, setAddGroupId] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  const [search, setSearch] = useState('')
  const [revealedPassword, setRevealedPassword] = useState('')
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ username: '', password: '' })
  const passwordTimer = useRef(null)

  const paidCount = useMemo(
    () => data.students.filter((s) => {
      const fee = Number(s.monthlyFee) || 0
      if (fee <= 0) return false
      return studentPaidForMonth(data.payments, s.id, month, year, fee)
    }).length,
    [data.students, data.payments, month, year],
  )
  const debtorCount = useMemo(
    () => data.students.filter((s) => isStudentDebtor(data.payments, s.id, month, year, s.monthlyFee)).length,
    [data.students, data.payments, month, year],
  )

  const filteredStudents = useMemo(
    () => data.students.filter((s) => matchesSearch(search, studentSearchFields(s, data.groups))),
    [data.students, data.groups, search],
  )

  useEffect(() => {
    if (!search.trim()) return
    if (!filteredStudents.length) return
    if (!filteredStudents.some((s) => s.id === selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(filteredStudents[0].id)
    }
  }, [search, filteredStudents, selectedId])

  const selected = data.students.find((s) => s.id === selectedId) ?? filteredStudents[0] ?? null
  const selectedDue = selected ? remainingFee(selected, data.payments, month, year) : 0

  async function revealPassword() {
    if (!selected) return
    try {
      const password = await revealStudentPassword(selected.id)
      setRevealedPassword(password)
      if (passwordTimer.current) window.clearTimeout(passwordTimer.current)
      passwordTimer.current = window.setTimeout(() => setRevealedPassword(''), 8000)
    } catch (revealError) {
      await alert({ message: revealError.message || 'Parolni ko‘rsatib bo‘lmadi.', tone: 'danger' })
    }
  }

  async function saveStudentPassword(event) {
    event.preventDefault()
    if (!selected) return
    try {
      await changeStudentPassword(selected.id, passwordForm)
      setPasswordOpen(false)
      setPasswordForm({ username: selected.username || '', password: '' })
      setRevealedPassword('')
      await alert({ message: 'O‘quvchi login va paroli yangilandi.' })
    } catch (passwordError) {
      setError(passwordError.message || 'Parolni o‘zgartirib bo‘lmadi.')
    }
  }

  async function unlinkTelegram() {
    if (!selected) return
    const confirmed = await confirm({ message: 'O‘quvchining Telegram akkauntini uzmoqchimisiz?', confirmLabel: 'Telegramdan uzish', tone: 'danger' })
    if (!confirmed) return
    try {
      await unlinkStudentTelegram(selected.id)
      await alert({ message: 'Telegram akkaunti uzildi.' })
    } catch (unlinkError) {
      await alert({ message: unlinkError.message || 'Telegram akkauntini uzib bo‘lmadi.', tone: 'danger' })
    }
  }

  useEffect(() => {
    const fromQuery = searchParams.get('id')
    if (!fromQuery) return
    if (!data.students.length) return
    if (data.students.some((s) => s.id === fromQuery)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(fromQuery)
    }
    const next = new URLSearchParams(searchParams)
    next.delete('id')
    setSearchParams(next, { replace: true })
  }, [searchParams, data.students, setSearchParams])

  useEffect(() => {
    if (!payOpen || !selected) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPayAmount(String(Math.max(0, Math.round(editingPayment?.amount ?? selectedDue))))
  }, [payOpen, selected, selectedDue, editingPayment])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAddGroupId('')
    setCodeCopied(false)
    setRevealedPassword('')
    if (passwordTimer.current) window.clearTimeout(passwordTimer.current)
  }, [selected?.id])

  useEffect(() => () => {
    if (passwordTimer.current) window.clearTimeout(passwordTimer.current)
  }, [])

  const copyStudentCode = async () => {
    if (!selected?.publicCode) return
    try {
      await navigator.clipboard.writeText(selected.publicCode)
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const issueTelegramInvite = async () => {
    if (!selected || inviteBusy) return
    setInviteBusy(true)
    setError('')
    try {
      const invite = await telegram.createInvite({ studentId: selected.id })
      setInviteUrl(invite.invite_url)
    } catch (inviteError) {
      setError(inviteError.message || 'Telegram ulash havolasini yaratib bo‘lmadi.')
    } finally {
      setInviteBusy(false)
    }
  }

  const setStudentGroups = async (student, nextIds) => {
    setGroupBusy(true)
    try {
      await updateStudent(student.id, { groupIds: nextIds })
    } catch (err) {
      await alert({ message: err.message || t('admin.error.saveFailed'), tone: 'danger' })
    } finally {
      setGroupBusy(false)
    }
  }

  const addStudentToGroup = async (groupId) => {
    if (!selected || !groupId || groupBusy) return
    if ((selected.groupIds || []).includes(groupId)) return
    await setStudentGroups(selected, [...(selected.groupIds || []), groupId])
    setAddGroupId('')
  }

  const removeStudentFromGroup = async (groupId) => {
    if (!selected || groupBusy) return
    const group = data.groups.find((g) => g.id === groupId)
    const ok = await confirm({
      message: t('admin.confirm.removeFromGroup', {
        student: selected.name,
        group: group?.name || '—',
      }),
      confirmLabel: t('admin.group.removeStudent'),
      tone: 'danger',
      delaySeconds: 5,
    })
    if (!ok) return
    await setStudentGroups(
      selected,
      (selected.groupIds || []).filter((id) => id !== groupId),
    )
  }

  const toggleGroup = (groupId) => {
    setForm((prev) => ({
      ...prev,
      groupIds: prev.groupIds.includes(groupId)
        ? prev.groupIds.filter((id) => id !== groupId)
        : [...prev.groupIds, groupId],
    }))
  }

  const openCreate = () => {
    setEditingId(null)
    setError('')
    setForm(emptyForm())
    setOpen(true)
  }

  const openEdit = (student) => {
    const parents = parseParentPhones(student.parentPhone)
    const { firstName, lastName } = splitPersonName(student.name)
    setEditingId(student.id)
    setError('')
    setForm({
      firstName,
      lastName,
      username: student.username || '',
      autoUsername: false,
      password: '',
      phone: student.phone || '',
      fatherPhone: parents.fatherPhone,
      motherPhone: parents.motherPhone,
      groupIds: [...(student.groupIds || [])],
    })
    setOpen(true)
  }

  const openPay = () => {
    if (!selected) return
    if (selectedDue <= 0) {
      alert({ message: t('admin.payment.alreadyPaid'), tone: 'default' })
      return
    }
    setEditingPayment(null)
    setError('')
    setPayOpen(true)
  }

  const openPaymentEdit = (payment) => {
    setEditingPayment(payment)
    setError('')
    setPayOpen(true)
  }

  const removePaymentRecord = async (payment) => {
    if (user?.role !== 'owner') return
    const confirmed = await confirm({ message: 'Ushbu to‘lov yozuvini o‘chirmoqchimisiz?', confirmLabel: 'O‘chirish' })
    if (!confirmed) return
    try {
      await deletePayment(payment.id)
    } catch (deleteError) {
      await alert({ message: deleteError.message || 'To‘lovni o‘chirib bo‘lmadi.', tone: 'danger' })
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const firstName = form.firstName.trim()
    const lastName = form.lastName.trim()
    if (!firstName || !lastName) {
      setError(t('domain.error.studentNameRequired'))
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
    if (phoneFieldState(form.fatherPhone) === 'incomplete') {
      setError(t('domain.error.fatherPhoneIncomplete'))
      return
    }
    if (phoneFieldState(form.motherPhone) === 'incomplete') {
      setError(t('domain.error.motherPhoneIncomplete'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: joinPersonName(firstName, lastName),
        phone: form.phone,
        username: form.username || loginBaseFromName(joinPersonName(firstName, lastName)),
        autoUsername: form.autoUsername,
        password: form.password,
        fatherPhone: isEmptyPhone(form.fatherPhone) ? '' : form.fatherPhone,
        motherPhone: isEmptyPhone(form.motherPhone) ? '' : form.motherPhone,
        groupIds: form.groupIds,
        joinedAt: todayISO(),
      }
      if (editingId) {
        await updateStudent(editingId, payload)
      } else {
        const created = await addStudent(payload)
        if (created?.id) setSelectedId(created.id)
      }
      setForm(emptyForm())
      setOpen(false)
      setEditingId(null)
    } catch (err) {
      setError(err.message || t('admin.error.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (student) => {
    const ok = await confirm({
      message: t('admin.confirm.delete', { name: student.name }),
      confirmLabel: t('dialog.yesDelete'),
      tone: 'danger',
      delaySeconds: 5,
    })
    if (!ok) return
    try {
      await deleteStudent(student.id)
      setSelectedId(null)
    } catch (err) {
      await alert({ message: err.message || t('admin.error.deleteFailed'), tone: 'danger' })
    }
  }

  const submitPayment = async (e) => {
    e.preventDefault()
    if (!selected) return
    const amount = Number(payAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(t('admin.payment.amountInvalid'))
      return
    }
    if (!editingPayment && amount > selectedDue) {
      setError(t('admin.payment.amountTooHigh', { amount: formatMoney(selectedDue) }))
      return
    }

    setError('')
    setPaying(true)
    try {
      if (editingPayment) {
        await updatePayment(editingPayment.id, {
          amount,
          month: editingPayment.month,
          year: editingPayment.year,
          paidAt: editingPayment.paidAt,
        })
      } else {
        await addPayment({
          studentId: selected.id,
          studentName: selected.name,
          amount,
          month,
          year,
          recordedBy: user.id,
        })
      }
      setPayOpen(false)
      setEditingPayment(null)
      await alert({ message: editingPayment ? 'To‘lov yangilandi.' : t('admin.payment.success'), tone: 'default' })
    } catch (err) {
      setError(err.message || t('admin.payment.saveFailed'))
    } finally {
      setPaying(false)
    }
  }

  const renderDetail = () => {
    if (!selected) {
      return <div className="master-detail-empty">{t('admin.student.select')}</div>
    }

    const fee = Number(selected.monthlyFee) || 0
    const hasFee = fee > 0
    const paid = studentPaidForMonth(data.payments, selected.id, month, year, fee)
    const paidAmount = amountPaidForMonth(data.payments, selected.id, month, year)
    const due = remainingFee(selected, data.payments, month, year)
    const groups = (selected.groupIds || [])
      .map((id) => data.groups.find((g) => g.id === id))
      .filter(Boolean)
    const availableGroups = data.groups.filter((g) => !(selected.groupIds || []).includes(g.id))

    return (
      <>
        <div className="master-detail-head">
          <Avatar name={selected.name} />
          <div className="master-detail-head-main">
            <h2>{selected.name}</h2>
            <p>{selected.phone ? formatPhone(selected.phone) : t('admin.student.phoneMissing')}</p>
          </div>
          <StatusBadge tone={!hasFee ? 'neutral' : paid ? 'success' : paidAmount > 0 ? 'warning' : 'danger'}>
            {!hasFee
              ? t('admin.group.notAssigned')
              : paid
                ? t('admin.status.paid')
                : paidAmount > 0
                  ? t('admin.status.partial')
                  : t('admin.status.unpaid')}
          </StatusBadge>
          {user?.role === 'owner' && <button
            type="button"
            className="btn-icon-danger master-detail-delete"
            onClick={() => remove(selected)}
            aria-label={t('common.delete')}
            title={t('common.delete')}
          >
            <Trash2 size={15} />
          </button>}
        </div>

        <div className="student-detail-stack">
          <div className="student-detail-grid">
            <div className="detail-meta-item student-detail-cell-2">
              <span>{t('admin.label.monthlyFee')}</span>
              <strong>{formatMoney(selected.monthlyFee)}</strong>
            </div>
            <div className="detail-meta-item student-detail-cell-2">
              <span>{t('admin.label.paidThisMonth')}</span>
              <strong>{formatMoney(paidAmount)}</strong>
            </div>
            <div className="detail-meta-item student-detail-cell-2">
              <span>{t('admin.label.remaining')}</span>
              <strong className={due > 0 ? 'money-text money-text-danger' : ''}>{formatMoney(due)}</strong>
            </div>

            <div className="detail-meta-item student-detail-cell-6 student-detail-id">
              <span>{t('admin.label.studentId')}</span>
              <div className="student-code-row">
                <strong className="student-public-code">{selected.publicCode || '—'}</strong>
                {selected.publicCode ? (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm student-code-copy"
                    onClick={copyStudentCode}
                    title={codeCopied ? t('common.copied') : t('common.copy')}
                  >
                    <Copy size={14} />
                    {codeCopied ? t('common.copied') : t('common.copy')}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="detail-meta-item student-detail-cell-6">
              <span>Mini App login</span>
              <div className="student-code-row">
                <strong>{selected.username || '—'}</strong>
                {selected.username && <button type="button" className="btn btn-outline btn-sm" onClick={async () => {
                  try { await navigator.clipboard.writeText(selected.username) } catch (copyError) {
                    await alert({ message: copyError.message || 'Loginni nusxalab bo‘lmadi.', tone: 'danger' })
                  }
                }}><Copy size={14} /> Nusxalash</button>}
              </div>
            </div>
            <div className="detail-meta-item student-detail-cell-6">
              <span>O‘quvchi paroli</span>
              {revealedPassword
                ? <strong aria-live="polite">{revealedPassword}</strong>
                : <span>Parol yashirilgan</span>}
              <div className="student-detail-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={revealPassword}>Parolni ko‘rsatish</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => {
                  setPasswordForm({ username: selected.username || '', password: '' })
                  setError('')
                  setPasswordOpen(true)
                }}>Login / parolni o‘zgartirish</button>
              </div>
              <small>Parolni boshqa joylarda ishlatmang.</small>
            </div>

            {(() => {
              const { fatherPhone, motherPhone } = parseParentPhones(selected.parentPhone)
              return (
                <>
                  <div className="detail-meta-item student-detail-cell-3">
                    <span>{t('admin.label.fatherPhone')}</span>
                    <strong>{fatherPhone ? formatPhoneDisplay(fatherPhone) : '—'}</strong>
                  </div>
                  <div className="detail-meta-item student-detail-cell-3">
                    <span>{t('admin.label.motherPhone')}</span>
                    <strong>{motherPhone ? formatPhoneDisplay(motherPhone) : '—'}</strong>
                  </div>
                </>
              )
            })()}
          </div>

          <div className="student-detail-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={openPay} disabled={due <= 0}>
              <Banknote size={14} /> {t('admin.action.markPaid')}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(selected)}>
              <Pencil size={14} /> {t('common.edit')}
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={issueTelegramInvite} disabled={inviteBusy}>
              {inviteBusy ? 'Tayyorlanmoqda…' : 'Telegram ulash havolasi'}
            </button>
            <span className="text-sm">{selected.telegramLinked ? 'Telegram ulangan' : 'Telegram ulanmagan'}</span>
            {selected.telegramLinked && <button type="button" className="btn btn-outline btn-sm" onClick={unlinkTelegram}>Telegramdan uzish</button>}
            {inviteUrl ? <a className="mini-link" href={inviteUrl} target="_blank" rel="noreferrer">Havolani ochish</a> : null}
          </div>

          <section className="card" aria-label="To‘lovlar tarixi">
            <div className="card-header"><strong>To‘lovlar tarixi</strong></div>
            <div className="card-body">
              {data.payments.filter((payment) => payment.studentId === selected.id).length ? (
                <div className="grid gap-2">
                  {data.payments.filter((payment) => payment.studentId === selected.id)
                    .sort((left, right) => String(right.paidAt).localeCompare(String(left.paidAt)))
                    .map((payment) => (
                      <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] py-2">
                        <div>
                          <strong>{formatMoney(payment.amount)}</strong>
                          <span className="ml-2 text-sm text-muted">{payment.month}/{payment.year} · {new Date(payment.paidAt).toLocaleDateString('uz-UZ')}</span>
                        </div>
                        {user?.role === 'owner' && (
                          <div className="flex gap-2">
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => openPaymentEdit(payment)}>Tahrirlash</button>
                            <button type="button" className="btn btn-outline btn-sm" onClick={() => removePaymentRecord(payment)}>O‘chirish</button>
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              ) : <p className="text-sm text-muted">To‘lov tarixi yo‘q.</p>}
            </div>
          </section>

          <div className="student-groups-block">
            <div className="student-groups-label">{t('admin.label.groups')}</div>
            {groups.length === 0 ? (
              <span className="student-groups-empty">{t('admin.group.notAssigned')}</span>
            ) : (
              <div className="student-groups-chips">
                {groups.map((g) => (
                  <span key={g.id} className="student-group-tag">
                    {g.name}
                    <em>{formatMoney(g.monthlyFee || 0)}</em>
                    <button
                      type="button"
                      className="student-group-remove"
                      disabled={groupBusy}
                      onClick={() => removeStudentFromGroup(g.id)}
                      aria-label={t('admin.group.removeStudent')}
                      title={t('admin.group.removeStudent')}
                    >
                      <X size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {data.groups.length === 0 ? (
              <p className="student-groups-empty">{t('admin.student.openGroupFirst')}</p>
            ) : availableGroups.length > 0 ? (
              <div className="student-groups-add-row">
                <Select
                  value={addGroupId}
                  disabled={groupBusy}
                  onChange={(e) => setAddGroupId(e.target.value)}
                  options={[
                    { value: '', label: t('admin.group.select') },
                    ...availableGroups.map((g) => ({
                      value: g.id,
                      label: `${g.name} — ${formatMoney(g.monthlyFee || 0)}`,
                    })),
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!addGroupId || groupBusy}
                  onClick={() => addStudentToGroup(addGroupId)}
                >
                  <Plus size={14} /> {t('admin.action.addToGroup')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </>
    )
  }

  return (
    <PageEnter>
      <PageHeader
        actions={
          <GlowButton className="btn-primary" onClick={openCreate}>
            <Plus size={16} /> {t('admin.action.addStudent')}
          </GlowButton>
        }
      />

      <div className="stat-grid stat-grid-3">
        <StatCard label={t('admin.label.students')} value={data.students.length} icon={GraduationCap} tone="default" />
        <StatCard label={t('admin.status.paidCount')} value={paidCount} icon={Wallet} tone="success" />
        <StatCard label={t('admin.status.debtor')} value={debtorCount} icon={Wallet} tone="danger" />
      </div>

      {data.students.length > 0 && (
        <MasterDetail
          list={(
            <>
              <ListSearch
                value={search}
                onChange={setSearch}
                placeholder={t('admin.search.students')}
              />
              {filteredStudents.length === 0 ? (
                <div className="master-list-empty">{t('common.searchNoResults')}</div>
              ) : (
                filteredStudents.map((student) => {
                  const fee = Number(student.monthlyFee) || 0
                  const hasFee = fee > 0
                  const paid = studentPaidForMonth(data.payments, student.id, month, year, fee)
                  const paidAmount = amountPaidForMonth(data.payments, student.id, month, year)
                  const active = (selectedId ?? filteredStudents[0]?.id) === student.id
                  return (
                    <MasterListItem
                      key={student.id}
                      active={active}
                      avatar={<Avatar name={student.name} size="sm" />}
                      title={student.name}
                      subtitle={student.phone ? formatPhone(student.phone) : t('admin.student.noPhone')}
                      badge={(
                        <StatusBadge tone={!hasFee ? 'neutral' : paid ? 'success' : paidAmount > 0 ? 'warning' : 'danger'}>
                          {!hasFee
                            ? t('admin.group.notAssigned')
                            : paid
                              ? t('admin.status.paid')
                              : paidAmount > 0
                                ? t('admin.status.partial')
                                : t('admin.status.debt')}
                        </StatusBadge>
                      )}
                      onClick={() => setSelectedId(student.id)}
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
        title={editingId ? t('admin.modal.editStudent') : t('admin.modal.newStudent')}
        onClose={() => setOpen(false)}
        size="lg"
        actions={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="student-form" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        {error && !payOpen ? <div className="alert alert-error">{error}</div> : null}
        <form id="student-form" onSubmit={submit} className="entity-form">
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
              <div className="field">
                <label>Mini App login</label>
                <input className="input" value={form.username} onChange={(e) => setForm((current) => ({ ...current, username: e.target.value, autoUsername: false }))} required />
                <small>Ism.familiya ko‘rinishida, faqat lotin harflari; band bo‘lsa avtomatik raqam qo‘shiladi.</small>
              </div>
              {!editingId && <div className="field">
                <label>O‘quvchi paroli (kamida 6 belgi)</label>
                <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={6} required />
                <small>{form.password.length < 6 ? 'Kuchsiz — kamida 6 belgi kiriting.' : form.password.length < 10 ? 'O‘rtacha parol.' : 'Kuchli parol.'}</small>
              </div>}
            </div>
          </section>

          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.form.contacts')}</strong>
            </header>
            <div className="field">
              <label>{t('common.phone')}</label>
              <PhoneInput
                value={form.phone}
                onChange={(phone) => setForm((prev) => ({ ...prev, phone }))}
                invalid={phoneFieldState(form.phone) === 'incomplete' || (Boolean(error) && isEmptyPhone(form.phone))}
              />
            </div>
            <div className="form-grid-2 form-grid-phones">
              <div className="field">
                <label>{t('admin.label.fatherPhone')} <span className="field-optional">({t('common.optional')})</span></label>
                <PhoneInput
                  value={form.fatherPhone}
                  onChange={(fatherPhone) => setForm((prev) => ({ ...prev, fatherPhone }))}
                  invalid={phoneFieldState(form.fatherPhone) === 'incomplete'}
                />
              </div>
              <div className="field">
                <label>{t('admin.label.motherPhone')} <span className="field-optional">({t('common.optional')})</span></label>
                <PhoneInput
                  value={form.motherPhone}
                  onChange={(motherPhone) => setForm((prev) => ({ ...prev, motherPhone }))}
                  invalid={phoneFieldState(form.motherPhone) === 'incomplete'}
                />
              </div>
            </div>
          </section>

          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.label.groups')}</strong>
            </header>
            <div className="student-group-list">
              {data.groups.length === 0 ? (
                <p className="student-groups-empty">{t('admin.student.openGroupFirst')}</p>
              ) : (
                data.groups.map((group) => (
                  <label key={group.id} className="student-group-chip">
                    <input type="checkbox" checked={form.groupIds.includes(group.id)} onChange={() => toggleGroup(group.id)} />
                    <span>{group.name}</span>
                    <em>{formatMoney(group.monthlyFee || 0)}</em>
                  </label>
                ))
              )}
            </div>
          </section>
        </form>
      </Modal>

      <Modal
        open={passwordOpen}
        title={`${selected?.name || 'O‘quvchi'} — login va parol`}
        onClose={() => { setPasswordOpen(false); setPasswordForm({ username: '', password: '' }); setError('') }}
        actions={(
          <>
            <button type="button" className="btn btn-outline" onClick={() => { setPasswordOpen(false); setError('') }}>{t('common.cancel')}</button>
            <button type="submit" form="student-password-form" className="btn btn-primary">Saqlash</button>
          </>
        )}
      >
        {error && passwordOpen && <div className="alert alert-error">{error}</div>}
        <form id="student-password-form" onSubmit={saveStudentPassword} className="entity-form">
          <div className="field"><label>Login</label><input className="input" value={passwordForm.username} onChange={(event) => setPasswordForm({ ...passwordForm, username: event.target.value })} required /></div>
          <div className="field"><label>Yangi parol (kamida 6 belgi)</label><input type="password" className="input" value={passwordForm.password} onChange={(event) => setPasswordForm({ ...passwordForm, password: event.target.value })} minLength={6} autoComplete="new-password" required /></div>
          <small>Parolni boshqa joylarda ishlatmang.</small>
        </form>
      </Modal>

      <Modal
        open={payOpen}
        title={editingPayment ? 'To‘lovni tahrirlash' : t('admin.payment.modalTitle')}
        onClose={() => { setPayOpen(false); setEditingPayment(null); setError('') }}
        actions={
          <>
            <button type="button" className="btn btn-outline" onClick={() => { setPayOpen(false); setEditingPayment(null); setError('') }}>{t('common.cancel')}</button>
            <button type="submit" form="student-pay-form" className="btn btn-primary" disabled={paying}>
              {paying ? t('common.saving') : editingPayment ? 'Saqlash' : t('admin.action.markPaid')}
            </button>
          </>
        }
      >
        {error && payOpen ? <div className="alert alert-error">{error}</div> : null}
        <form id="student-pay-form" onSubmit={submitPayment}>
          <div className="field">
            <label htmlFor="student-pay-amount">{t('admin.payment.amount')}</label>
            <MoneyInput
              id="student-pay-amount"
              value={payAmount}
              onChange={setPayAmount}
              placeholder={String(Math.round(selectedDue))}
              required
            />
          </div>
        </form>
      </Modal>

    </PageEnter>
  )
}
