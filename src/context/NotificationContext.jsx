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
  const toastTimers = useRef(new Map())

  const isStaff = user?.role === 'owner' || user?.role === 'admin'
  const now = currentMonthYear()

  // Joriy oy live xabarlarini arxivga yozish
  useEffect(() => {
    if (!isStaff || !initialized) return
    const live = buildStaffNotifications(data, t, now)
    setArchive(mergeLiveIntoArchive(live))
  }, [isStaff, initialized, data, t, now.month, now.year])

  const currentItems = useMemo(
    () => archive
      .filter((item) => !item.dismissed && item.month === now.month && item.year === now.year)
      .map(withIcon),
    [archive, now.month, now.year],
  )

  const unreadCount = useMemo(
    () => currentItems.filter((item) => !seen.has(item.id)).length,
    [currentItems, seen],
  )

  const getItemsForMonth = useCallback((month, year) => (
    archive
      .filter((item) => !item.dismissed && item.month === month && item.year === year)
      .map(withIcon)
  ), [archive])

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
    }),
    [currentItems, unreadCount, toasts, dismissToast, markAllRead, dismissNotification, getItemsForMonth],
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
    }
  }
  return ctx
}
