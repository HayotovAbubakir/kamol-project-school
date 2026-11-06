function minutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function slotTeacher(slot, group) {
  return slot?.teacherId || group?.teacher_id || null
}

export function validateGroupSchedule(schedule, groups, currentGroupId = null, groupTeacherId = null) {
  if (!Array.isArray(schedule) || schedule.length > 30) return 'Jadval noto‘g‘ri.'
  const slots = []
  for (const slot of schedule) {
    const start = minutes(slot?.startTime)
    const end = minutes(slot?.endTime)
    const day = slot?.day === null || slot?.day === undefined ? '' : String(slot.day).trim()
    if (!day || day.length > 32 || start === null || end === null || end <= start) {
      return 'Jadval vaqti noto‘g‘ri.'
    }
    slots.push({ ...slot, day, start, end })
  }
  for (let index = 0; index < slots.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < slots.length; otherIndex += 1) {
      const current = slots[index]
      const other = slots[otherIndex]
      if (current.day === other.day && current.start < other.end && other.start < current.end) {
        return 'Bir guruh ichidagi dars vaqtlari ustma-ust kelmoqda.'
      }
    }
  }
  for (const current of slots) {
    const teacherId = slotTeacher(current, { teacher_id: groupTeacherId })
    if (!teacherId) continue
    for (const group of groups) {
      if (group.id === currentGroupId) continue
      let existingSchedule = group.schedule
      if (typeof existingSchedule === 'string') {
        try {
          existingSchedule = JSON.parse(existingSchedule)
        } catch {
          return 'Mavjud guruh jadvali noto‘g‘ri.'
        }
      }
      if (!Array.isArray(existingSchedule)) return 'Mavjud guruh jadvali noto‘g‘ri.'
      for (const other of existingSchedule) {
        const start = minutes(other?.startTime)
        const end = minutes(other?.endTime)
        const otherDay = other?.day === null || other?.day === undefined ? '' : String(other.day).trim()
        if (slotTeacher(other, group) === teacherId && (!otherDay || start === null || end === null || end <= start)) {
          return 'Mavjud guruh jadvali noto‘g‘ri.'
        }
        if (
          current.day === otherDay
          && start !== null
          && end !== null
          && current.start < end
          && start < current.end
          && teacherId === slotTeacher(other, group)
        ) {
          return 'O‘qituvchi bu vaqtda boshqa guruhda dars beradi.'
        }
      }
    }
  }
  return null
}

export function calculateFinanceSummary({ payments = [], salaries = [], expenses = [] }) {
  const total = (rows) => rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  const income = total(payments)
  const salaryCost = total(salaries)
  const expenseCost = total(expenses)
  return {
    income,
    salary_cost: salaryCost,
    expense_cost: expenseCost,
    net: income - salaryCost - expenseCost,
  }
}
