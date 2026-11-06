import { cloudflare, usernameToEmail, usernameToEmailCandidates, normalizeUsername, MIN_PASSWORD_LENGTH } from './cloudflare'
import { currentMonthYear, todayISO, toStoredExpenseCategory } from './utils'
import { primaryGroupTeacherId, studentMonthlyFee, validateGroupSchedule } from './store'
import { translate } from '../i18n/runtime'
import { normalizePhone, packParentPhones, parseParentPhones } from './phone'

function requireClient() {
  if (!cloudflare) throw new Error('Cloudflare Worker API is unavailable.')
  return cloudflare
}

function throwDbError(error, fallbackKey = 'domain.error.dataLoadFailed') {
  if (!error) throw new Error(translate(fallbackKey))
  const msg = [error.message, error.details, error.hint].filter(Boolean).join(' — ')
  throw new Error(msg || translate(fallbackKey))
}

function asUuidOrNull(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
    ? raw
    : null
}

function normalizeSchedulePayload(schedule = [], fallbackTeacherId = null) {
  const fallback = asUuidOrNull(fallbackTeacherId)
  return (Array.isArray(schedule) ? schedule : []).map((slot) => ({
    day: Number(slot.day),
    startTime: String(slot.startTime || ''),
    endTime: String(slot.endTime || ''),
    teacherId: asUuidOrNull(slot.teacherId) || fallback,
  }))
}

function normalizeIncomingSchedule(schedule = [], fallbackTeacherId = null) {
  return normalizeSchedulePayload(schedule, fallbackTeacherId)
}

function parentPhoneForDb(payload) {
  if (payload.fatherPhone != null || payload.motherPhone != null) {
    return packParentPhones(payload.fatherPhone, payload.motherPhone)
  }
  if (payload.parentPhone != null) {
    const { fatherPhone, motherPhone } = parseParentPhones(payload.parentPhone)
    return packParentPhones(fatherPhone, motherPhone)
  }
  return undefined
}

function mapTeacher(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    monthlySalary: Number(row.monthly_salary) || 0,
  }
}

function mapGroup(row, studentIds = []) {
  const schedule = normalizeIncomingSchedule(
    Array.isArray(row.schedule) ? row.schedule : [],
    row.teacher_id,
  )
  return {
    id: row.id,
    name: row.name,
    teacherId: row.teacher_id || primaryGroupTeacherId({ schedule, teacherId: row.teacher_id }),
    roomId: null,
    monthlyFee: Number(row.monthly_fee) || 0,
    schedule,
    studentIds,
  }
}

function mapStudent(row, groupIds = []) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    parentPhone: row.parent_phone || '',
    publicCode: row.public_code || '',
    username: row.login || '',
    authUserId: row.auth_user_id || null,
    monthlyFee: 0,
    joinedAt: row.joined_at,
    groupIds,
  }
}

function mapPayment(row) {
  return {
    id: row.id,
    studentId: row.student_id || null,
    studentName: row.student_name || '',
    amount: Number(row.amount) || 0,
    month: row.month,
    year: row.year,
    paidAt: row.paid_at,
  }
}

function mapSalary(row) {
  return {
    id: row.id,
    teacherId: row.teacher_id,
    amount: Number(row.amount) || 0,
    paidAt: row.paid_at,
  }
}

function mapExpense(row) {
  return {
    id: row.id,
    title: row.title,
    amount: Number(row.amount) || 0,
    category: row.category,
    date: row.date,
    recordedBy: row.recorded_by,
  }
}

function mapAttendance(row) {
  return {
    id: row.id,
    studentId: row.student_id,
    groupId: row.group_id,
    date: row.date,
    status: row.status,
    note: row.note || '',
    markedBy: row.marked_by,
    markedAt: row.marked_at,
  }
}

function mapProfile(row) {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    role: row.role,
    teacherId: row.teacher_id,
    studentId: row.student_id,
  }
}

