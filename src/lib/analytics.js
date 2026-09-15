import { studentMonthlyFee, studentPaidForMonth, isStudentDebtor, slotTeacherId } from './store'
import { dateParts, localDateISO } from './utils'
import { getRuntimeLocale, translate } from '../i18n/runtime'

const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
]

export function getLast6MonthsTrend(data) {
  const now = new Date()
  const expected = data.students.reduce(
    (sum, s) => sum + (Number(s.monthlyFee) || studentMonthlyFee(s, data.groups) || 0),
    0,
  )
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const month = d.getMonth() + 1
    const year = d.getFullYear()
    const paid = data.payments
      .filter((p) => Number(p.month) === month && Number(p.year) === year)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0)
    return {
      name: translate(`domain.month.${MONTH_KEYS[month - 1]}`),
      nameKey: `chart.month.${month}`,
      month,
      year,
      paid,
      expected,
      income: paid,
    }
  })
}

export function getFinanceBreakdown(data, month, year) {
  const paid = data.payments
    .filter((p) => Number(p.month) === month && Number(p.year) === year)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const expected = data.students.reduce(
    (sum, s) => sum + (Number(s.monthlyFee) || studentMonthlyFee(s, data.groups) || 0),
    0,
  )
  const remaining = Math.max(0, expected - paid)
  return [
    { name: translate('domain.finance.payments'), nameKey: 'domain.finance.payments', value: paid, fill: '#34d399' },
    { name: translate('domain.finance.remaining'), nameKey: 'domain.finance.remaining', value: remaining, fill: '#fb7185' },
  ].filter((x) => x.value > 0)
}

export function getAttendanceBreakdown(data, date) {
  const records = data.attendance.filter((a) => a.date === date)
  const present = records.filter((a) => a.status === 'present').length
  const late = records.filter((a) => a.status === 'late').length
  const absent = records.filter((a) => a.status === 'absent').length
  return [
    { name: translate('domain.attendance.present'), nameKey: 'domain.attendance.present', value: present, fill: '#34d399' },
    { name: translate('domain.attendance.late'), nameKey: 'domain.attendance.late', value: late, fill: '#fbbf24' },
    { name: translate('domain.attendance.absent'), nameKey: 'domain.attendance.absent', value: absent, fill: '#fb7185' },
  ]
}

export function getStudentsPerGroup(data) {
  return data.groups.map((g) => ({
    name: g.name.length > 18 ? `${g.name.slice(0, 16)}…` : g.name,
    students: g.studentIds.length,
  }))
}

export function getPaymentStatus(data, month, year) {
  let paid = 0
  let unpaid = 0
  data.students.forEach((s) => {
    const fee = Number(s.monthlyFee) || 0
    if (fee <= 0) return
    if (studentPaidForMonth(data.payments, s.id, month, year, fee)) paid += 1
    else unpaid += 1
  })
  return [
    { name: translate('domain.payment.paid'), nameKey: 'domain.payment.paid', value: paid, fill: '#34d399' },
    { name: translate('domain.payment.unpaid'), nameKey: 'domain.payment.unpaid', value: unpaid, fill: '#fb7185' },
  ]
}

export function getWeeklyAttendance(data, groupIds = null) {
  const days = []
  const now = new Date()
  const allow = groupIds ? new Set(groupIds) : null
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    const iso = localDateISO(d)
    const label = d.toLocaleDateString(getRuntimeLocale(), { weekday: 'short', day: 'numeric' })
    const count = data.attendance.filter((a) => {
      if (a.date !== iso) return false
      if (allow && !allow.has(a.groupId)) return false
      return true
    }).length
    days.push({ name: label, davomat: count })
  }
  return days
}

export function formatCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

export function getTrendSparkline(trend, key) {
  return trend.map((t) => t[key] ?? 0)
}

export function getTrendDelta(trend, key) {
  if (!trend?.length || trend.length < 2) return null
  const prev = trend[trend.length - 2][key] ?? 0
  const curr = trend[trend.length - 1][key] ?? 0
  if (prev === 0) return curr === 0 ? 0 : 100
  return Math.round(((curr - prev) / Math.abs(prev)) * 100)
}

