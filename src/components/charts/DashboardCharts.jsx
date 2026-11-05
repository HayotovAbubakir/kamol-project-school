import { BarChart3, CircleDashed, PieChart as PieIcon } from 'lucide-react'
import GlassPane from '../GlassPane'
import { cn } from '../../lib/utils'
import { useLanguage } from '../../context/LanguageContext'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Legend,
  Pie,
  PieChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const C = {
  green: '#34d399',
  greenLight: '#5eead4',
  amber: '#fbbf24',
  coral: '#fb7185',
  muted: '#71717a',
}

const DATUM_NAME_KEYS = {
  "To'lovlar": 'chart.payments',
  'To‘lovlar': 'chart.payments',
  Оплаты: 'chart.payments',
  Payments: 'chart.payments',
  Qoldiq: 'chart.remaining',
  Остаток: 'chart.remaining',
  Remaining: 'chart.remaining',
  Maosh: 'chart.salary',
  Зарплата: 'chart.salary',
  Salary: 'chart.salary',
  Xarajat: 'chart.expenses',
  Расходы: 'chart.expenses',
  Expenses: 'chart.expenses',
  Keldi: 'chart.present',
  Пришёл: 'chart.present',
  Present: 'chart.present',
  Kechikdi: 'chart.late',
  Опоздал: 'chart.late',
  Late: 'chart.late',
  Kelmadi: 'chart.absent',
  Отсутствовал: 'chart.absent',
  Absent: 'chart.absent',
  "To'langan": 'chart.paid',
  'To‘langan': 'chart.paid',
  Оплачено: 'chart.paid',
  Paid: 'chart.paid',
  "To'lanmagan": 'chart.unpaid',
  'To‘lanmagan': 'chart.unpaid',
  'Не оплачено': 'chart.unpaid',
  Unpaid: 'chart.unpaid',
}

const DAY_NAME_KEYS = [
  ['dush', 'chart.day.mon'],
  ['sesh', 'chart.day.tue'],
  ['chor', 'chart.day.wed'],
  ['pay', 'chart.day.thu'],
  ['jum', 'chart.day.fri'],
  ['shan', 'chart.day.sat'],
  ['yak', 'chart.day.sun'],
]

function localizeDatumName(item, t) {
  if (item.nameKey) return t(item.nameKey)
  if (item.month) return t(`chart.month.${item.month}`)
  const nameKey = DATUM_NAME_KEYS[item.name]
  if (nameKey) return t(nameKey)
  const normalized = String(item.name || '').toLocaleLowerCase('uz-UZ')
  const day = DAY_NAME_KEYS.find(([prefix]) => normalized.includes(prefix))
  if (!day) return item.name
  const dayNumber = String(item.name).match(/\d+/)?.[0]
  return dayNumber ? `${t(day[1])}, ${dayNumber}` : t(day[1])
}

function localizeData(data, t) {
  return (data || []).map((item) => ({ ...item, name: localizeDatumName(item, t) }))
}

function GlassTooltip({ active, payload, label, valueType = 'money' }) {
  const { locale, t } = useLanguage()
  if (!active || !payload?.length) return null
  const item = payload[0]
  const name = item.name || label
  const value = typeof item.value === 'number'
    ? `${new Intl.NumberFormat(locale).format(item.value)}${valueType === 'count' ? '' : ` ${t('shared.currency')}`}`
    : item.value

  return (
    <div className="chart-tooltip">
      {name && <div className="chart-tooltip-label">{name}</div>}
      <div className="chart-tooltip-value">{value}</div>
    </div>
  )
}

function MultiTooltip({ active, payload, label }) {
  const { locale, t } = useLanguage()
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      {label && <div className="chart-tooltip-label">{label}</div>}
      {payload.map((p) => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color || p.stroke }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.name}</span>
          <span style={{ fontSize: 13, fontWeight: 700, marginLeft: 'auto' }}>
            {new Intl.NumberFormat(locale).format(p.value)} {t('shared.currency')}
          </span>
        </div>
      ))}
    </div>
  )
}

function ChartEmpty({ icon: Icon, label }) {
  const { t } = useLanguage()
  return (
    <div className="chart-empty">
      <div className="chart-empty-icon"><Icon size={22} /></div>
      <p>{label || t('chart.noData')}</p>
    </div>
  )
}

function ChartCard({ title, meta, children, className = '' }) {
  return (
    <GlassPane className={cn('chart-card', className)} radius={22}>
      <div className="chart-card-head">
        <h3>{title}</h3>
        {meta && <span className="chart-card-meta">{meta}</span>}
      </div>
      <div className="chart-card-body">{children}</div>
    </GlassPane>
  )
}

function hasChartData(data) {
  if (!data?.length) return false
  return data.some((d) => (d.value ?? d.davomat ?? d.students ?? 0) > 0)
}

function findPeak(data, key) {
  if (!data?.length) return null
  let peak = data[0]
  data.forEach((d) => { if ((d[key] ?? 0) > (peak[key] ?? 0)) peak = d })
  return peak[key] > 0 ? peak : null
}