export async function loadAll(role = 'owner') {
  const db = requireClient()
  const isOwner = role === 'owner'
  const isAdmin = role === 'admin'

  const [
    profilesRes,
    teachersRes,
    groupsRes,
    studentsRes,
    linksRes,
    paymentsRes,
    salaryRes,
    expensesRes,
    attendanceRes,
  ] = await Promise.all([
    db.from('profiles').select('*').order('created_at'),
    db.from('teachers').select('*').order('created_at'),
    db.from('groups').select('*').order('created_at'),
    db.from('students').select('*').order('created_at'),
    db.from('group_students').select('*'),
    (isOwner || isAdmin) ? db.from('payments').select('*').order('paid_at') : Promise.resolve({ data: [], error: null }),
    isOwner ? db.from('salary_payments').select('*').order('paid_at') : Promise.resolve({ data: [], error: null }),
    isOwner ? db.from('expenses').select('*').order('date', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    db.from('attendance').select('*').order('date', { ascending: false }),
  ])

  const firstError = [
    profilesRes, teachersRes, groupsRes, studentsRes,
    linksRes, paymentsRes, salaryRes, expensesRes, attendanceRes,
  ].find((r) => r.error)?.error
  if (firstError) throw firstError

  const links = linksRes.data || []
  const studentIdsByGroup = {}
  const groupIdsByStudent = {}
  for (const link of links) {
    if (!studentIdsByGroup[link.group_id]) studentIdsByGroup[link.group_id] = []
    studentIdsByGroup[link.group_id].push(link.student_id)
    if (!groupIdsByStudent[link.student_id]) groupIdsByStudent[link.student_id] = []
    groupIdsByStudent[link.student_id].push(link.group_id)
  }

  const groups = (groupsRes.data || []).map((g) => mapGroup(g, studentIdsByGroup[g.id] || []))
  const students = (studentsRes.data || []).map((s) => {
    const student = mapStudent(s, groupIdsByStudent[s.id] || [])
    student.monthlyFee = studentMonthlyFee(student, groups)
    return student
  })

  return {
    users: (profilesRes.data || []).map(mapProfile),
    teachers: (teachersRes.data || []).map(mapTeacher),
    rooms: [],
    groups,
    students,
    payments: (paymentsRes.data || []).map(mapPayment),
    salaryPayments: (salaryRes.data || []).map(mapSalary),
    expenses: (expensesRes.data || []).map(mapExpense),
    attendance: (attendanceRes.data || []).map(mapAttendance),
  }
}

export async function fetchProfile(userId) {
  const { data, error } = await requireClient().auth.getUser()
  if (error) throw error
  if (!data.user || data.user.id !== userId) throw new Error('Foydalanuvchi profili topilmadi.')
  return mapProfile(data.user)
}

export async function addTeacher(payload) {
  const db = requireClient()
  const name = (payload.name || '').trim()
  if (!name) throw new Error(translate('domain.error.teacherNameRequired'))

  const username = (payload.username || '').trim()
  const password = String(payload.password || '')
  const wantsLogin = Boolean(username || password)
  if (wantsLogin && (!username || !password)) {
    throw new Error(translate('domain.error.credentialsRequired'))
  }
  if (wantsLogin && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(translate('domain.error.passwordTooShort'))
  }

  const salary = payload.monthlySalary == null || payload.monthlySalary === ''
    ? 0
    : Number(payload.monthlySalary)
  if (!Number.isFinite(salary) || salary < 0) throw new Error(translate('domain.error.salaryInvalid'))

  const phone = normalizePhone(payload.phone)
  const { data, error } = await db.from('teachers').insert({
    name,
    phone,
    monthly_salary: salary,
  }).select().single()
  if (error) throw error

  const teacher = mapTeacher(data)
  if (wantsLogin) {
    try {
      await createLinkedAccount({
        username,
        password,
        name,
        role: 'teacher',
        teacherId: teacher.id,
      })
    } catch (accountErr) {
      const reason = accountErr?.message || translate('domain.error.userNotCreated')
      return {
        ...teacher,
        loginError: translate('domain.error.teacherCreatedLoginFailed', { reason }),
      }
    }
  }
  return teacher
}

export async function updateTeacher(id, updates) {
  const db = requireClient()

  const username = String(updates.username || '').trim().toLowerCase()
  const password = String(updates.password || '')
  const wantsLogin = Boolean(username || password)

  const { data: linked, error: linkedError } = await db
    .from('profiles')
    .select('id, username')
    .eq('teacher_id', id)
    .eq('role', 'teacher')
    .maybeSingle()
  if (linkedError) throw linkedError

  if (linked && password) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(translate('domain.error.passwordTooShort'))
    }
  } else if (wantsLogin && !linked && (!username || !password)) {
    throw new Error(translate('domain.error.credentialsRequired'))
  }
  if (wantsLogin && !linked && password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(translate('domain.error.passwordTooShort'))
  }

  const patch = {}
  if (updates.name != null) patch.name = String(updates.name).trim()
  if (updates.phone != null) patch.phone = normalizePhone(updates.phone)
  if (updates.monthlySalary != null) patch.monthly_salary = Number(updates.monthlySalary)

  if (Object.keys(patch).length) {
    const { error } = await db.from('teachers').update(patch).eq('id', id)
    if (error) throw error
  }

  const name = patch.name
    || (await db.from('teachers').select('name').eq('id', id).single()).data?.name
    || ''

  if (!linked && username && password) {
    await createLinkedAccount({
      username,
      password,
      name,
      role: 'teacher',
      teacherId: id,
    })
    return
  }

  if (linked?.id) {
    const profilePatch = { name }
    if (username && username !== linked.username) {
      profilePatch.username = username
    }
    const { error: profileError } = await db.from('profiles').update(profilePatch).eq('id', linked.id)
    if (profileError) throw profileError

    if (password) {
      const { error: pwError } = await db.rpc('staff_set_user_password', {
        target_user: linked.id,
        new_password: password,
      })
      if (pwError) throw new Error(pwError.message || translate('domain.error.passwordChangeFailed'))
    }
  }
}

