import { BookOpen, CalendarDays, ClipboardCheck, Users } from 'lucide-react'
import { AttendanceBarChart, GroupStudentsChart } from '../../lib/lazyCharts'
import { PageEnter } from '../../components/motion/PageMotion'
import { TeacherGroupsPanel } from '../../components/teacher/TeacherGroupsPanel'
import { StatCard, EmptyState } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { getWeeklyAttendance } from '../../lib/analytics'
import { groupsForTeacher, teacherSlotsInGroup } from '../../lib/store'
import { todayISO } from '../../lib/utils'

export default function TeacherDashboard() {
  const { user } = useAuth()
  const { data } = useData()
  const { t } = useLanguage()
  const today = todayISO()
  const groups = groupsForTeacher(data.groups, user.teacherId)
  const studentsCount = groups.reduce((sum, g) => sum + (g.studentIds?.length || 0), 0)
  const todayLessons = groups.reduce(
    (sum, g) => sum + teacherSlotsInGroup(g, user.teacherId).length,
    0,
  )
  const markedToday = data.attendance.filter(
    (a) => a.date === today && groups.some((g) => g.id === a.groupId),
  ).length
  const myGroupsChart = groups.map((g) => ({
    name: g.name.length > 18 ? `${g.name.slice(0, 16)}…` : g.name,
    students: g.studentIds?.length || 0,
  }))
  const groupIds = groups.map((g) => g.id)
  const weeklyAttendance = getWeeklyAttendance(data, groupIds)
  const needsLink = Boolean(user?.id) && !user?.teacherId

  return (
    <PageEnter>
      <div className="teacher-home">
        <div className="finance-highlight">
          <StatCard label={t('teacher.dashboard.markedToday')} value={markedToday} icon={ClipboardCheck} tone="success" featured />
          <StatCard label={t('nav.myGroups')} value={groups.length} icon={BookOpen} tone="info" />
          <StatCard label={t('nav.students')} value={studentsCount} icon={Users} tone="default" />
          <StatCard label={t('teacher.dashboard.lessonTimes')} value={todayLessons} icon={CalendarDays} tone="warning" />
        </div>

        <section className="teacher-section">
          <div className="teacher-section-head">
            <h3>{t('nav.myGroups')}</h3>
            <p>{t('teacher.groups.sectionHint')}</p>
          </div>
          {needsLink ? (
            <EmptyState
              title={t('teacher.groups.notLinked')}
              description={t('teacher.groups.notLinkedHint')}
            />
          ) : (
            <TeacherGroupsPanel
              groups={groups}
              teacherId={user.teacherId}
              attendance={data.attendance}
              today={today}
              compact
            />
          )}
        </section>

        <div className="dashboard-grid">
          {myGroupsChart.length > 0 ? <GroupStudentsChart data={myGroupsChart} /> : null}
          <AttendanceBarChart data={weeklyAttendance} />
        </div>
      </div>
    </PageEnter>
  )
}