export function RevenueTrendChart({ data }) {
  const { t } = useLanguage()
  const localizedData = localizeData(data, t)
  const peak = findPeak(localizedData, 'paid')
  return (
    <ChartCard title={t('chart.revenueTrend')} meta={t('chart.sixMonths')}>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={localizedData} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="paidGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.green} stopOpacity={0.5} />
              <stop offset="100%" stopColor={C.green} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="4 4" stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} width={42} />
          <Tooltip content={<MultiTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
          <Area isAnimationActive={false} type="monotone" dataKey="expected" name={t('chart.expected')} stroke={C.muted} strokeWidth={2} fill="transparent" strokeDasharray="5 4" dot={false} />
          <Area isAnimationActive={false} type="monotone" dataKey="paid" name={t('chart.payments')} stroke={C.green} strokeWidth={2.6} fill="url(#paidGrad)" dot={false} />
          {peak && (
            <ReferenceDot x={peak.name} y={peak.paid} r={5} fill={C.green} stroke="var(--matte)" strokeWidth={2}>
              <Label value={t('chart.maximum')} position="top" fill={C.green} fontSize={10} fontWeight={700} />
            </ReferenceDot>
          )}
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

export function FinancePieChart({ data }) {
  const { t } = useLanguage()
  const empty = !hasChartData(data)
  const localizedData = localizeData(data, t)
  return (
    <ChartCard title={t('chart.paymentStatus')}>
      {empty ? <ChartEmpty icon={PieIcon} /> : (
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie isAnimationActive={false} data={localizedData} cx="50%" cy="50%" innerRadius={54} outerRadius={80} paddingAngle={3} dataKey="value" nameKey="name" stroke="var(--matte)" strokeWidth={2}>
              {localizedData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
            </Pie>
            <Tooltip content={<GlassTooltip />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

export function AttendanceBarChart({ data }) {
  const { t } = useLanguage()
  const localizedData = localizeData(data, t)
  const empty = !hasChartData(localizedData)
  const peak = findPeak(localizedData, 'davomat')
  return (
    <ChartCard title={t('chart.weeklyAttendance')}>
      {empty ? <ChartEmpty icon={BarChart3} /> : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={localizedData} margin={{ top: peak ? 18 : 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={C.greenLight} stopOpacity={1} />
                <stop offset="100%" stopColor={C.green} stopOpacity={0.45} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
            <Tooltip content={<GlassTooltip valueType="count" />} />
            <Bar isAnimationActive={false} dataKey="davomat" name={t('chart.attendance')} fill="url(#barGrad)" radius={[6, 6, 0, 0]} maxBarSize={40} />
            {peak && (
              <ReferenceDot x={peak.name} y={peak.davomat} r={5} fill={C.green} stroke="var(--matte)" strokeWidth={2}>
                <Label value={peak.davomat} position="top" fill={C.green} fontSize={10} fontWeight={700} />
              </ReferenceDot>
            )}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

export function GroupStudentsChart({ data }) {
  const { t } = useLanguage()
  const empty = !data?.length
  return (
    <ChartCard title={t('chart.groups')}>
      {empty ? <ChartEmpty icon={BarChart3} label={t('chart.noGroups')} /> : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="hBarGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor={C.green} stopOpacity={0.5} />
                <stop offset="100%" stopColor={C.greenLight} stopOpacity={1} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="4 4" stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={100} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip content={<GlassTooltip valueType="count" />} />
            <Bar isAnimationActive={false} dataKey="students" name={t('chart.student')} fill="url(#hBarGrad)" radius={[0, 6, 6, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

export function PaymentStatusChart({ data }) {
  const { t } = useLanguage()
  const total = data.reduce((s, d) => s + d.value, 0)
  const localizedData = localizeData(data, t)
  return (
    <ChartCard title={t('chart.paymentStatus')}>
      {total === 0 ? <ChartEmpty icon={PieIcon} /> : (
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie isAnimationActive={false} data={localizedData} cx="50%" cy="50%" innerRadius={58} outerRadius={88} paddingAngle={4} dataKey="value" nameKey="name" stroke="var(--matte)" strokeWidth={2}>
              {localizedData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
            </Pie>
            <Tooltip content={<GlassTooltip valueType="count" />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: 'var(--muted)' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  )
}

export function AttendanceDonutChart({ data, date }) {
  const { t } = useLanguage()
  const total = data.reduce((s, d) => s + d.value, 0)
  const meta = date ? date.slice(5).replace('-', '/') : undefined
  const localizedData = localizeData(data, t)
  return (
    <ChartCard title={t('chart.todayAttendance')} meta={meta}>
      {total === 0 ? (
        <div className="donut-wrap"><ChartEmpty icon={CircleDashed} label={t('chart.notMarked')} /></div>
      ) : (
        <>
          <div className="donut-wrap">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie isAnimationActive={false} data={localizedData} cx="50%" cy="50%" innerRadius={62} outerRadius={88} paddingAngle={3} dataKey="value" nameKey="name" stroke="var(--matte)" strokeWidth={2}>
                  {localizedData.map((entry, i) => <Cell key={entry.name || i} fill={entry.fill} />)}
                </Pie>
                <Tooltip content={<GlassTooltip valueType="count" />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-center"><strong>{total}</strong><span>{t('chart.total')}</span></div>
          </div>
          <div className="legend-row">
            {localizedData.filter((d) => d.value > 0).map((d) => (
              <div key={d.name} className="legend-item"><span style={{ background: d.fill }} />{d.name}: {d.value}</div>
            ))}
          </div>
        </>
      )}
    </ChartCard>
  )
}