export async function deleteTeacher(id) {
  const db = requireClient()
  const { error } = await db.from('teachers').delete().eq('id', id)
  if (error) throw error
}

export async function addGroup(payload, currentGroups = []) {
  const db = requireClient()

  const schedule = normalizeSchedulePayload(payload.schedule, payload.teacherId)
  const draft = {
    name: (payload.name || '').trim(),
    teacherId: primaryGroupTeacherId({ schedule, teacherId: asUuidOrNull(payload.teacherId) }),
    roomId: null,
    monthlyFee: Number(String(payload.monthlyFee ?? '').replace(/\D/g, '')) || 0,
    schedule,
    studentIds: (payload.studentIds || []).map(asUuidOrNull).filter(Boolean),
  }
  if (!draft.name) throw new Error(translate('domain.error.groupNameRequired'))
  if (!Number.isFinite(draft.monthlyFee) || draft.monthlyFee < 0) {
    throw new Error(translate('domain.error.monthlyFeeInvalid'))
  }
  const conflict = validateGroupSchedule(currentGroups, draft)
  if (conflict) throw new Error(conflict)

  const row = {
    name: draft.name,
    teacher_id: draft.teacherId,
    monthly_fee: draft.monthlyFee,
    schedule: draft.schedule,
  }

  let { data, error } = await db.from('groups').insert(row).select().single()

  // Eski DB: monthly_fee ustuni yo'q bo'lsa, usiz qayta urinadi
  if (error && /monthly_fee|PGRST204/i.test(`${error.code || ''} ${error.message} ${error.details || ''} ${error.hint || ''}`)) {
    const withoutFee = { ...row }
    delete withoutFee.monthly_fee
    ;({ data, error } = await db.from('groups').insert(withoutFee).select().single())
  }

  if (error) throwDbError(error, 'domain.error.groupSaveFailed')

  const studentIds = draft.studentIds
  if (studentIds.length) {
    const { error: linkError } = await db.from('group_students').insert(
      studentIds.map((studentId) => ({ group_id: data.id, student_id: studentId })),
    )
    if (linkError) throwDbError(linkError, 'domain.error.groupSaveFailed')
  }

  return mapGroup(data, studentIds)
}

