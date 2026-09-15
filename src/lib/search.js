import { parseParentPhones } from './phone'
import { groupTeacherIds } from './store'

/** Qidiruv matnini solishtirish uchun soddalashtirish. */
export function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export function digitsForSearch(value) {
  return String(value || '').replace(/\D/g, '')
}

/** Query bo‘sh bo‘lsa true; aks holda ism yoki telefon raqamlari bo‘yicha moslik. */
export function matchesSearch(query, fields = []) {
  const q = normalizeSearchText(query)
  if (!q) return true

  const text = fields.map((f) => normalizeSearchText(f)).filter(Boolean).join(' ')
  if (text.includes(q)) return true

  const qDigits = digitsForSearch(query)
  if (qDigits.length >= 2) {
    const phones = fields.map((f) => digitsForSearch(f)).filter(Boolean).join(' ')
    if (phones.includes(qDigits)) return true
  }

  return false
}

export function studentSearchFields(student, groups = []) {
  const parents = parseParentPhones(student?.parentPhone)
  const groupNames = (student?.groupIds || [])
    .map((id) => groups.find((g) => g.id === id)?.name)
    .filter(Boolean)

  return [
    student?.name,
    student?.phone,
    student?.parentPhone,
    parents.fatherPhone,
    parents.motherPhone,
    student?.publicCode,
    ...groupNames,
  ]
}

export function teacherSearchFields(teacher, users = []) {
  const login = users.find((u) => u.role === 'teacher' && u.teacherId === teacher?.id)
  return [
    teacher?.name,
    teacher?.phone,
    login?.username,
  ]
}

export function groupSearchFields(group, { teachers = [], students = [] } = {}) {
  const teacherNames = groupTeacherIds(group)
    .map((id) => teachers.find((t) => t.id === id)?.name)
    .filter(Boolean)

  const memberFields = (group?.studentIds || []).flatMap((id) => {
    const student = students.find((s) => s.id === id)
    return student ? studentSearchFields(student) : []
  })

  return [
    group?.name,
    ...teacherNames,
    ...memberFields,
  ]
}