export function getScheduleDayForDate(dateInput) {
  const date = typeof dateInput === 'string'
    ? new Date(`${dateInput}T12:00:00`)
    : dateInput
  const jsDay = date.getDay()
  return jsDay === 0 ? 7 : jsDay
}

export function getTodayDayValue() {
  return getScheduleDayForDate(new Date())
}

export function groupHasLessonOnDate(group, dateStr, teacherId = null) {
  const day = getScheduleDayForDate(dateStr)
  return (group.schedule || []).some((slot) => {
    if (slot.day !== day) return false
    if (teacherId && slotTeacherId(slot, group) !== teacherId) return false
    return true
  })
}

export function getGroupLessonSlotsOnDate(group, dateStr, teacherId = null) {
  const day = getScheduleDayForDate(dateStr)
  return (group.schedule || []).filter((slot) => {
    if (slot.day !== day) return false
    if (teacherId && slotTeacherId(slot, group) !== teacherId) return false
    return true
  })
}

export function getTodayLessons(data) {
  const day = getTodayDayValue()
  if (!day) return []
  const lessons = []
  for (const group of data.groups) {
    for (const slot of group.schedule || []) {
      if (slot.day !== day) continue
      const tid = slotTeacherId(slot, group)
      const teacher = data.teachers.find((t) => t.id === tid)
      lessons.push({
        id: `${group.id}-${slot.day}-${slot.startTime}-${tid || 'none'}`,
        time: slot.startTime,
        endTime: slot.endTime,
        group: group.name,
        teacher: teacher?.name ?? '—',
      })
    }
  }
  return lessons.sort((a, b) => a.time.localeCompare(b.time))
}

export function formatLessonTime(lesson) {
  if (!lesson?.time) return '—'
  if (lesson.endTime) return `${lesson.time}–${lesson.endTime}`
  return lesson.time
}

export function getTodayAttendancePercent(data, date) {
  const records = data.attendance.filter((a) => a.date === date)
  if (!records.length) return null
  const attended = records.filter((a) => a.status === 'present' || a.status === 'late').length
  return Math.round((attended / records.length) * 100)
}

export function getDebtorCount(data, month, year) {
  return data.students.filter(
    (s) => isStudentDebtor(data.payments, s.id, month, year, s.monthlyFee),
  ).length
}

/** Bugun darsi bor guruhlarda "absent" deb belgilangan o'quvchilar */
export function getTodayAbsentStudents(data, date) {
  const day = getTodayDayValue()
  if (!day) return []

  const todayGroupIds = new Set()
  const groupMeta = {}
  for (const group of data.groups) {
    const hasLesson = (group.schedule || []).some((slot) => slot.day === day)
    if (!hasLesson) continue
    todayGroupIds.add(group.id)
    groupMeta[group.id] = group
  }
  if (!todayGroupIds.size) return []

  const byStudent = new Map()
  for (const record of data.attendance) {
    if (record.date !== date) continue
    if (record.status !== 'absent') continue
    if (!todayGroupIds.has(record.groupId)) continue
    const student = data.students.find((s) => s.id === record.studentId)
    if (!student) continue
    const group = groupMeta[record.groupId]
    const existing = byStudent.get(student.id)
    const entry = {
      id: student.id,
      name: student.name,
      phone: student.phone,
      parentPhone: student.parentPhone,
      groupId: record.groupId,
      groupName: group?.name ?? '—',
    }
    if (!existing) byStudent.set(student.id, entry)
  }
  return [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'uz'))
}

export function getTodayAbsentCount(data, date) {
  return getTodayAbsentStudents(data, date).length
}

export function getFrequentAbsenteeCount(data, minAbsences = 3, days = 30) {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const sinceIso = localDateISO(since)
  const counts = {}
  data.attendance
    .filter((a) => a.date >= sinceIso && a.status === 'absent')
    .forEach((a) => {
      counts[a.studentId] = (counts[a.studentId] || 0) + 1
    })
  return Object.values(counts).filter((c) => c >= minAbsences).length
}

export function getActiveGroupCount(data) {
  return data.groups.filter((g) => g.studentIds.length > 0).length
}