export async function updateGroup(id, updates, currentGroups = []) {
  const db = requireClient()
  const existing = currentGroups.find((g) => g.id === id)
  if (!existing) throw new Error(translate('domain.error.groupNotFound'))

  const nextSchedule = updates.schedule != null
    ? normalizeSchedulePayload(updates.schedule, updates.teacherId ?? existing.teacherId)
    : existing.schedule
  const merged = {
    ...existing,
    ...updates,
    schedule: nextSchedule,
    teacherId: updates.schedule != null
      ? primaryGroupTeacherId({ schedule: nextSchedule, teacherId: asUuidOrNull(updates.teacherId) })
      : (updates.teacherId !== undefined ? asUuidOrNull(updates.teacherId) : existing.teacherId),
    roomId: null,
  }
  if (updates.monthlyFee != null) {
    const fee = Number(String(updates.monthlyFee).replace(/\D/g, '')) || 0
    if (!Number.isFinite(fee) || fee < 0) throw new Error(translate('domain.error.monthlyFeeInvalid'))
    merged.monthlyFee = fee
  }
  // Faqat teacherId o‘zgarsa — barcha slotlarga bir xil o‘qituvchi
  if (updates.teacherId !== undefined && updates.schedule == null) {
    const tid = asUuidOrNull(updates.teacherId)
    merged.schedule = (existing.schedule || []).map((slot) => ({ ...slot, teacherId: tid }))
    merged.teacherId = tid
  }
  const conflict = validateGroupSchedule(currentGroups, merged, id)
  if (conflict) throw new Error(conflict)

  const patch = {}
  if (updates.name != null) patch.name = updates.name
  if (updates.teacherId !== undefined || updates.schedule != null) {
    patch.teacher_id = merged.teacherId
    patch.schedule = merged.schedule
  }
  if (updates.monthlyFee != null) patch.monthly_fee = merged.monthlyFee

  if (Object.keys(patch).length) {
    const { error } = await db.from('groups').update(patch).eq('id', id)
    if (error && patch.monthly_fee != null && /monthly_fee|PGRST204/i.test(`${error.code || ''} ${error.message}`)) {
      const withoutFee = { ...patch }
      delete withoutFee.monthly_fee
      const { error: retryError } = await db.from('groups').update(withoutFee).eq('id', id)
      if (retryError) throwDbError(retryError, 'domain.error.groupSaveFailed')
    } else if (error) {
      throwDbError(error, 'domain.error.groupSaveFailed')
    }
  }

  if (updates.studentIds) {
    const nextIds = updates.studentIds.map(asUuidOrNull).filter(Boolean)
    const { error: delError } = await db.from('group_students').delete().eq('group_id', id)
    if (delError) throwDbError(delError, 'domain.error.groupSaveFailed')
    if (nextIds.length) {
      const { error: insError } = await db.from('group_students').insert(
        nextIds.map((studentId) => ({ group_id: id, student_id: studentId })),
      )
      if (insError) throwDbError(insError, 'domain.error.groupSaveFailed')
    }
  }
}

export async function addStudent(payload) {
  const db = requireClient()
  const name = (payload.name || '').trim()
  if (!name) throw new Error(translate('domain.error.studentNameRequired'))

  const groupIds = payload.groupIds || []
  const { data, error } = await db.from('students').insert({
    name,
    phone: normalizePhone(payload.phone),
    parent_phone: parentPhoneForDb(payload) ?? '',
    monthly_fee: 0,
    joined_at: payload.joinedAt || todayISO(),
  }).select().single()
  if (error) throw error

  let credentials
  try {
    if (groupIds.length) {
      const { error: linkError } = await db.from('group_students').insert(
        groupIds.map((groupId) => ({ group_id: groupId, student_id: data.id })),
      )
      if (linkError) throw linkError
    }

    credentials = await createStudentCredentials(db, {
      studentId: data.id,
      name,
    })
    const { error: accountLinkError } = await db.from('students').update({
      login: credentials.username,
      auth_user_id: credentials.userId,
    }).eq('id', data.id)
    if (accountLinkError) throw accountLinkError
  } catch (error) {
    await db.from('group_students').delete().eq('student_id', data.id)
    await db.from('students').delete().eq('id', data.id)
    throw error
  }

  return {
    ...mapStudent({ ...data, login: credentials.username, auth_user_id: credentials.userId }, groupIds),
    credentials: {
      username: credentials.username,
      password: credentials.password,
      profileId: credentials.userId,
    },
  }
}

function studentUsernameBase(name) {
  const transliterated = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replaceAll('ў', 'u')
    .replaceAll('қ', 'q')
    .replaceAll('ғ', 'g')
    .replaceAll('ҳ', 'h')
    .replaceAll('ш', 'sh')
    .replaceAll('ч', 'ch')
    .replaceAll('ё', 'yo')
    .replaceAll('ю', 'yu')
    .replaceAll('я', 'ya')
    .replaceAll('ъ', '')
    .replaceAll('ь', '')
    .replaceAll('й', 'y')
    .replaceAll('а', 'a')
    .replaceAll('б', 'b')
    .replaceAll('в', 'v')
    .replaceAll('д', 'd')
    .replaceAll('е', 'e')
    .replaceAll('з', 'z')
    .replaceAll('и', 'i')
    .replaceAll('к', 'k')
    .replaceAll('л', 'l')
    .replaceAll('м', 'm')
    .replaceAll('н', 'n')
    .replaceAll('о', 'o')
    .replaceAll('п', 'p')
    .replaceAll('р', 'r')
    .replaceAll('с', 's')
    .replaceAll('т', 't')
    .replaceAll('у', 'u')
    .replaceAll('ф', 'f')
    .replaceAll('х', 'x')
    .replaceAll('э', 'e')
    .replaceAll('ц', 'ts')
    .replaceAll('ж', 'j')
    .replace(/[^a-z0-9]/g, '')
  return transliterated || 'student'
}

