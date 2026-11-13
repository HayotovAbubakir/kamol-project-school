import { currentMonthYear, dateParts, timesOverlap, timeToMinutes, todayISO } from './utils'
import { translate } from '../i18n/runtime'
import { groupFeeForMonth } from '../../shared/fees.js'

/** Pure helpers kept for charts / UI (no localStorage). */

/** Dars slotidagi o‘qituvchi (slot > guruh fallback) */
export function slotTeacherId(slot, group = null) {
  return slot?.teacherId || slot?.teacher_id || group?.teacherId || group?.teacher_id || null
}

export function groupTeacherIds(group) {
  const ids = new Set()
  for (const slot of group?.schedule || []) {
    const id = slotTeacherId(slot, group)
    if (id) ids.add(id)
  }
  if (group?.teacherId) ids.add(group.teacherId)
  return [...ids]
}

export function groupHasTeacherAssigned(group) {
  return groupTeacherIds(group).length > 0
}

export function groupTeachesTeacher(group, teacherId) {
  if (!teacherId) return false
  return groupTeacherIds(group).includes(teacherId)
}

export function groupsForTeacher(groups, teacherId) {
  return (groups || []).filter((g) => groupTeachesTeacher(g, teacherId))
}

export function teacherSlotsInGroup(group, teacherId) {
  if (!teacherId) return []
  return (group?.schedule || []).filter((slot) => slotTeacherId(slot, group) === teacherId)
}

/** Guruh ustuni teacher_id — birinchi slot o‘qituvchisi (RLS / qisqa ko‘rsatish) */
export function primaryGroupTeacherId(group) {
  for (const slot of group?.schedule || []) {
    if (slot?.teacherId) return slot.teacherId
  }
  return group?.teacherId || null
}

export function validateScheduleSlots(schedule = [], { requireTeacher = false } = {}) {
  const slots = Array.isArray(schedule) ? schedule : []
  for (const slot of slots) {
    if (!slot.startTime || !slot.endTime) return translate('domain.error.scheduleTimesRequired')
    if (timeToMinutes(slot.endTime) <= timeToMinutes(slot.startTime)) {
      return translate('domain.error.scheduleEndAfterStart')
    }
    if (requireTeacher && !slot.teacherId) return translate('domain.error.slotTeacherRequired')
  }
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      if (slots[i].day !== slots[j].day) continue
      if (timesOverlap(slots[i].startTime, slots[i].endTime, slots[j].startTime, slots[j].endTime)) {
        return translate('domain.error.scheduleOverlap')
      }
    }
  }
  return null
}

export function validateGroupSchedule(groups, group, excludeId = null, options = {}) {
  const slotError = validateScheduleSlots(group.schedule, options)
  if (slotError) return slotError

  const others = groups.filter((g) => g.id !== excludeId)
  for (const slot of group.schedule || []) {
    const teacherId = slotTeacherId(slot, group)
    if (!teacherId) continue
    for (const other of others) {
      for (const otherSlot of other.schedule || []) {
        if (slot.day !== otherSlot.day) continue
        if (!timesOverlap(slot.startTime, slot.endTime, otherSlot.startTime, otherSlot.endTime)) continue
        if (teacherId === slotTeacherId(otherSlot, other)) {
          return translate('domain.error.teacherBusy', { name: other.name })
        }
      }
    }
  }
  return null
}

// To‘lovlar massivi o‘zgarmas (React holati) — har massiv uchun bir marta indekslanadi:
// qarzdorlar ro‘yxati endi O(o‘quvchi × to‘lov) emas, O(o‘quvchi + to‘lov).
const paidIndexCache = new WeakMap()

function paidKey(studentId, month, year) {
  return `${typeof studentId}:${studentId}|${month}|${year}`
}

function paidIndex(payments) {
  let index = paidIndexCache.get(payments)
  if (!index) {
    index = new Map()
    for (const p of payments) {
      const month = Number(p.month)
      const year = Number(p.year)
      if (p.voidedAt || Number.isNaN(month) || Number.isNaN(year)) continue
      const key = paidKey(p.studentId, month, year)
      index.set(key, (index.get(key) || 0) + (Number(p.amount) || 0))
    }
    paidIndexCache.set(payments, index)
  }
  return index
}

export function amountPaidForMonth(payments, studentId, month, year) {
  const m = Number(month)
  const y = Number(year)
  if (Number.isNaN(m) || Number.isNaN(y)) return 0
  return paidIndex(payments).get(paidKey(studentId, m, y)) || 0
}

