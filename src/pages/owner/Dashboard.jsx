import { Copy, Hourglass, UserRound, UserX, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FinancePieChart, RevenueTrendChart } from '../../components/charts/DashboardCharts'
import { PageEnter } from '../../components/motion/PageMotion'
import { EmptyState, StatCard } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import {
  getDebtorCount,
  getFinanceBreakdown,
  getLast6MonthsTrend,
  getTodayAbsentCount,
  formatLessonTime,
  getTodayLessons,
  getTrendDelta,
  getTrendSparkline,
} from '../../lib/analytics'
import { getFinanceSummary } from '../../lib/store'
import { currentMonthYear, formatMoney, todayISO } from '../../lib/utils'

export default function OwnerDashboard() {
  const { data } = useData()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const base = pathname.startsWith('/admin') ? '/admin' : '/owner'
  const today = todayISO()
  const { month, year } = currentMonthYear()
  const lessons = useMemo(() => getTodayLessons(data), [data])
  const debtorCount = useMemo(() => getDebtorCount(data, month, year), [data, month, year])
  const absentCount = useMemo(() => getTodayAbsentCount(data, today), [data, today])
  const finance = useMemo(() => getFinanceSummary(data), [data])
  const trend = useMemo(() => getLast6MonthsTrend(data), [data])
  const breakdown = useMemo(() => getFinanceBreakdown(data, month, year), [data, month, year])
  const [copied, setCopied] = useState(false)

  const copySchedule = async () => {
    const text = lessons
      .map((l) => `${formatLessonTime(l)}\t${l.group}\t${l.teacher}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  const isSunday = new Date().getDay() === 0

  return (
    <PageEnter className="home-page">
      <div className="stat-grid home-stats">
        <StatCard
          label={t('owner.dashboard.debtors')}
          value={debtorCount}
          tone="danger"
          icon={UserRound}
          onClick={() => navigate(`${base}/finance/debtors`)}
        />
        <StatCard
          label={t('owner.dashboard.todayAbsent')}
          value={absentCount}
          tone="warning"
          icon={UserX}
          onClick={() => navigate(`${base}/attendance/absent-today`)}
        />
        <StatCard
          label={t('owner.finance.payments')}
          value={formatMoney(finance.studentIncome)}
          icon={Wallet}
          tone="success"
          featured
          sparkline={getTrendSparkline(trend, 'paid')}
          delta={getTrendDelta(trend, 'paid')}
          onClick={() => navigate(`${base}/finance`)}
        />
        <StatCard
          label={t('owner.finance.expected')}
          value={formatMoney(finance.expected)}
          icon={Hourglass}
          tone="default"
          onClick={() => navigate(`${base}/finance`)}
        />
      </div>

      <section className="home-panel matte-panel home-lessons-panel">
        <div className="home-panel-head">
          <h2 className="home-panel-title">{t('owner.dashboard.todayLessons').toUpperCase()}</h2>
          <button
            type="button"
            className="home-copy-btn"
            onClick={copySchedule}
            aria-label={t('owner.dashboard.copySchedule')}
            title={copied ? t('common.copied') : t('common.copy')}
          >
            <Copy size={16} />
          </button>
        </div>
        {isSunday ? (
          <EmptyState title={t('owner.schedule.dayOff')} />
        ) : lessons.length === 0 ? (
          <EmptyState title={t('owner.schedule.noLessons')} />
        ) : (
          <div className="home-lessons">
            <div className="home-lessons-grid">
              {lessons.map((lesson) => (
                <div key={lesson.id} className="home-lesson-row">
                  <span className="home-lesson-time">{formatLessonTime(lesson)}</span>
                  <span className="home-lesson-group">{lesson.group}</span>
                  <span className="home-lesson-teacher">{lesson.teacher}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="dashboard-grid home-finance-charts">
        <RevenueTrendChart data={trend} />
        <FinancePieChart data={breakdown} />
      </div>
    </PageEnter>
  )
}
