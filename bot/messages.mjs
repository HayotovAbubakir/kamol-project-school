const STATUS = {
  present: 'Keldi',
  late: 'Kechikdi',
  absent: 'Kelmadi',
}

const METHOD = {
  cash: 'naqd',
  card: 'karta',
  transfer: 'o‘tkazma',
}

export function formatMoney(amount) {
  const n = Math.round(Number(amount) || 0)
  return `${n.toLocaleString('uz-UZ')} so‘m`
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  return new Intl.DateTimeFormat('uz-UZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tashkent',
  }).format(d)
}

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

export function monthLabel(month) {
  return MONTHS[Number(month) - 1] || String(month)
}

function formatDateOnly(value) {
  const [year, month, day] = String(value || '').slice(0, 10).split('-')
  return year && month && day ? `${day}.${month}.${year}` : String(value || '—')
}

export function menuText() {
  return 'Kerakli bo‘limni tanlang.'
}

export function welcomeAskCode() {
  return [
    'Assalomu alaykum! Kamol School boti.',
    '',
    'Farzandingizning o‘quvchi ID raqamini yuboring.',
    'Masalan: KS-A7F2C9',
  ].join('\n')
}

export function linkedOk(student) {
  return [
    `Bog‘landi: ${student.name}`,
    `ID: ${student.public_code}`,
    '',
    menuText(),
  ].join('\n')
}

export function alreadyLinked(student) {
  return [
    `Siz allaqachon bog‘langansiz: ${student.name}`,
    `ID: ${student.public_code}`,
    '',
    menuText(),
  ].join('\n')
}

export function codeNotFound() {
  return 'Bunday ID topilmadi. Tekshirib, qayta yuboring. Masalan: KS-A7F2C9'
}

export function needLink() {
  return 'Avval o‘quvchi ID raqamini yuboring. Boshlash: /start'
}

export function unlinked() {
  return 'Bog‘lanish uzildi. Qayta ulash: /start'
}

export function statusText({ student, groups, expected, paid, remaining, month, year }) {
  const groupLines = groups.length
    ? groups.map((g) => `• ${g.name} — ${formatMoney(g.monthly_fee)}`).join('\n')
    : '• Guruh yo‘q'
  return [
    `${student.name} · ${monthLabel(month)} ${year}`,
    '',
    groupLines,
    '',
    `Kerak: ${formatMoney(expected)}`,
    `To‘langan: ${formatMoney(paid)}`,
    remaining > 0 ? `Qarz: ${formatMoney(remaining)}` : 'To‘liq to‘langan ✅',
  ].join('\n')
}

export function attendanceText(rows) {
  if (!rows.length) return 'Oxirgi 14 kunda davomat yo‘q.'
  const lines = rows.map((row) => {
    const status = STATUS[row.status] || row.status
    const group = row.groups?.name || '—'
    return `${formatDateOnly(row.date)} — ${status} (${group})${row.note ? `\n  Izoh: ${row.note}` : ''}`
  })
  return ['Davomat · 14 kun', '', ...lines].join('\n')
}

export function scheduleText(rows) {
  if (!rows.length) return 'Yaqin 14 kunda dars yo‘q.'
  const weekdays = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba']
  const lines = rows.map((lesson) => {
    const date = lesson.date || ''
    const parsedDate = new Date(`${date}T12:00:00Z`)
    const weekday = Number.isNaN(parsedDate.getTime()) ? '' : weekdays[parsedDate.getUTCDay()]
    const status = lesson.status === 'cancelled'
      ? ' · BEKOR QILINGAN'
      : lesson.status === 'rescheduled'
        ? ` · KO‘CHIRILDI${lesson.newDate ? ` → ${formatDateOnly(lesson.newDate)}` : ''}`
        : lesson.status === 'changed' ? ' · O‘ZGARTIRILGAN' : ''
    return `• ${formatDateOnly(date)} (${weekday}) · ${lesson.startTime || '—'}–${lesson.endTime || '—'} · ${lesson.groupName}${status}${lesson.reason ? `\n  Sabab: ${lesson.reason}` : ''}`
  })
  return ['Jadval · 14 kun', '', ...lines].join('\n')
}

/** To‘lov yozuvida guruh saqlanmaydi — faqat qaysi oy uchun va qanday to‘langani ko‘rsatiladi. */
export function paymentsText(rows) {
  if (!rows.length) return 'To‘lov yo‘q.'
  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const lines = rows.map((row) => {
    const method = METHOD[row.method] ? ` (${METHOD[row.method]})` : ''
    return `• ${String(row.month).padStart(2, '0')}.${row.year} — ${formatMoney(row.amount)}${method} · ${formatDateTime(row.paid_at).slice(0, 10)}`
  })
  return [`To‘lovlar · jami ${formatMoney(total)}`, '', ...lines].join('\n')
}

export function attendancePush({ studentName, groupName, status, date, note }) {
  const label = STATUS[status] || status
  const parts = [
    `${studentName} — ${label}`,
    `${formatDateOnly(date)} · ${groupName || '—'}`,
  ]
  if (note) parts.push(note)
  return parts.join('\n')
}

export function paymentPush({ studentName, amount, month, year }) {
  return [
    `To‘lov qabul qilindi ✅`,
    `${studentName} — ${formatMoney(amount)}`,
    `${monthLabel(month)} ${year}`,
  ].join('\n')
}
