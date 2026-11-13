import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageEnter } from '../../components/motion/PageMotion'
import { EmptyState } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import {
  formatLessonTime,
  getGroupLessonSlotsOnDate,
  getTashkentDateISO,
  groupHasLessonOnDate,
} from '../../lib/analytics'
import { groupsForTeacher } from '../../lib/store'
import { formatPhone } from '../../lib/utils'
import { useDialog } from '../../context/DialogContext'
import AttendanceSourceTag from '../../components/face/AttendanceSourceTag.jsx'
import { useSiteFaceLabels } from '../../components/face/useSiteFaceLabels.js'
import { isFaceLockedError } from '../../lib/faceApi.js'

export default function TeacherAttendance() {
  const { user } = useAuth()
  const { data, markAttendance } = useData()
  const { t } = useLanguage()
  const { confirm } = useDialog()
  const faceLabels = useSiteFaceLabels()
  const [manualOpen, setManualOpen] = useState(false)
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const groups = useMemo(
    () => groupsForTeacher(data.groups, user.teacherId),
    [data.groups, user.teacherId],
  )
  const date = getTashkentDateISO()
  const [notes, setNotes] = useState({})
  const [savingId, setSavingId] = useState(null)
  const [saveError, setSaveError] = useState('')

  const groupId = searchParams.get('group') || groups[0]?.id || ''
  const selectedGroup = data.groups.find((g) => g.id === groupId)
  const hasLessonToday = selectedGroup
    ? groupHasLessonOnDate(selectedGroup, date, user.teacherId)
    : false
  const todaySlots = selectedGroup
    ? getGroupLessonSlotsOnDate(selectedGroup, date, user.teacherId)
    : []
  const todayTimes = todaySlots
    .map((slot) => `${formatLessonTime({ time: slot.startTime, endTime: slot.endTime })}${slot.status === 'changed' ? ' · O‘zgartirilgan' : ''}`)
    .join(', ')
  const cancelledToday = todaySlots.some((slot) => slot.status === 'cancelled')

  useEffect(() => {
    if (!groups.length) return
    if (!groupId || !groups.some((g) => g.id === groupId)) {
      setSearchParams({ group: groups[0].id }, { replace: true })
    }
  }, [groups, groupId, setSearchParams])

  const students = useMemo(() => {
    const group = data.groups.find((g) => g.id === groupId)
    if (!group) return []
    return group.studentIds
      .map((id) => data.students.find((s) => s.id === id))
      .filter(Boolean)
  }, [data, groupId])

  const getRecord = (studentId) =>
    data.attendance.find((a) => a.studentId === studentId && a.groupId === groupId && a.date === date)

  const getStatus = (studentId) => getRecord(studentId)?.status

  const save = async (studentId, status, note) => {
    if (!hasLessonToday || savingId) return
    const record = getRecord(studentId)
    const askOverride = () => confirm({
      message: faceLabels.overrideConfirm(),
      confirmLabel: faceLabels.overrideAction(),
      tone: 'danger',
    })
    let overrideFace = false
    if (record?.source === 'face' && record.checkedInAt) {
      if (!(await askOverride())) return
      overrideFace = true
    }
    setSavingId(studentId)
    setSaveError('')
    try {
      try {
        await markAttendance({ studentId, groupId, status, note, markedBy: user.id, overrideFace })
      } catch (lockError) {
        if (overrideFace || !isFaceLockedError(lockError)) throw lockError
        if (await askOverride()) await markAttendance({ studentId, groupId, status, note, markedBy: user.id, overrideFace: true })
      }
    } catch (err) {
      const name = data.students.find((s) => s.id === studentId)?.name || ''
      setSaveError(`${name ? `${name}: ` : ''}${err.message || t('domain.error.dataLoadFailed')}`)
    } finally {
      setSavingId(null)
    }
  }

  const setStatus = (studentId, status) => save(
    studentId,
    status,
    notes[studentId] ?? getRecord(studentId)?.note ?? '',
  )

  const saveNote = (studentId) => {
    const current = getStatus(studentId)
    if (!current) return
    const nextNote = notes[studentId]
    if (nextNote === undefined || nextNote === (getRecord(studentId)?.note ?? '')) return
    return save(studentId, current, nextNote || '')
  }

  if (!user?.teacherId) {
    return (
      <PageEnter>
        <EmptyState
          title={t('teacher.groups.notLinked')}
          description={t('teacher.groups.notLinkedHint')}
        />
      </PageEnter>
    )
  }

  if (!groups.length) {
    return (
      <PageEnter>
        <EmptyState
          title={t('teacher.groups.empty')}
          description={t('teacher.groups.emptyHint')}
        />
      </PageEnter>
    )
  }

  const markedCount = students.filter((s) => getStatus(s.id)).length

  return (
    <PageEnter>
      <div className="teacher-attendance">
        <div className="attendance-toolbar-card">
          <div className="attendance-toolbar-top">
            <div className="attendance-toolbar-title">
              <strong>{t('teacher.attendance.group')}</strong>
              <span>{date.split('-').reverse().join('.')}</span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/teacher/groups')}>
              {t('nav.myGroups')}
            </button>
          </div>

          <div className="attendance-group-tabs" role="tablist" aria-label={t('teacher.attendance.group')}>
            {groups.map((group) => {
              const active = group.id === groupId
              const hasLesson = groupHasLessonOnDate(group, date, user.teacherId)
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`attendance-group-tab${active ? ' is-active' : ''}${hasLesson ? '' : ' is-idle'}`}
                  onClick={() => setSearchParams({ group: group.id })}
                >
                  {group.name}
                </button>
              )
            })}
          </div>

          <div className="attendance-toolbar-meta">
            {hasLessonToday ? (
              <>
                <span>{t('teacher.attendance.lessonToday', { times: todayTimes })}</span>
                <strong>{t('teacher.attendance.progress', { marked: markedCount, total: students.length })}</strong>
              </>
            ) : (
              <span className="attendance-toolbar-warning">{cancelledToday ? 'Bugungi dars bekor qilingan.' : t('teacher.attendance.noLessonToday')}</span>
            )}
          </div>
        </div>

        {saveError && <div className="alert alert-error" role="alert">{saveError}</div>}

        {hasLessonToday && students.length > 0 && (
          <div className="attendance-toolbar-card">
            <div className="attendance-toolbar-top">
              <div className="attendance-toolbar-title">
                <strong>{faceLabels.manualTitle()}</strong>
                <span>{faceLabels.manualHint()}</span>
              </div>
              <button type="button" className="btn btn-outline btn-sm" aria-expanded={manualOpen} onClick={() => setManualOpen((value) => !value)}>
                {manualOpen ? faceLabels.hideManual() : faceLabels.showManual()}
              </button>
            </div>
          </div>
        )}

        {!hasLessonToday ? (
          <EmptyState
            title={cancelledToday ? 'Dars bekor qilingan' : t('teacher.attendance.noLessonToday')}
            description={cancelledToday ? 'Davomat belgilash shart emas.' : t('teacher.attendance.noLessonTodayHint')}
          />
        ) : students.length === 0 ? (
          <EmptyState title={t('teacher.attendance.noStudents')} />
        ) : (
          <div className="attendance-grid">
            {students.map((student) => {
              const status = getStatus(student.id)
              const noteValue = notes[student.id]
                ?? getRecord(student.id)?.note
                ?? ''
              return (
                <div key={student.id} className={`attendance-row${savingId === student.id ? ' is-saving' : ''}`}>
                  <div className="attendance-student">
                    <strong>{student.name}</strong>
                    <div className="attendance-phone">
                      {student.phone ? formatPhone(student.phone) : '—'}
                    </div>
                    {getRecord(student.id) ? <AttendanceSourceTag record={getRecord(student.id)} labels={faceLabels} /> : null}
                    {manualOpen && (
                      <input
                        className="input attendance-note-input"
                        aria-label={`${student.name} — ${t('teacher.attendance.notePlaceholder')}`}
                        placeholder={t('teacher.attendance.notePlaceholder')}
                        value={noteValue}
                        onChange={(e) => setNotes({ ...notes, [student.id]: e.target.value })}
                        onBlur={() => saveNote(student.id)}
                      />
                    )}
                  </div>
                  {!manualOpen ? (
                    <div className="attendance-actions">
                      <span className={`status-btn${status ? ` active-${status}` : ''}`}>
                        {status ? t(`teacher.attendance.${status}`) : '—'}
                      </span>
                    </div>
                  ) : <div className="attendance-actions">
                    <button
                      type="button"
                      disabled={Boolean(savingId)}
                      aria-pressed={status === 'present'}
                      className={`status-btn${status === 'present' ? ' active-present' : ''}`}
                      onClick={() => setStatus(student.id, 'present')}
                    >
                      {t('teacher.attendance.present')}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(savingId)}
                      aria-pressed={status === 'late'}
                      className={`status-btn${status === 'late' ? ' active-late' : ''}`}
                      onClick={() => setStatus(student.id, 'late')}
                    >
                      {t('teacher.attendance.late')}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(savingId)}
                      aria-pressed={status === 'absent'}
                      className={`status-btn${status === 'absent' ? ' active-absent' : ''}`}
                      onClick={() => setStatus(student.id, 'absent')}
                    >
                      {t('teacher.attendance.absent')}
                    </button>
                  </div>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PageEnter>
  )
}
