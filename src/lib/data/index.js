import {
  addExpense,
  addGroup,
  addPayment,
  addStudent,
  addTeacher,
  deleteExpense,
  deleteGroup,
  deleteStudent,
  deleteTeacher,
  markAttendance,
  addSalaryPayment,
  updateGroup,
  updateStudent,
  updateTeacher,
} from '../api.js'
import { authJson, cloudflare, isBackendConfigured } from '../cloudflare.js'
import { canAccessTable } from '../../../shared/role-permissions.js'
import {
  createHomework,
  fetchProfile,
  loadGroups,
  loadHomeworks,
  loadMonthlyReport,
  loadStudents,
  reviewSubmission,
  submitHomework,
} from '../../miniapp/api.js'

async function workerRequest(path, { method = 'POST', body } = {}) {
  const result = await authJson(path, { method, body })
  return result.data ?? result
}

async function workerFunction(name, body) {
  const { data, error } = await cloudflare.functions.invoke(name, { body })
  if (error) throw error
  return data?.data ?? data
}

export const auth = {
  isConfigured: isBackendConfigured,
  getSession: () => cloudflare.auth.getSession(),
  getProfile: (id) => fetchProfile(id),
  signInWithTelegram: () => cloudflare.auth.signInWithTelegram(),
  signInWithTelegramCredentials: (credentials) => cloudflare.auth.signInWithTelegramCredentials(credentials),
  signOut: () => cloudflare.auth.signOut(),
  updatePassword: (password) => cloudflare.auth.updateUser({ password }),
  onAuthStateChange: (callback) => cloudflare.auth.onAuthStateChange(callback),
}

export const homework = {
  list: loadHomeworks,
  create: createHomework,
  submit: submitHomework,
  review: reviewSubmission,
}

export const groups = { list: loadGroups }
export const students = {
  list: loadStudents,
  create: addStudent,
  update: updateStudent,
  remove: deleteStudent,
  async revealPassword(id) {
    const result = await workerFunction(`students/${encodeURIComponent(id)}/password/reveal`, {})
    return typeof result === 'string' ? result : result?.password || ''
  },
  changePassword: (id, password, username) => workerFunction(`students/${encodeURIComponent(id)}/password`, { password, username }),
  unlinkTelegram: (id) => workerFunction(`students/${encodeURIComponent(id)}/telegram/unlink`, {}),
}

export const staff = {
  async list() {
    return workerRequest('/api/staff', { method: 'GET' })
  },
  create: (record) => workerFunction('staff', record),
  update: (id, updates) => workerFunction(`staff/${encodeURIComponent(id)}`, updates),
}
export const teachers = {
  async list(role = 'owner') {
    const { data, error } = await cloudflare.from('teachers').select('id, name, phone, monthly_salary, created_at').order('name').all()
    if (error) throw error
    const rows = data || []
    if (!rows.length) return []
    // Qabulxona `profiles` jadvalini o‘qiy olmaydi; Telegram ulash ham faqat egasiga ochiq.
    let profileRows = []
    if (canAccessTable(role, 'profiles')) {
      const profiles = await cloudflare.from('profiles').select('id, teacher_id, telegram_id').in('teacher_id', rows.map((row) => row.id))
      if (profiles.error) throw profiles.error
      profileRows = profiles.data || []
    }
    const byTeacher = new Map(profileRows.map((profile) => [profile.teacher_id, profile]))
    return rows.map((row) => ({
      ...row,
      monthlySalary: Number(row.monthly_salary) || 0,
      profile_id: byTeacher.get(row.id)?.id || null,
      telegram_id: byTeacher.get(row.id)?.telegram_id || null,
    }))
  },
  create: addTeacher,
  update: updateTeacher,
  remove: deleteTeacher,
}
export const payments = {
  async list(profile) {
    let query = cloudflare.from('payments')
      .select('id, student_id, student_name, amount, month, year, paid_at, method, voided_at')
      .order('paid_at', { ascending: false })
    if (profile.role === 'student') query = query.eq('student_id', profile.student_id)
    // Qarzdorlar hisobi joriy oyning barcha to‘lovlarini talab qiladi — 100 talik limit uni buzardi.
    const { data, error } = await query.all()
    if (error) throw error
    return data || []
  },
  create: addPayment,
  correct: (id, { amount, month, year, method, reason }) => workerRequest('/api/payments/correct', {
    body: {
      id,
      ...(amount !== undefined ? { amount: Number(amount) } : {}),
      ...(month !== undefined ? { month: Number(month) } : {}),
      ...(year !== undefined ? { year: Number(year) } : {}),
      ...(method ? { method } : {}),
      ...(reason ? { reason } : {}),
    },
  }),
  void: (id, reason) => workerRequest('/api/payments/void', { body: { id, reason } }),
}
export const attendance = {
  async list(profile) {
    let query = cloudflare.from('attendance')
      .select('id, student_id, group_id, date, status, note, source, checked_in_at, late_minutes, groups(name)')
      .order('date', { ascending: false })
    if (profile.role === 'student') query = query.eq('student_id', profile.student_id)
    const { data, error } = await query.limit(100)
    if (error) throw error
    return data || []
  },
  async forDate(date) {
    const { data, error } = await cloudflare.from('attendance')
      .select('id, student_id, group_id, date, status, note, source, checked_in_at, late_minutes')
      .eq('date', date)
      .all()
    if (error) throw error
    return data || []
  },
  mark: markAttendance,
}
export const expenses = {
  async list() {
    const { data, error } = await cloudflare.from('expenses')
      .select('id, title, amount, category, date')
      .order('date', { ascending: false })
      .limit(200)
    if (error) throw error
    return data || []
  },
  create: addExpense,
  remove: deleteExpense,
}
export const salaryPayments = {
  async list() {
    const { data, error } = await cloudflare.from('salary_payments')
      .select('id, teacher_id, amount, paid_at, teachers(name)')
      .order('paid_at', { ascending: false })
      .limit(100)
    if (error) throw error
    return data || []
  },
  create: addSalaryPayment,
}
export const finance = {
  summary(from, to) {
    const params = new URLSearchParams({ from, to })
    return authJson(`/api/finance/summary?${params}`, { fallbackError: 'Moliyaviy hisobotni yuklab bo‘lmadi.' })
  },
}
export const reports = { monthlyHomework: loadMonthlyReport }
export const groupManagement = { create: addGroup, update: updateGroup, remove: deleteGroup }

export const telegram = {
  createInvite(target) {
    return authJson('/api/telegram/invites', {
      method: 'POST',
      body: typeof target === 'string' ? { profileId: target } : target,
      fallbackError: 'Telegram ulash havolasini yaratib bo‘lmadi.',
    })
  },
}
