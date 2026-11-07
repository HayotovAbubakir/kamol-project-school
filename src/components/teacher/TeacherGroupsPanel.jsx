import { ClipboardCheck, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../ui'
import { useLanguage } from '../../context/LanguageContext'
import { getTodayDayValue } from '../../lib/analytics'
import { slotTeacherId, teacherSlotsInGroup } from '../../lib/store'
import { getGroupLessonSlotsOnDate } from '../../lib/analytics'
import ScheduleChangeDialog from '../ScheduleChangeDialog'

function formatTodaySlots(group, t, teacherId) {
  const day = getTodayDayValue()
  if (!day) return t('teacher.groups.noLessonToday')
  const slots = getGroupLessonSlotsOnDate(group, new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' }))
    .filter((slot) => !['cancelled', 'rescheduled'].includes(slot.status))
    .filter((slot) => !teacherId || slotTeacherId(slot, group) === teacherId)
  if (!slots.length) return t('teacher.groups.noLessonToday')
  return slots
    .map((s) => `${s.startTime}–${s.endTime}${s.status === 'changed' ? ' · O‘zgartirilgan' : ''}`)
    .join(', ')
}

function formatWeekSchedule(group, t, teacherId) {
  const slots = (teacherId ? teacherSlotsInGroup(group, teacherId) : [...(group.schedule || [])])
    .sort((a, b) => a.day - b.day || String(a.startTime).localeCompare(String(b.startTime)))
  if (!slots.length) return t('teacher.groups.noSchedule')
  return slots
    .map((s) => `${t(`teacher.schedule.day.${s.day}`)} ${s.startTime}–${s.endTime}`)
    .join(' · ')
}

export function TeacherGroupsPanel({
  groups,
  teacherId = null,
  attendance = [],
  today,
  compact = false,
}) {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [scheduleChange, setScheduleChange] = useState(null)

  const rows = useMemo(() => groups.map((group) => {
    const marked = attendance.filter(
      (a) => a.groupId === group.id && a.date === today,
    ).length
    const total = group.studentIds?.length || 0
    return {
      group,
      marked,
      total,
      done: total > 0 && marked >= total,
      todaySlots: formatTodaySlots(group, t, teacherId),
      weekSchedule: formatWeekSchedule(group, t, teacherId),
    }
  }), [groups, attendance, today, t, teacherId])

  if (!rows.length) {
    return (
      <EmptyState
        title={t('teacher.groups.empty')}
        description={t('teacher.groups.emptyHint')}
      />
    )
  }

  return (
    <div className={`teacher-groups-grid${compact ? ' is-compact' : ''}`}>
      {rows.map(({ group, marked, total, done, todaySlots, weekSchedule }) => (
        <article key={group.id} className="teacher-group-card">
          <div className="teacher-group-card-top">
            <div className="teacher-group-icon">
              <Users size={18} />
            </div>
            <div className="teacher-group-meta">
              <strong>{group.name}</strong>
              <span>{t('teacher.groups.studentsCount', { count: total })}</span>
            </div>
            {done ? (
              <span className="teacher-group-pill is-done">{t('teacher.groups.done')}</span>
            ) : (
              <span className="teacher-group-pill">{t('teacher.groups.pending')}</span>
            )}
          </div>

          <div className="teacher-group-stats">
            <div className="teacher-group-stat">
              <span>{t('teacher.groups.markedLabel')}</span>
              <strong>{t('teacher.groups.markedToday', { marked, total })}</strong>
            </div>
            <div className="teacher-group-stat">
              <span>{t('teacher.groups.today')}</span>
              <strong>{todaySlots}</strong>
            </div>
          </div>

          {!compact ? (
            <p className="teacher-group-week">{weekSchedule}</p>
          ) : null}

          <button
            type="button"
            className="btn btn-primary teacher-group-cta"
            onClick={() => navigate(`/teacher/attendance?group=${group.id}`)}
          >
            <ClipboardCheck size={16} />
            {t('teacher.groups.markAttendance')}
          </button>
          <button type="button" className="btn btn-outline teacher-group-cta"
            onClick={() => setScheduleChange({
              group,
              slotId: String(teacherSlotsInGroup(group, teacherId)[0]?.slotId || ''),
            })}>
            O‘zgartirish
          </button>
        </article>
      ))}
      {scheduleChange ? (
        <ScheduleChangeDialog group={scheduleChange.group} initialSlotId={scheduleChange.slotId}
          onClose={() => setScheduleChange(null)} />
      ) : null}
    </div>
  )
}
