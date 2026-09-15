import { PageEnter } from '../../components/motion/PageMotion'
import { TeacherGroupsPanel } from '../../components/teacher/TeacherGroupsPanel'
import { EmptyState } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { groupsForTeacher } from '../../lib/store'
import { todayISO } from '../../lib/utils'

export default function TeacherGroups() {
  const { user } = useAuth()
  const { data } = useData()
  const { t } = useLanguage()
  const groups = groupsForTeacher(data.groups, user.teacherId)

  return (
    <PageEnter>
      {!user?.teacherId ? (
        <EmptyState
          title={t('teacher.groups.notLinked')}
          description={t('teacher.groups.notLinkedHint')}
        />
      ) : (
        <TeacherGroupsPanel
          groups={groups}
          teacherId={user.teacherId}
          attendance={data.attendance}
          today={todayISO()}
        />
      )}
    </PageEnter>
  )
}