/** Guruh narxi: oy berilsa — o‘sha oydagi narx (narx tarixi bo‘yicha), aks holda hozirgi narx. */
export function groupMonthlyFee(group, month, year) {
  if (!group) return 0
  if (!month || !year) return Number(group.monthlyFee) || 0
  return groupFeeForMonth(group.monthlyFee, group.feeHistory, month, year)
}

/** O‘quvchi to‘lovi = a’zo bo‘lgan guruhlar oylik to‘lovlari yig‘indisi (oy berilsa — o‘sha oy narxida). */
export function studentMonthlyFee(student, groups = [], month, year) {
  const ids = student?.groupIds || []
  if (!ids.length) return 0
  return ids.reduce((sum, groupId) => {
    const group = groups.find((g) => g.id === groupId)
    return sum + groupMonthlyFee(group, month, year)
  }, 0)
}

export function withComputedStudentFees(students = [], groups = []) {
  return students.map((student) => ({
    ...student,
    monthlyFee: studentMonthlyFee(student, groups),
  }))
}

export function studentPaidForMonth(payments, studentId, month, year, monthlyFee = 0) {
  const paid = amountPaidForMonth(payments, studentId, month, year)
  const fee = Number(monthlyFee) || 0
  // Guruh yo‘q / oylik 0 — qarzdor emas
  if (fee <= 0) return true
  return paid >= fee
}

export function isStudentDebtor(payments, studentId, month, year, monthlyFee = 0) {
  const fee = Number(monthlyFee) || 0
  if (fee <= 0) return false
  return !studentPaidForMonth(payments, studentId, month, year, fee)
}

export function remainingFee(student, payments, month, year, groups = null) {
  const fee = groups
    ? studentMonthlyFee(student, groups, month, year)
    : (Number(student?.monthlyFee) || 0)
  return Math.max(0, fee - amountPaidForMonth(payments, student?.id, month, year))
}

/** To‘lovni guruh ulushiga taqsimlash (ko‘p guruhda proporsional) */
export function amountAttributedToGroup(payments, student, group, groups, month, year) {
  const paid = amountPaidForMonth(payments, student?.id, month, year)
  const groupFee = groupMonthlyFee(group, month, year)
  if (groupFee <= 0 || paid <= 0) return 0
  const totalFee = studentMonthlyFee(student, groups, month, year)
  if (totalFee <= 0) return 0
  if (totalFee === groupFee) return paid
  return paid * (groupFee / totalFee)
}

export function recentMonthYears(count = 6) {
  const { month, year } = currentMonthYear()
  const out = []
  let m = month
  let y = year
  for (let i = 0; i < count; i += 1) {
    out.push({ month: m, year: y })
    m -= 1
    if (m < 1) {
      m = 12
      y -= 1
    }
  }
  return out
}

/** Guruh bo‘yicha oy moliyasi: kerak / to‘langan / qoldiq + o‘quvchilar */
export function getGroupMonthFinance(group, members, payments, groups, month, year) {
  const fee = groupMonthlyFee(group, month, year)
  const expected = members.length * fee
  let collected = 0
  const rows = members.map((student) => {
    const attributed = amountAttributedToGroup(payments, student, group, groups, month, year)
    const towardFee = Math.min(attributed, fee)
    collected += towardFee
    const due = Math.max(0, fee - towardFee)
    const fullyPaid = fee > 0 ? towardFee >= fee - 0.009 : attributed > 0
    const partial = !fullyPaid && towardFee > 0
    return {
      student,
      paid: towardFee,
      due,
      fullyPaid,
      partial,
    }
  })
  return {
    fee,
    expected,
    collected,
    remaining: Math.max(0, expected - collected),
    rows,
  }
}

export function getFinanceSummary(data) {
  const { month, year } = currentMonthYear()
  const studentIncome = data.payments
    .filter((p) => !p.voidedAt && Number(p.month) === month && Number(p.year) === year)
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const expected = data.students.reduce((sum, s) => sum + studentMonthlyFee(s, data.groups, month, year), 0)
  const remaining = Math.max(0, expected - studentIncome)
  const salaryPaid = data.salaryPayments
    .filter((p) => {
      const parts = dateParts(p.paidAt)
      return parts.month === month && parts.year === year
    })
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  const expenses = data.expenses
    .filter((e) => {
      const parts = dateParts(e.date)
      return parts.month === month && parts.year === year
    })
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
  const netProfit = studentIncome - salaryPaid - expenses
  return { studentIncome, expected, remaining, salaryPaid, expenses, netProfit, month, year }
}

export { todayISO, currentMonthYear }
