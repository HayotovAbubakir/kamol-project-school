import { Phone } from 'lucide-react'
import { Card, EmptyState, Skeleton } from '../ui.jsx'
import { parseParentPhones } from '../../lib/phone.js'
import { displayIsoDate, tashkentToday, telLink } from '../format.js'
import { t } from '../i18n.js'

export default function AbsentTodayScreen({ rows, loading, students, groups, todayLessons }) {
  const today = tashkentToday()
  const studentById = new Map(students.map((student) => [student.id, student]))
  const groupById = new Map(groups.map((group) => [group.id, group]))
  const absent = rows.filter((row) => row.status === 'absent')
  const late = rows.filter((row) => row.status === 'late')
  const markedGroups = new Set(rows.map((row) => row.group_id))
  const unmarked = [...new Map(todayLessons
    .filter((lesson) => !markedGroups.has(lesson.groupId))
    .map((lesson) => [lesson.groupId, lesson])).values()]

  const renderRow = (row) => {
    const student = studentById.get(row.student_id)
    const phones = parseParentPhones(student?.parent_phone)
    const callTo = telLink(phones.fatherPhone || phones.motherPhone || student?.phone)
    return (
      <div key={row.id} className="flex min-h-12 items-center justify-between gap-3 border-t border-[var(--mini-border)] py-2 first:border-t-0">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{student?.name || t('O‘quvchi')}</p>
          <p className="truncate text-xs text-[var(--mini-muted)]">{groupById.get(row.group_id)?.name || ''}{row.note ? ` · ${row.note}` : ''}</p>
        </div>
        {callTo && (
          <a className="mini-icon-button shrink-0" href={callTo} aria-label={t('Qo‘ng‘iroq')}>
            <Phone size={16} aria-hidden="true" />
          </a>
        )}
      </div>
    )
  }

  if (loading && !rows.length) return <section className="mt-7"><Skeleton rows={3} /></section>

  return (
    <section className="mt-7 grid gap-3">
      <p className="text-sm text-[var(--mini-muted)]">{displayIsoDate(today)}</p>
      <Card>
        <h2 className="font-bold">{t('Kelmadi')} · {absent.length}</h2>
        <div className="mt-2">{absent.map(renderRow)}</div>
        {!absent.length && <p className="mt-2 text-sm text-[var(--mini-muted)]">{t('Hamma keldi')}</p>}
      </Card>
      {!!late.length && (
        <Card>
          <h2 className="font-bold">{t('Kechikdi')} · {late.length}</h2>
          <div className="mt-2">{late.map(renderRow)}</div>
        </Card>
      )}
      {!!unmarked.length && (
        <Card>
          <h2 className="font-bold">{t('Davomat belgilanmagan')}</h2>
          {unmarked.map((lesson) => (
            <p key={lesson.groupId} className="mt-2 text-sm">{lesson.groupName} · {lesson.startTime || ''}</p>
          ))}
        </Card>
      )}
      {!rows.length && !unmarked.length && <EmptyState title={t('Bugun dars yo‘q')} />}
    </section>
  )
}
