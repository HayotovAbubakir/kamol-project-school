const STATUS = {
  present: 'Keldi',
  late: 'Kechikdi',
  absent: 'Kelmadi',
}

export function formatMoney(amount) {
  const n = Math.round(Number(amount) || 0)
  return `${n.toLocaleString('uz-UZ')} so'm`
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month}.${year} ${hh}:${mm}`
}

export function menuText() {
  return [
    'Pastdagi tugmalardan tanlang:',
    '• Holat — shu oy to‘lov va guruhlar',
    '• Davomat — oxirgi 14 kun',
    '• To‘lovlar tarixi — barcha to‘lovlar',
    '• Uzish — bog‘lashni uzish',
  ].join('\n')
}

export function welcomeAskCode() {
  return [
    'Assalomu alaykum!',
    'Bu Kamol School ota-ona boti.',
    '',
    'Farzandingizning o‘quvchi ID sini yuboring.',
    'Masalan: KS-A7F2K9',
    '',
    'ID ni maktab administratsiyasidan olishingiz mumkin.',
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
  return 'Bunday o‘quvchi ID topilmadi. Qayta tekshirib yuboring (masalan KS-A7F2K9).'
}

export function needLink() {
  return 'Avval o‘quvchi ID sini yuboring. /start ni bosing.'
}

export function unlinked() {
  return 'Bog‘lash uzildi. Qayta ulash uchun /start bosing va yangi ID yuboring.'
}

export function statusText({ student, groups, expected, paid, remaining, month, year }) {
  const groupLines = groups.length
    ? groups.map((g) => `• ${g.name} — oylik ${formatMoney(g.monthly_fee)}`).join('\n')
    : '• Guruhga biriktirilmagan'
  return [
    `Holat: ${student.name}`,
    `Oy: ${month}.${year}`,
    '',
    'Guruhlar:',
    groupLines,
    '',
    `Jami kerak: ${formatMoney(expected)}`,
    `To‘langan: ${formatMoney(paid)}`,
    `Qoldiq: ${formatMoney(remaining)}`,
  ].join('\n')
}

export function attendanceText(rows) {
  if (!rows.length) return 'Oxirgi 14 kunda davomat yozuvi yo‘q.'
  const lines = rows.map((row) => {
    const status = STATUS[row.status] || row.status
    const group = row.groups?.name || '—'
    return `${row.date} — ${status} (${group})`
  })
  return ['Oxirgi 14 kun davomat:', ...lines].join('\n')
}

/** To‘lovni guruh oyliklariga proporsional taqsimlash */
function splitPaymentByGroups(amount, groups) {
  const list = Array.isArray(groups) ? groups : []
  const totalFee = list.reduce((sum, g) => sum + (Number(g.monthly_fee) || 0), 0)
  if (!list.length || totalFee <= 0) {
    return [{ name: 'Umumiy', share: amount }]
  }
  return list.map((g) => {
    const fee = Number(g.monthly_fee) || 0
    const share = amount * (fee / totalFee)
    return { name: g.name, share, fee }
  })
}

export function paymentsText(rows, groups = []) {
  if (!rows.length) return 'Hali to‘lov yozuvi yo‘q.'

  const total = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const blocks = rows.map((row, index) => {
    const amount = Number(row.amount) || 0
    const shares = splitPaymentByGroups(amount, groups)
    const shareLines = shares
      .map((s) => `   → ${s.name}: ${formatMoney(s.share)}`)
      .join('\n')
    return [
      `${index + 1}) ${formatDateTime(row.paid_at)}`,
      `   Summa: ${formatMoney(amount)}`,
      `   Oy: ${row.month}.${row.year}`,
      '   Guruhlar bo‘yicha:',
      shareLines,
    ].join('\n')
  })

  return [
    'Jami to‘lovlar tarixi:',
    `Jami: ${formatMoney(total)} (${rows.length} ta)`,
    '',
    ...blocks,
  ].join('\n')
}

export function attendancePush({ studentName, groupName, status, date, note }) {
  const label = STATUS[status] || status
  const parts = [
    `Davomat: ${studentName}`,
    `Sana: ${date}`,
    `Guruh: ${groupName || '—'}`,
    `Holat: ${label}`,
  ]
  if (note) parts.push(`Izoh: ${note}`)
  return parts.join('\n')
}

export function paymentPush({ studentName, amount, month, year }) {
  return [
    `To‘lov qabul qilindi: ${studentName}`,
    `Summa: ${formatMoney(amount)}`,
    `Oy: ${month}.${year}`,
  ].join('\n')
}
