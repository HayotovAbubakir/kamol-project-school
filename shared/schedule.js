function isoDate(value) {
  const date = String(value || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const parsed = new Date(`${date}T12:00:00Z`)
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : date
}

function weekday(value) {
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDay()
  return day === 0 ? 7 : day
}

function scheduleRows(value) {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function normalizeScheduleWeekdays(value) {
  const rows = scheduleRows(value)
  const zeroBased = rows.some((slot) => Number(slot?.day) === 0)
  return rows.map((slot) => ({
    ...slot,
    day: Number(slot?.day) + (zeroBased ? 1 : 0),
  }))
}

function slotId(slot, index) {
  return String(slot?.slotId || slot?.slot_id || `slot-${index}`)
}

function rowGroupId(row) {
  return row?.groupId || row?.group_id
}

function rowDate(row, camel, snake) {
  return row?.[camel] || row?.[snake] || ''
}

export function getEffectiveLesson(groupId, dateValue, { group, groups = [], versions = [], overrides = [] } = {}) {
  const date = isoDate(dateValue)
  const currentGroup = group || groups.find((item) => item.id === groupId)
  if (!date || !currentGroup || currentGroup.id !== groupId) return []

  const groupVersions = versions
    .filter((version) => rowGroupId(version) === groupId)
    .filter((version) => {
      const start = rowDate(version, 'validFrom', 'valid_from')
      const end = rowDate(version, 'validTo', 'valid_to')
      return start <= date && (!end || date < end)
    })
    .sort((left, right) => (
      rowDate(left, 'validFrom', 'valid_from').localeCompare(rowDate(right, 'validFrom', 'valid_from'))
      || String(left.createdAt || left.created_at || '').localeCompare(String(right.createdAt || right.created_at || ''))
      || String(left.id || '').localeCompare(String(right.id || ''))
    ))
  const version = groupVersions.at(-1)
  const schedule = normalizeScheduleWeekdays(version?.schedule ?? version?.schedule_json ?? currentGroup.schedule)
  const groupOverrides = overrides.filter((item) => rowGroupId(item) === groupId && !rowDate(item, 'revertedAt', 'reverted_at'))
  const lessons = []

  schedule.forEach((slot, index) => {
    if (Number(slot.day) !== weekday(date)) return
    const id = slotId(slot, index)
    const change = groupOverrides.find((item) => (
      String(item.slotId || item.slot_id) === id
      && rowDate(item, 'originalDate', 'original_date') === date
    ))
    const base = {
      ...slot,
      slotId: id,
      groupId,
      date,
      originalDate: date,
      originalStartTime: slot.startTime,
      originalEndTime: slot.endTime,
      changeId: change?.changeId || change?.change_id || null,
      reason: change?.reason || '',
    }

    if (!change) {
      lessons.push({ ...base, status: 'regular' })
    } else if (change.action === 'cancel') {
      lessons.push({ ...base, status: 'cancelled' })
    } else if (rowDate(change, 'newDate', 'new_date') && rowDate(change, 'newDate', 'new_date') !== date) {
      lessons.push({
        ...base,
        status: 'rescheduled',
        newDate: rowDate(change, 'newDate', 'new_date'),
        newStartTime: change.newStartTime || change.new_start_time || slot.startTime,
        newEndTime: change.newEndTime || change.new_end_time || slot.endTime,
      })
    } else {
      lessons.push({
        ...base,
        startTime: change.newStartTime || change.new_start_time || slot.startTime,
        endTime: change.newEndTime || change.new_end_time || slot.endTime,
        teacherId: change.newTeacherId || change.new_teacher_id || slot.teacherId,
        status: 'changed',
      })
    }
  })

  for (const change of groupOverrides) {
    if (rowDate(change, 'newDate', 'new_date') !== date
      || rowDate(change, 'originalDate', 'original_date') === date
      || change.action === 'cancel') continue
    const sourceDate = rowDate(change, 'originalDate', 'original_date')
    const sourceSchedule = scheduleRows(groupVersions
      .filter((item) => rowDate(item, 'validFrom', 'valid_from') <= sourceDate
        && (!rowDate(item, 'validTo', 'valid_to') || sourceDate < rowDate(item, 'validTo', 'valid_to')))
      .sort((left, right) => rowDate(left, 'validFrom', 'valid_from').localeCompare(rowDate(right, 'validFrom', 'valid_from')))
      .at(-1)?.schedule ?? currentGroup.schedule)
    const sourceSlot = sourceSchedule.find((item, index) => slotId(item, index) === String(change.slotId || change.slot_id))
    if (!sourceSlot) continue
    lessons.push({
      ...sourceSlot,
      slotId: String(change.slotId || change.slot_id),
      groupId,
      date,
      originalDate: sourceDate,
      originalStartTime: change.originalStartTime || change.original_start_time || sourceSlot.startTime,
      originalEndTime: change.originalEndTime || change.original_end_time || sourceSlot.endTime,
      startTime: change.newStartTime || change.new_start_time || sourceSlot.startTime,
      endTime: change.newEndTime || change.new_end_time || sourceSlot.endTime,
      teacherId: change.newTeacherId || change.new_teacher_id || sourceSlot.teacherId,
      reason: change.reason || '',
      changeId: change.changeId || change.change_id || null,
      status: 'changed',
    })
  }

  return lessons.sort((left, right) => String(left.startTime || '').localeCompare(String(right.startTime || '')))
}

export function findDateScheduleConflict({ date, lesson, groups = [], versions = [], overrides = [], excludeSlotId = null }) {
  const start = String(lesson?.startTime || '')
  const end = String(lesson?.endTime || '')
  const startMinutes = timeToMinutes(start)
  const endMinutes = timeToMinutes(end)
  if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return 'Dars vaqti noto‘g‘ri.'

  for (const group of groups) {
    const lessons = getEffectiveLesson(group.id, date, { group, groups, versions, overrides })
    for (const other of lessons) {
      if (other.status === 'cancelled' || other.status === 'rescheduled') continue
      if (group.id === lesson.groupId && other.slotId === excludeSlotId) continue
      const otherStart = timeToMinutes(other.startTime)
      const otherEnd = timeToMinutes(other.endTime)
      if (otherStart === null || otherEnd === null || startMinutes >= otherEnd || otherStart >= endMinutes) continue
      if (group.id === lesson.groupId) return `Guruhning boshqa darsi ${date} kuni ustma-ust kelmoqda.`
      const teacherId = lesson.teacherId || lesson.teacher_id || null
      const otherTeacherId = other.teacherId || other.teacher_id || group.teacherId || group.teacher_id || null
      if (teacherId && teacherId === otherTeacherId) {
        return `O‘qituvchi ${date} kuni ${group.name || 'boshqa guruh'}da band.`
      }
    }
  }
  return null
}

export function timeToMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
