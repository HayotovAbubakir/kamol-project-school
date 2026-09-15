import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { useAuth } from './AuthContext'
import { translate } from '../i18n/runtime'

const DataContext = createContext(null)

const emptyData = {
  users: [],
  teachers: [],
  rooms: [],
  groups: [],
  students: [],
  payments: [],
  salaryPayments: [],
  expenses: [],
  attendance: [],
}

export function DataProvider({ children }) {
  const { user, ready: authReady, configError } = useAuth()
  const userId = user?.id ?? null
  const [data, setData] = useState(emptyData)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState(null)
  const loadedForUser = useRef(null)

  const refresh = useCallback(async ({ soft = false } = {}) => {
    if (!userId) {
      setData(emptyData)
      setInitialized(true)
      loadedForUser.current = null
      return
    }

    // Soft = fon yangilash (tab qaytganda UI o‘chmasin)
    if (!soft) setLoading(true)
    setError(null)
    try {
      const next = await api.loadAll()
      setData(next)
      loadedForUser.current = userId
    } catch (err) {
      setError(err.message || translate('domain.error.dataLoadFailed'))
    } finally {
      setLoading(false)
      setInitialized(true)
    }
  }, [userId])

  useEffect(() => {
    if (!authReady || configError) return

    if (!userId) {
      setData(emptyData)
      setInitialized(true)
      loadedForUser.current = null
      return
    }

    // Shu user uchun allaqachon yuklangan — qayta full-screen loading yo‘q
    if (loadedForUser.current === userId) return

    setInitialized(false)
    refresh({ soft: false })
  }, [authReady, configError, userId, refresh])

  const run = useCallback(
    async (fn) => {
      await fn()
      await refresh({ soft: true })
    },
    [refresh],
  )

  const actions = useMemo(
    () => ({
      refresh: () => refresh({ soft: true }),
      loading,
      initialized,
      error,
      async addStudent(student) {
        let created = null
        await run(async () => {
          created = await api.addStudent(student)
        })
        return created
      },
      async updateStudent(id, updates) {
        await run(() => api.updateStudent(id, updates))
      },
      async deleteStudent(id) {
        await run(() => api.deleteStudent(id))
      },
      async addTeacher(teacher) {
        let created = null
        await run(async () => {
          created = await api.addTeacher(teacher)
        })
        return created
      },
      async updateTeacher(id, updates) {
        await run(() => api.updateTeacher(id, updates))
      },
      async deleteTeacher(id) {
        await run(() => api.deleteTeacher(id))
      },
      async addGroup(group) {
        let created = null
        await run(async () => {
          created = await api.addGroup(group, data.groups)
        })
        return created
      },
      async updateGroup(id, updates) {
        await run(() => api.updateGroup(id, updates, data.groups))
      },
      async deleteGroup(id) {
        await run(() => api.deleteGroup(id))
      },
      async addPayment(payment) {
        await run(() => api.addPayment(payment))
      },
      async addSalaryPayment(payment) {
        await run(() => api.addSalaryPayment(payment))
      },
      async addExpense(expense) {
        await run(() => api.addExpense(expense))
      },
      async deleteExpense(id) {
        await run(() => api.deleteExpense(id))
      },
      async addAdminUser(userPayload) {
        await run(() => api.addAdminUser(userPayload))
      },
      async removeAdminUser(id) {
        await run(() => api.removeAdminUser(id))
      },
      async markAttendance(payload) {
        await run(() => api.markAttendance(payload))
      },
    }),
    [refresh, loading, initialized, error, run, data.groups],
  )

  return <DataContext.Provider value={{ data, ...actions }}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error(translate('domain.error.dataProviderRequired'))
  return ctx
}
