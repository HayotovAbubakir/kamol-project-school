import { Copy } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageEnter } from '../../components/motion/PageMotion'
import { EmptyState, PageHeader } from '../../components/ui'
import GlassPane from '../../components/GlassPane'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { formatLessonTime, getTodayDayValue, getTodayLessons } from '../../lib/analytics'
import { translate as tr } from '../../i18n/runtime'

const WEEKDAY_KEYS = {
  1: 'domain.weekday.monday',
  2: 'domain.weekday.tuesday',
  3: 'domain.weekday.wednesday',
  4: 'domain.weekday.thursday',
  5: 'domain.weekday.friday',
  6: 'domain.weekday.saturday',
}

export default function OwnerSchedule() {
  const { data } = useData()
  const { t } = useLanguage()
  const lessons = useMemo(() => getTodayLessons(data, { includeChanged: true }), [data])
  const [copied, setCopied] = useState(false)
  const isSunday = getTodayDayValue() === 7
  const dayValue = getTodayDayValue()
  const dayLabel = isSunday ? t('owner.schedule.sunday') : t(WEEKDAY_KEYS[dayValue])

  const copySchedule = async () => {
    if (!lessons.length) return
    const text = lessons
      .map((l) => `${formatLessonTime(l)}\t${l.group}${l.status === 'cancelled' ? ' (bekor qilingan)' : l.status === 'changed' ? ' (o‘zgartirilgan)' : l.status === 'rescheduled' ? ` (ko‘chirilgan: ${l.newDate})` : ''}\t${l.teacher}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <PageEnter>
      <PageHeader
        actions={lessons.length > 0 ? (
          <button type="button" className="home-copy-btn" onClick={copySchedule} title={copied ? t('common.copied') : t('common.copy')}>
            <Copy size={16} />
          </button>
        ) : null}
      />

      <GlassPane className="home-panel home-panel-full schedule-panel" radius={22}>
        <div className="home-panel-head">
          <h2 className="home-panel-title">{t('owner.schedule.heading')}</h2>
          <span className="schedule-day-meta">{dayLabel}</span>
        </div>
        {isSunday && !lessons.length ? (
          <EmptyState title={t('owner.schedule.dayOff')} />
        ) : lessons.length === 0 ? (
          <EmptyState title={t('owner.schedule.noLessons')} />
        ) : (
          <div className="home-lessons">
            <div className="home-lessons-grid home-lessons-grid-header">
              <span>{t('owner.schedule.time')}</span>
              <span>{t('owner.schedule.group')}</span>
              <span>{t('owner.schedule.teacher')}</span>
            </div>
            <div className="home-lessons-grid">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="home-lesson-row">
                  <span className="home-lesson-time">{formatLessonTime(lesson)}</span>
                  <span className="home-lesson-group">
                    {lesson.group}
                    {lesson.status === 'changed' && <span className="schedule-change-badge">{tr('O‘zgartirilgan')}</span>}
                    {lesson.status === 'cancelled' && <span className="schedule-cancel-badge">{tr('Bekor qilingan')}</span>}
                    {lesson.status === 'rescheduled' && <span className="schedule-change-badge">{tr('Ko‘chirilgan ·')} {lesson.newDate}</span>}
                  </span>
                  <span className="home-lesson-teacher">{lesson.teacher}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassPane>
    </PageEnter>
  )
}