async function createStudentCredentials(db, { studentId, name }) {
  const base = studentUsernameBase(name)
  let username = base
  let suffix = 1
  while (true) {
    const { data: existing, error } = await db.from('profiles').select('id').eq('username', username).maybeSingle()
    if (error) throw error
    if (!existing) break
    username = `${base}${suffix}`
    suffix += 1
  }

  const password = `kp${String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000).padStart(5, '0')}s`
  const user = await createLinkedAccount({
    username,
    password,
    name,
    role: 'student',
    studentId,
  })
  return { username, password, userId: user.id }
}

export async function updateStudent(id, updates) {
  const db = requireClient()
  const patch = {}
  if (updates.name != null) patch.name = updates.name
  if (updates.phone != null) patch.phone = normalizePhone(updates.phone)
  const parentPacked = parentPhoneForDb(updates)
  if (parentPacked !== undefined) patch.parent_phone = parentPacked
  if (updates.joinedAt != null) patch.joined_at = updates.joinedAt
  // Oylik to‘lov guruhda — o‘quvchi yozuvida saqlanmaydi
  patch.monthly_fee = 0

  if (Object.keys(patch).length) {
    const { error } = await db.from('students').update(patch).eq('id', id)
    if (error) throw error
  }

  if (updates.groupIds) {
    const { error: delError } = await db.from('group_students').delete().eq('student_id', id)
    if (delError) throw delError
    if (updates.groupIds.length) {
      const { error: insError } = await db.from('group_students').insert(
        updates.groupIds.map((groupId) => ({ group_id: groupId, student_id: id })),
      )
      if (insError) throw insError
    }
  }
}

export async function resetUserCredentials(user) {
  const db = requireClient()
  const password = `kp${String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000).padStart(5, '0')}s`
  let username = user.username || ''
  if (!username) {
    const { data, error } = await db.from('profiles').select('username').eq('id', user.id).maybeSingle()
    if (error) throw error
    username = data?.username || ''
  }
  if (!username) throw new Error('Foydalanuvchining login ma’lumoti topilmadi.')

  const { error } = await db.rpc('staff_set_user_password', {
    target_user: user.id,
    new_password: password,
  })
  if (error) throw new Error(error.message || 'Vaqtinchalik parolni o‘rnatib bo‘lmadi.')
  return { username, password }
}

export async function resetStudentCredentials(student, users = []) {
  const db = requireClient()
  const linkedUser = users.find((user) => user.studentId === student.id)
  const userId = student.authUserId || linkedUser?.id
  if (userId) {
    return resetUserCredentials({
      id: userId,
      username: student.username || linkedUser?.username,
    })
  }

  const credentials = await createStudentCredentials(db, { studentId: student.id, name: student.name })
  const { error } = await db.from('students').update({
    login: credentials.username,
    auth_user_id: credentials.userId,
  }).eq('id', student.id)
  if (error) throw error
  return { username: credentials.username, password: credentials.password }
}

export async function deleteStudent(id) {
  const db = requireClient()

  // To‘lovlar moliya hisobotida qolishi uchun ismni oldindan yozib qo‘yamiz
  const { data: student } = await db
    .from('students')
    .select('name')
    .eq('id', id)
    .maybeSingle()

  if (student?.name) {
    const { error: nameError } = await db
      .from('payments')
      .update({ student_name: student.name })
      .eq('student_id', id)
    if (nameError) throwDbError(nameError, 'domain.error.dataLoadFailed')
  }

  const { error } = await db.from('students').delete().eq('id', id)
  if (error) throw error
}

export async function deleteGroup(id) {
  const db = requireClient()
  // Guruh o‘chadi, lekin o‘quvchi to‘lovlari (payments) o‘chmaydi — moliya tarixi saqlanadi
  const { error } = await db.from('groups').delete().eq('id', id)
  if (error) throw error
}

