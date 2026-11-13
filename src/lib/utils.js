import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { getRuntimeLocale, translate } from '../i18n/runtime'
import { formatPhoneDisplay } from './phone'

export function formatPhone(value) {
  return formatPhoneDisplay(value) || '—'
}

export function splitPersonName(full = '') {
  const parts = String(full).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: '', lastName: '' }
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

export function joinPersonName(firstName = '', lastName = '') {
  return [firstName, lastName].map((part) => String(part || '').trim()).filter(Boolean).join(' ')
}

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const DAYS = [
  { value: 1, get label() { return translate('domain.weekday.monday') } },
  { value: 2, get label() { return translate('domain.weekday.tuesday') } },
  { value: 3, get label() { return translate('domain.weekday.wednesday') } },
  { value: 4, get label() { return translate('domain.weekday.thursday') } },
  { value: 5, get label() { return translate('domain.weekday.friday') } },
  { value: 6, get label() { return translate('domain.weekday.saturday') } },
]

export const ATTENDANCE_STATUS = {
  present: { get label() { return translate('domain.attendance.present') }, color: '#2D6A4F' },
  late: { get label() { return translate('domain.attendance.late') }, color: '#CA8A04' },
  absent: { get label() { return translate('domain.attendance.absent') }, color: '#BB2D1E' },
}

export function parseMoneyDigits(value) {
  return String(value ?? '').replace(/\D/g, '')
}

export function formatMoneyDigits(value) {
  const digits = parseMoneyDigits(value)
  if (!digits) return ''
  return new Intl.NumberFormat(getRuntimeLocale()).format(Number(digits))
}

export function formatMoney(amount) {
  return `${new Intl.NumberFormat(getRuntimeLocale()).format(amount)} ${translate('domain.currencySuffix')}`
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  const parts = dateParts(dateStr)
  if (!parts.year) return '—'
  return new Date(parts.year, parts.month - 1, parts.day).toLocaleDateString(getRuntimeLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

/** Local calendar date as YYYY-MM-DD (UTC emas). */
export function localDateISO(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const SCHOOL_TIME_ZONE = 'Asia/Tashkent'

/** Maktab (Asia/Tashkent) kalendari bo‘yicha sana qismlari. Qurilma vaqt zonasi ta’sir qilmaydi. */
export function schoolDateParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date instanceof Date ? date : new Date(date)).map(({ type, value }) => [type, value]))
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) }
}

/** Bugungi sana Asia/Tashkent bo‘yicha (YYYY-MM-DD). */
export function todayISO() {
  const { year, month, day } = schoolDateParts()
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Date-only strings stay calendar-local; timestamps use the user's timezone. */
export function dateParts(value) {
  const s = String(value || '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.length <= 10) {
    return {
      year: Number(s.slice(0, 4)),
      month: Number(s.slice(5, 7)),
      day: Number(s.slice(8, 10)),
    }
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return { year: 0, month: 0, day: 0 }
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** Joriy oy va yil Asia/Tashkent bo‘yicha. */
export function currentMonthYear() {
  const { month, year } = schoolDateParts()
  return { month, year }
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

export function timesOverlap(aStart, aEnd, bStart, bEnd) {
  const aS = timeToMinutes(aStart)
  const aE = timeToMinutes(aEnd)
  const bS = timeToMinutes(bStart)
  const bE = timeToMinutes(bEnd)
  return aS < bE && bS < aE
}

export function getDayLabel(day) {
  return DAYS.find((d) => d.value === day)?.label ?? '—'
}

export const DEFAULT_EXPENSE_CATEGORY = 'Operatsion'

const OPERATIONAL_CATEGORY_LABELS = new Set(['Operatsion', 'Операционные', 'Operational'])

export function toStoredExpenseCategory(value) {
  const category = String(value || '').trim()
  if (!category || OPERATIONAL_CATEGORY_LABELS.has(category)) return DEFAULT_EXPENSE_CATEGORY
  return category
}

export function expenseCategoryLabel(category, t) {
  if (!category || OPERATIONAL_CATEGORY_LABELS.has(category)) return t('domain.expense.operational')
  return category
}
