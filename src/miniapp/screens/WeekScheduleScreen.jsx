import { Card, EmptyState } from '../ui.jsx'
import { displayIsoDate, isoWeekday, tashkentToday, weekdayLong } from '../format.js'
import { t } from '../i18n.js'

function lessonStatusText(lesson) {
  if (lesson.status === 'cancelled') return t('Bekor qilindi')
  if (lesson.status === 'rescheduled') return `${t('Ko‘chirildi')} → ${displayIsoDate(lesson.newDate)}`
  if (lesson.status === 'changed') return t('O‘zgartirildi')
  return ''
}

/** 7 kunlik jadval: `entries` — getEffectiveLesson natijalari (groupId, groupName, date, startTime, endTime, status). */
export default function WeekScheduleScreen({ entries, teachers = [], showTeacher = false, onChangeGroup }) {
  const today = tashkentToday()
  const teacherNames = new Map(teachers.map((teacher) => [teacher.id, teacher.name]))
  const days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(`${today}T12:00:00Z`)
    date.setUTCDate(date.getUTCDate() + offset)
    return date.toISOString().slice(0, 10)
  })
  const byDay = new Map(days.map((day) => [day, []]))
  for (const lesson of entries) byDay.get(lesson.date)?.push(lesson)
  for (const list of byDay.values()) list.sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')))
  const hasAny = [...byDay.values()].some((list) => list.length)

  if (!hasAny) return <section className="mt-7"><EmptyState title={t('Jadval bo‘sh')} /></section>

  return (
    <section className="mt-7 grid gap-3">
      {days.map((day) => {
        const lessons = byDay.get(day)
        if (!lessons.length) return null
        return (
          <Card key={day}>
            <h2 className="font-bold">
              {day === today ? t('Bugun') : weekdayLong(isoWeekday(day))}
              <span className="ml-2 text-xs font-normal text-[var(--mini-muted)]">{displayIsoDate(day)}</span>
            </h2>
            <div className="mt-2">
              {lessons.map((lesson) => {
                const status = lessonStatusText(lesson)
                const off = ['cancelled', 'rescheduled'].includes(lesson.status)
                return (
                  <div key={`${lesson.groupId}-${lesson.slotId}-${lesson.date}`} className="flex min-h-12 items-center justify-between gap-3 border-t border-[var(--mini-border)] py-2 first:border-t-0">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold${off ? ' line-through opacity-60' : ''}`}>
                        {lesson.startTime || '—'}{lesson.endTime ? `–${lesson.endTime}` : ''} · {lesson.groupName}
                      </p>
                      {(status || (showTeacher && lesson.teacherId)) && (
                        <p className="text-xs text-[var(--mini-muted)]">
                          {[showTeacher ? teacherNames.get(lesson.teacherId) : '', status].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    {onChangeGroup && !off && (
                      <button type="button" className="mini-link inline-flex min-h-11 min-w-11 shrink-0 items-center text-xs" onClick={() => onChangeGroup(lesson.groupId)}>{t('O‘zgartirish')}</button>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
    </section>
  )
}
