import { AlertTriangle, CalendarDays, ClipboardCheck, Users, Wallet } from 'lucide-react'
import { getDebtorCount, getFrequentAbsenteeCount, getTodayLessons } from './analytics'
import { groupHasTeacherAssigned } from './store'
import { currentMonthYear, todayISO } from './utils'

export const NOTIF_ICONS = {
  debtors: Wallet,
  absentees: AlertTriangle,
  'no-teacher': Users,
  'empty-groups': Users,
  attendance: ClipboardCheck,
  schedule: CalendarDays,
}

export function resolveNotificationIcon(kind) {
  return NOTIF_ICONS[kind] || Users
}

/** Joriy holatdan live bildirishnomalar (oy/yil bilan) */
export function buildStaffNotifications(data, t, monthYear = currentMonthYear()) {
  if (!data) return []
  const { month, year } = monthYear
  const period = `${month}/${year}`
  const today = todayISO()
  const list = []

  const debtors = getDebtorCount(data, month, year)
  if (debtors > 0) {
    list.push({
      id: `debtors:${period}:${debtors}`,
      kind: 'debtors',
      month,
      year,
      title: t('owner.notifications.debtorsTitle', { count: debtors }),
      text: t('owner.notifications.debtorsText', { period }),
    })
  }

  const absentees = getFrequentAbsenteeCount(data)
  if (absentees > 0) {
    list.push({
      id: `absentees:${period}:${absentees}`,
      kind: 'absentees',
      month,
      year,
      title: t('owner.notifications.absenteesTitle', { count: absentees }),
      text: t('owner.notifications.absenteesText'),
    })
  }

  const noTeacher = data.groups.filter((g) => !groupHasTeacherAssigned(g))
  if (noTeacher.length) {
    list.push({
      id: `no-teacher:${period}:${noTeacher.map((g) => g.id).sort().join(',')}`,
      kind: 'no-teacher',
      month,
      year,
      title: t('owner.notifications.noTeacherTitle', { count: noTeacher.length }),
      text: noTeacher.map((g) => g.name).join(', '),
    })
  }

  const emptyGroups = data.groups.filter((g) => !g.studentIds.length)
  if (emptyGroups.length) {
    list.push({
      id: `empty-groups:${period}:${emptyGroups.map((g) => g.id).sort().join(',')}`,
      kind: 'empty-groups',
      month,
      year,
      title: t('owner.notifications.emptyGroupsTitle', { count: emptyGroups.length }),
      text: emptyGroups.map((g) => g.name).join(', '),
    })
  }

  const now = currentMonthYear()
  const isCurrentMonth = month === now.month && year === now.year
  const unmarked = isCurrentMonth
    && getTodayLessons(data).length > 0
    && data.attendance.filter((a) => a.date === today).length === 0
  if (unmarked) {
    list.push({
      id: `attendance:${today}`,
      kind: 'attendance',
      month,
      year,
      title: t('owner.notifications.unmarkedTitle'),
      text: t('owner.notifications.unmarkedText'),
    })
  }

  return list
}

export function playNotificationSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.3)
    osc.onended = () => ctx.close().catch(() => {})
  } catch {
    /* ignore */
  }
}

const SEEN_KEY = 'kamol-notif-seen'
const TOASTED_KEY = 'kamol-notif-toasted'
const ARCHIVE_KEY = 'kamol-notif-archive'

function readIdSet(key, storage = sessionStorage) {
  try {
    const raw = storage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(arr) ? arr : [])
  } catch {
    return new Set()
  }
}

function writeIdSet(key, set, storage = sessionStorage) {
  try {
    storage.setItem(key, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

export function readSeenNotificationIds() {
  return readIdSet(SEEN_KEY)
}

export function writeSeenNotificationIds(set) {
  writeIdSet(SEEN_KEY, set)
}

export function readToastedNotificationIds() {
  return readIdSet(TOASTED_KEY)
}

export function writeToastedNotificationIds(set) {
  writeIdSet(TOASTED_KEY, set)
}

export function readNotificationArchive() {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

export function writeNotificationArchive(list) {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

/** Live xabarlarni arxivga qo‘shadi (oy bo‘yicha tarix) */
export function mergeLiveIntoArchive(liveItems) {
  const archive = readNotificationArchive()
  const byId = new Map(archive.map((item) => [item.id, item]))
  let changed = false

  liveItems.forEach((item) => {
    const existing = byId.get(item.id)
    if (existing) {
      if (existing.dismissed) return
      if (existing.title !== item.title || existing.text !== item.text) {
        byId.set(item.id, { ...existing, title: item.title, text: item.text })
        changed = true
      }
      return
    }
    byId.set(item.id, {
      id: item.id,
      kind: item.kind,
      month: item.month,
      year: item.year,
      title: item.title,
      text: item.text,
      createdAt: Date.now(),
      dismissed: false,
    })
    changed = true
  })

  if (!changed) return archive
  const next = [...byId.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  writeNotificationArchive(next)
  return next
}

export function dismissFromArchive(id) {
  const archive = readNotificationArchive()
  const next = archive.map((item) => (
    item.id === id ? { ...item, dismissed: true } : item
  ))
  writeNotificationArchive(next)
  return next
}
