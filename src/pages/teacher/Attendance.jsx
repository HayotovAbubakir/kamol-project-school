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
  groupHasLessonOnDate,
} from '../../lib/analytics'
import { groupsForTeacher } from '../../lib/store'
import { formatPhone, todayISO } from '../../lib/utils'

export default function TeacherAttendance() {
  const { user } = useAuth()
  const { data, markAttendance } = useData()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const groups = useMemo(
    () => groupsForTeacher(data.groups, user.teacherId),
    [data.groups, user.teacherId],
  )
  const date = todayISO()
  const [notes, setNotes] = useState({})
  const [savingId, setSavingId] = useState(null)

  const groupId = searchParams.get('group') || groups[0]?.id || ''
  const selectedGroup = data.groups.find((g) => g.id === groupId)
  const hasLessonToday = selectedGroup
    ? groupHasLessonOnDate(selectedGroup, date, user.teacherId)
    : false
  const todaySlots = selectedGroup
    ? getGroupLessonSlotsOnDate(selectedGroup, date, user.teacherId)
    : []
  const todayTimes = todaySlots
    .map((slot) => formatLessonTime({ time: slot.startTime, endTime: slot.endTime }))
    .join(', ')

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

  const setStatus = async (studentId, status) => {
    if (!hasLessonToday) return
    setSavingId(studentId)
    try {
      await markAttendance({
        studentId,
        groupId,
        status,
        note: notes[studentId] ?? getRecord(studentId)?.note ?? '',
        markedBy: user.id,
      })
    } finally {
      setSavingId(null)
    }
  }

  const saveNote = async (studentId) => {
    if (!hasLessonToday) return
    const current = getStatus(studentId)
    if (!current) return
    setSavingId(studentId)
    try {
      await markAttendance({
        studentId,
        groupId,
        status: current,
        note: notes[studentId] || '',
        markedBy: user.id,
      })
    } finally {
      setSavingId(null)
    }
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
              <span>{date}</span>
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
              <span className="attendance-toolbar-warning">{t('teacher.attendance.noLessonToday')}</span>
            )}
          </div>
        </div>

        {!hasLessonToday ? (
          <EmptyState
            title={t('teacher.attendance.noLessonToday')}
            description={t('teacher.attendance.noLessonTodayHint')}
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
                    <input
                      className="input attendance-note-input"
                      placeholder={t('teacher.attendance.notePlaceholder')}
                      value={noteValue}
                      onChange={(e) => setNotes({ ...notes, [student.id]: e.target.value })}
                      onBlur={() => saveNote(student.id)}
                    />
                  </div>
                  <div className="attendance-actions">
                    <button
                      type="button"
                      className={`status-btn${status === 'present' ? ' active-present' : ''}`}
                      onClick={() => setStatus(student.id, 'present')}
                    >
                      {t('teacher.attendance.present')}
                    </button>
                    <button
                      type="button"
                      className={`status-btn${status === 'late' ? ' active-late' : ''}`}
                      onClick={() => setStatus(student.id, 'late')}
                    >
                      {t('teacher.attendance.late')}
                    </button>
                    <button
                      type="button"
                      className={`status-btn${status === 'absent' ? ' active-absent' : ''}`}
                      onClick={() => setStatus(student.id, 'absent')}
                    >
                      {t('teacher.attendance.absent')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </PageEnter>
  )
}
