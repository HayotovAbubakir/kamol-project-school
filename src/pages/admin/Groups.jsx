import { BookOpen, ClipboardCopy, ClipboardPaste, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MoneyInput from '../../components/MoneyInput'
import Select from '../../components/Select'
import { PageEnter } from '../../components/motion/PageMotion'
import ScheduleChangeDialog from '../../components/ScheduleChangeDialog'
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
import { getGroupMonthFinance, groupTeacherIds, primaryGroupTeacherId, slotTeacherId } from '../../lib/store'
import { groupSearchFields, matchesSearch } from '../../lib/search'
import { DAYS, currentMonthYear, formatMoney, formatPhone } from '../../lib/utils'

const emptySlot = () => ({ day: 1, startTime: '09:00', endTime: '10:30', teacherId: '' })
const DAY_KEYS = {
  1: 'admin.day.monday',
  2: 'admin.day.tuesday',
  3: 'admin.day.wednesday',
  4: 'admin.day.thursday',
  5: 'admin.day.friday',
  6: 'admin.day.saturday',
  7: 'admin.day.sunday',
}

function teacherNamesForGroup(group, teachers, missingLabel) {
  const ids = groupTeacherIds(group)
  if (!ids.length) return missingLabel
  return ids
    .map((id) => teachers.find((t) => t.id === id)?.name)
    .filter(Boolean)
    .join(', ') || missingLabel
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export default function AdminGroups() {
  const { data, addGroup, updateGroup, deleteGroup } = useData()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { confirm, alert } = useDialog()
  const { t } = useLanguage()
  const [selectedId, setSelectedId] = useState(null)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [copiedSlot, setCopiedSlot] = useState(null)
  const [scheduleChange, setScheduleChange] = useState(null)
  const emptyForm = () => ({
    name: '',
    monthlyFee: '',
    schedule: [emptySlot()],
    studentIds: [],
    scheduleReason: '',
  })
  const [form, setForm] = useState(emptyForm)
  const { month: curMonth, year: curYear } = currentMonthYear()
  const [financeMonth, setFinanceMonth] = useState(curMonth)
  const [financeYear, setFinanceYear] = useState(curYear)
  const financeYears = useMemo(() => Array.from({ length: 21 }, (_, index) => curYear + 1 - index), [curYear])
  const [search, setSearch] = useState('')

  const totalStudents = useMemo(
    () => data.groups.reduce((sum, g) => sum + g.studentIds.length, 0),
    [data.groups],
  )

  const filteredGroups = useMemo(
    () => data.groups.filter((group) => matchesSearch(
      search,
      groupSearchFields(group, { teachers: data.teachers, students: data.students }),
    )),
    [data.groups, data.teachers, data.students, search],
  )

  useEffect(() => {
    if (!search.trim()) return
    if (!filteredGroups.length) return
    if (!filteredGroups.some((group) => group.id === selectedId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(filteredGroups[0].id)
    }
  }, [search, filteredGroups, selectedId])

  const selected = data.groups.find((g) => g.id === selectedId) ?? filteredGroups[0] ?? null
  const [slotBusy, setSlotBusy] = useState(false)

  const setSlotTeacher = async (group, slotIndex, teacherId) => {
    setSlotBusy(true)
    setError('')
    try {
      const schedule = (group.schedule || []).map((slot, i) => ({
        day: Number(slot.day),
        startTime: slot.startTime,
        endTime: slot.endTime,
        teacherId: i === slotIndex
          ? (teacherId || null)
          : (slotTeacherId(slot, group) || null),
      }))
      await updateGroup(group.id, { schedule, scheduleReason: 'O‘qituvchi darsiga biriktirildi' })
    } catch (err) {
      await alert({ message: err.message || t('domain.error.groupSaveFailed'), tone: 'danger' })
    } finally {
      setSlotBusy(false)
    }
  }

  const openCreate = () => {
    setError('')
    setEditingId(null)
    setCopiedSlot(null)
    setForm(emptyForm())
    setOpen(true)
  }

  const openEdit = (group) => {
    setError('')
    setEditingId(group.id)
    setCopiedSlot(null)
    setForm({
      name: group.name,
      monthlyFee: String(group.monthlyFee || ''),
      schedule: group.schedule?.length
        ? group.schedule.map((s) => ({
          slotId: s.slotId,
          day: s.day,
          startTime: s.startTime,
          endTime: s.endTime,
          teacherId: slotTeacherId(s, group) || '',
        }))
        : [emptySlot()],
      studentIds: [...(group.studentIds || [])],
      scheduleReason: '',
    })
    setOpen(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const payload = {
        name: form.name,
        teacherId: primaryGroupTeacherId({ schedule: form.schedule }),
        monthlyFee: Number(form.monthlyFee) || 0,
        schedule: form.schedule,
        studentIds: form.studentIds,
        scheduleReason: form.scheduleReason,
      }
      if (editingId) {
        await updateGroup(editingId, payload)
      } else {
        const created = await addGroup(payload)
        if (created?.id) setSelectedId(created.id)
      }
      setForm(emptyForm())
      setOpen(false)
      setEditingId(null)
    } catch (err) {
      setError(err.message || t('domain.error.groupSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (group) => {
    const ok = await confirm({
      message: t('admin.confirm.delete', { name: group.name }),
      confirmLabel: t('dialog.yesDelete'),
      tone: 'danger',
      delaySeconds: 5,
    })
    if (!ok) return
    try {
      await deleteGroup(group.id)
      setSelectedId(null)
    } catch (err) {
      await alert({ message: err.message || t('admin.error.deleteFailed'), tone: 'danger' })
    }
  }

  const renderDetail = () => {
    if (!selected) {
      return <div className="master-detail-empty">{t('admin.group.select')}</div>
    }

    const teacherLabel = teacherNamesForGroup(selected, data.teachers, t('admin.group.noAssignedTeacher'))
    const members = selected.studentIds
      .map((id) => data.students.find((s) => s.id === id))
      .filter(Boolean)
    const finance = getGroupMonthFinance(
      selected,
      members,
      data.payments,
      data.groups,
      financeMonth,
      financeYear,
    )

    return (
      <>
        <div className="master-detail-head">
          <Avatar name={selected.name} />
          <div className="master-detail-head-main">
            <h2>{selected.name}</h2>
            <p>{teacherLabel}</p>
          </div>
          <StatusBadge tone="success">{t('admin.student.count', { count: selected.studentIds.length })}</StatusBadge>
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

        <div className="detail-meta-grid">
          <div className="detail-meta-item"><span>{t('admin.label.monthlyFee')}</span><strong>{formatMoney(selected.monthlyFee)}</strong></div>
          <div className="detail-meta-item"><span>{t('admin.label.lessons')}</span><strong>{selected.schedule.length}</strong></div>
          <div className="detail-meta-item"><span>{t('admin.label.students')}</span><strong>{selected.studentIds.length}</strong></div>
        </div>

        <div className="page-header-actions" style={{ marginBottom: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(selected)}>
            <Pencil size={14} /> {t('common.edit')}
          </button>
        </div>

        <div className="card group-finance-card">
          <div className="card-header group-finance-head">
            <strong>{t('admin.group.financeTitle')}</strong>
            <div className="group-finance-month-selects">
              <Select
                className="group-finance-month"
                value={financeMonth}
                aria-label={t('common.month')}
                onChange={(event) => setFinanceMonth(Number(event.target.value))}
                options={MONTH_KEYS.map((key, index) => ({
                  value: index + 1,
                  label: t(`domain.month.${key}`),
                }))}
              />
              <Select
                className="group-finance-month"
                value={financeYear}
                aria-label={t('common.year')}
                onChange={(event) => setFinanceYear(Number(event.target.value))}
                options={financeYears.map((year) => ({ value: year, label: String(year) }))}
              />
            </div>
          </div>
          <div className="detail-meta-grid detail-meta-grid-3 group-finance-stats">
            <div className="detail-meta-item">
              <span>{t('admin.group.expected')}</span>
              <strong>{formatMoney(finance.expected)}</strong>
            </div>
            <div className="detail-meta-item">
              <span>{t('admin.group.collected')}</span>
              <strong>{formatMoney(finance.collected)}</strong>
            </div>
            <div className="detail-meta-item">
              <span>{t('admin.label.remaining')}</span>
              <strong className={finance.remaining > 0 ? 'money-text money-text-danger' : ''}>
                {formatMoney(finance.remaining)}
              </strong>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><strong>{t('admin.label.students')}</strong></div>
          {members.length === 0 ? (
            <div className="master-detail-empty" style={{ minHeight: 80, padding: 16 }}>{t('admin.group.noStudents')}</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('common.name')}</th>
                    <th>{t('admin.group.collected')}</th>
                    <th>{t('admin.label.remaining')}</th>
                    <th>{t('admin.label.paymentStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {finance.rows.map(({ student: s, paid, due, fullyPaid, partial }) => (
                    <tr
                      key={s.id}
                      className="table-row-link"
                      tabIndex={0}
                      role="link"
                      onClick={() => navigate(`/${user?.role || 'owner'}/students?id=${encodeURIComponent(s.id)}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          navigate(`/${user?.role || 'owner'}/students?id=${encodeURIComponent(s.id)}`)
                        }
                      }}
                    >
                      <td>
                        <div className="group-student-cell">
                          <strong>{s.name}</strong>
                          <span>{s.phone ? formatPhone(s.phone) : '—'}</span>
                        </div>
                      </td>
                      <td>{formatMoney(paid)}</td>
                      <td className={due > 0 ? 'money-text money-text-danger' : ''}>{formatMoney(due)}</td>
                      <td>
                        <StatusBadge tone={fullyPaid ? 'success' : partial ? 'warning' : 'danger'}>
                          {fullyPaid
                            ? t('admin.status.paid')
                            : partial
                              ? t('admin.status.partial')
                              : t('admin.status.debt')}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header"><strong>{t('admin.label.schedule')}</strong></div>
          <div className="group-schedule-edit" style={{ padding: '12px 16px 16px' }}>
            {data.teachers.length === 0 ? (
              <p className="group-teacher-empty">{t('admin.group.noTeachersYet')}</p>
            ) : null}
            {selected.schedule.map((s, i) => {
              const tid = slotTeacherId(s, selected) || ''
              const slotId = String(s.slotId || `slot-${i}`)
              return (
                <div key={slotId} className="group-schedule-edit-row">
                  <div className="group-schedule-edit-meta">
                    <strong>{t(DAY_KEYS[s.day])}</strong>
                    <span>{s.startTime}–{s.endTime}</span>
                  </div>
                  <Select
                    value={tid}
                    disabled={slotBusy || data.teachers.length === 0}
                    onChange={(e) => setSlotTeacher(selected, i, e.target.value || null)}
                    options={[
                      { value: '', label: t('admin.group.unassignedOption') },
                      ...data.teachers.map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                  <button type="button" className="btn btn-outline btn-sm"
                    onClick={() => setScheduleChange({ group: selected, slotId })}>
                    O‘zgartirish
                  </button>
                </div>
              )
            })}
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
            <Plus size={16} /> {t('admin.action.newGroup')}
          </GlowButton>
        }
      />

      <div className="stat-grid stat-grid-2">
        <StatCard label={t('nav.groups')} value={data.groups.length} icon={BookOpen} tone="default" />
        <StatCard label={t('admin.label.students')} value={totalStudents} icon={Users} tone="info" />
      </div>

      {data.groups.length > 0 && (
        <MasterDetail
          list={(
            <>
              <ListSearch
                value={search}
                onChange={setSearch}
                placeholder={t('admin.search.groups')}
              />
              {filteredGroups.length === 0 ? (
                <div className="master-list-empty">{t('common.searchNoResults')}</div>
              ) : (
                filteredGroups.map((group) => {
                  const teacherLabel = teacherNamesForGroup(group, data.teachers, t('admin.group.teacherMissing'))
                  const active = (selectedId ?? filteredGroups[0]?.id) === group.id
                  return (
                    <MasterListItem
                      key={group.id}
                      active={active}
                      avatar={<Avatar name={group.name} size="sm" />}
                      title={group.name}
                      subtitle={teacherLabel}
                      badge={<StatusBadge tone="success">{group.studentIds.length}</StatusBadge>}
                      onClick={() => setSelectedId(group.id)}
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
        title={editingId ? t('admin.modal.editGroup') : t('admin.action.newGroup')}
        onClose={() => setOpen(false)}
        size="lg"
        actions={
          <>
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
            <button type="submit" form="group-form" className="btn btn-primary" disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </>
        }
      >
        {error && <div className="alert alert-error">{error}</div>}
        <form id="group-form" onSubmit={submit} className="entity-form">
          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.form.groupMain')}</strong>
            </header>
            <div className="field">
              <label>{t('admin.group.formName')}</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field">
              <label>{t('admin.label.groupMonthlyFee')}</label>
              <MoneyInput
                value={form.monthlyFee}
                onChange={(monthlyFee) => setForm((prev) => ({ ...prev, monthlyFee }))}
                required
              />
            </div>
          </section>
          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.label.schedule')}</strong>
              <p className="form-section-hint">{t('admin.group.scheduleTeacherHint')}</p>
            </header>
          {form.schedule.map((slot, index) => (
            <div key={index} className="schedule-slot">
              <div className="field">
                <label>{t('admin.label.teacher')}</label>
                {data.teachers.length === 0 ? (
                  <p className="group-teacher-empty">{t('admin.group.noTeachersYet')}</p>
                ) : (
                  <Select
                    value={slot.teacherId || ''}
                    onChange={(e) => {
                      const schedule = [...form.schedule]
                      schedule[index] = { ...slot, teacherId: e.target.value }
                      setForm({ ...form, schedule })
                    }}
                    options={[
                      { value: '', label: t('admin.group.pickTeacher') },
                      ...data.teachers.map((teacher) => ({ value: teacher.id, label: teacher.name })),
                    ]}
                  />
                )}
              </div>
              <div className="schedule-slot-head">
                <div className="field">
                  <label>{t('admin.label.day')}</label>
                  <Select
                    value={slot.day}
                    onChange={(e) => {
                      const schedule = [...form.schedule]
                      schedule[index] = { ...slot, day: Number(e.target.value) }
                      setForm({ ...form, schedule })
                    }}
                    options={DAYS.map((d) => ({
                      value: d.value,
                      label: t(DAY_KEYS[d.value]),
                    }))}
                  />
                </div>
                <div className="schedule-slot-actions">
                  <button
                    type="button"
                    className="schedule-slot-action"
                    aria-label={t('common.copy')}
                    title={t('common.copy')}
                    onClick={() => setCopiedSlot({
                      startTime: slot.startTime,
                      endTime: slot.endTime,
                      teacherId: slot.teacherId,
                    })}
                  >
                    <ClipboardCopy size={15} />
                  </button>
                  <button
                    type="button"
                    className="schedule-slot-action"
                    aria-label={t('common.paste')}
                    title={t('common.paste')}
                    disabled={!copiedSlot}
                    onClick={() => {
                      if (!copiedSlot) return
                      const schedule = [...form.schedule]
                      schedule[index] = {
                        ...slot,
                        startTime: copiedSlot.startTime,
                        endTime: copiedSlot.endTime,
                        teacherId: copiedSlot.teacherId ?? slot.teacherId,
                      }
                      setForm({ ...form, schedule })
                    }}
                  >
                    <ClipboardPaste size={15} />
                  </button>
                  {form.schedule.length > 1 && (
                    <button
                      type="button"
                      className="schedule-slot-action schedule-slot-remove"
                      aria-label={t('common.delete')}
                      title={t('common.delete')}
                      onClick={() => setForm({ ...form, schedule: form.schedule.filter((_, i) => i !== index) })}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
              <div className="field">
                <label>{t('admin.label.time')}</label>
                <div className="schedule-slot-times">
                  <input type="time" className="input" value={slot.startTime} onChange={(e) => {
                    const schedule = [...form.schedule]
                    schedule[index] = { ...slot, startTime: e.target.value }
                    setForm({ ...form, schedule })
                  }} />
                  <input type="time" className="input" value={slot.endTime} onChange={(e) => {
                    const schedule = [...form.schedule]
                    schedule[index] = { ...slot, endTime: e.target.value }
                    setForm({ ...form, schedule })
                  }} />
                </div>
              </div>
            </div>
          ))}
          <div className="schedule-slot-toolbar">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setForm({ ...form, schedule: [...form.schedule, emptySlot()] })}>
              + {t('admin.action.addLessonTime')}
            </button>
            {copiedSlot && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => setForm({
                  ...form,
                  schedule: [...form.schedule, {
                    day: 1,
                    startTime: copiedSlot.startTime,
                    endTime: copiedSlot.endTime,
                    teacherId: copiedSlot.teacherId || '',
                  }],
                })}
              >
                <ClipboardPaste size={14} /> {t('common.paste')}
              </button>
            )}
          </div>
          {editingId ? (
            <div className="field">
              <label htmlFor="schedule-reason">Jadval o‘zgarish sababi</label>
              <input id="schedule-reason" className="input" maxLength="500" value={form.scheduleReason}
                onChange={(event) => setForm({ ...form, scheduleReason: event.target.value })}
                placeholder="Masalan: yangi o‘quv guruhi jadvali" />
            </div>
          ) : null}
          </section>
          <section className="form-section">
            <header className="form-section-head">
              <strong>{t('admin.label.students')}</strong>
            </header>
            <div className="student-group-list">
              {data.students.length === 0 ? (
                <p className="group-teacher-empty">{t('admin.group.noStudents')}</p>
              ) : (
                data.students.map((student) => (
                  <label key={student.id} className="student-group-chip">
                    <input
                      type="checkbox"
                      checked={form.studentIds.includes(student.id)}
                      onChange={() => {
                        setForm((prev) => ({
                          ...prev,
                          studentIds: prev.studentIds.includes(student.id)
                            ? prev.studentIds.filter((id) => id !== student.id)
                            : [...prev.studentIds, student.id],
                        }))
                      }}
                    />
                    <span>{student.name}</span>
                  </label>
                ))
              )}
            </div>
          </section>
        </form>
      </Modal>
      {scheduleChange ? (
        <ScheduleChangeDialog
          group={scheduleChange.group}
          initialSlotId={scheduleChange.slotId}
          onClose={() => setScheduleChange(null)}
        />
      ) : null}
    </PageEnter>
  )
}