export async function addPayment(payload) {
  const db = requireClient()
  const amount = Number(payload.amount)
  const month = Number(payload.month)
  const year = Number(payload.year)
  if (!payload.studentId) throw new Error(translate('domain.error.studentRequired'))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(translate('domain.error.amountPositive'))
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(translate('domain.error.monthInvalid'))
  if (!Number.isInteger(year) || year < 2000) throw new Error(translate('domain.error.yearInvalid'))

  let studentName = String(payload.studentName || '').trim()
  if (!studentName) {
    const { data: student } = await db
      .from('students')
      .select('name')
      .eq('id', payload.studentId)
      .maybeSingle()
    studentName = student?.name || ''
  }

  const { error } = await db.from('payments').insert({
    student_id: payload.studentId,
    student_name: studentName,
    amount,
    month,
    year,
    paid_at: payload.paidAt || new Date().toISOString(),
  })
  if (error) throw error
}

export async function addSalaryPayment(payload) {
  const db = requireClient()
  const amount = Number(payload.amount)
  if (!payload.teacherId) throw new Error(translate('domain.error.teacherRequired'))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(translate('domain.error.amountPositive'))
  const { error } = await db.from('salary_payments').insert({
    teacher_id: payload.teacherId,
    amount,
    paid_at: payload.paidAt || new Date().toISOString(),
  })
  if (error) throw error
}

export async function addExpense(payload) {
  const db = requireClient()
  const title = (payload.title || '').trim()
  const amount = Number(payload.amount)
  if (!title) throw new Error(translate('domain.error.titleRequired'))
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(translate('domain.error.amountPositive'))
  const { error } = await db.from('expenses').insert({
    title,
    amount,
    category: toStoredExpenseCategory(payload.category),
    date: payload.date || todayISO(),
    recorded_by: payload.recordedBy || null,
  })
  if (error) throw error
}

export async function deleteExpense(id) {
  const db = requireClient()
  const { error } = await db.from('expenses').delete().eq('id', id)
  if (error) throw error
}

export async function markAttendance({ studentId, groupId, status, note, markedBy }) {
  const db = requireClient()
  if (!studentId || !groupId) throw new Error(translate('domain.error.attendanceSelectionRequired'))
  if (!['present', 'late', 'absent'].includes(status)) throw new Error(translate('domain.error.attendanceStatusInvalid'))
  const date = todayISO()
  const { error } = await db.from('attendance').upsert({
    student_id: studentId,
    group_id: groupId,
    date,
    status,
    note: note || '',
    marked_by: markedBy || null,
    marked_at: new Date().toISOString(),
  }, { onConflict: 'student_id,group_id,date' })
  if (error) throw error
}

async function restoreSession(db, session) {
  if (session?.access_token) {
    await db.auth.setSession({ access_token: session.access_token })
    return
  }
  try {
    await db.auth.signOut({ scope: 'local' })
  } catch {
    /* ignore */
  }
}

async function upsertLinkedProfile(db, { userId, username, name, role, teacherId, studentId }) {
  const profileData = {
    id: userId,
    username,
    name,
    role,
    teacher_id: teacherId || null,
    student_id: studentId || null,
  }
  const { data: existing, error: selectError } = await db
    .from('profiles')
    .select('id, username, name, role, teacher_id, student_id')
    .eq('id', userId)
    .maybeSingle()
  if (selectError) throw selectError
  if (
    existing
    && existing.username === profileData.username
    && existing.name === profileData.name
    && existing.role === profileData.role
    && existing.teacher_id === profileData.teacher_id
    && existing.student_id === profileData.student_id
  ) return

  const result = existing
    ? await db.from('profiles').update(profileData).eq('id', userId)
    : await db.from('profiles').insert(profileData)
  const { error } = result
  if (error) throw error
}

/** Allaqachon Auth da bor loginni parol bilan tekshirib teacher_id ga bog‘lash */
async function linkExistingTeacherAccount(db, {
  username,
  password,
  name,
  teacherId,
  currentSession,
}) {
  const candidates = [
    usernameToEmail(username),
    ...usernameToEmailCandidates(username),
  ].filter(Boolean)
  const unique = [...new Set(candidates)]

  let authUser = null
  for (const email of unique) {
    const { data, error } = await db.auth.signInWithPassword({ email, password })
    if (!error && data.user) {
      authUser = data.user
      break
    }
  }

  await restoreSession(db, currentSession)

  if (!authUser) {
    throw new Error(translate('domain.error.usernameTaken'))
  }

  await upsertLinkedProfile(db, {
    userId: authUser.id,
    username,
    name,
    role: 'teacher',
    teacherId,
  })
  return authUser
}

