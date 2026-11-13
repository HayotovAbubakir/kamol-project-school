import { groupFeeForMonth } from '../../shared/fees.js'
import { miniLocale, t } from './i18n.js'

export const SCHOOL_TZ = 'Asia/Tashkent'

export function monthName(month) {
  return t(['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'][Number(month) - 1] || '')
}

export function weekdayShort(day) {
  return t(['Dush.', 'Sesh.', 'Chor.', 'Pay.', 'Juma', 'Shan.', 'Yak.'][Number(day) - 1] || '')
}

export function weekdayLong(day) {
  return t(['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'][Number(day) - 1] || '')
}

export function paymentMethodLabel(method) {
  return t({ cash: 'Naqd', card: 'Karta', transfer: 'O‘tkazma' }[method] || method || '')
}

export function money(value) {
  return `${Math.round(Number(value) || 0).toLocaleString('uz-UZ').replace(/,/g, ' ')} ${t('so‘m')}`
}

export function tashkentToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export function tashkentMonthYear() {
  const [year, month] = tashkentToday().split('-').map(Number)
  return { month, year }
}

export function displayIsoDate(value) {
  if (!value) return '—'
  const [year, month, day] = String(value).slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

export function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(miniLocale(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: SCHOOL_TZ }).format(date)
}

export function isoWeekday(isoDate) {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay()
  return day === 0 ? 7 : day
}

/** O‘quvchi oylik summasi: a’zo guruhlar narxi yig‘indisi (o‘sha oy narxida). */
export function studentFee(student, groups, month, year) {
  const byId = new Map(groups.map((group) => [group.id, group]))
  return (student.group_ids || []).reduce((sum, groupId) => {
    const group = byId.get(groupId)
    return group ? sum + groupFeeForMonth(group.monthly_fee, group.feeHistory, month, year) : sum
  }, 0)
}

export function paidForMonth(payments, studentId, month, year) {
  return payments
    .filter((item) => item.student_id === studentId && !item.voided_at
      && Number(item.month) === Number(month) && Number(item.year) === Number(year))
    .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
}

/** Qarzdorlar: oylik summasi bor va to‘liq to‘lamaganlar, eng katta qarz birinchi. */
export function debtorsFor(students, groups, payments, month, year) {
  return students
    .map((student) => {
      const fee = studentFee(student, groups, month, year)
      const paid = paidForMonth(payments, student.id, month, year)
      return { student, fee, paid, remaining: Math.max(0, fee - paid) }
    })
    .filter((row) => row.fee > 0 && row.remaining > 0)
    .sort((left, right) => right.remaining - left.remaining || left.student.name.localeCompare(right.student.name))
}

export function telLink(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '')
  return digits ? `tel:${digits}` : ''
}
