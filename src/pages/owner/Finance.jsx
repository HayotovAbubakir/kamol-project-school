import { Hourglass, Wallet } from 'lucide-react'
import { FinancePieChart, RevenueTrendChart } from '../../components/charts/DashboardCharts'
import { PageEnter } from '../../components/motion/PageMotion'
import { StatCard } from '../../components/ui'
import { getFinanceBreakdown, getLast6MonthsTrend, getTrendDelta, getTrendSparkline } from '../../lib/analytics'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import { getFinanceSummary } from '../../lib/store'
import { currentMonthYear, formatMoney } from '../../lib/utils'

export default function OwnerFinance() {
  const { data } = useData()
  const { t } = useLanguage()
  const finance = getFinanceSummary(data)
  const { month, year } = currentMonthYear()
  const trend = getLast6MonthsTrend(data)
  const breakdown = getFinanceBreakdown(data, month, year)

  return (
    <PageEnter className="finance-page">
      <div className="stat-grid stat-grid-2">
        <StatCard
          label={t('owner.finance.payments')}
          value={formatMoney(finance.studentIncome)}
          icon={Wallet}
          tone="success"
          featured
          sparkline={getTrendSparkline(trend, 'paid')}
          delta={getTrendDelta(trend, 'paid')}
        />
        <StatCard
          label={t('owner.finance.expected')}
          value={formatMoney(finance.expected)}
          icon={Hourglass}
          tone="default"
        />
      </div>

      <div className="dashboard-grid">
        <RevenueTrendChart data={trend} />
        <FinancePieChart data={breakdown} />
      </div>
    </PageEnter>
  )
}
