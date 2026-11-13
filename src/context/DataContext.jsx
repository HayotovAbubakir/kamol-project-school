import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../lib/api'
import { onDataChanged } from '../lib/dataEvents'
import { studentMonthlyFee } from '../lib/store'
import { todayISO } from '../lib/utils'
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

const STUDENT_SCOPES = ['groups', 'students']
const BACKGROUND_REFRESH_DELAY_MS = 250

// `groups` va `students` bitta so‘rovda hisoblanadi — doim birga yangilanadi.
function normalizeScopes(scopes) {
  const set = new Set(scopes)
  if (set.has('groups') || set.has('students')) STUDENT_SCOPES.forEach((scope) => set.add(scope))
  return [...set]
}

function syncGroupMembers(groups, studentId, groupIds) {
  const wanted = new Set(groupIds || [])
  return groups.map((group) => {
    const has = (group.studentIds || []).includes(studentId)
    if (has === wanted.has(group.id)) return group
    return {
      ...group,
      studentIds: has
        ? group.studentIds.filter((id) => id !== studentId)
        : [...(group.studentIds || []), studentId],
    }
  })
}

const STUDENT_PATCH_FIELDS = ['name', 'phone', 'parentPhone', 'joinedAt', 'username', 'groupIds']

export function DataProvider({ children }) {
  const { user, ready: authReady, configError } = useAuth()
  const userId = user?.id ?? null
  const userRole = user?.role ?? null
  const mustResetPassword = Boolean(user?.mustResetPassword)
  const [data, setData] = useState(emptyData)
  const [loading, setLoading] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [error, setError] = useState(null)
  const loadedForUser = useRef(null)
  const dataRef = useRef(data)
  // Har bir bo‘lim uchun versiya: eski (sekin) javob yangi o‘zgarish ustidan yozilmasin.
  const scopeVersion = useRef({})
  const sessionVersion = useRef(0)
  const pendingScopes = useRef(new Set())
  const pendingTimer = useRef(null)

  useEffect(() => {
    dataRef.current = data
  }, [data])

  const invalidate = useCallback((scopes) => {
    for (const scope of scopes) scopeVersion.current[scope] = (scopeVersion.current[scope] || 0) + 1
  }, [])

  const load = useCallback(async (scopeList, { soft = false } = {}) => {
    if (!userId || mustResetPassword) {
      sessionVersion.current += 1
      setData(emptyData)
      setInitialized(true)
      loadedForUser.current = null
      return
    }
    const scopes = normalizeScopes(scopeList)
    const session = sessionVersion.current
    invalidate(scopes)
    const versions = Object.fromEntries(scopes.map((scope) => [scope, scopeVersion.current[scope]]))
    const isCurrent = () => session === sessionVersion.current
    // Soft = fon yangilash (tab qaytganda yoki amaldan keyin UI o‘chmasin)
    if (!soft) setLoading(true)
    setError(null)
    try {
      const next = await api.loadTables(userRole, scopes)
      if (!isCurrent()) return
      const fresh = Object.fromEntries(Object.entries(next)
        .filter(([scope]) => scopeVersion.current[scope] === versions[scope]))
      if (Object.keys(fresh).length) setData((prev) => ({ ...prev, ...fresh }))
      if (scopes.length >= api.DATA_SCOPES.length) loadedForUser.current = userId
    } catch (err) {
      if (!isCurrent()) return
      setError(err.message || translate('domain.error.dataLoadFailed'))
    } finally {
      if (isCurrent()) {
        if (!soft) setLoading(false)
        setInitialized(true)
      }
    }
  }, [userId, userRole, mustResetPassword, invalidate])

  const refresh = useCallback(
    ({ soft = false } = {}) => load(api.DATA_SCOPES, { soft }),
    [load],
  )

  /** Amaldan keyingi yangilash: kutilmaydi, ketma-ket amallar bitta so‘rovga birlashadi. */
  const refreshInBackground = useCallback((scopes) => {
    for (const scope of scopes) pendingScopes.current.add(scope)
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
    pendingTimer.current = setTimeout(() => {
      pendingTimer.current = null
      const next = [...pendingScopes.current]
      pendingScopes.current.clear()
      if (next.length) load(next, { soft: true })
    }, BACKGROUND_REFRESH_DELAY_MS)
  }, [load])

  useEffect(() => () => {
    if (pendingTimer.current) clearTimeout(pendingTimer.current)
  }, [])

  useEffect(() => onDataChanged((scopes) => {
    if (userId) refreshInBackground(scopes)
  }), [userId, refreshInBackground])

  useEffect(() => {
    if (!authReady || configError) return

    if (!userId || mustResetPassword) {
      sessionVersion.current += 1
      pendingScopes.current.clear()
      // These resets prevent one user's cached records from flashing on the next session.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(emptyData)
      setInitialized(true)
      loadedForUser.current = null
      return
    }

    // Shu user uchun allaqachon yuklangan — qayta full-screen loading yo‘q
    if (loadedForUser.current === userId) return

    sessionVersion.current += 1
    setInitialized(false)
    refresh({ soft: false })
  }, [authReady, configError, mustResetPassword, userId, refresh])

  /**
   * Amal: server javobini kutadi, mahalliy holatni darhol yangilaydi va
   * ta’sirlangan jadvallarni fonda qayta yuklaydi (tugma/modal kutib qolmaydi).
   */
  const run = useCallback(async (scopes, mutate, patch) => {
    const result = await mutate()
    const normalized = normalizeScopes(scopes)
    if (patch) {
      invalidate(normalized)
      setData((prev) => ({ ...prev, ...patch(prev, result) }))
    }
    refreshInBackground(normalized)
    return result
  }, [invalidate, refreshInBackground])

  const actions = useMemo(
    () => ({
      refresh: () => refresh({ soft: true }),
      loading,
      initialized,
      error,
      addStudent(student) {
        return run([...STUDENT_SCOPES], () => api.addStudent(student), (prev, created) => {
          if (!created?.id) return {}
          const record = { ...created, monthlyFee: studentMonthlyFee(created, prev.groups) }
          return {
            students: [...prev.students.filter((item) => item.id !== created.id), record],
            groups: syncGroupMembers(prev.groups, created.id, created.groupIds),
          }
        })
      },
      async updateStudent(id, updates) {
        await run([...STUDENT_SCOPES, 'payments'], () => api.updateStudent(id, updates), (prev) => {
          const patch = Object.fromEntries(STUDENT_PATCH_FIELDS
            .filter((field) => updates[field] !== undefined)
            .map((field) => [field, updates[field]]))
          const students = prev.students.map((item) => (item.id === id ? { ...item, ...patch } : item))
          return {
            students,
            ...(updates.groupIds ? { groups: syncGroupMembers(prev.groups, id, updates.groupIds) } : {}),
          }
        })
      },
      async deleteStudent(id) {
        await run([...STUDENT_SCOPES, 'payments', 'attendance'], () => api.deleteStudent(id), (prev) => ({
          students: prev.students.filter((item) => item.id !== id),
          groups: syncGroupMembers(prev.groups, id, []),
        }))
      },
      addTeacher(teacher) {
        return run(['teachers', 'users'], () => api.addTeacher(teacher), (prev, created) => (created?.id
          ? { teachers: [...prev.teachers.filter((item) => item.id !== created.id), { id: created.id, name: created.name, phone: created.phone, monthlySalary: created.monthlySalary }] }
          : {}))
      },
      async updateTeacher(id, updates) {
        await run(['teachers', 'users'], () => api.updateTeacher(id, updates), (prev) => ({
          teachers: prev.teachers.map((item) => (item.id === id
            ? {
                ...item,
                ...(updates.name != null ? { name: String(updates.name).trim() } : {}),
                ...(updates.phone != null ? { phone: updates.phone } : {}),
                ...(updates.monthlySalary != null ? { monthlySalary: Number(updates.monthlySalary) || 0 } : {}),
              }
            : item)),
        }))
      },
      async deleteTeacher(id) {
        await run(['teachers', 'users', ...STUDENT_SCOPES, 'salaryPayments'], () => api.deleteTeacher(id), (prev) => ({
          teachers: prev.teachers.filter((item) => item.id !== id),
        }))
      },
      addGroup(group) {
        return run([...STUDENT_SCOPES], () => api.addGroup(group, dataRef.current.groups), (prev, created) => {
          if (!created?.id) return {}
          const record = { scheduleVersions: [], scheduleOverrides: [], feeHistory: [], ...created }
          return {
            groups: [...prev.groups.filter((item) => item.id !== created.id), record],
            students: prev.students.map((student) => (created.studentIds.includes(student.id)
              ? { ...student, groupIds: [...new Set([...(student.groupIds || []), created.id])] }
              : student)),
          }
        })
      },
      async updateGroup(id, updates) {
        await run([...STUDENT_SCOPES], () => api.updateGroup(id, updates, dataRef.current.groups))
      },
      async deleteGroup(id) {
        await run([...STUDENT_SCOPES], () => api.deleteGroup(id), (prev) => ({
          groups: prev.groups.filter((item) => item.id !== id),
          students: prev.students.map((student) => ((student.groupIds || []).includes(id)
            ? { ...student, groupIds: student.groupIds.filter((groupId) => groupId !== id) }
            : student)),
        }))
      },
      async addPayment(payment) {
        await run(['payments'], () => api.addPayment(payment), (prev, created) => (created?.id
          ? { payments: [...prev.payments.filter((item) => item.id !== created.id), created] }
          : {}))
      },
      async correctPayment(payment) {
        await run(['payments'], () => api.correctPayment(payment))
      },
      async voidPayment(payment) {
        await run(['payments'], () => api.voidPayment(payment), (prev, result) => ({
          payments: prev.payments.map((item) => (item.id === payment.id
            ? { ...item, voidedAt: result?.voided_at || new Date().toISOString(), voidReason: result?.void_reason || payment.reason || '' }
            : item)),
        }))
      },
      async updatePayment(id, payment) {
        await run(['payments'], () => api.updatePayment(id, payment))
      },
      async deletePayment(id) {
        await run(['payments'], () => api.deletePayment(id), (prev, result) => ({
          payments: prev.payments.map((item) => (item.id === id
            ? { ...item, voidedAt: result?.voided_at || new Date().toISOString(), voidReason: result?.void_reason || '' }
            : item)),
        }))
      },
      async loadPaymentHistory(paymentId) {
        return api.paymentHistory(paymentId)
      },
      async addSalaryPayment(payment) {
        await run(['salaryPayments'], () => api.addSalaryPayment(payment), (prev, created) => (created?.id
          ? { salaryPayments: [...prev.salaryPayments.filter((item) => item.id !== created.id), created] }
          : {}))
      },
      async addExpense(expense) {
        await run(['expenses'], () => api.addExpense(expense), (prev, created) => (created?.id
          ? { expenses: [created, ...prev.expenses.filter((item) => item.id !== created.id)] }
          : {}))
      },
      async deleteExpense(id) {
        await run(['expenses'], () => api.deleteExpense(id), (prev) => ({
          expenses: prev.expenses.filter((item) => item.id !== id),
        }))
      },
      async addReceptionUser(userPayload) {
        await run(['users'], () => api.addReceptionUser(userPayload))
      },
      async setReceptionActive(id, active) {
        await run(['users'], () => api.setReceptionActive(id, active), (prev) => ({
          users: prev.users.map((item) => (item.id === id ? { ...item, isActive: Boolean(active) } : item)),
        }))
      },
      async updateReceptionUser(payload) {
        await run(['users'], () => api.updateReceptionUser(payload))
      },
      async markAttendance(payload) {
        await run(['attendance'], () => api.markAttendance(payload), (prev) => {
          const date = todayISO()
          const existing = prev.attendance.find((item) => item.studentId === payload.studentId
            && item.groupId === payload.groupId && item.date === date)
          const record = {
            ...(existing || { id: `local-${payload.studentId}-${payload.groupId}-${date}`, checkedInAt: null, lateMinutes: null }),
            studentId: payload.studentId,
            groupId: payload.groupId,
            date,
            status: payload.status,
            note: payload.note || '',
            markedBy: payload.markedBy || null,
            markedAt: new Date().toISOString(),
            source: 'manual',
          }
          return {
            attendance: existing
              ? prev.attendance.map((item) => (item === existing ? record : item))
              : [record, ...prev.attendance],
          }
        })
      },
    }),
    [refresh, loading, initialized, error, run],
  )

  return <DataContext.Provider value={{ data, ...actions }}>{children}</DataContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error(translate('domain.error.dataProviderRequired'))
  return ctx
}
