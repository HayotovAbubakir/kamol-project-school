import { CalendarDays, Users } from 'lucide-react'
import { PageEnter } from '../../components/motion/PageMotion'
import { EmptyState } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { groupsForTeacher, teacherSlotsInGroup } from '../../lib/store'

export default function TeacherSchedule() {
  const { user } = useAuth()
  const { data } = useData()
  const { t } = useLanguage()
  const groups = groupsForTeacher(data.groups, user.teacherId)

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

  return (
    <PageEnter>
      <div className="teacher-schedule-list">
        {groups.map((group) => {
          const slots = teacherSlotsInGroup(group, user.teacherId)
          const schedule = slots
            .map((s) => `${t(`teacher.schedule.day.${s.day}`)} ${s.startTime}–${s.endTime}`)
            .join(' · ')
          return (
            <article key={group.id} className="teacher-schedule-card card">
              <div className="teacher-schedule-card-top">
                <strong>{group.name}</strong>
                <span className="teacher-schedule-students">
                  <Users size={14} />
                  {t('teacher.groups.studentsCount', { count: group.studentIds.length })}
                </span>
              </div>
              <p className="teacher-schedule-times">
                <CalendarDays size={14} />
                <span>{schedule || t('teacher.groups.noSchedule')}</span>
              </p>
            </article>
          )
        })}
      </div>
    </PageEnter>
  )
}
