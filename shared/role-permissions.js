export const ROLES = Object.freeze(['owner', 'reception', 'teacher', 'student'])

const read = Object.freeze(['select'])
const manage = Object.freeze(['select', 'insert', 'update', 'delete', 'upsert'])

export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze({
    label: 'Egasi',
    tables: '*',
    endpoints: '*',
    pages: '*',
    descriptions: ['Barcha sahifalar, ma’lumotlar va amallar'],
  }),
  reception: Object.freeze({
    label: 'Qabulxona',
    tables: Object.freeze({
      teachers: read,
      groups: ['select', 'insert', 'update'],
      students: ['select', 'insert', 'update'],
      group_students: manage,
      group_fee_history: read,
      telegram_links: read,
      payments: ['select', 'insert', 'update'],
      payment_audit: read,
      homework_review_history: read,
      attendance: read,
      homework: read,
      homework_submissions: read,
      monthly_homework_report: read,
    }),
    endpoints: Object.freeze([
      'auth:staff', 'student:telegram-invite', 'homework:read', 'questions:inbox',
      'questions:reply', 'files:homework-access', 'files:all-homework', 'data:staff-wide-read',
      'data:reception-row-write', 'data:staff-wide-query', 'schedule:read', 'schedule:manage',
      'face:manage',
    ]),
    pages: Object.freeze(['reception', 'students', 'groups', 'teachers', 'schedule', 'payments', 'attendance', 'homework', 'questions']),
    descriptions: Object.freeze([
      'O‘quvchilarni qo‘shish, tahrirlash va guruhga biriktirish',
      'Guruhlar va jadvallarni yaratish va tahrirlash',
      'O‘qituvchilar, davomat va uy vazifasi holatini ko‘rish',
      'To‘lov qabul qilish va to‘lov holatini ko‘rish',
      'O‘quvchiga Telegram ulash havolasi yaratish',
      'Savol-javoblar bilan ishlash',
      'O‘quvchining Face ID rasmlarini olish va yangilash',
    ]),
  }),
  teacher: Object.freeze({
    label: 'O‘qituvchi',
    tables: Object.freeze({
      teachers: read,
      groups: read,
      students: read,
      group_students: read,
      attendance: ['select', 'insert', 'update', 'upsert'],
      homework: ['select', 'insert', 'update'],
      homework_submissions: read,
      homework_review_history: read,
    }),
    endpoints: Object.freeze(['auth:staff', 'homework:read-write', 'attendance:mark', 'files:homework-access', 'questions:inbox', 'questions:reply', 'schedule:read', 'schedule:manage-own']),
    pages: Object.freeze(['teacher', 'groups', 'attendance', 'schedule', 'homework', 'questions']),
    descriptions: Object.freeze([
      'Faqat biriktirilgan guruh va o‘quvchilar',
      'Davomat Face ID orqali; qo‘lda belgilash — zaxira usul',
      'Uy vazifasi yaratish va topshiriqlarni tekshirish',
      'Faqat o‘z guruhiga tegishli savol-ticketlarni ko‘rish va javob berish',
    ]),
  }),
  student: Object.freeze({
    label: 'O‘quvchi',
    tables: Object.freeze({ homework_review_history: read }),
    endpoints: Object.freeze(['miniapp:student', 'files:homework-access', 'questions:create', 'schedule:read', 'notifications:read']),
    pages: Object.freeze(['miniapp:student', 'questions']),
    descriptions: Object.freeze([
      'Faqat Telegram bot va Mini App',
      'O‘zining vazifasi, davomat va to‘lov holatini ko‘rish',
      'To‘liq topshirilgan uy vazifani yuborish va tarixini ko‘rish',
    ]),
  }),
})

export function canAccessTable(role, table, action = 'select') {
  const permissions = ROLE_PERMISSIONS[role]?.tables
  if (permissions === '*') return true
  return Boolean(permissions?.[table]?.includes(action))
}

export function canAccessEndpoint(role, endpoint) {
  const permissions = ROLE_PERMISSIONS[role]?.endpoints
  return permissions === '*' || Boolean(permissions?.includes(endpoint))
}

export function canAccessPage(role, page) {
  const permissions = ROLE_PERMISSIONS[role]?.pages
  return permissions === '*' || Boolean(permissions?.includes(page))
}

export function roleLabel(role) {
  return ROLE_PERMISSIONS[role]?.label || 'Noma’lum rol'
}
