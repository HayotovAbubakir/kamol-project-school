import { lazy, Suspense } from 'react'

// Recharts (~420 kB) dashboard raqamlaridan keyin yuklanadi: sahifa grafiklarni kutib qolmaydi.
const loadCharts = () => import('../components/charts/DashboardCharts')

function lazyChart(name, minHeight) {
  const Chart = lazy(() => loadCharts().then((module) => ({ default: module[name] })))
  function LazyChart(props) {
    return (
      <Suspense fallback={<div className="chart-card" style={{ minHeight }} aria-busy="true" />}>
        <Chart {...props} />
      </Suspense>
    )
  }
  LazyChart.displayName = `Lazy(${name})`
  return LazyChart
}

export const RevenueTrendChart = lazyChart('RevenueTrendChart', 290)
export const FinancePieChart = lazyChart('FinancePieChart', 290)
export const AttendanceBarChart = lazyChart('AttendanceBarChart', 330)
export const GroupStudentsChart = lazyChart('GroupStudentsChart', 330)
