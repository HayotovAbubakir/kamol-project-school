import {
  AlertCircle,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
} from 'lucide-react'
import {
  AttendanceBarChart,
  AttendanceDonutChart,
  GroupStudentsChart,
  PaymentStatusChart,
} from '../../components/charts/DashboardCharts'
import { PageEnter, Stagger, StaggerItem } from '../../components/motion/PageMotion'
import { StatCard } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useLanguage } from '../../context/LanguageContext'
import {
  getAttendanceBreakdown,
  getPaymentStatus,
  getStudentsPerGroup,
  getWeeklyAttendance,
} from '../../lib/analytics'
import { isStudentDebtor } from '../../lib/store'
import { currentMonthYear, todayISO } from '../../lib/utils'

export default function AdminDashboard() {
  const { data } = useData()
  const { t } = useLanguage()
  const { month, year } = currentMonthYear()
  const unpaid = data.students.filter((s) => isStudentDebtor(data.payments, s.id, month, year, s.monthlyFee)).length
  const todayAttendance = data.attendance.filter((a) => a.date === todayISO()).length
  const paymentChart = getPaymentStatus(data, month, year)
  const groupsChart = getStudentsPerGroup(data)
  const weeklyAttendance = getWeeklyAttendance(data)
  const todayBreakdown = getAttendanceBreakdown(data, todayISO())

  return (
    <PageEnter>
      <div className="finance-highlight">
        <StatCard
          label={t('admin.attendance.title')}
          value={todayAttendance}
          icon={ClipboardCheck}
          tone="success"
          featured
        />
        <StatCard
          label={t('admin.status.unpaid')}
          value={unpaid}
          icon={AlertCircle}
          tone={unpaid ? 'danger' : 'success'}
        />
        <StatCard label={t('nav.students')} value={data.students.length} icon={GraduationCap} tone="info" />
        <StatCard label={t('nav.groups')} value={data.groups.length} icon={BookOpen} tone="default" />
      </div>

      <Stagger className="dashboard-grid dashboard-grid-3" delay={0.06}>
        <StaggerItem><PaymentStatusChart data={paymentChart} /></StaggerItem>
        <StaggerItem><GroupStudentsChart data={groupsChart} /></StaggerItem>
        <StaggerItem><AttendanceDonutChart data={todayBreakdown} date={todayISO()} /></StaggerItem>
      </Stagger>

      <Stagger delay={0.06}>
        <StaggerItem><AttendanceBarChart data={weeklyAttendance} /></StaggerItem>
      </Stagger>
    </PageEnter>
  )
}
