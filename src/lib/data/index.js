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
import { cloudflare, isBackendConfigured } from '../cloudflare.js'
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
  const { data } = await cloudflare.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Sessiya tugagan. Ilovani Telegram ichidan qayta oching.')
  const response = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'So‘rovni bajarib bo‘lmadi.')
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
  revealPassword: (id) => workerFunction(`students/${encodeURIComponent(id)}/password/reveal`, {}),
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
  async list() {
    const { data, error } = await cloudflare.from('teachers').select('id, name, phone, monthly_salary, created_at').order('name')
    if (error) throw error
    const rows = data || []
    if (!rows.length) return []
    const profiles = await cloudflare.from('profiles').select('id, teacher_id, telegram_id').in('teacher_id', rows.map((row) => row.id))
    if (profiles.error) throw profiles.error
    const byTeacher = new Map((profiles.data || []).map((profile) => [profile.teacher_id, profile]))
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
      .select('id, student_id, student_name, amount, month, year, paid_at')
      .order('paid_at', { ascending: false })
    if (profile.role === 'student') query = query.eq('student_id', profile.student_id)
    const { data, error } = await query.limit(100)
    if (error) throw error
    return data || []
  },
  create: addPayment,
}
export const attendance = {
  async list(profile) {
    let query = cloudflare.from('attendance')
      .select('id, student_id, group_id, date, status, note, groups(name)')
      .order('date', { ascending: false })
    if (profile.role === 'student') query = query.eq('student_id', profile.student_id)
    const { data, error } = await query.limit(100)
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
      .limit(100)
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
  async summary(from, to) {
    const { data } = await cloudflare.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sessiya tugagan. Ilovani Telegram ichidan qayta oching.')
    const params = new URLSearchParams({ from, to })
    const response = await fetch(`/api/finance/summary?${params}`, {
      headers: { Authorization: `******` },
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Moliyaviy hisobotni yuklab bo‘lmadi.')
    return result
  },
}
export const reports = { monthlyHomework: loadMonthlyReport }
export const groupManagement = { create: addGroup, update: updateGroup, remove: deleteGroup }

export const telegram = {
  async createInvite(target) {
    const { data } = await cloudflare.auth.getSession()
    const token = data.session?.access_token
    if (!token) throw new Error('Sessiya tugagan. Ilovani Telegram ichidan qayta oching.')
    const response = await fetch('/api/telegram/invites', {
      method: 'POST',
      headers: { Authorization: `******`, 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof target === 'string' ? { profileId: target } : target),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Telegram ulash havolasini yaratib bo‘lmadi.')
    return result
  },
}
