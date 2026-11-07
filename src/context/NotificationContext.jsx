import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useData } from './DataContext'
import { useLanguage } from './LanguageContext'
import {
  buildStaffNotifications,
  dismissFromArchive,
  mergeLiveIntoArchive,
  playNotificationSound,
  readNotificationArchive,
  readSeenNotificationIds,
  readToastedNotificationIds,
  resolveNotificationIcon,
  writeSeenNotificationIds,
  writeToastedNotificationIds,
} from '../lib/notifications'
import { currentMonthYear } from '../lib/utils'
import { getScheduleNotifications } from '../lib/api'

const NotificationContext = createContext(null)

function withIcon(item) {
  return { ...item, icon: resolveNotificationIcon(item.kind) }
}

export function NotificationProvider({ children }) {
  const { user } = useAuth()
  const { data, initialized } = useData()
  const { t } = useLanguage()
  const { pathname } = useLocation()
  const [seen, setSeen] = useState(() => readSeenNotificationIds())
  const [archive, setArchive] = useState(() => readNotificationArchive())
  const [toasts, setToasts] = useState([])
  const [scheduleItems, setScheduleItems] = useState([])
  const [scheduleError, setScheduleError] = useState('')
  const [dismissedScheduleIds, setDismissedScheduleIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('kamol-schedule-dismissed') || '[]')) } catch { return new Set() }
  })
  const toastTimers = useRef(new Map())

  const isStaff = user?.role === 'owner' || user?.role === 'reception'
  const now = currentMonthYear()

  useEffect(() => {
    if (!user?.id) return undefined
    let active = true
    const load = async () => {
      try {
        const rows = await getScheduleNotifications()
        if (!active) return
        const mapped = (rows || []).map((row) => {
          const date = new Date(row.scheduled_at)
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Tashkent', month: 'numeric', year: 'numeric',
          }).formatToParts(date).map(({ type, value }) => [type, value]))
          const title = row.notification_kind === 'undo'
            ? 'Jadval o‘zgarishi qaytarildi'
            : row.notification_kind === 'reminder' ? 'Dars eslatmasi' : 'Jadval o‘zgarishi'
          return {
            id: `schedule:${row.id}`,
            kind: 'schedule',
            month: Number(parts.month),
            year: Number(parts.year),
            title: `${title}${row.group_name ? ` · ${row.group_name}` : ''}`,
            text: row.message,
            createdAt: row.scheduled_at,
          }
        })
        setScheduleItems(mapped)
        setScheduleError('')
      } catch (error) {
        if (!active) return
        setScheduleError(error instanceof Error ? error.message : 'Jadval bildirishnomalarini yuklab bo‘lmadi.')
      }
    }
    load()
    const timer = window.setInterval(load, 60_000)
    window.addEventListener('focus', load)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [user?.id])

  // Joriy oy live xabarlarini arxivga yozish
  useEffect(() => {
    if (!isStaff || !initialized) return
    const live = buildStaffNotifications(data, t, { month: now.month, year: now.year })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setArchive(mergeLiveIntoArchive(live))
  }, [isStaff, initialized, data, t, now.month, now.year])

  const currentItems = useMemo(
    () => [
      ...archive.filter((item) => !item.dismissed && item.month === now.month && item.year === now.year),
      ...scheduleItems.filter((item) => item.month === now.month && item.year === now.year
        && !dismissedScheduleIds.has(item.id)),
    ].map(withIcon),
    [archive, scheduleItems, dismissedScheduleIds, now.month, now.year],
  )

  const unreadCount = useMemo(
    () => currentItems.filter((item) => !seen.has(item.id)).length,
    [currentItems, seen],
  )

  const getItemsForMonth = useCallback((month, year) => (
    [
      ...archive.filter((item) => !item.dismissed && item.month === month && item.year === year),
      ...scheduleItems.filter((item) => item.month === month && item.year === year
        && !dismissedScheduleIds.has(item.id)),
    ].map(withIcon)
  ), [archive, scheduleItems, dismissedScheduleIds])

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
    const timer = toastTimers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      toastTimers.current.delete(id)
    }
  }, [])

  const pushToast = useCallback((item) => {
    setToasts((prev) => {
      if (prev.some((toast) => toast.id === item.id)) return prev
      return [...prev, withIcon(item)].slice(-4)
    })
    const timer = setTimeout(() => dismissToast(item.id), 5200)
    toastTimers.current.set(item.id, timer)
  }, [dismissToast])

  const markAllRead = useCallback(() => {
    setSeen((prev) => {
      let changed = false
      const next = new Set(prev)
      currentItems.forEach((item) => {
        if (!next.has(item.id)) {
          next.add(item.id)
          changed = true
        }
      })
      if (!changed) return prev
      writeSeenNotificationIds(next)
      return next
    })
  }, [currentItems])

  const dismissNotification = useCallback((id) => {
    if (String(id).startsWith('schedule:')) {
      setDismissedScheduleIds((previous) => {
        const next = new Set(previous)
        next.add(id)
        try { localStorage.setItem('kamol-schedule-dismissed', JSON.stringify([...next])) } catch { /* local archive is optional */ }
        return next
      })
    }
    setArchive(dismissFromArchive(id))
    setSeen((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      writeSeenNotificationIds(next)
      return next
    })
    dismissToast(id)
  }, [dismissToast])

  const onNotificationsPage = /\/notifications\/?$/.test(pathname)

  useEffect(() => {
    if (!isStaff || !onNotificationsPage) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    markAllRead()
  }, [isStaff, onNotificationsPage, markAllRead])

  useEffect(() => {
    if (!isStaff || !initialized || !currentItems.length || onNotificationsPage) return undefined

    const toasted = readToastedNotificationIds()
    const fresh = currentItems.filter((item) => !seen.has(item.id) && !toasted.has(item.id))
    if (!fresh.length) return undefined

    fresh.forEach((item) => {
      toasted.add(item.id)
      pushToast(item)
    })
    writeToastedNotificationIds(toasted)
    playNotificationSound()
    return undefined
  }, [isStaff, initialized, currentItems, seen, onNotificationsPage, pushToast])

  useEffect(() => () => {
    toastTimers.current.forEach((timer) => clearTimeout(timer))
    toastTimers.current.clear()
  }, [])

  const value = useMemo(
    () => ({
      items: currentItems,
      unreadCount,
      toasts,
      dismissToast,
      markAllRead,
      dismissNotification,
      getItemsForMonth,
      scheduleError,
    }),
    [currentItems, unreadCount, toasts, dismissToast, markAllRead, dismissNotification, getItemsForMonth, scheduleError],
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    return {
      items: [],
      unreadCount: 0,
      toasts: [],
      dismissToast: () => {},
      markAllRead: () => {},
      dismissNotification: () => {},
      getItemsForMonth: () => [],
      scheduleError: '',
    }
  }
  return ctx
}