async function createLinkedAccount({ username, password, name, role, teacherId = null, studentId = null }) {
  const db = requireClient()
  const uname = normalizeUsername(username)
  const email = usernameToEmail(uname)
  if (!uname || !password) throw new Error(translate('domain.error.credentialsRequired'))
  if (uname.length < 2) throw new Error(translate('domain.error.loginInvalid'))
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(translate('domain.error.passwordTooShort'))

  const { data: sessionData } = await db.auth.getSession()
  const currentSession = sessionData.session

  const { data, error } = await db.auth.signUp({
    email,
    password,
    options: {
      data: {
        username: uname,
        name,
        role,
        teacher_id: teacherId || '',
        student_id: studentId || '',
      },
    },
  })

  if (error) {
    const msg = error.message || ''
    if (/already|registered|exists/i.test(msg) && role === 'teacher' && teacherId) {
      return linkExistingTeacherAccount(db, {
        username: uname,
        password,
        name,
        teacherId,
        currentSession,
      })
    }
    await restoreSession(db, currentSession)
    if (/email.*invalid|invalid.*email/i.test(msg)) {
      throw new Error(translate('domain.error.loginInvalid'))
    }
    if (/already|registered|exists/i.test(msg)) {
      throw new Error(translate('domain.error.usernameTaken'))
    }
    throw error
  }

  if (!data.user) {
    await restoreSession(db, currentSession)
    throw new Error(translate('domain.error.userNotCreated'))
  }

  // Avval owner sessiyasini qaytarib, keyin profilni teacher_id bilan yozamiz
  await restoreSession(db, currentSession)

  await upsertLinkedProfile(db, {
    userId: data.user.id,
    username: uname,
    name,
    role,
    teacherId,
    studentId,
  })

  // Akkaunt yaratilgan bo‘lsa ham sessiyasiz foydalanuvchini tizimga kiritmaymiz.
  if (!data.session) {
    throw new Error(translate('domain.error.authEmailConfirmOn'))
  }

  return { ...data, teacherId: data.teacher_id }.user
}

export async function updateOwnCredentials({ username, password }) {
  const db = requireClient()
  const { data: authData, error: authError } = await db.auth.getUser()
  if (authError || !authData?.user) {
    throw new Error(translate('domain.error.dataLoadFailed'))
  }

  const userId = authData.user.id
  const profile = await fetchProfile(userId)
  if (profile.role !== 'owner') {
    throw new Error(translate('domain.error.ownerOnlyCredentials'))
  }

  const uname = normalizeUsername(username)
  if (!uname || uname.length < 2) {
    throw new Error(translate('domain.error.loginInvalid'))
  }

  const nextPassword = String(password || '')
  if (nextPassword && nextPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(translate('domain.error.passwordTooShort'))
  }

  if (uname !== String(profile.username || '').toLowerCase()) {
    const { data: taken, error: takenError } = await db
      .from('profiles')
      .select('id')
      .eq('username', uname)
      .neq('id', userId)
      .maybeSingle()
    if (takenError) throw takenError
    if (taken?.id) throw new Error(translate('domain.error.usernameTaken'))

    const { error: profileError } = await db
      .from('profiles')
      .update({ username: uname })
      .eq('id', userId)
    if (profileError) {
      if (/unique|duplicate/i.test(profileError.message || '')) {
        throw new Error(translate('domain.error.usernameTaken'))
      }
      throw profileError
    }
  }

  if (nextPassword) {
    const { error: updateError } = await db.auth.updateUser({ password: nextPassword })
    if (updateError) {
      const { error: rpcError } = await db.rpc('staff_set_user_password', {
        target_user: userId,
        new_password: nextPassword,
      })
      if (rpcError) {
        throw new Error(rpcError.message || translate('domain.error.passwordChangeFailed'))
      }
    }
  }

  return { username: uname }
}

export async function addAdminUser({ name, username, password }) {
  return createLinkedAccount({
    name,
    username,
    password,
    role: 'admin',
  })
}

export async function removeAdminUser(id) {
  const db = requireClient()
  const { error } = await db.from('profiles').delete().eq('id', id).eq('role', 'admin')
  if (error) throw error
}

export { currentMonthYear }
